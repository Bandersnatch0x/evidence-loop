/**
 * RoleGate — deep module for demo-role view access.
 *
 * Sidebar already encodes `roles[]` on nav items; App previously re-implemented
 * the same check as 8 shallow ternaries. One interface concentrates the gate.
 */
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DemoRole } from '../../shared/contracts'

export interface RoleGateProps {
  /** Current demo role. */
  role: DemoRole
  /** Roles allowed to see children. Empty/undefined = all roles. */
  allow?: readonly DemoRole[]
  /** Message shown when the current role is denied. */
  deniedMessage: string
  children: ReactNode
}

/**
 * Render children when `role` is in `allow` (or allow is open).
 * Otherwise render a consistent denied status block.
 */
export function RoleGate({
  role,
  allow,
  deniedMessage,
  children
}: RoleGateProps) {
  const permitted =
    allow === undefined || allow.length === 0 || allow.includes(role)

  if (permitted) return <>{children}</>

  return (
    <div className="view-loading role-denied" role="status">
      <AlertTriangle size={18} />
      {deniedMessage}
    </div>
  )
}
