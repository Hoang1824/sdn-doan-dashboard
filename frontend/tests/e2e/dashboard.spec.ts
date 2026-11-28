import { test, expect } from '@playwright/test'

async function mockEmptyRunList(page: import('@playwright/test').Page) {
  await page.route('**/api/runs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ runs: [] }),
  }))
}

test('startup shows a compact evidence-first dashboard without invented network metrics', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  const sockets: string[] = []
  const apiRequests: string[] = []
  await mockEmptyRunList(page)
  page.on('pageerror', error => errors.push(error.message))
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname.startsWith('/ws/runs/')) sockets.push(socket.url())
  })
  page.on('request', request => { if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') apiRequests.push(request.url()) })
  await page.goto('/')
  await expect(page).toHaveTitle('Sentinel SDN | Security Operations')
  await expect(page.getByRole('heading', { name: 'AI DDoS Detection & Mitigation' })).toBeVisible()
  for (const title of ['AI Detection', 'DDoS Alerts', 'Mitigation', 'DROP Counter Timeline', 'Event Timeline']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
  await expect(page.locator('.metric-value strong')).toHaveText(['—', '—', '—', '—', '—'])
  await expect(page.getByText('Lưu lượng mạng')).toHaveCount(0)
  await expect(page.getByText('Tốc độ gói tin')).toHaveCount(0)
  await page.locator('#evidence > summary').click()
  for (const title of ['SDN Topology', 'System Status']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
  await expect(page.locator('#system .status-badge')).toHaveText([
    'Đã kết nối',
    'Chưa giám sát trực tiếp',
    'Chưa giám sát trực tiếp',
    'Chưa cấu hình',
  ])
  await expect(page.locator('.react-flow__node')).toHaveCount(11)
  await expect(page.getByText('h1 · 10.0.0.1')).toBeVisible()
  await expect(page.getByText('score · DPID 3')).toBeVisible()
  await expect(page.getByText('Topology tham chiếu tĩnh B8 · không phải discovery live Ryu')).toBeVisible()
  await expect(page.locator('.recharts-area')).toHaveCount(0)
  await expect(page.getByText('VERIFIED', { exact: true })).toHaveCount(0)
  await page.getByRole('searchbox').fill('192.0.2.1')
  await page.getByRole('button', { name: 'Ryu Policy' }).click()
  await expect(page.getByRole('heading', { name: 'Không có event trong phạm vi đang xem' })).toBeVisible()
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click()
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Trang lịch sử tiếp theo' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
  expect(apiRequests).toHaveLength(1)
  expect(sockets).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true })
})

