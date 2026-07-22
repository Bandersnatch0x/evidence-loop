import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ViteDevServer } from 'vite'
import type { ApiError } from '../shared/contracts'
import { createAssignmentRegistry } from './data/assignments'
import { createCohortSnapshot } from './data/cohort'
import { createKnowledgeBase } from './data/knowledge'
import { EvaluationAgent } from './domain/EvaluationAgent'
import { createFeedbackGenerator } from './domain/feedback'
import { PythonSubprocessRunner } from './runner/PythonSubprocessRunner'
import { JsonEvaluationStore } from './store/EvaluationStore'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const isProduction = process.argv.includes('--production')
const port = Number(process.env.PORT ?? 4173)
const maxRequestBodyBytes = 256 * 1024

const evaluateRequestSchema = z.object({
  assignmentId: z.string().min(1),
  code: z.string().min(1).max(20_000),
  previousEvaluationId: z.string().min(1).optional()
})

interface ApiContext {
  assignments: ReturnType<typeof createAssignmentRegistry>
  store: JsonEvaluationStore
  agent: EvaluationAgent
}

interface EvidenceLoopServerOptions {
  dataFile?: string
  vite?: boolean
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

export async function createEvidenceLoopServer(
  options: EvidenceLoopServerOptions = {}
) {
  const assignments = createAssignmentRegistry()
  const store = new JsonEvaluationStore(
    options.dataFile ?? join(projectRoot, '.data', 'evaluations.json')
  )
  const context: ApiContext = {
    assignments,
    store,
    agent: new EvaluationAgent({
      assignments,
      knowledge: createKnowledgeBase(),
      runner: new PythonSubprocessRunner(),
      feedback: createFeedbackGenerator()
    })
  }
  const vite = options.vite ? await createViteMiddleware() : undefined

  return createServer((request, response) => {
    void routeRequest(request, response, context, vite)
  })
}

async function start(): Promise<void> {
  const server = await createEvidenceLoopServer({ vite: !isProduction })

  server.listen(port, '0.0.0.0', () => {
    console.log(`EvidenceLoop running at http://localhost:${String(port)}`)
  })
}

async function createViteMiddleware(): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import('vite')
  return createViteServer({
    root: projectRoot,
    server: { middlewareMode: true },
    appType: 'spa'
  })
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ApiContext,
  vite?: ViteDevServer
): Promise<void> {
  try {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? `localhost:${String(port)}`}`
    )

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(request, response, requestUrl, context)
      return
    }

    if (requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'public, max-age=86400' })
      response.end()
      return
    }

    if (vite) {
      vite.middlewares.handle(request, response, () => {
        respondJson(response, 404, { error: 'Not found' })
      })
      return
    }

    await serveProductionAsset(requestUrl.pathname, response)
  } catch (error) {
    if (error instanceof HttpError && !response.headersSent) {
      respondJson(response, error.statusCode, { error: error.message })
      return
    }
    console.error(error)
    if (!response.headersSent) {
      respondJson(response, 500, { error: 'Internal server error' })
    } else {
      response.end()
    }
  }
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  { assignments, store, agent }: ApiContext
): Promise<void> {
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    respondJson(response, 200, {
      status: 'ok',
      runner: 'python-subprocess',
      feedback: process.env.LLM_API_KEY ? 'llm-with-fallback' : 'local-policy'
    })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/assignments') {
    respondJson(response, 200, assignments.list())
    return
  }

  const assignmentMatch = requestUrl.pathname.match(/^\/api\/assignments\/([^/]+)$/)
  if (request.method === 'GET' && assignmentMatch?.[1]) {
    const assignment = assignments.get(decodeURIComponent(assignmentMatch[1]))
    if (!assignment) {
      respondJson(response, 404, { error: 'Assignment not found' })
      return
    }
    const publicAssignment = {
      id: assignment.id,
      title: assignment.title,
      module: assignment.module,
      language: assignment.language,
      estimatedMinutes: assignment.estimatedMinutes,
      status: assignment.status,
      objective: assignment.objective,
      scenario: assignment.scenario,
      requirements: assignment.requirements,
      constraints: assignment.constraints,
      functionSignature: assignment.functionSignature,
      rubric: assignment.rubric,
      demoVariants: assignment.demoVariants
    }
    respondJson(response, 200, publicAssignment)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/evaluations') {
    respondJson(
      response,
      200,
      await store.list(requestUrl.searchParams.get('assignmentId') ?? undefined)
    )
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/evaluations') {
    const parsed = evaluateRequestSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid evaluation request',
        details: parsed.error.issues.map((issue) => issue.message)
      } satisfies ApiError)
      return
    }

    const previous = parsed.data.previousEvaluationId
      ? await store.get(parsed.data.previousEvaluationId)
      : await store.latest(parsed.data.assignmentId)
    const evaluation = await agent.evaluate(parsed.data, previous)
    await store.save(evaluation)
    respondJson(response, 201, evaluation)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/cohort') {
    respondJson(response, 200, createCohortSnapshot(await store.list()))
    return
  }

  respondJson(response, 404, { error: 'API route not found' })
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)

  if (Number.isFinite(declaredSize) && declaredSize > maxRequestBodyBytes) {
    throw new HttpError(413, 'Request body is too large')
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxRequestBodyBytes) {
      throw new HttpError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpError(400, 'Malformed JSON request body')
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(payload))
}

async function serveProductionAsset(
  pathname: string,
  response: ServerResponse
): Promise<void> {
  const distRoot = join(projectRoot, 'dist')
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
  const normalizedPath = normalize(requestedPath)
  let filePath = resolve(distRoot, normalizedPath)

  if (!isPathInside(distRoot, filePath)) {
    respondJson(response, 403, { error: 'Forbidden' })
    return
  }

  try {
    const fileStats = await stat(filePath)
    if (fileStats.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    filePath = join(distRoot, 'index.html')
  }

  try {
    const fileStats = await stat(filePath)
    response.writeHead(200, {
      'content-type': contentType(extname(filePath)),
      'content-length': fileStats.size,
      'cache-control': filePath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable'
    })
    createReadStream(filePath).pipe(response)
  } catch {
    const html = await readFile(join(distRoot, 'index.html'), 'utf8')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  }
}

function contentType(extension: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
  }
  return types[extension] ?? 'application/octet-stream'
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (
    !isAbsolute(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
  )
}

const entryPath = process.argv[1] ? normalize(resolve(process.argv[1])) : ''
const modulePath = normalize(fileURLToPath(import.meta.url))
if (entryPath.toLowerCase() === modulePath.toLowerCase()) {
  void start()
}
