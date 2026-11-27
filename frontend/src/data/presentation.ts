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
 * Defense in depth for presentation, not controller/switch verification.
 * The future adapter must validate the actual evidence against its API contract.
 * A claimed VERIFIED value without usable evidence must never appear verified.
 */
export function getMitigationStatus(rule: MitigationRule): DisplayMitigationStatus {
  if (rule.status !== 'verified') return rule.status

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
 * Only expose a reported aggregate when the available rule evidence supports it.
 * An unavailable or inconsistent count stays unknown, including partial snapshots.
 * Pagination needs a separately validated aggregate-evidence contract in the adapter.
 */
export function getVerifiedSourceCount(snapshot: DashboardSnapshot): number | null {
  const reported = snapshot.network.verifiedSources
  if (reported === null || !Number.isSafeInteger(reported) || reported < 0) return null

  const supportedSources = new Set(
    snapshot.mitigations
      .filter((rule) => getMitigationStatus(rule) === 'verified')
      .map((rule) => rule.sourceIp.trim())
      .filter((sourceIp) => sourceIp.length > 0),
  )

  return reported === supportedSources.size ? reported : null
}
