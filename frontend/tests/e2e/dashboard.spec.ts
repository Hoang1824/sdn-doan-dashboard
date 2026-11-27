import { test, expect } from '@playwright/test'

test('startup stays honest, renders every module and allows chart/history controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  const sockets: string[] = []
  const apiRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('websocket', socket => { if (!socket.url().includes('token=')) sockets.push(socket.url()) })
  page.on('request', request => { if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') apiRequests.push(request.url()) })
  await page.goto('/')
  await expect(page).toHaveTitle('Sentinel SDN | Security Operations')
  await expect(page.getByRole('heading', { name: 'Tổng quan an ninh mạng' })).toBeVisible()
  for (const title of ['Network Overview', 'AI Detection', 'Attack Alerts', 'SDN Topology', 'Mitigation', 'Attack History', 'Performance', 'System Status']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
  await expect(page.locator('.metric-value strong')).toHaveText(['—', '—', '—', '—'])
  await expect(page.locator('#system .status-badge')).toHaveText(['Chưa cấu hình', 'Chưa cấu hình', 'Chưa cấu hình'])
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
  await expect(page.getByText('Chưa có dữ liệu topology', { exact: true })).toBeVisible()
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
  expect(apiRequests).toEqual([])
  expect(sockets).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true })
})

test('topology controls expand and collapse without inventing devices', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
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
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
})

test('mobile navigation is keyboard accessible and the page does not overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
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
  await page.goto('/')
  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: 'Network Overview', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
