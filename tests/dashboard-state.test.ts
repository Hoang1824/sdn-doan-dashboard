import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialSnapshot } from '../frontend/src/data/initial-state.ts'
import {
  formatMetric,
  getAttackPredictionCount,
  getConfirmedDropRuleCount,
  getEverDroppedSourceCount,
  getFinalDropPacketCount,
  getMitigationStatus,
  getVerifiedSourceCount,
} from '../frontend/src/data/presentation.ts'
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
  cookie: '0x-test',
  dpid: 3,
  sampleId: 'sample-test',
  destinationIp: '192.0.2.100',
  ipProtocol: 6,
  packetCount: 1,
  byteCount: 60,
  counterDelta: null,
  counterReset: false,
  counterSource: 'verified_flow_stats',
  removalReason: null,
  eventId: 'event-test',
  times: {
    sourceTimestamp: '2026-01-01T00:00:00.000Z',
    backendReceivedAt: '2026-01-01T00:00:00.000Z',
    browserReceivedAt: '2026-01-01T00:00:00.000Z',
  },
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
    dropCounterHistory: [],
    dropCounterSampleCount: null,
    dropCounterHistoryComplete: false,
  })
  assert.equal(snapshot.predictionClassCounts, null)
  assert.equal(snapshot.alertEventCount, null)
  assert.equal(snapshot.alertHistoryComplete, false)
  assert.equal(snapshot.detection, null)
  assert.deepEqual(snapshot.alerts, [])
  assert.deepEqual(snapshot.mitigations, [])
  assert.deepEqual(snapshot.history, [])
  assert.deepEqual(snapshot.performance, {
    detectionMs: null,
    mitigationMs: null,
    mitigationSampleCount: null,
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

test('verified source count includes distinct VERIFIED and DROPPING sources only', () => {
  const rules = [
    { ...verifiedRule, status: 'verified' as const },
    { ...verifiedRule, id: 'dropping-rule', sourceIp: '192.0.2.11', status: 'dropping' as const },
    { ...verifiedRule, id: 'cleaned-rule', sourceIp: '192.0.2.12', status: 'cleaned' as const },
  ]
  assert.equal(getVerifiedSourceCount(snapshotWithMitigations(2, rules)), 2)
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

test('attack prediction KPI uses the complete class histogram only', () => {
  const snapshot = {
    ...createInitialSnapshot(),
    predictionClassCounts: { benign: 277, syn_flood: 72, udp_flood: 0 },
  }
  assert.equal(getAttackPredictionCount(snapshot), 72)
  assert.equal(getAttackPredictionCount(createInitialSnapshot()), null)
})

test('confirmed DROP rules include completed lifecycles and require a complete rule list', () => {
  const rules = [
    { ...verifiedRule, status: 'confirmed' as const, evidence: null },
    { ...verifiedRule, id: 'cleaned', status: 'cleaned' as const },
    { ...verifiedRule, id: 'requested', status: 'requested' as const },
    { ...verifiedRule, id: 'not-drop', rule: 'ALLOW', status: 'dropping' as const },
  ]
  const snapshot = {
    ...createInitialSnapshot(),
    run: {
      runId: 's1-run',
      scenario: 'S1',
      seed: 701,
      status: 'complete',
      policyMode: 'MITIGATE' as const,
      revision: {},
    },
    dataMode: 'REPLAY' as const,
    mitigations: rules,
  }
  assert.equal(getConfirmedDropRuleCount(snapshot), 2)
  assert.equal(getConfirmedDropRuleCount({ ...snapshot, mitigationsComplete: false }), null)
  assert.equal(getConfirmedDropRuleCount(createInitialSnapshot()), null)
})

test('historical dropped sources are distinct while cleaned sources are not currently blocked', () => {
  const initial = createInitialSnapshot()
  const rules = [
    { ...verifiedRule, id: 'a-tcp', sourceIp: '10.0.0.10', ipProtocol: 6, status: 'cleaned' as const },
    { ...verifiedRule, id: 'a-udp', sourceIp: '10.0.0.10', ipProtocol: 17, status: 'cleaned' as const },
    { ...verifiedRule, id: 'b-tcp', sourceIp: '10.0.0.11', ipProtocol: 6, status: 'cleaned' as const },
    { ...verifiedRule, id: 'b-udp', sourceIp: '10.0.0.11', ipProtocol: 17, status: 'cleaned' as const },
    { ...verifiedRule, id: 'c-tcp', sourceIp: '10.0.0.12', ipProtocol: 6, status: 'cleaned' as const },
    { ...verifiedRule, id: 'c-udp', sourceIp: '10.0.0.12', ipProtocol: 17, status: 'cleaned' as const },
  ]
  const snapshot = {
    ...initial,
    run: {
      runId: 's8-run',
      scenario: 'S8',
      seed: 1101,
      status: 'completed',
      policyMode: 'MITIGATE' as const,
      revision: {},
    },
    dataMode: 'REPLAY' as const,
    mitigations: rules,
    network: { ...initial.network, verifiedSources: 0 },
  }

  assert.equal(getConfirmedDropRuleCount(snapshot), 6)
  assert.equal(getEverDroppedSourceCount(snapshot), 3)
  assert.equal(getVerifiedSourceCount(snapshot), 0)
  assert.equal(getEverDroppedSourceCount({
    ...snapshot,
    mitigations: [...rules, { ...verifiedRule, id: 'requested-only', status: 'requested' as const }],
  }), 3)
  assert.equal(getEverDroppedSourceCount({ ...snapshot, mitigationsComplete: false }), null)
  assert.equal(getEverDroppedSourceCount(createInitialSnapshot()), null)
})

test('final DROP packet KPI sums terminal FlowRemoved counters by unique DPID and cookie', () => {
  const removedRules = [
    { ...verifiedRule, status: 'cleaned' as const, packetCount: 6_000, removalReason: 0 },
    { ...verifiedRule, id: 'second-cookie', cookie: '0x-second', sourceIp: '192.0.2.11', status: 'removed' as const, packetCount: 6_795, removalReason: 0 },
  ]
  const snapshot = {
    ...createInitialSnapshot(),
    dataMode: 'REPLAY' as const,
    run: {
      runId: 's1-run',
      scenario: 'S1',
      seed: 701,
      status: 'complete',
      policyMode: 'MITIGATE' as const,
      revision: {},
    },
    mitigations: removedRules,
  }
  assert.equal(getFinalDropPacketCount(snapshot), 12_795)
  assert.equal(getFinalDropPacketCount({ ...snapshot, dataMode: 'LIVE' }), null)
  assert.equal(getFinalDropPacketCount({
    ...snapshot,
    mitigations: [{ ...removedRules[0], removalReason: null }],
  }), null)
  assert.equal(getFinalDropPacketCount({
    ...snapshot,
    mitigations: [removedRules[0], { ...removedRules[1], dpid: 4 }],
  }), 12_795)
  assert.equal(getFinalDropPacketCount({
    ...snapshot,
    mitigations: [removedRules[0], { ...removedRules[1], cookie: removedRules[0].cookie }],
  }), null)
  assert.equal(getFinalDropPacketCount({
    ...snapshot,
    mitigations: [{ ...removedRules[0], cookie: null }],
  }), null)
})
