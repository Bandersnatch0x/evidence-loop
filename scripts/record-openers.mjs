/**
 * Record 6s Ken-Burns openers from still frames (Imagine stills).
 * Video gen API unavailable under ZDR; this yields real opener clips.
 */
import { mkdir, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'screenshots', 'demo-videos')
const htmlPath = join(root, 'scripts', 'ken-burns-opener.html')

const shots = [
  {
    name: 'opener-code',
    image: join(root, 'docs', 'screenshots', 'demo-videos', 'opener-code.jpg'),
    label: '代码辅导 · 概念开场'
  },
  {
    name: 'opener-math',
    image: join(root, 'docs', 'screenshots', 'demo-videos', 'opener-math.jpg'),
    label: '数学双通道 · 概念开场'
  },
  {
    name: 'opener-fallback',
    image: join(root, 'docs', 'screenshots', 'demo-videos', 'opener-fallback.jpg'),
    label: '弱网降级 · 概念开场'
  }
]

async function recordOne(shot) {
  // Prefer system Chrome so we don't require a Playwright browser download.
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: outDir, size: { width: 1440, height: 900 } }
  })
  const page = await context.newPage()
  const url =
    pathToFileURL(htmlPath).href
    + `?src=${encodeURIComponent(pathToFileURL(shot.image).href)}`
    + `&label=${encodeURIComponent(shot.label)}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(6200)
  const video = page.video()
  await page.close()
  await context.close()
  await browser.close()
  if (!video) return
  const raw = await video.path()
  const target = join(outDir, `${shot.name}.webm`)
  const { rename } = await import('node:fs/promises')
  try {
    await rename(raw, target)
  } catch {
    await copyFile(raw, target)
  }
  console.log(`saved ${target}`)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  for (const shot of shots) {
    await recordOne(shot)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
