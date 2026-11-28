import type { DashboardSnapshot, MitigationRule, MitigationStatus } from '../types/dashboard.ts'

export type DisplayMitigationStatus = MitigationStatus | 'unverified'

const confirmedDropStatuses = new Set([
  'confirmed', 'verified', 'dropping', 'removed', 'removed_idle', 'cleaned',
])

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

export function getAttackPredictionCount(snapshot: DashboardSnapshot): number | null {
  const counts = snapshot.predictionClassCounts
  if (!counts) return null
  const total = counts.syn_flood + counts.udp_flood
  return Number.isSafeInteger(total) ? total : null
}

export function getConfirmedDropRuleCount(snapshot: DashboardSnapshot): number | null {
  if (!snapshot.run || snapshot.dataMode === null || !snapshot.mitigationsComplete) return null
  return snapshot.mitigations.filter((rule) => (
    rule.rule.trim().toUpperCase() === 'DROP'
    && confirmedDropStatuses.has(getMitigationStatus(rule))
  )).length
}

export function getEverDroppedSourceCount(snapshot: DashboardSnapshot): number | null {
  if (!snapshot.run || snapshot.dataMode === null || !snapshot.mitigationsComplete) return null
  return new Set(
    snapshot.mitigations
      .filter((rule) => (
        rule.rule.trim().toUpperCase() === 'DROP'
        && confirmedDropStatuses.has(getMitigationStatus(rule))
      ))
      .map((rule) => rule.sourceIp.trim())
      .filter(Boolean),
  ).size
}

export function getFinalDropPacketCount(snapshot: DashboardSnapshot): number | null {
  const terminalStatuses = new Set(['complete', 'completed', 'aborted', 'cancelled', 'canceled', 'failed'])
  if (
    snapshot.dataMode !== 'REPLAY'
    || !snapshot.run?.status
    || !terminalStatuses.has(snapshot.run.status.trim().toLowerCase())
    || !snapshot.mitigationsComplete
  ) return null

  const dropRules = snapshot.mitigations.filter((rule) => rule.rule.trim().toUpperCase() === 'DROP')
  if (dropRules.length === 0) return 0

  let total = 0
  const ruleKeys = new Set<string>()
  for (const rule of dropRules) {
    const status = getMitigationStatus(rule)
    const ruleKey = rule.dpid !== null && rule.cookie?.trim()
      ? `${String(rule.dpid)}:${rule.cookie}`
      : null
    if (
      !['removed', 'removed_idle', 'cleaned'].includes(status)
      || !Number.isSafeInteger(rule.removalReason)
      || ruleKey === null
      || ruleKeys.has(ruleKey)
      || !Number.isSafeInteger(rule.packetCount)
      || (rule.packetCount ?? -1) < 0
    ) return null
    ruleKeys.add(ruleKey)
    total += rule.packetCount ?? 0
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}
