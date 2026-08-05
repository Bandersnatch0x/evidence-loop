/**
 * verify-build-budget.mjs — production build budget gate (ticket T-M/T-17).
 *
 * Runs AFTER `vite build` in `npm run check`. Asserts:
 *   - the demo UI is split into independently loaded chunks (StudentPlayer /
 *     TeacherStudio are NOT inlined into the main bundle);
 *   - per-chunk size budgets hold, so the studio and player stay off the
 *     critical path and slow networks keep the student workspace snappy.
 *
 * Budgets are generous baselines (not micro-targets); adjust when the module
 * legitimately grows, never to silence a regression.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist', 'assets')

const BUDGETS = [
  // Main entry — app shell + question bank + workspace. Keep off 3D engine.
  { match: /^index-.*\.js$/, maxBytes: 700 * 1024 },
  // Teacher studio loads only when the teacher opens the tab.
  { match: /^TeacherStudio-.*\.js$/, maxBytes: 200 * 1024 },
  // Student player loads only when a demonstration is present.
  { match: /^StudentPlayer-.*\.js$/, maxBytes: 100 * 1024 },
  // Full PlayCanvas engine is large but must remain a named, teacher-only lazy chunk.
  { match: /^playcanvas-engine-.*\.js$/, maxBytes: 2_600 * 1024 }
]

if (!existsSync(dist)) {
  console.error('dist/assets not found — run `npm run build` before this gate.')
  process.exit(1)
}

const files = readdirSync(dist).filter((f) => f.endsWith('.js'))
const sizes = new Map(files.map((f) => [f, statSync(join(dist, f)).size]))

let failed = false
for (const budget of BUDGETS) {
  const matches = files.filter((f) => budget.match.test(f))
  if (matches.length === 0) {
    console.error(`budget ${budget.match} — no matching chunk in dist/assets`)
    failed = true
    continue
  }
  for (const file of matches) {
    const bytes = sizes.get(file) ?? 0
    const ok = bytes <= budget.maxBytes
    console.log(
      `${ok ? 'ok ' : 'FAIL'} ${file.padEnd(38)} ${(bytes / 1024).toFixed(1)} KiB (budget ${(budget.maxBytes / 1024).toFixed(0)} KiB)`
    )
    if (!ok) failed = true
  }
}

// Split proof: studio/player component code must NOT be inlined into the main
// chunk. Vite writes dynamic-import chunk filenames into the main bundle, so
// filename matches are expected; instead probe for unique component content
// markers that would only appear if the code itself were bundled inline.
const mainIndex = files.find((f) => /^index-.*\.js$/.test(f))
if (mainIndex) {
  const main = readFileSync(join(dist, mainIndex), 'utf8')
  for (const [marker, label] of [
    ['studio-object-tree', 'TeacherStudio'],
    ['student-player-svg', 'StudentPlayer'],
    ['studio-scene-content', 'PlayCanvasStudioViewport']
  ]) {
    const inlined = main.includes(marker)
    console.log(`${inlined ? 'FAIL' : 'ok '} ${label} code not inlined into ${mainIndex}`)
    if (inlined) failed = true
  }
}

if (failed) {
  console.error('\nBuild budget gate FAILED — review dist/ asset growth.')
  process.exit(1)
}
console.log('\nBuild budget gate passed.')
