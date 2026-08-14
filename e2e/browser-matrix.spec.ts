/**
 * T-M browser-matrix smoke (Playwright). Chromium, Firefox, and WebKit
 * projects each verify app boot, student/teacher role boundaries, studio
 * lazy-load navigation, and a mobile viewport overflow guard. The dev server
 * is started automatically by playwright.config.ts.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:4180'
const ROLE_LABELS = {
  student: '学生',
  teacher: '教师',
  admin: '管理员'
} as const

async function gotoApp(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
}

async function selectDemoRole(
  page: Page,
  role: keyof typeof ROLE_LABELS
): Promise<void> {
  await page.getByLabel('演示角色切换').click()
  await page.getByRole('option', { name: ROLE_LABELS[role], exact: true }).click()
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
    await selectDemoRole(page, 'student')
    await expect(page.getByRole('button', { name: '教师工作台' })).toHaveCount(0)
    await expect(page.getByText('教学演示创作台', { exact: true })).toHaveCount(0)
    await expect(page.getByText('生成演示', { exact: false })).toHaveCount(0)
  })

  test('teacher workbench exposes and loads the studio tab', async ({ page }) => {
    await gotoApp(page)
    await selectDemoRole(page, 'teacher')
    await page.getByRole('button', { name: '教师工作台' }).click()
    const studioTab = page.getByRole('tab', { name: /教学演示创作台/i })
    await expect(studioTab).toBeVisible()
    await studioTab.click()
    await expect(page.getByText('教学演示创作台', { exact: true })).toBeVisible()
  })

  // Heavy case: cold engine import + WebGL2 context under load can exceed the
  // default poll budget, so the engine-boot poll gets an explicit timeout (see
  // tests/App.test.tsx for the same resource-contention budget pattern).
  test('PlayCanvas studio viewport builds the 3D scene and runs the render loop', async ({ page }) => {
    test.setTimeout(60_000)
    await gotoApp(page)
    await selectDemoRole(page, 'teacher')
    await page.getByRole('button', { name: '教师工作台' }).click()
    await page.getByRole('tab', { name: /教学演示创作台/i }).click()
    await page.getByRole('button', { name: '空白 3D 场景' }).click()

    const canvas = page.getByLabel('PlayCanvas 场景画布')
    await expect(canvas).toBeVisible()
    await expect(page.getByText(/WebGL2.*停用/)).toHaveCount(0)

    // Scene graph must be built from the SceneDocument (box + camera + lights).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as Record<string, unknown>
            const debug = w.__pcDebug as { built?: number } | undefined
            return debug?.built ?? 0
          }),
        { timeout: 20_000, intervals: [500, 1000, 1000, 2000] }
      )
      .toBeGreaterThan(0)

    // Render loop must advance (frame counter increases).
    const frame = (): Promise<number> =>
      page.evaluate(() => {
        const w = window as unknown as { __pcApp?: { frame?: number } }
        return w.__pcApp?.frame ?? -1
      })
    const frameA = await frame()
    await page.waitForTimeout(600)
    const frameB = await frame()
    expect(frameB).toBeGreaterThan(frameA)

    // Orbit input must change the camera (view matrix row changes).
    const viewA = await page.evaluate(() => {
      const w = window as unknown as { __pcApp?: { root: { findByName: (n: string) => { getWorldTransform: () => { data: ArrayLike<number> } } | null } } }
      const cam = w.__pcApp?.root.findByName('studio-camera')
      return cam ? Array.from(cam.getWorldTransform().data).slice(0, 12) : null
    })
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.35, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const viewB = await page.evaluate(() => {
      const w = window as unknown as { __pcApp?: { root: { findByName: (n: string) => { getWorldTransform: () => { data: ArrayLike<number> } } | null } } }
      const cam = w.__pcApp?.root.findByName('studio-camera')
      return cam ? Array.from(cam.getWorldTransform().data).slice(0, 12) : null
    })
    expect(viewB).not.toBeNull()
    expect(viewB!.some((value, index) => Math.abs(value - (viewA![index] as number)) > 0.001)).toBe(true)
  })

  test('mobile viewport renders without horizontal overflow (flow layout)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoApp(page)
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflowX).toBeLessThanOrEqual(0)
  })

  test('teacher question editor exposes the demonstration reference drawer', async ({ page, request }) => {
    // T-J/T-17 business loop: 题库 → 编辑题 → 教学演示引用抽屉挂载（检索/已引用）。
    // Seed questions are read-only; create a teacher-owned question so the
    // 编辑 button renders, then exercise the reference drawer on it.
    await gotoApp(page)
    await selectDemoRole(page, 'teacher')
    await request.post('/api/questions', {
      headers: { 'X-Demo-Role': 'teacher' },
      data: {
        questionBankId: 'seed-demo-bank',
        subject: 'math',
        questionType: 'choice',
        stem: 'e2e 演示引用题',
        payload: { kind: 'choice', correctOptionIds: ['A'] },
        kpIds: [],
        difficulty: 1
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectDemoRole(page, 'teacher')
    await page.getByRole('button', { name: '教师工作台' }).click()
    await page.getByRole('tab', { name: /题库录入/i }).click()
    await page.getByRole('button', { name: /编辑/i }).first().click()
    await expect(page.getByText('编辑题目', { exact: true })).toBeVisible()
    const refToggle = page.getByText('管理教学演示引用')
    await expect(refToggle).toBeVisible()
    await refToggle.click()
    await expect(page.getByLabel('检索')).toBeVisible()
    await expect(page.getByText(/已引用/)).toBeVisible()
  })
})
