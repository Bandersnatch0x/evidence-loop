// Screenshot capture — student + teacher key pages for PROJECT_PARAMETERS.md
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4180'
const OUT = 'docs/screenshots/pages'

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log('captured', name)
}

async function setRole(page, role) {
  await page.getByLabel('演示角色切换').selectOption(role)
  await page.waitForTimeout(600)
}

async function nav(page, label) {
  // open sidebar on mobile, direct click on desktop
  const btn = page.getByRole('button', { name: label })
  await btn.first().scrollIntoViewIfNeeded().catch(() => {})
  await btn.first().click()
  await page.waitForTimeout(1500)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  // ---- Desktop ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await shot(page, 'student-workspace')
  await setRole(page, 'student')

  await nav(page, '我的掌握度')
  await page.waitForTimeout(2000)
  await shot(page, 'student-mastery-intervention')

  await nav(page, '今日复习')
  await shot(page, 'student-review')

  await nav(page, '我的练习')
  await page.waitForTimeout(2000)
  await shot(page, 'student-practice-dualmode')

  await nav(page, '我的循证计划')
  await page.waitForTimeout(2000)
  await shot(page, 'student-plan-hub')

  await setRole(page, 'teacher')
  await nav(page, '教师工作台')
  await page.waitForTimeout(2000)
  await shot(page, 'teacher-workbench')

  await nav(page, '班级学情')
  await page.waitForTimeout(2000)
  await shot(page, 'teacher-cohort-tabs')

  await nav(page, '项目透明度')
  await shot(page, 'transparency-view')

  await page.close()

  // ---- Mobile (separate context) ----
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await m.goto(BASE, { waitUntil: 'networkidle' })
  await m.waitForTimeout(1500)
  await m.getByRole('button', { name: '打开导航' }).click()
  await m.waitForTimeout(500)
  await shot(m, 'mobile-sidebar')
  await m.getByLabel('演示角色切换').selectOption('teacher')
  await m.waitForTimeout(500)
  await m.getByRole('button', { name: '教师工作台' }).click()
  await m.waitForTimeout(1500)
  await shot(m, 'mobile-teacher-workbench')

  await browser.close()
  console.log('done')
}

main().catch((e) => { console.error(e); process.exit(1) })