test('run selection loads a final REPLAY snapshot without starting a live socket', async ({ page }) => {
  const requests: string[] = []
  const sockets: string[] = []
  const wireEvent = (
    eventId: string,
    kind: string,
    rawEvent: string,
    payload: Record<string, unknown>,
    sampleId: string | null = null,
    cookie: string | null = null,
  ) => ({
    schema_version: 'b8.dashboard.v1',
    run_id: 's8-run-final',
    event_id: eventId,
    cursor: `cursor-${eventId}`,
    kind,
    raw_event: rawEvent,
    source_stream: 'ryu_events.jsonl',
    source_timestamp: 1795701942.7,
    backend_received_at: '2026-11-27T15:00:00Z',
    data_mode: 'REPLAY',
    policy_mode: 'MITIGATE',
    run_revision: {},
    keys: { sample_id: sampleId, cookie },
    payload,
  })
  const attackEvent = wireEvent(
    'attack-history',
    'ai.prediction',
    'v2_prediction',
    { id: 'sample-attack', prediction: 'syn_flood', src_ip: '10.0.0.10' },
    'sample-attack',
  )
  const benignEvent = wireEvent(
    'benign-history',
    'ai.prediction',
    'v2_prediction',
    { id: 'sample-benign', prediction: 'benign', src_ip: '10.0.0.20' },
    'sample-benign',
  )
  const confirmedEvent = wireEvent(
    'confirmed-history',
    'mitigation.confirmed',
    'b8_mitigation_confirmed',
    { src_ip: '10.0.0.10', dpid: 3, mitigation_action: 'DROP' },
    'sample-attack',
    '0xb83524a71b55e4bc',
  )
  const requestedEvent = wireEvent(
    'requested-history',
    'other',
    'b8_mitigation_requested',
    { src_ip: '10.0.0.10', dpid: 3, mitigation_action: 'DROP' },
    'sample-attack',
    '0xb83524a71b55e4bc',
  )
  const dropEvent = wireEvent(
    'drop-history',
    'other',
    'b8_drop_counter',
    {
      src_ip: '10.0.0.10',
      dpid: 3,
      mitigation_action: 'DROP',
      counter_source: 'verified_flow_stats',
      packet_count: 142,
    },
    'sample-attack',
    '0xb83524a71b55e4bc',
  )
  const removedEvent = wireEvent(
    'removed-history',
    'other',
    'b8_mitigation_flow_removed',
    { src_ip: '10.0.0.10', dpid: 3, mitigation_action: 'DROP', packet_count: 142 },
    'sample-attack',
    '0xb83524a71b55e4bc',
  )
  const policyEvent = wireEvent(
    'policy-history',
    'policy.decision',
    'b8_live_policy_decision',
    { src_ip: '10.0.0.10', decision: 'mitigate' },
    'sample-attack',
  )
  await page.route('**/api/runs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      runs: [{
        run_id: 's8-run-final',
        manifest: {
          scenario: 8,
          seed_reference: 1101,
          mode: 'MITIGATE',
          status: 'completed',
          controller_revision: 'B8_ACK_IDLE_DROP_1',
        },
      }],
    }),
  }))
  await page.route('**/api/runs/s8-run-final/snapshot*', async route => {
    requests.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: 's8-run-final',
        data_mode: 'REPLAY',
        policy_mode: 'MITIGATE',
        run: {
          scenario: 8,
          seed: 1101,
          status: 'completed',
          policy_mode: 'MITIGATE',
          revision: {
            controller_revision: 'B8_ACK_IDLE_DROP_1',
            profile: { model_candidate: 'B7.3.5_TRIAL_3', details: 'profile-details-marker' },
          },
        },
        as_of_cursor: 'fixture-cursor',
        snapshot_received_at: '2026-11-27T15:00:00Z',
        state: {
          prediction_count: 5927,
          latest_prediction: null,
          latest_policies: [],
          rules: [
            { src_ip: '10.0.0.10', ip_proto: 6 },
            { src_ip: '10.0.0.10', ip_proto: 17 },
            { src_ip: '10.0.0.11', ip_proto: 6 },
            { src_ip: '10.0.0.11', ip_proto: 17 },
            { src_ip: '10.0.0.12', ip_proto: 6 },
            { src_ip: '10.0.0.12', ip_proto: 17 },
          ].map((flow, index) => {
            const cookie = index === 0 ? '0xb83524a71b55e4bc' : `fixture-cookie-${index + 1}`
            return {
              id: `3:${cookie}`,
              dpid: 3,
              cookie,
              sample_id: null,
              dst_ip: '10.0.0.100',
              mitigation_action: 'DROP',
              status: 'CLEANED',
              packet_count: index === 0 ? 7300 : null,
              byte_count: null,
              counter_delta: null,
              counter_reset: false,
              counter_source: null,
              evidence: null,
              reason: 0,
              source_timestamp: 1795701942,
              last_event_id: `fixture-flow-removed-${index + 1}`,
              ...flow,
            }
          }),
          verified_source_count: 0,
          observations: [],
          prediction_class_counts: { benign: 5684, syn_flood: 231, udp_flood: 12 },
          alert_event_count: 261,
          alert_events: [attackEvent, confirmedEvent, dropEvent],
          recent_events: Array.from({ length: 500 }, (_, index) => ({
            ...benignEvent,
            event_id: `recent-benign-${index}`,
            cursor: `recent-benign-cursor-${index}`,
          })),
          drop_counter_sample_count: 237,
          drop_counter_history: [{
            event_id: 'drop-history',
            timestamp: 1795701942.7,
            cookie: '0xb83524a71b55e4bc',
            dpid: 3,
            src_ip: '10.0.0.10',
            sample_id: 'sample-attack',
            packet_count: 142,
            delta: null,
            counter_reset: false,
          }],
          mitigation_observation_ms: 50,
          mitigation_observation_count: 1,
        },
      }),
    })
  })
  const eventPageRequests: string[] = []
  await page.route('**/api/runs/s8-run-final/events*', async route => {
    const url = new URL(route.request().url())
    eventPageRequests.push(url.href)
    const after = url.searchParams.get('after')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: 's8-run-final',
        data_mode: 'REPLAY',
        events: after
          ? [attackEvent, requestedEvent, confirmedEvent, dropEvent, removedEvent, attackEvent, policyEvent]
          : [benignEvent],
        next_cursor: after ? 'end-cursor' : 'second-page-cursor',
        has_more: after === null,
      }),
    })
  })

  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname.startsWith('/ws/runs/')) sockets.push(socket.url())
  })
  await page.goto('/')
  await page.getByLabel('Chọn run', { exact: true }).selectOption('s8-run-final')
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()

  await expect(page.locator('.run-control-summary')).toContainText('s8-run-final')
  await expect(page.locator('.run-control-summary')).toContainText('S8 · seed 1101')
  await expect(page.locator('.replay-summary')).toBeHidden()
  await page.locator('#evidence > summary').click()
  await page.locator('.run-evidence-details > summary').click()
  await expect(page.getByText('REPLAY / HISTORY · snapshot', { exact: true })).toBeVisible()
  await expect(page.getByText('completed', { exact: true })).toBeVisible()
  await expect(page.locator('.replay-summary')).toContainText('S8 · seed 1101')
  await expect(page.locator('.metric-value strong')).toHaveText(['5,927', '243', '6', '3', '—'])
  await expect(page.locator('.metrics-grid article').nth(3)).toContainText('Đang bị chặn: 0 IP')
  await expect(page.locator('.replay-summary-grid')).toHaveCount(0)
  await expect(page.locator('.prediction-distribution')).toContainText('5,684')
  await expect(page.locator('.prediction-distribution')).toContainText('231')
  await expect(page.locator('.prediction-distribution')).toContainText('12')
  await expect(page.locator('.replay-flow-table tbody tr')).toHaveCount(6)
  await expect(page.locator('.replay-counters')).toContainText('0xb83524a71b55e4bc')
  await expect(page.locator('.replay-counters')).toContainText('7,300')
  await expect(page.getByRole('region', { name: 'Bảng luật giảm thiểu' }).getByText('CLEANED', { exact: true })).toHaveCount(6)
  await expect(page.locator('#detection')).toContainText('B7.3.5_TRIAL_3')
  await expect(page.locator('#detection')).not.toContainText('Accuracy')
  await expect(page.locator('#alerts')).toContainText('Lịch sử từ snapshot / REPLAY')
  await expect(page.locator('#alerts')).toContainText('10.0.0.10')
  await expect(page.locator('#alerts')).toContainText('0xb83524a71b55e4bc')
  await expect(page.locator('.drop-counter-latest')).toContainText('142 packets lũy kế')
  await expect(page.locator('#network')).toContainText('delta = 0 không có nghĩa cả run không DROP gói nào')
  await expect(page.locator('#performance')).toContainText('50.00')
  const profileDetails = page.locator('.revision-details')
  await expect(profileDetails.locator('pre')).toBeHidden()
  await profileDetails.locator('summary').click()
  await expect(profileDetails.locator('pre')).toContainText('profile-details-marker')
  await expect(page.getByText('Không sử dụng (REPLAY)', { exact: true })).toBeVisible()
  await expect(page.getByText('Chưa giám sát trực tiếp', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Tối đa 500 event gần nhất', { exact: false })).toBeVisible()
  await page.locator('.history-important > summary').click()
  await expect(page.locator('.history-important')).toContainText('AI attack predictions')
  await expect(page.locator('.history-important')).toContainText('CLEANED')
  await expect(page.locator('.history-important')).toContainText('REPLAY snapshot')
  await expect(page.locator('.history-important')).not.toContainText('LIVE')
  await page.getByRole('button', { name: 'Duyệt lịch sử API từ đầu' }).click()
  await expect(page.locator('#history')).toContainText('benign')
  await page.getByRole('button', { name: 'AI Attack Detection' }).click()
  await expect(page.locator('#history')).toContainText('0 bản ghi khớp trên trang API 1')
  await expect(page.getByRole('button', { name: 'Trang API tiếp theo' })).toBeEnabled()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect(page.locator('#history')).toContainText('Đã quét hết')
  await expect(page.locator('#history')).toContainText('v2_prediction: syn_flood')
  await expect(page.locator('#history tbody tr').filter({ hasText: 'v2_prediction: syn_flood' })).toHaveCount(1)
  const requestsAfterAiSearch = eventPageRequests.length
  await page.getByRole('button', { name: 'DROP Requested / Confirmed' }).click()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect(page.locator('#history')).toContainText('b8_mitigation_requested')
  await expect(page.locator('#history')).toContainText('b8_mitigation_confirmed')
  const requestsAfterDropSearch = eventPageRequests.length
  await page.getByRole('button', { name: 'AI Attack Detection' }).click()
  await expect(page.locator('#history')).toContainText('v2_prediction: syn_flood')
  expect(eventPageRequests).toHaveLength(requestsAfterDropSearch)
  await page.getByRole('button', { name: 'DROP Requested / Confirmed' }).click()
  await expect(page.locator('#history')).toContainText('b8_mitigation_confirmed')
  expect(eventPageRequests).toHaveLength(requestsAfterDropSearch)
  expect(requestsAfterDropSearch).toBeGreaterThan(requestsAfterAiSearch)
  await page.getByRole('button', { name: 'Verified DROP Counter' }).click()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect(page.locator('#history')).toContainText('b8_drop_counter')
  await page.getByRole('button', { name: 'Removed / Cleaned' }).click()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect(page.locator('#history')).toContainText('b8_mitigation_flow_removed')
  await page.getByRole('button', { name: 'Quay lại trang/snapshot' }).click()
  await page.getByRole('button', { name: 'Trang API tiếp theo' }).click()
  await expect(page.getByRole('button', { name: 'Ryu Policy' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Ryu Policy' }).click()
  await expect(page.locator('#history')).toContainText('b8_live_policy_decision')
  await expect.poll(() => eventPageRequests.length).toBeGreaterThan(2)
  expect(new URL(eventPageRequests[0]).searchParams.get('after')).toBeNull()
  expect(eventPageRequests.some(url => new URL(url).searchParams.get('after') === 'second-page-cursor')).toBe(true)
  expect(requests).toHaveLength(1)
  expect(sockets).toEqual([])
})

test('switching S1/S7/S8 clears history and finds S7 DROP confirmation beyond the current API page', async ({ page }) => {
  const replayRuns = [
    { runId: 'replay-s1', scenario: 1, seed: 701 },
    { runId: 'replay-s7', scenario: 7, seed: 1007 },
    { runId: 'replay-s8', scenario: 8, seed: 1101 },
  ]
  const makeEvent = (
    runId: string,
    eventId: string,
    kind: string,
    rawEvent: string,
    payload: Record<string, unknown>,
  ) => ({
    schema_version: 'b8.dashboard.v1',
    run_id: runId,
    event_id: eventId,
    cursor: `cursor-${eventId}`,
    kind,
    raw_event: rawEvent,
    source_stream: 'ryu_events.jsonl',
    source_timestamp: 1795701900,
    backend_received_at: '2026-11-27T15:59:59Z',
    data_mode: 'REPLAY',
    policy_mode: 'MITIGATE',
    run_revision: {},
    keys: { sample_id: null, cookie: '0x001' },
    payload,
  })
  const s7Benign = makeEvent('replay-s7', 's7-benign', 'ai.prediction', 'v2_prediction', {
    prediction: 'benign',
    src_ip: '10.0.0.20',
  })
  const s7Confirmed = makeEvent('replay-s7', 's7-confirmed', 'mitigation.confirmed', 'b8_mitigation_confirmed', {
    mitigation_action: 'DROP',
    src_ip: '10.0.0.7',
    dpid: 3,
  })

  await page.route('**/api/runs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      runs: replayRuns.map(({ runId, scenario, seed }) => ({
        run_id: runId,
        manifest: {
          scenario,
          seed_reference: seed,
          mode: 'MITIGATE',
          status: 'completed',
        },
      })),
    }),
  }))
  await page.route('**/api/runs/*/snapshot*', route => {
    const runId = new URL(route.request().url()).pathname.split('/')[3]
    const metadata = replayRuns.find((run) => run.runId === runId)
    if (!metadata) throw new Error(`Unexpected run snapshot request: ${runId}`)
    const marker = makeEvent(runId, `${runId}-snapshot`, 'ai.prediction', `${runId}_snapshot_marker`, {
      prediction: 'benign',
      src_ip: '10.0.0.1',
    })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: runId,
        data_mode: 'REPLAY',
        policy_mode: 'MITIGATE',
        run: {
          scenario: metadata.scenario,
          seed: metadata.seed,
          status: 'completed',
          policy_mode: 'MITIGATE',
          revision: {},
        },
        as_of_cursor: `snapshot-${runId}`,
        snapshot_received_at: '2026-11-27T16:00:00Z',
        state: {
          prediction_count: 1,
          latest_prediction: marker,
          latest_policies: [],
          rules: [],
          verified_source_count: 0,
          observations: [],
          prediction_class_counts: { benign: 1, syn_flood: 0, udp_flood: 0 },
          alert_event_count: 0,
          alert_events: [],
          recent_events: [marker],
          drop_counter_sample_count: 0,
          drop_counter_history: [],
          mitigation_observation_ms: null,
          mitigation_observation_count: 0,
        },
      }),
    })
  })
  await page.route('**/api/runs/replay-s7/events*', route => {
    const after = new URL(route.request().url()).searchParams.get('after')
    const events = after === null
      ? [s7Benign]
      : after === 's7-next'
        ? [s7Confirmed]
        : [s7Confirmed]
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'replay-s7',
        data_mode: 'REPLAY',
        events,
        next_cursor: after === null ? 's7-next' : after === 's7-next' ? 's7-loop' : 's7-next',
        has_more: true,
      }),
    })
  })

  const selector = page.getByLabel('Chọn run', { exact: true })
  await page.goto('/')
  await selector.selectOption('replay-s1')
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()
  await expect(page.locator('#history')).toContainText('replay-s1_snapshot_marker')

  await selector.selectOption('replay-s7')
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()
  await expect(page.locator('#history')).toContainText('replay-s7_snapshot_marker')
  await expect(page.locator('#history')).not.toContainText('replay-s1_snapshot_marker')
  await page.getByRole('button', { name: 'Duyệt lịch sử API từ đầu' }).click()
  await page.getByRole('button', { name: 'DROP Requested / Confirmed' }).click()
  await expect(page.locator('#history')).toContainText('0 bản ghi khớp trên trang API 1')
  await expect(page.getByRole('button', { name: 'Trang API tiếp theo' })).toBeEnabled()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect(page.locator('#history')).toContainText('b8_mitigation_confirmed')
  await expect(page.locator('#history')).toContainText('cursor lặp')

  await selector.selectOption('replay-s8')
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()
  await expect(page.locator('#history')).toContainText('replay-s8_snapshot_marker')
  await expect(page.locator('#history')).not.toContainText('b8_mitigation_confirmed')
  await expect(page.locator('#history')).not.toContainText('replay-s1_snapshot_marker')
  await expect(page.getByLabel('Chế độ dữ liệu')).toHaveValue('REPLAY')
})

