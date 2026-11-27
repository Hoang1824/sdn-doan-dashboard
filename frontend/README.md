# Sentinel SDN — SOC Dashboard

Giao diện giám sát phát hiện và giảm thiểu DDoS trong mạng SDN, dùng React,
TypeScript và Vite. Dashboard có dark mode, bố cục responsive, biểu đồ Recharts
và sơ đồ tương tác React Flow.

## Phạm vi hiện tại

Đây là giai đoạn xây dựng frontend. Ứng dụng **chưa kết nối FastAPI, AI, Ryu
hoặc Mininet**. Nguồn dữ liệu mặc định rỗng; không có chế độ tự sinh dữ liệu
mô phỏng. Giá trị chưa biết hiển thị `—`; AI, Ryu và WebSocket hiển thị trạng
thái riêng biệt. Danh sách rỗng không có nghĩa mạng an toàn hoặc đã giảm thiểu
thành công.

Luật DROP chỉ có thể hiển thị `VERIFIED` khi bản ghi có bằng chứng khả dụng từ
controller hoặc switch. Kiểm tra phía frontend là quy tắc hiển thị, không thay
thế quy trình xác minh thực tế của backend.

`docs/HANDOFF.md` và `docs/API_CONTRACT.md` ở thư mục gốc repository được giữ
nguyên để chờ bàn giao. Không suy đoán endpoint, model, payload hoặc quy trình
mitigation. Chi tiết tại [kiến trúc frontend](../docs/FRONTEND_ARCHITECTURE.md).

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

## Các lệnh

Chạy các lệnh sau từ thư mục `frontend/`:

| Lệnh | Mục đích |
| --- | --- |
| `npm ci` | Cài dependencies theo `package-lock.json`. |
| `npm run dev` | Chạy Vite để phát triển và xem giao diện local. |
| `npm run build` | Kiểm tra TypeScript rồi tạo bản production trong `dist/`. |
| `npm run preview` | Xem bản build local sau khi chạy `npm run build`. |
| `npm test` | Chạy kiểm thử thuần tại `../tests/dashboard-state.test.ts` bằng Node. |
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

`DashboardProvider` là điểm đưa snapshot vào cây component. Các kiểu trong
`src/types/dashboard.ts` phục vụ giao diện, **không phải hợp đồng API**. Sau
bàn giao, adapter sẽ chịu trách nhiệm kiểm tra dữ liệu thực, lấy snapshot REST
và xử lý sự kiện WebSocket theo contract đã thống nhất. Reconnect, khử trùng
lặp, phát hiện sự kiện thiếu và đối soát trạng thái thuộc giai đoạn tích hợp.
