import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialSnapshot } from '../frontend/src/data/initial-state.ts'
import { formatMetric, getMitigationStatus, getVerifiedSourceCount } from '../frontend/src/data/presentation.ts'
import type { DashboardSnapshot, MitigationRule } from '../frontend/src/types/dashboard.ts'

// Evidence below is a test fixture only and is never imported into the app.
const verifiedRule: MitigationRule = {
  id: 'test-rule',
  sourceIp: '192.0.2.10',
  switchId: 'test-switch',
  rule: 'DROP',
  status: 'verified',
  evidence: {
    source: 'switch',
    reference: 'test-flow-stats-reference',
    observedAt: '2026-01-01T00:00:00.000Z',
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function snapshotWithMitigations(reported: number | null, rules: MitigationRule[]): DashboardSnapshot {
  const snapshot = createInitialSnapshot()
  return {
    ...snapshot,
    network: { ...snapshot.network, verifiedSources: reported },
    mitigations: rules,
  }
}

test('startup makes no measured-zero, detection or mitigation claims', () => {
  const snapshot = createInitialSnapshot()
  assert.equal(snapshot.receivedAt, null)
  assert.deepEqual(snapshot.network, {
    throughputMbps: null,
    packetsPerSecond: null,
    activeAlerts: null,
    verifiedSources: null,
    traffic: [],
  })
  assert.equal(snapshot.detection, null)
  assert.deepEqual(snapshot.alerts, [])
  assert.deepEqual(snapshot.mitigations, [])
  assert.deepEqual(snapshot.history, [])
  assert.deepEqual(snapshot.performance, {
    detectionMs: null,
    mitigationMs: null,
    roundTripMs: null,
  })
  for (const service of Object.values(snapshot.services)) {
    assert.deepEqual(service, { status: 'unconfigured', updatedAt: null })
  }
})

test('service health is independent and snapshot instances do not share collections', () => {
  const first = createInitialSnapshot()
  const second = createInitialSnapshot()
  assert.notEqual(first.history, second.history)
  assert.notEqual(first.network.traffic, second.network.traffic)
  assert.notEqual(first.services.ai, first.services.websocket)

  const websocketOnly = {
    ...first,
    services: {
      ...first.services,
      websocket: { status: 'connected', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
  }
  assert.equal(websocketOnly.services.ai.status, 'unconfigured')
  assert.equal(websocketOnly.services.ryu.status, 'unconfigured')
})

test('unknown and invalid measurements are distinct from measured zero', () => {
  assert.equal(formatMetric(null), '—')
  assert.equal(formatMetric(Number.NaN), '—')
  assert.equal(formatMetric(Number.POSITIVE_INFINITY), '—')
  assert.equal(formatMetric(Number.NEGATIVE_INFINITY), '—')
  assert.equal(formatMetric(0), '0')
  assert.equal(formatMetric(0, 2), '0.00')
  assert.equal(formatMetric(1234.56, 1), '1,234.6')
})

test('claimed verification requires evidence with reference, source and observation time', () => {
  assert.equal(getMitigationStatus({ ...verifiedRule, evidence: null }), 'unverified')
  assert.ok(verifiedRule.evidence)

  const missingReference = { ...verifiedRule.evidence, reference: '   ' }
  assert.equal(getMitigationStatus({ ...verifiedRule, evidence: missingReference }), 'unverified')

  const invalidTime = { ...verifiedRule.evidence, observedAt: 'unknown' }
  assert.equal(getMitigationStatus({ ...verifiedRule, evidence: invalidTime }), 'unverified')

  const missingTime = { ...verifiedRule.evidence, observedAt: '' }
  assert.equal(getMitigationStatus({ ...verifiedRule, evidence: missingTime }), 'unverified')

  const invalidSource = { ...verifiedRule.evidence, source: 'http-200' }
  assert.equal(
    getMitigationStatus({ ...verifiedRule, evidence: invalidSource } as MitigationRule),
    'unverified',
  )
})

test('controller or switch evidence permits a claimed verified status', () => {
  assert.equal(getMitigationStatus(verifiedRule), 'verified')
  assert.ok(verifiedRule.evidence)
  assert.equal(
    getMitigationStatus({
      ...verifiedRule,
      evidence: { ...verifiedRule.evidence, source: 'controller' },
    }),
    'verified',
  )
})

test('evidence never promotes pending, installed, expired or failed rules to verified', () => {
  for (const status of ['pending', 'installed', 'expired', 'failed'] as const) {
    assert.equal(getMitigationStatus({ ...verifiedRule, status }), status)
  }
})

test('verified source count remains unknown when the aggregate is unavailable', () => {
  assert.equal(getVerifiedSourceCount(createInitialSnapshot()), null)
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(null, [verifiedRule])), null)
})

test('verified source count rejects totals not supported by available evidence', () => {
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(5, [])), null)
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(2, [verifiedRule])), null)
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(0, [verifiedRule])), null)
})

test('verified source count counts a source only once across rules and switches', () => {
  const rules = [
    verifiedRule,
    { ...verifiedRule, id: 'second-rule', switchId: 'second-switch' },
    { ...verifiedRule, id: 'third-rule', sourceIp: ' 192.0.2.10 ' },
  ]
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(1, rules)), 1)
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(3, rules)), null)
})

test('verified source count rejects invalid numeric aggregates', () => {
  for (const reported of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(getVerifiedSourceCount(snapshotWithMitigations(reported, [])), null)
  }
})

test('explicit measured zero is preserved when no verified sources are present', () => {
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(0, [])), 0)
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(0, [
    { ...verifiedRule, status: 'installed' },
    { ...verifiedRule, id: 'expired-rule', status: 'expired' },
  ])), 0)
})

test('invalid evidence, missing source and unverified lifecycle states cannot support the total', () => {
  assert.ok(verifiedRule.evidence)
  const invalidRules: MitigationRule[] = [
    { ...verifiedRule, evidence: null },
    { ...verifiedRule, evidence: { ...verifiedRule.evidence, reference: '' } },
    { ...verifiedRule, evidence: { ...verifiedRule.evidence, observedAt: 'invalid' } },
    { ...verifiedRule, sourceIp: ' ' },
    ...(['pending', 'installed', 'expired', 'failed'] as const).map((status) => ({ ...verifiedRule, status })),
  ]
  for (const rule of invalidRules) {
    assert.equal(getVerifiedSourceCount(snapshotWithMitigations(1, [rule])), null)
  }
})

test('matching evidence for distinct sources supports a reported positive total', () => {
  const rules = [verifiedRule, { ...verifiedRule, id: 'other-source', sourceIp: '192.0.2.11' }]
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(2, rules)), 2)
})
