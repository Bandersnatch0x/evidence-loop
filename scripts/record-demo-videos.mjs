/**
 * Real-product screen recordings for multimodal demos (ticket 022 hybrid pack)
 * + 核心铁律路径三段（复赛 item 4 补录）。
 *
 * Requires: server already running with MULTIMODAL_ENABLED=true and
 * VITE_MULTIMODAL_ENABLED=true (e.g. npm run dev with those env vars).
 *
 * Usage:
 *   node scripts/record-demo-videos.mjs [baseUrl]
 *
 * Outputs under docs/screenshots/demo-videos/:
 *   live-code.webm | live-math.webm | live-fallback.webm   (multimodal)
 *   live-evidence.webm | live-tutoring.webm | live-teacher.webm  (核心铁律, item 4)
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'screenshots', 'demo-videos')
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4180'

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRecording(name, run) {
  // Prefer system Chrome so we don't require a Playwright browser download.
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: outDir,
      size: { width: 1440, height: 900 }
    },
    locale: 'zh-CN'
  })
  const page = await context.newPage()
  try {
    await run(page)
  } finally {
    const video = page.video()
    await page.close()
    await context.close()
    await browser.close()
    if (video) {
      const rawPath = await video.path()
      const target = join(outDir, `${name}.webm`)
      // Playwright names files randomly; rename after close.
      const { rename, writeFile } = await import('node:fs/promises')
      try {
        await rename(rawPath, target)
      } catch {
        // If rename fails (cross-device), leave raw and write a pointer.
        await writeFile(
          join(outDir, `${name}.path.txt`),
          `${rawPath}\n`,
          'utf8'
        )
      }
      console.log(`saved ${target}`)
    }
  }
}

async function openWorkspace(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForSelector('text=学习工作台', { timeout: 30_000 })
  // Ensure student role for workspace demos.
  const role = page.getByLabel('演示角色切换')
  if (await role.count()) {
    await role.selectOption('student')
    await sleep(800)
  }
}

/** Drive voice pipeline without mic: ask API + highlight event. */
async function simulateVoiceAsk(page, text) {
  const voiceBtn = page.getByRole('button', { name: /按住说话|松开结束/ })
  if (await voiceBtn.count()) {
    // Visual press state.
    await voiceBtn.dispatchEvent('pointerdown')
    await sleep(600)
    await voiceBtn.dispatchEvent('pointerup')
  }

  await page.evaluate(async (askText) => {
    const response = await fetch('/api/multimodal/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-role': 'student'
      },
      body: JSON.stringify({ text: askText, durationMs: 1800 })
    })
    const body = await response.json()
    const llmOutput = body.llmOutput ?? ''
    // Mirror client pipeline: parse HIGHLIGHT and fire overlay event.
    const match = /\[HIGHLIGHT:selector="([^"]+)"\]/.exec(llmOutput)
    if (match?.[1]) {
      window.dispatchEvent(
        new CustomEvent('multimodal:highlight', {
          detail: { selector: match[1], durationMs: 3500 }
        })
      )
    }
    // Show transcript/reply in the companion if elements exist.
    const transcript = document.querySelector('.voice-transcript')
    if (transcript) transcript.textContent = `你说：${askText}`
    const reply = document.querySelector('.voice-reply')
    if (reply) {
      const spoken = llmOutput.replace(/\[[^\]]+\]/g, '').trim()
      reply.textContent = `助手：${spoken}`
    }
  }, text)
  await sleep(3500)
}

async function recordCode(page) {
  await openWorkspace(page)
  await sleep(1000)

  // Prefer boundary-bug variant.
  const variant = page.locator('select, [role="listbox"]').first()
  // Click demo variant buttons if present.
  const bugVariant = page.getByRole('button', { name: /边界缺陷|存在边界/ })
  if (await bugVariant.count()) {
    await bugVariant.first().click()
    await sleep(400)
  }

  const runBtn = page.getByRole('button', { name: '运行循证评估' })
  await runBtn.click()
  await page.waitForSelector('text=/分|空序列|证据/', { timeout: 30_000 })
  await sleep(1500)

  await simulateVoiceAsk(page, '哪里错了？')
  await sleep(2000)
}

