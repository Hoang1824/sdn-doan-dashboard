import { test, expect } from '@playwright/test'

async function mockEmptyRunList(page: import('@playwright/test').Page) {
  await page.route('**/api/runs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ runs: [] }),
  }))
}

test('startup stays honest, renders every module and allows chart/history controls', async ({ page }, testInfo) => {
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
  await expect(page.getByRole('heading', { name: 'Tổng quan an ninh mạng' })).toBeVisible()
  for (const title of ['Network Overview', 'AI Detection', 'Attack Alerts', 'SDN Topology', 'Mitigation', 'Attack History', 'Performance', 'System Status']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
  await expect(page.locator('.metric-value strong')).toHaveText(['—', '—', '—', '—'])
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
  await page.getByRole('button', { name: '5 phút', exact: true }).click()
  await expect(page.getByRole('button', { name: '5 phút', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('searchbox').fill('192.0.2.1')
  await page.getByRole('combobox', { name: 'Loại sự kiện' }).selectOption('mitigation')
  await expect(page.getByRole('heading', { name: 'Chưa có lịch sử sự kiện' })).toBeVisible()
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click()
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Loại sự kiện' })).toHaveValue('all')
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
        },
      }),
    })
  })

  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname.startsWith('/ws/runs/')) sockets.push(socket.url())
  })
  await page.goto('/')
  await page.getByLabel('Chọn run', { exact: true }).selectOption('s8-run-final')
  await page.getByRole('button', { name: 'Tải snapshot lịch sử' }).click()

  await expect(page.getByText('s8-run-final', { exact: true })).toBeVisible()
  await expect(page.getByText('S8 / 1101', { exact: true })).toBeVisible()
  await expect(page.getByText('REPLAY / HISTORY · snapshot', { exact: true })).toBeVisible()
  await expect(page.getByText('completed', { exact: true })).toBeVisible()
  await expect(page.locator('.metric-value strong')).toHaveText(['—', '—', '—', '0'])
  await expect(page.locator('.replay-summary-grid dd')).toHaveText([
    '5,927',
    'Chưa có dữ liệu từ API',
    '6',
    '0',
  ])
  await expect(page.locator('.replay-counters li')).toHaveCount(6)
  await expect(page.locator('.replay-counters')).toContainText('0xb83524a71b55e4bc')
  await expect(page.locator('.replay-counters')).toContainText('7,300 packets')
  await expect(page.getByRole('region', { name: 'Bảng luật giảm thiểu' }).getByText('CLEANED', { exact: true })).toHaveCount(6)
  await expect(page.getByText(/Model: B7\.3\.5_TRIAL_3/)).toBeVisible()
  await expect(page.getByText('Accuracy mô hình')).toBeVisible()
  await expect(page.locator('#detection').getByText('Chưa có dữ liệu', { exact: true })).toBeVisible()
  const profileDetails = page.locator('.revision-details')
  await expect(profileDetails.locator('pre')).toBeHidden()
  await profileDetails.locator('summary').click()
  await expect(profileDetails.locator('pre')).toContainText('profile-details-marker')
  await expect(page.getByText('Không sử dụng (REPLAY)', { exact: true })).toBeVisible()
  await expect(page.getByText('Chưa giám sát trực tiếp', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Tóm lược snapshot, không phải toàn bộ event', { exact: false })).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(sockets).toEqual([])
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
    })), 500)
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

  await expect(page.locator('.run-metadata')).toContainText('live-auto-run')
  await expect(page.getByText('LIVE · theo dõi bản ghi mới', { exact: true })).toBeVisible()
  await expect.poll(() => socketUrls.length).toBe(1)
  await expect.poll(() => snapshotRequests.length).toBe(2, { timeout: 5_000 })
  await expect(page.getByText('REPLAY / HISTORY · snapshot', { exact: true })).toBeVisible()
  await expect(page.getByText('completed', { exact: true })).toBeVisible()
  await expect(page.getByText(/Backend đã nhận pha finished/)).toBeVisible()
  await expect(page.locator('.replay-counters')).toContainText('7,300 packets')
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
  await page.getByRole('navigation', { name: 'Các khu vực dashboard' }).getByRole('link', { name: 'Attack History' }).click()
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
    await expect(page.getByRole('heading', { name: 'Network Overview', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
