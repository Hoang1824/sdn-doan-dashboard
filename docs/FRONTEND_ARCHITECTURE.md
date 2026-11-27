# Kiến trúc frontend SOC Dashboard

## Phạm vi hiện tại

Frontend dùng React, TypeScript và Vite. Recharts phục vụ biểu đồ lưu lượng;
React Flow phục vụ tương tác topology. Đây là giai đoạn xây dựng giao diện và
ranh giới dữ liệu, chưa tích hợp FastAPI, AI, Ryu hoặc Mininet.

`HANDOFF.md` và `API_CONTRACT.md` chưa có nội dung tại thời điểm triển khai.
Không suy đoán kiến trúc model, nhãn dự đoán, endpoint, payload, chu kỳ lấy mẫu,
ngưỡng cảnh báo hoặc cách controller xác minh DROP.

## Phân chia trách nhiệm

- `src/app/`: bố cục, điều hướng và ghép các khu vực dashboard.
- `src/components/`: thành phần giao diện tái sử dụng, không mở kết nối mạng.
- `src/features/`: các khu vực theo nghiệp vụ giám sát.
- `src/types/dashboard.ts`: read model của giao diện, **không phải API contract**.
- `src/data/DashboardProvider.tsx`: điểm đưa snapshot vào cây component.
- `src/data/useDashboard.ts`: hook đọc snapshot; yêu cầu có provider.
- `src/data/initial-state.ts`: trạng thái ban đầu chưa cấu hình nguồn dữ liệu.
- `src/data/presentation.ts`: quy tắc hiển thị số liệu và trạng thái mitigation.
- `src/styles/`: hệ thống màu, typography và responsive.
- `tests/dashboard-state.test.ts`: kiểm thử thuần các quy tắc dữ liệu quan trọng.

Provider mặc định dùng snapshot rỗng. Tham số `snapshot` cho phép adapter tương
lai truyền dữ liệu đã xác thực, đồng thời hỗ trợ kiểm thử component. Provider
không tạo timer, sự kiện ngẫu nhiên hoặc yêu cầu mạng.

## Tính trung thực của giao diện

- Giá trị chưa biết là `null`, hiển thị `—`. Số `0` chỉ dành cho phép đo thực tế.
- `receivedAt` là thời điểm thực sự nhận dữ liệu; không dùng thời gian mở trang.
- Các danh sách ban đầu rỗng; không suy ra hệ thống an toàn từ danh sách rỗng.
- AI, Ryu và WebSocket có trạng thái độc lập. Socket kết nối không chứng minh
  model hoặc controller hoạt động.
- Không có dữ liệu lưu lượng, node topology, confidence, lịch sử hoặc latency
  mô phỏng trong nguồn dữ liệu mặc định.
- Confidence trong read model dùng khoảng `0..1`. Adapter tương lai phải ánh xạ
  và kiểm tra theo contract bàn giao; đây không phải giả định về đầu ra model.
- `getMitigationStatus` hạ một giá trị `verified` thiếu bằng chứng khả dụng xuống
  `unverified`. Bằng chứng phải có nguồn controller/switch, tham chiếu không rỗng
  và thời điểm quan sát hợp lệ.
- Kiểm tra trên chỉ là hàng rào hiển thị. Nó không xác minh tính xác thực của
  bằng chứng, không gửi lệnh xuống switch và không thay quy trình xác minh backend.
  Các trạng thái `pending`, `installed`, `expired`, `failed` không được nâng lên
  `verified` chỉ vì một object bằng chứng xuất hiện.
- `getVerifiedSourceCount` chỉ hiển thị tổng nguồn đã xác minh khi số do hệ thống
  cung cấp là số nguyên không âm hợp lệ và khớp số IP duy nhất có luật `verified`
  với bằng chứng khả dụng. Các luật trùng IP trên nhiều switch chỉ tính một nguồn;
  IP rỗng và luật không còn `verified` không được tính. Thiếu tổng hoặc không khớp
  thì hiển thị `—`; không suy ra số `0` từ danh sách rỗng. Tổng `0` được hệ thống
  cung cấp rõ ràng và không mâu thuẫn với bằng chứng vẫn được hiển thị.
- Chính sách tổng trên chủ ý thận trọng: snapshot chỉ chứa một phần danh sách
  cũng có thể trả `—`. Khi backend hỗ trợ phân trang, cần contract riêng cho tổng
  và bằng chứng tổng hợp đã xác thực; không dùng số đếm thô để bỏ qua kiểm tra này.
- Không tự đặt ngưỡng dữ liệu quá hạn hoặc giả định rằng bằng chứng cũ còn hiệu lực.

## Kế hoạch tích hợp sau bàn giao

Các mục dưới đây **chưa được triển khai**:

1. Xác nhận hợp đồng API, định danh nguồn, timestamp, đơn vị đo và quyền truy cập.
   Kiểm tra dữ liệu runtime trước khi ánh xạ vào read model.
2. Dùng REST lấy snapshot ban đầu, lịch sử và snapshot để đối soát trạng thái.
3. Dùng WebSocket nhận sự kiện mới. Thiết kế thứ tự snapshot/event, event ID,
   cursor hoặc sequence dựa trên khả năng thực tế của backend.
4. Loại sự kiện trùng; phát hiện khoảng thiếu theo contract; đồng bộ lại khi
   reconnect hoặc khi phát hiện thiếu dữ liệu. Không tự bù dữ liệu giả.
5. Giới hạn bộ nhớ biểu đồ, hàng đợi sự kiện và cache ID. Gộp cập nhật render khi
   cần để tránh giao diện bị quá tải. Không chặn vòng monitoring/mitigation của Ryu.
6. Ánh xạ vòng đời cài luật, xác minh, hết hạn và lỗi từ dữ liệu controller/switch.
   Trạng thái xác minh và số nguồn bị chặn phải nhất quán với bằng chứng còn hiệu lực.
7. Xác nhận cách đo latency, quan hệ giữa timestamp và đồng bộ đồng hồ. Chỉ hiển thị
   chỉ số đo được; không thay bằng thời gian render hoặc giá trị cấu hình.
8. Áp dụng chính sách freshness riêng cho từng nguồn theo tần suất/cơ chế heartbeat
   được bàn giao; phân biệt mất kết nối với dữ liệu cũ.

Không sửa model AI hoặc logic giảm thiểu DDoS trong giai đoạn giao diện.

## Kiểm tra

Từ thư mục `frontend`, có thể chạy kiểm thử thuần bằng Node.js 24:

```powershell
node --experimental-strip-types --test ../tests/dashboard-state.test.ts
```

Các test kiểm tra dữ liệu chưa biết, số 0 đo được, tính độc lập trạng thái dịch vụ,
điều kiện hiển thị VERIFIED và tổng IP đã xác minh khớp bằng chứng. Fixture chỉ tồn tại trong `tests/`, không được
import vào ứng dụng. Build thành công hoặc các test này thành công không chứng
minh tích hợp realtime hoạt động; cần kiểm thử end-to-end với hệ thống thực sau bàn giao.
