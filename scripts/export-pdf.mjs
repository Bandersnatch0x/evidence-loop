import { chromium } from 'playwright'
import { resolve } from 'node:path'

const htmlPath = resolve('docs/presentation.html')
const pdfPath = resolve('docs/EvidenceRing-功能演示.pdf')

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.pdf({
    path: pdfPath,
    width: '1280px',
    height: '800px',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true
  })
  await browser.close()
  console.log('PDF generated:', pdfPath)
}

main().catch((e) => { console.error(e); process.exit(1) })
