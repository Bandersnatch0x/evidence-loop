/**
 * Password hashing with node:crypto scrypt — zero native deps beyond the
 * Node runtime. Encoding: `scrypt$N$r$p$saltHex$keyHex`.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16
const ACTIVATION_CODE_BYTES = 6

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN)
  const key = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })
  return encodeScrypt(salt, key)
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = decodeScrypt(encoded)
  if (parsed === null) return false
  const candidate = scryptSync(password, parsed.salt, parsed.key.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p
  })
  if (candidate.length !== parsed.key.length) return false
  return timingSafeEqual(candidate, parsed.key)
}

/** One-time student activation code (base64url, ~8 chars of entropy). */
export function generateActivationCode(): string {
  return randomBytes(ACTIVATION_CODE_BYTES).toString('base64url')
}

export function hashActivationCode(code: string): string {
  return hashPassword(normalizeActivationCode(code))
}

export function verifyActivationCode(code: string, encoded: string): boolean {
  return verifyPassword(normalizeActivationCode(code), encoded)
}

function normalizeActivationCode(code: string): string {
  return code.trim()
}

function encodeScrypt(salt: Buffer, key: Buffer): string {
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('hex'),
    key.toString('hex')
  ].join('$')
}

interface ScryptParams {
  N: number
  r: number
  p: number
  salt: Buffer
  key: Buffer
}

function decodeScrypt(encoded: string): ScryptParams | null {
  const parts = encoded.split('$')
  if (parts.length !== 6) return null
  const [algo, nRaw, rRaw, pRaw, saltHex, keyHex] = parts
  if (algo !== 'scrypt') return null
  if (
    nRaw === undefined ||
    rRaw === undefined ||
    pRaw === undefined ||
    saltHex === undefined ||
    keyHex === undefined
  ) {
    return null
  }
  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null
  }
  if (N <= 0 || r <= 0 || p <= 0) return null
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) {
    return null
  }
  if (saltHex.length % 2 !== 0 || keyHex.length % 2 !== 0) return null
  return {
    N,
    r,
    p,
    salt: Buffer.from(saltHex, 'hex'),
    key: Buffer.from(keyHex, 'hex')
  }
}