test('out-of-order REPLAY filter searches keep separate cached results', async ({ page }) => {
  const runId = 'race-s8-run'
  const makeEvent = (eventId: string, kind: string, rawEvent: string, payload: Record<string, unknown>) => ({
    schema_version: 'b8.dashboard.v1',
    run_id: runId,
    event_id: eventId,
    cursor: `cursor-${eventId}`,
    kind,
    raw_event: rawEvent,
    source_stream: 'ryu_events.jsonl',
    source_timestamp: 1795701900,
    backend_received_at: '2026-11-27T15:59:59Z',
    data_mode: 'REPLAY',
    policy_mode: 'MITIGATE',
    run_revision: {},
    keys: { sample_id: null, cookie: '0x001' },
    payload,
  })
  const benign = makeEvent('race-benign', 'ai.prediction', 'v2_prediction', { prediction: 'benign' })
  const attack = makeEvent('race-attack', 'ai.prediction', 'v2_prediction', { prediction: 'udp_flood' })
  const drop = makeEvent('race-drop', 'mitigation.confirmed', 'b8_mitigation_confirmed', {
    mitigation_action: 'DROP',
    src_ip: '10.0.0.8',
  })
  await page.route('**/api/runs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      runs: [{
        run_id: runId,
        manifest: { scenario: 8, seed_reference: 1101, mode: 'MITIGATE', status: 'completed' },
      }],
    }),
  }))
  await page.route(`**/api/runs/${runId}/snapshot*`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      run_id: runId,
      data_mode: 'REPLAY',
      policy_mode: 'MITIGATE',
      run: {
        scenario: 8,
        seed: 1101,
        status: 'completed',
        policy_mode: 'MITIGATE',
        revision: {},
      },
      as_of_cursor: 'race-snapshot',
      snapshot_received_at: '2026-11-27T16:00:00Z',
      state: {
        prediction_count: 1,
        latest_prediction: benign,
        latest_policies: [],
        rules: [],
        verified_source_count: 0,
        observations: [],
        prediction_class_counts: { benign: 1, syn_flood: 0, udp_flood: 0 },
        alert_event_count: 0,
        alert_events: [],
        recent_events: [benign],
        drop_counter_sample_count: 0,
        drop_counter_history: [],
        mitigation_observation_ms: null,
        mitigation_observation_count: 0,
      },
    }),
  }))

  const pageResponses: string[] = []
  await page.route(`**/api/runs/${runId}/events*`, async route => {
    const requestIndex = pageResponses.length
    const url = new URL(route.request().url())
    pageResponses.push(url.href)
    if (requestIndex === 1) await new Promise((resolve) => setTimeout(resolve, 1_000))
    const events = requestIndex === 1 ? [attack] : requestIndex === 3 ? [drop] : [benign]
    const hasMore = requestIndex === 0 || requestIndex === 2
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: runId,
        data_mode: 'REPLAY',
        events,
        next_cursor: hasMore ? 'race-next' : `race-end-${requestIndex}`,
        has_more: hasMore,
      }),
    })
  })

  await page.goto('/')
  await page.getByLabel('Chọn run', { exact: true }).selectOption(runId)
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()
  await page.getByRole('button', { name: 'AI Attack Detection' }).click()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect.poll(() => pageResponses.length).toBe(2)
  await expect(page.getByRole('status')).toContainText('Đã quét 1 trang')

  await page.getByRole('button', { name: 'DROP Requested / Confirmed' }).click()
  await page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' }).click()
  await expect(page.locator('#history')).toContainText('b8_mitigation_confirmed')
  await expect.poll(() => pageResponses.length).toBe(4)

  await page.getByRole('button', { name: 'AI Attack Detection' }).click()
  await expect(page.locator('#history')).toContainText('v2_prediction: udp_flood')
  await page.getByRole('button', { name: 'DROP Requested / Confirmed' }).click()
  await expect(page.locator('#history')).toContainText('b8_mitigation_confirmed')
  expect(pageResponses).toHaveLength(4)
})

