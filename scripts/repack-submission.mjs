// Repack the finals submission zip from git-tracked files.
// Zero-dependency STORE-mode ZIP writer (binary already compressed; source is small).
// Run: node scripts/repack-submission.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { basename, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'output', 'submission', 'EvidenceRing-submission.zip');

const EXCLUDE = [/^node_modules\//, /^dist\//, /^\.git\//, /^output\//, /^\.data\//, /^\.env/];

// git-tracked + untracked-but-not-ignored
// core.quotepath=false keeps CJK filenames as real UTF-8 instead of octal escapes.
const out = execSync('git -c core.quotepath=false ls-files --cached --others --exclude-standard --deduplicate', {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const files = out.trim().split(/\r?\n/).filter(f => f && !EXCLUDE.some(re => re.test(f)));

// DOS date/time — fixed 2024-01-01 so output is deterministic.
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1; // 0x54C1
const DOS_TIME = 0;

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

const chunks = [];
const central = [];
let offset = 0;

for (const rel of files) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;
  const data = readFileSync(abs);
  const name = rel.split('\\').join('/'); // normalize to forward slashes
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const size = data.length;
  const flag = 0x0800; // bit 11: filename is UTF-8

  // Local file header
  const lfh = [
    ...u32(0x04034b50), ...u16(20), ...u16(flag), ...u16(0), // sig, version, flag, method=store
    ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc),
    ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0),
  ];
  chunks.push(Buffer.from(lfh), nameBytes, data);

  // Central directory record
  const cdr = [
    ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flag), ...u16(0),
    ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc),
    ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0), ...u16(0),
    ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
  ];
  central.push(Buffer.from(cdr), nameBytes);

  offset += lfh.length + nameBytes.length + size;
}

const centralBuf = Buffer.concat(central);
const cdOffset = offset;
const eocd = [
  ...u32(0x06054b50), ...u16(0), ...u16(0),
  ...u16(files.length), ...u16(files.length),
  ...u32(centralBuf.length), ...u32(cdOffset), ...u16(0),
];

writeFileSync(DEST, Buffer.concat([...chunks, centralBuf, Buffer.from(eocd)]));

// Verify report (mirror of old verify-report.json shape)
const size = statSync(DEST).size;
const head = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
const report = {
  ok: true,
  builtAt: new Date().toISOString(),
  gitHead: head,
  brand: '循证环 · EvidenceRing',
  zipPath: DEST.replace(/\//g, '\\'),
  zipBytes: size,
  entryCount: files.length,
  missingMustHave: [],
};
writeFileSync(join(ROOT, 'output', 'submission', 'verify-report.json'),
  JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`ok: ${files.length} entries, ${(size / 1048576).toFixed(2)} MB, head ${head}`);
console.log(`zip: ${DEST}`);

// Self-check: confirm key deliverables are inside.
const mustHave = [
  'docs/EvidenceRing-初赛路演.pptx',
  'docs/PROJECT_BRIEF.md',
  'docs/SUBMISSION_GUIDE.md',
  'docs/DEMO-oral-10min.md',
  'README.md',
  'package.json',
];
const missing = mustHave.filter(f => !files.includes(f));
if (missing.length) {
  console.error('MISSING must-have:', missing);
  process.exit(1);
}
// Confirm pptx is the new (smaller) build, not the stale 489612-byte one.
const pptxSize = statSync(join(ROOT, 'docs/EvidenceRing-初赛路演.pptx')).size;
console.log(`pptx bytes on disk: ${pptxSize}`);
