/**
 * Real-product screen recordings for multimodal demos (ticket 022 hybrid pack).
 *
 * Requires: server already running with MULTIMODAL_ENABLED=true and
 * VITE_MULTIMODAL_ENABLED=true (e.g. npm run dev with those env vars).
 *
 * Usage:
 *   node scripts/record-demo-videos.mjs [baseUrl]
 *
 * Outputs under docs/screenshots/demo-videos/:
 *   live-code.webm | live-math.webm | live-fallback.webm
 */

import { mkdir, writeFile } from 'node:fs/promises'
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
      const { rename } = await import('node:fs/promises')
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

  // Switch to teacher → cohort usage panel (counts only).
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

  await withRecording('live-code', recordCode)
  await withRecording('live-math', recordMath)
  await withRecording('live-fallback', recordFallback)

  await writeFile(
    join(outDir, 'README.md'),
    [
      '# Demo videos (hybrid pack)',
      '',
      '## Live product recordings (Playwright)',
      '- `live-code.webm` — bug submit → voice ask simulation → highlight',
      '- `live-math.webm` — KaTeX view → dual-channel ask → highlight',
      '- `live-fallback.webm` — webspeech path + teacher multimodal usage counts',
      '',
      '## Imagine openers (concept B-roll)',
      '- `opener-code.mp4` / `opener-math.mp4` / `opener-fallback.mp4`',
      '',
      '## Hybrid assembly',
      'See `assemble-hybrid.ps1` or run ffmpeg concat when ffmpeg is available.',
      '',
      'Live clips are **real product UI**. Openers are **AI concept motion** — label as such in pitch materials.',
      ''
    ].join('\n'),
    'utf8'
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