test('run selector stays stable through polling and loads only the manually selected snapshot', async ({ page }) => {
  test.setTimeout(60_000)
  const replayS1 = '20261127_102033_b8s1_mitigate_84644d'
  const replayS8 = 's8-run-final'
  const liveRunId = 'new-live-run'
  let catalogRequests = 0
  const snapshotRequests: string[] = []

  const run = (runId: string, scenario: number, seed: number, status: string) => ({
    run_id: runId,
    manifest: { scenario, seed_reference: seed, mode: 'MITIGATE', status },
  })
  const liveRun = {
    ...run(liveRunId, 1, 702, 'running'),
    live: {
      status: 'running',
      terminal: false,
      freshness: 'fresh',
      eligible: true,
      last_activity_at: '2026-11-27T15:59:59Z',
      last_activity_stream: 'ryu_events.jsonl',
      age_seconds: 1,
      freshness_seconds: 30,
    },
  }
  await page.route('**/api/runs', route => {
    catalogRequests += 1
    const runs = catalogRequests === 1
      ? [run(replayS1, 1, 701, 'complete'), run(replayS8, 8, 1101, 'complete')]
      : [run(replayS8, 8, 1101, 'complete'), liveRun, run(replayS1, 1, 701, 'complete')]
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runs,
        live_discovery: catalogRequests === 1 ? null : {
          mode: 'automatic',
          status: 'single',
          selected_run_id: liveRunId,
          candidate_run_ids: [liveRunId],
          freshness_seconds: 30,
        },
      }),
    })
  })
  await page.route('**/api/runs/*/snapshot*', route => {
    const url = new URL(route.request().url())
    const runId = decodeURIComponent(url.pathname.split('/')[3])
    const dataMode = url.searchParams.get('data_mode')
    snapshotRequests.push(`${runId}:${dataMode}`)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: runId,
        data_mode: dataMode,
        policy_mode: 'MITIGATE',
        run: {
          scenario: runId === replayS8 ? 8 : 1,
          seed: runId === replayS8 ? 1101 : 701,
          status: 'complete',
          policy_mode: 'MITIGATE',
          revision: {},
        },
        as_of_cursor: `snapshot-${runId}`,
        snapshot_received_at: '2026-11-27T15:00:00Z',
        state: {
          prediction_count: 0,
          latest_prediction: null,
          latest_policies: [],
          rules: [],
          verified_source_count: 0,
          observations: [],
        },
      }),
    })
  })

  await page.goto('/')
  const selector = page.getByLabel('Chọn run', { exact: true })
  await selector.selectOption(replayS1)
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()
  await expect(page.locator('.run-control-summary')).toContainText(replayS1)
  await expect.poll(() => snapshotRequests).toEqual([`${replayS1}:REPLAY`])

  await selector.click()
  await expect(selector).toBeFocused()
  await expect.poll(() => catalogRequests, { timeout: 25_000 }).toBeGreaterThanOrEqual(4)
  await expect(selector).toBeEnabled()
  await expect(selector).toHaveValue(replayS1)
  await expect(page.getByLabel('Chế độ dữ liệu')).toHaveValue('REPLAY')
  expect(snapshotRequests).toEqual([`${replayS1}:REPLAY`])

  await selector.selectOption(replayS8)
  await expect(page.locator('.run-control-summary')).toContainText(replayS8)
  await expect.poll(() => snapshotRequests).toEqual([
    `${replayS1}:REPLAY`,
    `${replayS8}:REPLAY`,
  ])
  expect(await selector.inputValue()).toBe(replayS8)

  await selector.evaluate((element: HTMLSelectElement) => element.blur())
  await expect(page.getByRole('button', { name: 'Theo dõi run LIVE' })).toBeVisible()
  await expect(page.locator('.run-live-discovery')).toContainText(liveRunId)
  expect(await selector.inputValue()).toBe(replayS8)
  expect(snapshotRequests).toHaveLength(2)
})

