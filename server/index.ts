/**
 * EvidenceRing HTTP entry + pure route dispatcher.
 *
 * Architecture deepening C2: inline routes (cohort / audit / mastery / review /
 * multimodal / assignments / knowledge) extracted behind the same
 * `handle*Api → boolean` seam as evaluationRoutes. This file owns transport
 * (listener, Vite, static assets, error envelope) and ordered dispatch only.
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViteDevServer } from 'vite'
import { createServerContext } from './serverContext'
import type { ApiContext, EvidenceRingServerOptions } from './serverTypes'
import { HttpError, respondJson } from './http/httpUtils'
import { tryHandleAuthRoute } from './auth/authRoutes'
import { AuthError, authStatusCode } from './auth/errors'
import { handleAdaptiveApi } from './adaptive'
import { handleAssignmentApi } from './data/assignmentRoutes'
import { handleCohortApi } from './data/cohortRoutes'
import { handleKnowledgeApi } from './data/knowledgeRoutes'
import { handleEvaluationApi } from './domain/evaluationRoutes'
import { tryHandleImportRoute } from './import'
import { handleTeacherApi } from './teacher'
import { handleStudentApi } from './student'
import { handleTutoringApi } from './tutoring'
import { handleQuestionBankApi } from './questionbank/questionRoutes'
import { handleMediaApi } from './media/mediaRoutes'
import { handleReviewerApi } from './demonstration/reviewerRoutes'
import { handlePlayerApi } from './demonstration/playerRoutes'
import { handleAuthorApi } from './demonstration/authorRoutes'
import { handleAiApi } from './demonstration/aiRoutes'
import { handleReferenceApi } from './demonstration/referenceRoutes'
import { handleLibraryApi } from './demonstration/libraryRoutes'
import { tryHandleMaterialImportRoute } from './materialImport'
import { handleMockExamApi } from './mockExam'
import { handleTransparencyApi } from './transparency/transparencyRoutes'
import { handleStudyPlanApi } from './studyPlan/studyPlanRoutes'
import { handleWeeklyReportApi } from './reports'
import { handleParentApi } from './parent'
import { handleAchievementApi } from './achievements'
import { handleTaskTemplateApi } from './taskTemplate'
import { handleDialogueApi } from './dialogue/dialogueRoutes'
import { tryHandleFlashcardDraftRoute } from './flashcardDraft'
import { handlePortfolioApi } from './portfolio/portfolioRoutes'
import { handleMultimodalApi } from './multimodal/multimodalRoutes'
import { handleMasteryApi } from './mastery/masteryRoutes'
import { handleReviewApi } from './review/reviewRoutes'
import { handleAuditApi } from './audit/auditRoutes'
import { PIIError } from './pii/PIIDetector'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const isProduction = process.argv.includes('--production')
const port = Number(process.env.PORT ?? 4180)

export async function createEvidenceRingServer(
  options: EvidenceRingServerOptions = {}
) {
  const composed = await createServerContext(options)
  let vite: ViteDevServer | undefined
  try {
    vite = options.vite ? await createViteMiddleware() : undefined
  } catch (error) {
    await composed.dispose()
    throw error
  }

  const server = createServer((request, response) => {
    void routeRequest(request, response, composed.context, vite)
  })
  server.once('close', () => {
    void composed.dispose()
  })
  return server
}

export { createConfiguredRunner } from './runner/configuredRunner'

async function start(): Promise<void> {
  const server = await createEvidenceRingServer({ vite: !isProduction })

  server.listen(port, '0.0.0.0', () => {
    console.log(`EvidenceRing running at http://localhost:${String(port)}`)
  })
}

async function createViteMiddleware(): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import('vite')
  // Prefer an explicit free HMR port. The default 24678 collides when another
  // Vite instance is already alive on the machine, which throws a page error
  // and confuses Playwright boot checks.
  const hmrPort = Number(process.env.VITE_HMR_PORT ?? 24679)
  return createViteServer({
    root: projectRoot,
    server: {
      middlewareMode: true,
      hmr: {
        port: hmrPort,
        clientPort: hmrPort
      }
    },
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
    if (error instanceof PIIError && !response.headersSent) {
      respondJson(response, 422, { error: error.message })
      return
    }
    // Real-session provider throws AuthError on unauthenticated requests.
    if (error instanceof AuthError && !response.headersSent) {
      respondJson(response, authStatusCode(error), { error: error.message })
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
  context: ApiContext
): Promise<void> {
  const {
    assignments,
    store,
    agent,
    runnerName,
    knowledge,
    audit,
    sessions,
    memory,
    interventions,
    stt
  } = context

  // Auth routes (register/login/activate/change-password/logout) do not
  // require a session — they're the entry to obtaining one. Must run BEFORE
  // sessions.resolve, otherwise real-mode unauthenticated callers throw.
  if (
    await tryHandleAuthRoute(request, response, requestUrl, {
      auth: context.auth,
      sessions
    })
  ) {
    return
  }

  // Health is an infrastructure probe — no auth required.
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    respondJson(response, 200, {
      status: 'ok',
      runner: runnerName,
      feedback: process.env.LLM_API_KEY ? 'llm-with-fallback' : 'local-policy'
    })
    return
  }

  const user = sessions.resolve(request)

  // Core presentation / evaluation / mastery routes (hot path).
  if (
    handleAssignmentApi(request, response, requestUrl, {
      assignments,
      questionBank: context.questionBank,
      // Presentation-only reference lookup stays outside AssignmentRegistry
      // so EvaluationAgent/scoring never reads demonstration tables.
      listStudentReferencesForAssignment: (assignmentId) =>
        context.demonstration.references.listStudentReferencesForAssignment(
          assignmentId
        )
    })
  ) {
    return
  }

  if (
    await handleEvaluationApi(request, response, requestUrl, {
      store,
      agent,
      runnerName,
      audit,
      mastery: memory.mastery,
      review: memory.review,
      evidenceProjector: context.evidenceProjector,
      user,
      achievements: context.achievements
    })
  ) {
    return
  }

  if (
    await handleCohortApi(request, response, requestUrl, {
      db: context.productDb,
      store,
      audit,
      user
    })
  ) {
    return
  }

  if (
    await handleKnowledgeApi(request, response, requestUrl, { knowledge })
  ) {
    return
  }

  if (
    await handleAuditApi(request, response, requestUrl, {
      db: context.productDb,
      audit,
      user
    })
  ) {
    return
  }

  if (
    await handleMultimodalApi(request, response, requestUrl, {
      audit,
      stt,
      user
    })
  ) {
    return
  }

  if (
    await handleMasteryApi(request, response, requestUrl, {
      db: context.productDb,
      audit,
      mastery: memory.mastery,
      interventions,
      user
    })
  ) {
    return
  }

  if (
    await handleReviewApi(request, response, requestUrl, {
      db: context.productDb,
      audit,
      review: memory.review,
      user
    })
  ) {
    return
  }

  // ---------------------------------------------------------------------------
  // Effort 2 vertical slices (T15-T23). Each returns true when it consumed the
  // request. All follow ADR-0001: suggestions only, never write score/evidence.
  //
  // ORDER MATTERS: these MUST run before handleStudentApi / handleTeacherApi,
  // which consume every /api/student/* and /api/teacher/* prefix (unknown
  // sub-paths also return true with 404). T15-T23 own several /api/student/*
  // and /api/teacher/* endpoints, so they get first claim on the prefix.
  // ---------------------------------------------------------------------------
  // T22 ticket aliases: /material-import/transcript|audio → flashcard drafts
  if (
    requestUrl.pathname === '/api/teacher/material-import/transcript' ||
    requestUrl.pathname === '/api/teacher/material-import/audio'
  ) {
    const rewritten = new URL(requestUrl.href)
    rewritten.pathname =
      requestUrl.pathname.endsWith('/audio')
        ? '/api/teacher/flashcard-drafts/audio'
        : '/api/teacher/flashcard-drafts'
    if (
      await tryHandleFlashcardDraftRoute(request, response, rewritten, {
        flashcardDraft: context.flashcardDraft,
        user
      })
    ) {
      return
    }
  }
  if (
    await tryHandleMaterialImportRoute(request, response, requestUrl, {
      materialImportService: context.materialImport,
      user
    })
  ) {
    return
  }
  if (
    await handleMockExamApi(request, response, requestUrl, {
      db: context.productDb,
      mockExam: context.mockExam,
      user,
      org: context.org,
      audit: context.audit
    })
  ) {
    return
  }
  if (handleTransparencyApi(request, response, requestUrl.pathname)) {
    return
  }
  if (
    await handleStudyPlanApi(request, response, requestUrl, {
      db: context.productDb,
      studyPlan: context.studyPlan,
      user,
      org: context.org,
      assign: context.assignByWeakness
    })
  ) {
    return
  }
  if (
    await handleWeeklyReportApi(request, response, requestUrl, {
      db: context.productDb,
      weeklyReport: context.weeklyReport,
      org: context.org,
      user,
      exports: context.weeklyReportExports,
      audit,
      parentBindings: context.parentChildBindings
    })
  ) {
    return
  }
  if (
    handleParentApi(request, response, requestUrl, {
      user,
      bindings: context.parentChildBindings
    })
  ) {
    return
  }
  if (
    await handleAchievementApi(request, response, requestUrl, {
      db: context.productDb,
      achievements: context.achievements,
      user,
      org: context.org
    })
  ) {
    return
  }
  if (
    await handleTaskTemplateApi(request, response, requestUrl, {
      db: context.productDb,
      taskTemplates: context.taskTemplates,
      user,
      org: context.org
    })
  ) {
    return
  }
  if (
    await handleDialogueApi(request, response, requestUrl, {
      dialogue: context.dialogue,
      user
    })
  ) {
    return
  }
  if (
    await tryHandleFlashcardDraftRoute(request, response, requestUrl, {
      flashcardDraft: context.flashcardDraft,
      user
    })
  ) {
    return
  }
  if (
    await handlePortfolioApi(request, response, requestUrl, {
      db: context.productDb,
      portfolio: context.portfolio,
      org: context.org,
      user,
      exports: context.portfolioExports,
      audit
    })
  ) {
    return
  }

  // ---------------------------------------------------------------------------
  // Delegated module routers (T02-T08). Each returns true when it consumed the
  // request. Kept after the core evaluation/mastery routes so those stay hot.
  // (Auth routes are handled above, before sessions.resolve.)
  // ---------------------------------------------------------------------------
  if (
    await handleQuestionBankApi(request, response, requestUrl, {
      questionBank: context.questionBank,
      db: context.productDb,
      questionStore: context.questionStore,
      user
    })
  ) {
    return
  }
  if (
    await handleTutoringApi(request, response, requestUrl, {
      tutoring: context.tutoring,
      user
    })
  ) {
    return
  }
  if (
    await tryHandleImportRoute(request, response, requestUrl, {
      importService: context.importService,
      user
    })
  ) {
    return
  }
  if (
    await handleAdaptiveApi(request, response, requestUrl, {
      db: context.productDb,
      nextPractice: context.nextPractice,
      assignByWeakness: context.assignByWeakness,
      user
    })
  ) {
    return
  }
  if (
    await handleStudentApi(request, response, requestUrl, {
      sessions: context.practiceSessions,
      mistakes: context.mistakes,
      tips: context.tips,
      user
    })
  ) {
    return
  }
  if (
    await handleTeacherApi(request, response, requestUrl, {
      teachingUnits: context.teachingUnits,
      roster: context.roster,
      assignments: context.assignmentService,
      grading: context.grading,
      tips: context.tips,
      user
    })
  ) {
    return
  }
  if (
    await handleMediaApi(request, response, requestUrl, {
      db: context.media.db,
      blobs: context.media.blobs,
      uploads: context.media.uploads,
      processor: context.media.processor,
      scanner: context.media.scanner,
      user
    })
  ) {
    return
  }
  if (
    await handleReviewerApi(request, response, requestUrl, {
      db: context.demonstration.db,
      demoService: context.demonstration.demoService,
      aiQuota: context.demonstration.aiQuota,
      references: context.demonstration.references,
      review: context.demonstration.review,
      evidence: context.demonstration.evidence,
      notifications: context.demonstration.notifications,
      reports: context.demonstration.reports,
      appeals: context.demonstration.appeals,
      user
    })
  ) {
    return
  }
  if (
    handlePlayerApi(request, response, requestUrl.pathname, {
      db: context.demonstration.db,
      references: context.demonstration.references,
      getRole: () => user.role
    })
  ) {
    return
  }
  if (
    await handleAuthorApi(request, response, requestUrl.pathname, {
      db: context.demonstration.db,
      service: context.demonstration.demoService,
      getUserId: () => user.userId
    })
  ) {
    return
  }
  if (
    await handleAiApi(request, response, requestUrl.pathname, {
      db: context.demonstration.db,
      service: context.demonstration.demoService,
      quota: context.demonstration.aiQuota,
      getUserId: () => user.userId
    })
  ) {
    return
  }
  if (
    await handleReferenceApi(request, response, requestUrl.pathname, requestUrl, {
      db: context.demonstration.db,
      references: context.demonstration.references,
      notifications: context.demonstration.notifications,
      getUserId: () => user.userId,
      getRole: () => user.role
    })
  ) {
    return
  }
  if (
    handleLibraryApi(request, response, requestUrl.pathname, requestUrl, {
      db: context.demonstration.db,
      getUserId: () => user.userId
    })
  ) {
    return
  }

  respondJson(response, 404, { error: 'API route not found' })
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
