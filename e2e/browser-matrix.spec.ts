/**
 * T-M browser-matrix smoke (Playwright). Chromium, Firefox, and WebKit
 * projects each verify app boot, student/teacher role boundaries, studio
 * lazy-load navigation, and a mobile viewport overflow guard. The dev server
 * is started automatically by playwright.config.ts.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'

async function gotoApp(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'networkidle' })
}

test.describe('T-M browser matrix', () => {
  test('app boots and renders the workspace shell', async ({ page }) => {
    await gotoApp(page)
    await expect(page).toHaveTitle('循证环 · EvidenceRing')
    await expect(page.getByLabel('演示角色切换')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  })

  test('student role has no teacher studio or demo-authoring entry', async ({ page }) => {
    await gotoApp(page)
    await page.getByLabel('演示角色切换').selectOption('student')
    await expect(page.getByRole('button', { name: '教师工作台' })).toHaveCount(0)
    await expect(page.getByText('教学演示创作台', { exact: true })).toHaveCount(0)
    await expect(page.getByText('生成演示', { exact: false })).toHaveCount(0)
  })

  test('teacher workbench exposes and loads the studio tab', async ({ page }) => {
    await gotoApp(page)
    await page.getByLabel('演示角色切换').selectOption('teacher')
    await page.getByRole('button', { name: '教师工作台' }).click()
    const studioTab = page.getByRole('tab', { name: /教学演示创作台/i })
    await expect(studioTab).toBeVisible()
    await studioTab.click()
    await expect(page.getByText('教学演示创作台', { exact: true })).toBeVisible()
  })

  test('mobile viewport renders without horizontal overflow (flow layout)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoApp(page)
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflowX).toBeLessThanOrEqual(0)
  })
})