test('a newly discovered LIVE run can be selected without entering its ID', async ({ page }) => {
  let runListRequests = 0
  const snapshotRequests: string[] = []
  const socketUrls: string[] = []
  await page.routeWebSocket((url) => {
    if (url.pathname !== '/ws/runs/live-auto-run') return false
    socketUrls.push(url.href)
    return true
  }, socket => {
    setTimeout(() => socket.send(JSON.stringify({
      type: 'run_status',
      status: 'running',
      terminal: false,
      freshness: 'fresh',
      eligible: true,
      last_activity_at: '2026-11-27T15:59:59Z',
      last_activity_stream: 'ryu_events.jsonl',
      age_seconds: 1,
      freshness_seconds: 30,
    })), 50)
    setTimeout(() => socket.send(JSON.stringify({
      type: 'run_complete',
      status: 'completed',
      cursor: 'final-cursor',
      finalization_status: 'confirmed',
      last_activity_at: '2026-11-27T16:00:01Z',
    })), 2_000)
  })
  await page.route('**/api/runs', route => {
    runListRequests += 1
    const discovered = runListRequests > 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(discovered ? {
        runs: [{
          run_id: 'live-auto-run',
          manifest: {
            run_id: 'live-auto-run',
            scenario: 'S1',
            seed: 701,
            mode: 'MITIGATE',
            status: 'running',
          },
          live: {
            status: 'running',
            terminal: false,
            freshness: 'fresh',
            eligible: true,
            last_activity_at: '2026-11-27T15:59:59Z',
            last_activity_stream: 'ryu_events.jsonl',
            age_seconds: 1,
            freshness_seconds: 30,
          },
        }],
        live_discovery: {
          mode: 'automatic',
          status: 'single',
          selected_run_id: 'live-auto-run',
          candidate_run_ids: ['live-auto-run'],
          freshness_seconds: 30,
        },
      } : {
        runs: [],
        live_discovery: {
          mode: 'automatic',
          status: 'none',
          selected_run_id: null,
          candidate_run_ids: [],
          freshness_seconds: 30,
        },
      }),
    })
  })
  await page.route('**/api/runs/live-auto-run/snapshot*', async route => {
    snapshotRequests.push(route.request().url())
    const dataMode = new URL(route.request().url()).searchParams.get('data_mode')
    const isReplay = dataMode === 'REPLAY'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'live-auto-run',
        data_mode: dataMode,
        policy_mode: 'MITIGATE',
        live_monitor: {
          status: isReplay ? 'completed' : 'running',
          terminal: isReplay,
          freshness: isReplay ? 'stale' : 'fresh',
          eligible: !isReplay,
          last_activity_at: '2026-11-27T15:59:59Z',
          last_activity_stream: 'ryu_events.jsonl',
          age_seconds: isReplay ? 31 : 1,
          freshness_seconds: 30,
        },
        run: {
          scenario: 'S1',
          seed: 701,
          status: isReplay ? 'completed' : 'running',
          policy_mode: 'MITIGATE',
          revision: {},
        },
        as_of_cursor: 'live-snapshot-cursor',
        snapshot_received_at: '2026-11-27T16:00:00Z',
        state: {
          prediction_count: isReplay ? 1 : 0,
          latest_prediction: null,
          latest_policies: [],
          rules: isReplay ? [{
            id: '3:0xb8-final-cookie',
            dpid: 3,
            cookie: '0xb8-final-cookie',
            sample_id: 'sample-final',
            src_ip: '10.0.0.10',
            dst_ip: '10.0.0.100',
            ip_proto: 6,
            mitigation_action: 'DROP',
            status: 'CLEANED',
            packet_count: 7300,
            byte_count: 394200,
            counter_delta: null,
            counter_reset: false,
            counter_source: 'verified_flow_stats',
            evidence: {
              source: 'controller',
              reference: 'final-counter-event',
              source_timestamp: 1795701942,
            },
            reason: 0,
            source_timestamp: 1795701942,
            last_event_id: 'final-cleanup-event',
          }] : [],
          verified_source_count: 0,
          observations: [],
        },
      }),
    })
  })
  await page.goto('/')
  await expect(page.getByText('Chưa phát hiện run LIVE đủ mới.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Theo dõi run LIVE' })).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Theo dõi run LIVE' }).click()

  await expect(page.locator('.run-control-summary')).toContainText('LIVE')
  await expect.poll(() => socketUrls.length).toBe(1)
  await expect.poll(() => snapshotRequests.length).toBe(1, { timeout: 5_000 })
  await expect(page.locator('.run-control-summary')).toContainText('LIVE')
  await expect(page.locator('#history')).toContainText('LIVE hiển thị buffer sự kiện gần nhất')
  await expect(page.getByRole('button', { name: 'Tìm trên toàn bộ REPLAY' })).toHaveCount(0)
  await expect.poll(() => snapshotRequests.length).toBe(2, { timeout: 5_000 })
  await expect(page.locator('.run-control-summary')).toContainText('REPLAY')
  await page.locator('#evidence > summary').click()
  await page.locator('.run-evidence-details > summary').click()
  await expect(page.locator('.run-metadata')).toContainText('live-auto-run')
  await expect(page.getByText('REPLAY / HISTORY · snapshot', { exact: true })).toBeVisible()
  await expect(page.getByText('completed', { exact: true })).toBeVisible()
  await expect(page.getByText(/Backend đã nhận pha finished/)).toBeVisible()
  await expect(page.locator('.replay-counters')).toContainText('7,300')
  await expect(page.locator('.replay-counters')).toContainText('CLEANED')
  expect(new URL(snapshotRequests[0]).searchParams.get('data_mode')).toBe('LIVE')
  expect(new URL(snapshotRequests[1]).searchParams.get('data_mode')).toBe('REPLAY')
  expect(new URL(socketUrls[0]).searchParams.get('after')).toBe('live-snapshot-cursor')
  expect(runListRequests).toBeGreaterThanOrEqual(2)
})

