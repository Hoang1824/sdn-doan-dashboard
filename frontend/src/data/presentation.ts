import type { DashboardSnapshot, MitigationRule, MitigationStatus } from '../types/dashboard.ts'

export type DisplayMitigationStatus = MitigationStatus | 'unverified'

/** Keep unavailable data distinct from a measured zero. */
export function formatMetric(value: number | null, decimals = 0): string {
  if (value === null || !Number.isFinite(value)) return '—'

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * Defense in depth for display; the B8 adapter validates controller/switch evidence.
 * A claimed VERIFIED value without usable evidence must never appear verified.
 */
export function getMitigationStatus(rule: MitigationRule): DisplayMitigationStatus {
  if (rule.status !== 'verified' && rule.status !== 'dropping') return rule.status

  const evidence = rule.evidence
  if (
    !evidence ||
    (evidence.source !== 'controller' && evidence.source !== 'switch') ||
    typeof evidence.reference !== 'string' ||
    evidence.reference.trim().length === 0 ||
    typeof evidence.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(evidence.observedAt))
  ) {
    return 'unverified'
  }

  return 'verified'
}

/**
 * Only expose a reported aggregate when complete current rule evidence supports it.
 * An unavailable or inconsistent count stays unknown, including partial snapshots.
 */
export function getVerifiedSourceCount(snapshot: DashboardSnapshot): number | null {
  if (!snapshot.mitigationsComplete) return null
  const reported = snapshot.network.verifiedSources
  if (reported === null || !Number.isSafeInteger(reported) || reported < 0) return null

  const supportedSources = new Set(
    snapshot.mitigations
      .filter((rule) => {
        const status = getMitigationStatus(rule)
        return status === 'verified' || status === 'dropping'
      })
      .map((rule) => rule.sourceIp.trim())
      .filter((sourceIp) => sourceIp.length > 0),
  )

  return reported === supportedSources.size ? reported : null
}