async function recordMath(page) {
  await openWorkspace(page)
  await sleep(1000)

  // Scroll math problem into view if present.
  const math = page.locator('.math-problem, [data-katex-id]').first()
  if (await math.count()) {
    await math.scrollIntoViewIfNeeded()
    await sleep(800)
  }

  await simulateVoiceAsk(page, '第 3 步为什么错？')
  await sleep(2500)
}

async function recordFallback(page) {
  await openWorkspace(page)
  await sleep(800)

  // Banner-like pause on workspace with voice UI visible (webspeech path).
  const voice = page.locator('.voice-companion')
  if (await voice.count()) {
    await voice.scrollIntoViewIfNeeded()
  }
  await sleep(1200)

  // Switch to teacher -> cohort usage panel (counts only).
  const role = page.getByLabel('演示角色切换')
  await role.selectOption('teacher')
  await sleep(1000)

  const cohortNav = page.getByRole('button', { name: '班级学情' })
  if (await cohortNav.count()) {
    await cohortNav.click()
    await sleep(1500)
  }

  const usage = page.locator('.cohort-multimodal-usage')
  if (await usage.count()) {
    await usage.scrollIntoViewIfNeeded()
    await sleep(2500)
  } else {
    await sleep(2000)
  }
}

// ---- 复赛 item 4：核心铁律路径（补录）----
// 三段覆盖评分铁律：分数只来自证据 / 辅导不改分 / 终裁不折叠 + 提示不是分。
// 每步 if(await el.count()) 防御，选择器偶发缺失只跳过该停留点，不致命。
// 教师段不点终态按钮（布置/发送/提交终裁），避免污染 demo 数据。

/** 铁律一：分数只来自可复现证据。学生 -> 今日该练 -> 运行循证评估 -> 证据+分数环。 */
async function recordEvidence(page) {
  await openWorkspace(page)
  await sleep(1000)

  const todayTitle = page.getByRole('heading', { name: '今日该练' })
  if (await todayTitle.count()) {
    await todayTitle.scrollIntoViewIfNeeded()
    await sleep(600)
  }
  const startBtn = page.getByRole('button', { name: '开始练' })
  if (await startBtn.count()) {
    await startBtn.first().click()
    await sleep(1000)
  }

  const runBtn = page.getByRole('button', { name: '运行循证评估' })
  if (await runBtn.count()) {
    await runBtn.click()
  }
  await page.waitForSelector('.results-panel', { timeout: 30_000 })
  await page.waitForSelector('[data-testid="evaluation-score"]', { timeout: 20_000 })
  await sleep(1500)

  const score = page.getByTestId('evaluation-score')
  if (await score.count()) {
    await score.scrollIntoViewIfNeeded()
  }
  const evidenceList = page.locator('.evidence-list')
  if (await evidenceList.count()) {
    await evidenceList.first().scrollIntoViewIfNeeded()
    await sleep(2000)
  }
  const shield = page.locator('.evidence-shield-trigger')
  if (await shield.count()) {
    await shield.first().scrollIntoViewIfNeeded()
    await sleep(1500)
  }
  const policy = page.locator('.policy-badge')
  if (await policy.count()) {
    await policy.first().scrollIntoViewIfNeeded()
    await sleep(1200)
  }
  await sleep(800)
}

/** 铁律二：AI 辅导不改分。练习态求助 -> 铁律文案 -> 分数不变。 */
async function recordTutoring(page) {
  await openWorkspace(page)
  await sleep(1000)

  const runBtn = page.getByRole('button', { name: '运行循证评估' })
  if (await runBtn.count()) {
    await runBtn.click()
    await page.waitForSelector('.results-panel', { timeout: 30_000 })
    await page.waitForSelector('[data-testid="evaluation-score"]', { timeout: 20_000 })
  }

  const tutoring = page.locator('.tutoring-panel')
  if (await tutoring.count()) {
    await tutoring.first().scrollIntoViewIfNeeded()
    await sleep(1500)
  }
  const aiBadge = page.locator('.tutoring-panel .ai-inference-badge')
  if (await aiBadge.count()) {
    await aiBadge.first().scrollIntoViewIfNeeded()
    await sleep(1500)
  }

  await simulateVoiceAsk(page, '哪里错了？')
  await sleep(2000)

  const scoreAfter = page.getByTestId('evaluation-score')
  if (await scoreAfter.count()) {
    await scoreAfter.scrollIntoViewIfNeeded()
    await sleep(1500)
  }
  await sleep(500)
}

