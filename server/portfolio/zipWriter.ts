/**
 * zipWriter — 零依赖的最小 ZIP 归档器（T23 导出下载用）。
 *
 * 刻意不引入 adm-zip / yazl：包体只有 portfolio.json + README.md，用
 * method=0（STORE，不压缩）即可，既确定又可读 —— 测试能直接按
 * local file header 扫描条目内容，无需任何解压依赖。
 *
 * 铁律（ADR-0003）：zip 内容只来自入站已净化的 PortfolioPackage 与 README，
 * 本函数本身不产生任何自由文本。
 */
import { createHash } from 'node:crypto'

/** 一条 zip 条目。 */
export interface ZipEntry {
  /** 归档内路径，如 'portfolio.json'。 */
  name: string
  /** 条目内容（UTF-8）。 */
  data: string
}

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

/**
 * 把一组条目归档为 zip 字节（method=0 store，UTF-8 文件名）。
 * 输出字节确定：相同条目必得相同 zip（时间戳用固定 0，避免非确定性）。
 */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const data = entries.map((entry) => Buffer.from(entry.data, 'utf8'))
  const names = entries.map((entry) => Buffer.from(entry.name, 'utf8'))

  const chunks: Buffer[] = []
  const offsets: number[] = []
  let offset = 0

  // 1) local file headers + data
  for (let index = 0; index < entries.length; index += 1) {
    const body = data[index]
    const name = names[index]
    const crc = crc32(body ?? Buffer.alloc(0))
    const size = body?.length ?? 0
    offsets.push(offset)

    const header = Buffer.alloc(30)
    header.writeUInt32LE(LOCAL_FILE_HEADER, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0x0800, 6) // flags: UTF-8
    header.writeUInt16LE(0, 8) // method = store
    header.writeUInt16LE(0, 10) // mod time
    header.writeUInt16LE(0, 12) // mod date
    header.writeUInt32LE(crc >>> 0, 14)
    header.writeUInt32LE(size, 18) // compressed size
    header.writeUInt32LE(size, 22) // uncompressed size
    header.writeUInt16LE(name?.length ?? 0, 26)
    header.writeUInt16LE(0, 28) // extra length

    chunks.push(header, name ?? Buffer.alloc(0), body ?? Buffer.alloc(0))
    offset += (name?.length ?? 0) + (body?.length ?? 0) + 30
  }

  // 2) central directory
  const centralStart = offset
  for (let index = 0; index < entries.length; index += 1) {
    const body = data[index]
    const name = names[index]
    const crc = crc32(body ?? Buffer.alloc(0))
    const size = body?.length ?? 0

    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0)
    header.writeUInt16LE(20, 4) // version made by
    header.writeUInt16LE(20, 6) // version needed
    header.writeUInt16LE(0x0800, 8) // flags: UTF-8
    header.writeUInt16LE(0, 10) // method = store
    header.writeUInt16LE(0, 12) // mod time
    header.writeUInt16LE(0, 14) // mod date
    header.writeUInt32LE(crc >>> 0, 16)
    header.writeUInt32LE(size, 20)
    header.writeUInt32LE(size, 24)
    header.writeUInt16LE(name?.length ?? 0, 28)
    header.writeUInt16LE(0, 30) // extra len
    header.writeUInt16LE(0, 32) // comment len
    header.writeUInt16LE(0, 34) // disk number
    header.writeUInt16LE(0, 36) // internal attrs
    header.writeUInt32LE(0, 38) // external attrs
    header.writeUInt32LE(offsets[index] ?? 0, 42) // local header offset

    chunks.push(header, name ?? Buffer.alloc(0))
    offset += (name?.length ?? 0) + 46
  }

  // 3) end of central directory
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
  end.writeUInt16LE(0, 4) // disk number
  end.writeUInt16LE(0, 6) // central dir disk
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - centralStart, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20) // comment len
  chunks.push(end)

  return Buffer.concat(chunks)
}

/** 从 zip 字节里按名字取出某条目内容（method=store，仅测试/校验用）。 */
export function readZipEntry(zip: Buffer, target: string): string | undefined {
  let cursor = 0
  while (cursor + 30 <= zip.length) {
    const signature = zip.readUInt32LE(cursor)
    if (signature !== LOCAL_FILE_HEADER) return undefined
    const nameLength = zip.readUInt16LE(cursor + 26)
    const dataLength = zip.readUInt32LE(cursor + 18)
    const name = zip
      .subarray(cursor + 30, cursor + 30 + nameLength)
      .toString('utf8')
    if (name === target) {
      return zip
        .subarray(cursor + 30 + nameLength, cursor + 30 + nameLength + dataLength)
        .toString('utf8')
    }
    cursor += 30 + nameLength + dataLength
  }
  return undefined
}

// ---------------------------------------------------------------------------
// CRC-32（IEEE 802.3，表驱动，无依赖）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let byte = 0; byte < 256; byte += 1) {
    let value = byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[byte] = value >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 稳定文件名（导出下载的 content-disposition 用）：去掉 PII 化的时间戳只留别名。 */
export function portfolioFilename(studentAlias: string): string {
  const safe = studentAlias.replace(/[^\w.-]/g, '_')
  const digest = createHash('sha256')
    .update(studentAlias)
    .digest('hex')
    .slice(0, 8)
  return `portfolio_${safe}_${digest}.zip`
}
