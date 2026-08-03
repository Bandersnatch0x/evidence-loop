/**
 * Reviewer authorization helper (spec §2.8, §5.2, decision 04/14).
 *
 * The public-library reviewer is a FLAG COLUMN on `users`
 * (`public_library_reviewer`), NOT a role-enum expansion. This module is the
 * single read-path for that flag so the route layer and the T-F governance
 * services (reports / appeals / evidence panel) stay consistent with the
 * T-D ReviewService check, which already gates approve/reject/takedown.
 *
 * Reviewers only ever read public-library governance endpoints - they are
 * never granted teaching / grade / audit-view authority (spec §2.8).
 */
import type { Database } from 'better-sqlite3'

/**
 * Does this user hold the public-library reviewer flag? Returns false when the
 * user row is absent (demo/mock sessions whose principal has no DB row are
 * never reviewers - fail-closed).
 */
export function isPublicLibraryReviewer(
  db: Database,
  userId: string
): boolean {
  const row = db
    .prepare(`SELECT public_library_reviewer AS flag FROM users WHERE id = ?`)
    .get(userId) as { flag: number } | undefined
  return row?.flag === 1
}