test('ambiguous LIVE candidates are never selected automatically', async ({ page }) => {
  const selectedSnapshots: string[] = []
  await page.route('**/api/runs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      runs: ['live-run-a', 'live-run-b'].map(runId => ({
        run_id: runId,
        manifest: { run_id: runId, status: 'running', scenario: 'S1', seed: 701 },
        live: {
          status: 'running',
          terminal: false,
          freshness: 'fresh',
          eligible: true,
          last_activity_at: '2026-11-27T15:59:59Z',
          last_activity_stream: 'ryu_events.jsonl',
          age_seconds: 1,
          freshness_seconds: 30,
        },
      })),
      live_discovery: {
        mode: 'automatic',
        status: 'ambiguous',
        selected_run_id: null,
        candidate_run_ids: ['live-run-a', 'live-run-b'],
        freshness_seconds: 30,
      },
    }),
  }))
  await page.route('**/api/runs/live-run-b/snapshot*', async route => {
    selectedSnapshots.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: 'live-run-b',
        data_mode: 'LIVE',
        policy_mode: 'MITIGATE',
        live_monitor: {
          status: 'running',
          terminal: false,
          freshness: 'fresh',
          eligible: true,
          last_activity_at: '2026-11-27T15:59:59Z',
          last_activity_stream: 'ryu_events.jsonl',
          age_seconds: 1,
          freshness_seconds: 30,
        },
        run: { scenario: 'S1', seed: 701, status: 'running', policy_mode: 'MITIGATE', revision: {} },
        as_of_cursor: 'ambiguous-selected-cursor',
        snapshot_received_at: '2026-11-27T16:00:00Z',
        state: {
          prediction_count: 0,
          latest_prediction: null,
          latest_policies: [],
          rules: [],
          verified_source_count: 0,
          observations: [],
        },
      }),
    })
  })

  await page.goto('/')
  await expect(page.getByText('Có nhiều run LIVE hợp lệ.')).toBeVisible()
  await expect(page.getByLabel('Chọn run', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Theo dõi live-run-a' })).toBeVisible()
  await page.getByRole('button', { name: 'Theo dõi live-run-b' }).click()
  await expect(page.locator('.run-metadata')).toContainText('live-run-b')
  await expect.poll(() => selectedSnapshots.length).toBe(1)
  expect(new URL(selectedSnapshots[0]).searchParams.get('data_mode')).toBe('LIVE')
})

