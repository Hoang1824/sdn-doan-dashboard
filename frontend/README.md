# Sentinel SDN — SOC Dashboard

Giao diện giám sát phát hiện và giảm thiểu DDoS trong mạng SDN, dùng React,
TypeScript và Vite. Dashboard có dark mode, bố cục responsive, biểu đồ Recharts
và sơ đồ tương tác React Flow.

## Phạm vi hiện tại

Dashboard đọc danh sách run và snapshot từ B8 Read-Only API. `REPLAY` /
`HISTORY` là chế độ mặc định; danh sách run được cập nhật mỗi 5 giây để phát
hiện run LIVE mới. Run chỉ được theo dõi sau khi người dùng chọn rõ candidate;
nếu có nhiều candidate, dashboard không tự chọn. Chế độ LIVE không khẳng định
traffic hoặc tấn công hiện đang chạy. Dữ liệu chưa có trong API (traffic
samples, topology, latency) tiếp tục hiển thị là chưa khả dụng; không có dữ liệu
mock trong runtime.

Luật DROP chỉ có thể hiển thị `VERIFIED` khi bản ghi có bằng chứng khả dụng từ
controller hoặc switch. Kiểm tra phía frontend là quy tắc hiển thị, không thay
thế quy trình xác minh thực tế của backend.

`AI Inference` và `Ryu Controller` không được đánh dấu healthy dựa trên việc
dashboard API trả lời; backend read-only không cung cấp health check trực tiếp
cho hai dịch vụ đó. Không suy luận độ trễ từ timestamp của các clock khác nhau.
Chi tiết kiến trúc tại [kiến trúc frontend](../docs/FRONTEND_ARCHITECTURE.md)
và schema tại [API_CONTRACT.md](../docs/API_CONTRACT.md).

## Chạy trên máy phát triển

Yêu cầu Node.js 24 và npm. Từ thư mục gốc repository:

```powershell
cd frontend
npm ci
npm run dev
```

Mở địa chỉ **Local** do Vite in ra trong terminal; cổng có thể thay đổi nếu cổng
mặc định đã được sử dụng. Nhấn `Ctrl+C` trong terminal để dừng server.

Trên PowerShell, nếu chính sách thực thi chặn `npm.ps1`, có thể dùng `npm.cmd`
thay cho `npm` với cùng tham số.

## Kết nối B8 API

Vite proxy `/api` và `/ws` tới `B8_DASHBOARD_PROXY_TARGET`. Mặc định target là
`http://127.0.0.1:8003`, phù hợp khi SSH tunnel chuyển tiếp Ubuntu
`127.0.0.1:8003` tới Windows local `127.0.0.1:8003`. Có thể override target qua
biến môi trường hoặc `frontend/.env.local`; không ghi IP máy ảo vào source.

Ví dụ SSH tunnel (thay host bằng địa chỉ VMware đã được cấu hình):

```powershell
ssh -N -L 8003:127.0.0.1:8003 <user>@<vm-host>
```

Để chạy Vite với target khác:

```powershell
$env:B8_DASHBOARD_PROXY_TARGET = "http://127.0.0.1:8003"
npm run dev
```

Trong production, `VITE_B8_API_BASE_URL` đặt REST origin và
`VITE_B8_WS_BASE_URL` tùy chọn đặt WebSocket origin. Các giá trị `VITE_*` được
đóng gói công khai vào browser bundle; **không đặt token/secret** tại đó. Giữ
backend trên loopback và dùng SSH tunnel; không mở inference `8002`, ACK relay
`9012` hoặc OpenFlow `6653` cho browser.

## Các lệnh

Chạy các lệnh sau từ thư mục `frontend/`:

| Lệnh | Mục đích |
| --- | --- |
| `npm ci` | Cài dependencies theo `package-lock.json`. |
| `npm run dev` | Chạy Vite để phát triển và xem giao diện local. |
| `npm run build` | Kiểm tra TypeScript rồi tạo bản production trong `dist/`. |
| `npm run preview` | Xem bản build local sau khi chạy `npm run build`. |
| `npm test` | Chạy kiểm thử reducer, API mapping, lifecycle và WebSocket bằng Node. |
| `npm run test:e2e` | Chạy kiểm thử giao diện bằng Playwright và trình duyệt headless. |
| `npm run lint` | Kiểm tra quy tắc ESLint. |

Build hoặc kiểm thử frontend không xác nhận hệ thống AI–SDN realtime đang hoạt
động. Cần kiểm thử tích hợp với hệ thống thực sau khi nhận tài liệu bàn giao.

## Kiểm thử trình duyệt

`playwright.config.ts` dùng **Microsoft Edge đã cài trên Windows**, ở chế độ
headless. Trên hệ điều hành khác, cấu hình dùng Chromium của Playwright; cài
trình duyệt trước khi chạy lần đầu:

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright tự khởi động Vite tại `http://127.0.0.1:4175` và dừng server sau khi
kiểm thử. Cổng `4175` phải còn trống vì cấu hình không tái sử dụng server đang
chạy. Kết quả kiểm thử được ghi vào `frontend/test-results/`; trace và ảnh lỗi
được giữ lại khi test thất bại.

Các fixture tổng hợp chỉ dùng trong kiểm thử, không được nhập vào nguồn dữ
liệu của dashboard. Kiểm thử thuần tập trung vào số liệu chưa biết, trạng thái
kết nối và điều kiện hiển thị xác minh. Kiểm thử trình duyệt kiểm tra các khu
vực giao diện, bộ lọc, topology, điều hướng bàn phím và bố cục responsive.

## Tổ chức mã nguồn

```text
frontend/
├── src/
│   ├── app/                  # Bố cục và điều hướng dashboard
│   ├── components/           # Panel, MetricCard, StatusBadge, EmptyState
│   ├── data/                 # Provider, snapshot ban đầu, quy tắc hiển thị
│   ├── features/
│   │   ├── network/          # Network Overview và biểu đồ traffic
│   │   ├── detection/        # AI Detection và confidence
│   │   ├── alerts/           # Attack Alerts
│   │   ├── mitigation/       # Luật DROP và bằng chứng xác minh
│   │   ├── topology/         # SDN Topology tương tác
│   │   ├── history/          # Lịch sử, tìm kiếm, lọc và phân trang
│   │   ├── performance/      # Các chỉ số độ trễ
│   │   └── system-status/    # Trạng thái AI, Ryu và WebSocket
│   ├── styles/               # Tokens dark mode và responsive
│   └── types/                # Kiểu dữ liệu phục vụ giao diện
├── tests/e2e/                # Kiểm thử Playwright
└── playwright.config.ts

tests/dashboard-state.test.ts # Kiểm thử thuần tại thư mục gốc repository
```

`DashboardProvider` tải runs/snapshot, quản lý trạng thái kết nối và chỉ mở
WebSocket LIVE sau snapshot/cursor. `src/data/b8-api.ts` xác thực response
contract; `src/data/b8-read-model.ts` ánh xạ event vào UI state có giới hạn;
`src/data/b8-live-feed.ts` xử lý reconnect, dedupe, cursor và resync. Các
component tiếp tục nhận read model từ provider; topology, traffic và latency
chỉ được hiển thị khi API có bằng chứng tương ứng.
