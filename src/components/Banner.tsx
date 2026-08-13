/**
 * Banner — shared status/error/success message primitive.
 *
 * Owns the ARIA contract (role + aria-live) and the icon, so every call site
 * gets correct, consistent semantics for free. Replaces ~10 hand-inlined
 * error-banner / success-banner / view-loading blocks that had drifted
 * (icon size, missing role, two CSS classes for the same semantic).
 */
import type { ReactNode } from 'react'
import { AlertTriangle, Check } from 'lucide-react'

export type BannerTone = 'error' | 'success' | 'loading' | 'denied'

export interface BannerProps {
  tone: BannerTone
  children: ReactNode
  /** Override the default icon (default depends on tone). */
  icon?: ReactNode
  className?: string
}

const TONE_CONFIG: Record<
  BannerTone,
  { role: string; ariaLive?: 'polite' | 'assertive'; className: string }
> = {
  error: { role: 'alert', ariaLive: 'assertive', className: 'error-banner' },
  success: { role: 'status', ariaLive: 'polite', className: 'success-banner' },
  loading: { role: 'status', ariaLive: 'polite', className: 'view-loading' },
  denied: { role: 'status', ariaLive: 'polite', className: 'view-loading role-denied' }
}

export function Banner({ tone, children, icon, className }: BannerProps) {
  const config = TONE_CONFIG[tone]
  const defaultIcon =
    tone === 'error' ? (
      <AlertTriangle size={18} aria-hidden="true" />
    ) : tone === 'success' ? (
      <Check size={18} aria-hidden="true" />
    ) : null
  return (
    <div
      className={`${config.className}${className ? ` ${className}` : ''}`}
      role={config.role}
      aria-live={config.ariaLive}
    >
      {icon ?? defaultIcon}
      {children}
    </div>
  )
}

/** Convenience: error banner with icon (most common usage). */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return <Banner tone="error">{children}</Banner>
}

/** Convenience: success banner with icon. */
export function SuccessBanner({ children }: { children: ReactNode }) {
  return <Banner tone="success">{children}</Banner>
}
