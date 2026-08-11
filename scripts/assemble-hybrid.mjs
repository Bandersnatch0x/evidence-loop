/**
 * Concat opener (concept) + live (product) clips into hybrid-*.mp4 (3 短条)
 * AND a single demo-full.mp4 timeline (复赛 item 4, ~2-3 min).
 * Uses ffmpeg-static so no system ffmpeg install is required.
 *
 *   node scripts/assemble-hybrid.mjs
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

// 归一化滤镜：统一 1440x900 30fps，letterbox 居中，与录制 recordVideo 尺寸一致。
const VF =
  'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,setsar=1'

// 3 条短混剪（向后兼容 README 方案 C）。
const pairs = [
  ['opener-code.webm', 'live-code.webm', 'hybrid-code.mp4'],
  ['opener-math.webm', 'live-math.webm', 'hybrid-math.mp4'],
  ['opener-fallback.webm', 'live-fallback.webm', 'hybrid-fallback.mp4']
]

// 单条完整演示视频时间轴（复赛 item 4，约 2-3 分钟）。
// opener 概念开场 -> 核心铁律 live -> 多模态 live，按铁律叙事排列。
// 缺失的片段会被跳过（文件不存在时 notFatal），便于渐进补录。
const timeline = [
  'opener-code.webm',
  'live-evidence.webm',
  'live-tutoring.webm',
  'opener-math.webm',
  'live-math.webm',
  'live-teacher.webm',
  'opener-fallback.webm',
  'live-fallback.webm'
]
const fullOutput = 'demo-full.mp4'

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

async function exists(name) {
  const { access } = await import('node:fs/promises')
  try {
    await access(join(outDir, name))
    return true
  } catch {
    return false
  }
}

/** 把若干片段归一化为临时 mp4 后用 concat demuxer 流复制拼接。 */
async function concatClips(clips, outputName) {
  const output = join(outDir, outputName)
  const tmpFiles = []
  for (let i = 0; i < clips.length; i += 1) {
    const tmp = join(outDir, `_tmp_${outputName}.${i}.mp4`)
    tmpFiles.push(tmp)
    runFfmpeg([
      '-y',
      '-i',
      join(outDir, clips[i]),
      '-vf',
      VF,
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      tmp
    ])
  }

  const list = join(outDir, `_concat_${outputName}.txt`)
  const listBody = tmpFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n'
  await writeFile(list, listBody, 'utf8')

  runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', output])

  await Promise.allSettled([...tmpFiles.map((f) => unlink(f)), unlink(list)])
  console.log(`wrote ${outputName}`)
}

async function assemble([openerName, liveName, outputName]) {
  await concatClips([openerName, liveName], outputName)
}

async function assembleFull() {
  // 过滤掉不存在的片段（渐进补录期间允许部分缺失）。
  const present = []
  for (const clip of timeline) {
    if (await exists(clip)) {
      present.push(clip)
    } else {
      console.log(`skip missing: ${clip}`)
    }
  }
  if (present.length === 0) {
    console.log('no timeline clips present, skip demo-full.mp4')
    return
  }
  await concatClips(present, fullOutput)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  // 3 条短混剪（向后兼容）。
  for (const pair of pairs) {
    await assemble(pair)
  }
  // 单条完整演示视频。
  await assembleFull()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
