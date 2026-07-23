/**
 * Concat opener (concept) + live (product) clips into hybrid-*.webm/mp4.
 * Uses ffmpeg-static so no system ffmpeg install is required.
 */
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'screenshots', 'demo-videos')

if (!ffmpegPath) {
  console.error('ffmpeg-static binary not found')
  process.exit(1)
}

const pairs = [
  ['opener-code.webm', 'live-code.webm', 'hybrid-code.mp4'],
  ['opener-math.webm', 'live-math.webm', 'hybrid-math.mp4'],
  ['opener-fallback.webm', 'live-fallback.webm', 'hybrid-fallback.mp4']
]

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    throw new Error(`ffmpeg failed: ${args.join(' ')}`)
  }
}

async function assemble([openerName, liveName, outputName]) {
  const opener = join(outDir, openerName)
  const live = join(outDir, liveName)
  const output = join(outDir, outputName)
  const tmpOpen = join(outDir, `_tmp_${outputName}.open.mp4`)
  const tmpLive = join(outDir, `_tmp_${outputName}.live.mp4`)
  const list = join(outDir, `_concat_${outputName}.txt`)

  const vf =
    'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,setsar=1'

  runFfmpeg([
    '-y',
    '-i',
    opener,
    '-vf',
    vf,
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    tmpOpen
  ])
  runFfmpeg([
    '-y',
    '-i',
    live,
    '-vf',
    vf,
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    tmpLive
  ])

  // concat demuxer wants forward slashes
  const listBody = [
    `file '${tmpOpen.replace(/\\/g, '/')}'`,
    `file '${tmpLive.replace(/\\/g, '/')}'`,
    ''
  ].join('\n')
  await writeFile(list, listBody, 'utf8')

  runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', output])

  await Promise.allSettled([unlink(tmpOpen), unlink(tmpLive), unlink(list)])
  console.log(`wrote ${output}`)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  for (const pair of pairs) {
    await assemble(pair)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