/** 铁律三：教师终裁不折叠进 score + 提示不是分。切教师 -> 布置/发提示/终裁/学情。 */
async function recordTeacher(page) {
  // 先进工作台（加载页面与侧栏），再切教师角色。
  await openWorkspace(page)
  await sleep(1000)

  const role = page.getByLabel('演示角色切换')
  if (await role.count()) {
    await role.selectOption('teacher')
    await sleep(1500)
  }
  const teachNav = page.getByRole('button', { name: '教师工作台' })
  if (await teachNav.count()) {
    await teachNav.click()
    await sleep(1500)
  }

  const demoUnit = page.getByRole('button', { name: '使用演示单元 tu-demo' })
  if (await demoUnit.count()) {
    await demoUnit.click()
    await sleep(1200)
  }

  const assignTab = page.getByRole('tab', { name: '布置作业' })
  if (await assignTab.count()) {
    await assignTab.click()
    await sleep(800)
  }
  const composer = page.locator('.assignment-composer')
  if (await composer.count()) {
    await composer.first().scrollIntoViewIfNeeded()
    await sleep(2000)
  }

  const tipsTab = page.getByRole('tab', { name: '发提示' })
  if (await tipsTab.count()) {
    await tipsTab.click()
    await sleep(800)
  }
  const tipComposer = page.locator('.tip-composer')
  if (await tipComposer.count()) {
    await tipComposer.first().scrollIntoViewIfNeeded()
    await sleep(2000)
  }

  const gradeTab = page.getByRole('tab', { name: '主观题批改' })
  if (await gradeTab.count()) {
    await gradeTab.click()
    await sleep(1000)
  }
  const gradingRow = page.locator('.grading-row')
  if (await gradingRow.count()) {
    await gradingRow.first().scrollIntoViewIfNeeded()
    await sleep(2500)
  } else {
    await sleep(1500)
  }

  const cohortNav = page.getByRole('button', { name: '班级学情' })
  if (await cohortNav.count()) {
    await cohortNav.click()
    await sleep(1500)
  }
  const metricGrid = page.locator('.metric-grid')
  if (await metricGrid.count()) {
    await metricGrid.first().scrollIntoViewIfNeeded()
    await sleep(2500)
  }
  await sleep(800)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  console.log(`recording against ${baseUrl}`)

  // Health check.
  const health = await fetch(`${baseUrl}/api/health`).catch(() => null)
  if (!health || !health.ok) {
    throw new Error(
      `Server not reachable at ${baseUrl}. Start with MULTIMODAL_ENABLED=true VITE_MULTIMODAL_ENABLED=true npm run dev`
    )
  }

  // 多模态三条（向后兼容既有 hybrid 包）。
  // 支持 CLIP=live-xxx 只录指定片段（重录单段用）。
  const clip = process.env.CLIP
  const want = (name) => !clip || clip === name

  const jobs = [
    ['live-code', recordCode],
    ['live-math', recordMath],
    ['live-fallback', recordFallback],
    ['live-evidence', recordEvidence],
    ['live-tutoring', recordTutoring],
    ['live-teacher', recordTeacher]
  ]
  for (const [name, fn] of jobs) {
    if (want(name)) {
      await withRecording(name, fn)
    }
  }

  // 不再覆写 README.md（docs/screenshots/demo-videos/README.md 为人工维护的方案 C 文档）。
  console.log('done: 6 clips recorded (3 multimodal + 3 core-铁律).')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