test('static B8 topology uses documented hosts and remains expandable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockEmptyRunList(page)
  await page.goto('/')
  await page.locator('#evidence > summary').click()
  const expand = page.getByRole('button', { name: 'Mở rộng sơ đồ' })
  await expand.click()
  await expect(page.locator('#topology')).toHaveClass(/topology-panel-expanded/)
  const collapse = page.getByRole('button', { name: 'Thu gọn sơ đồ' })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Phóng to', exact: true }).click()
  await page.getByRole('button', { name: 'Thu nhỏ', exact: true }).click()
  await collapse.click()
  await expect(page.locator('#topology')).not.toHaveClass(/topology-panel-expanded/)
  await expect(page.locator('.react-flow__node')).toHaveCount(11)
})

test('mobile navigation is keyboard accessible and the page does not overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockEmptyRunList(page)
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Mở điều hướng' })
  await toggle.click()
  const dialog = page.getByRole('dialog', { name: 'Điều hướng dashboard' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đóng điều hướng' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('link', { name: 'Chi tiết kết nối' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await toggle.click()
  await page.getByRole('navigation', { name: 'Các khu vực dashboard' }).getByRole('link', { name: 'Event Timeline' }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page).toHaveURL(/#history$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true })
})

test('tablet and narrow mobile layouts keep every section within the viewport', async ({ page }) => {
  await mockEmptyRunList(page)
  await page.goto('/')
  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: 'DROP Counter Timeline', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
