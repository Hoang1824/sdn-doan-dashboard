# B8 Dashboard Handoff — 27/11/2026

> **Mục đích:** Đối chiếu dashboard React/Codex với hệ thống SDN–AI DDoS B8 đã được kiểm thử. Đây là **tài liệu bàn giao**, không phải khẳng định backend dashboard đã được tích hợp. Không chỉnh logic model/Ryu/Mininet nếu chưa có kiểm thử và sự đồng ý.

## 1. Trạng thái có bằng chứng

- Workspace frontend trên Windows: `D:\doan-ddos-sdn\sdn-doan-dashboard`; React + TypeScript + Vite; GitHub repository `Hoang1824/sdn-doan-dashboard`, nhánh `main` đã push.
- Ubuntu VMware: `/home/mininet/doan-ddos-sdn`; topology `sdn_topo_final.py`.
- Controller B8: `v2_integrated/ryu_b8_b735_mitigate.py` revision `B8_ACK_IDLE_DROP_1`.
- Kịch bản: `b8_kich_ban_live.py`, revision `B8_S78_STAGES_1`; sensor qua `sudo python3 -u b8_kich_ban_live.py sensor`; sensor revision `B8_SENSOR_EVENT_TIME_1`.
- Model đóng băng `B7.3.5_TRIAL_3` CNN–MLP; SHA-256 model `e409da09a80d8ca1d26f51fbc188d9a6b77f915c983cc1877685b8839d71dbe5`.
- 7 đặc trưng theo đúng thứ tự: `Protocol`, `Flow Duration`, `Total Fwd Packets`, `Total Length of Fwd Packets`, `Flow Bytes/s`, `Flow Packets/s`, `Average Packet Size`; 3 lớp `benign`, `syn_flood`, `udp_flood`.
- API inference: `127.0.0.1:8002`; relay nội bộ có ACK: `127.0.0.1:9012`; Ryu/OpenFlow: `6653`. **Không** chuyển API inference hoặc relay ra mạng công khai. Dashboard dùng cổng riêng, xác minh cổng thật với mã hiện có.
- Hoàn tất 5 kịch bản `S1`, `S2`, `S4`, `S7`, `S8`, mỗi kịch bản 3 seed × 2 mode (`ALERT_ONLY`, `MITIGATE`) = **30 lượt hợp lệ**. Có lịch sử những lượt lỗi riêng; không xóa/đánh tráo. Tài liệu đối chiếu: `README_KIEM_THU_B8.md`, `TONG_HOP_THUC_NGHIEM_B8.md`, cập nhật 27/11/2026.
- Tổng qua 15 lượt MITIGATE: **66 luật DROP xác nhận**, tổng *counter cuối theo luật* **359.939**; không được gọi đó là tỷ lệ chặn hay số liệu live hiện tại.
- Các số liệu 100% phân loại ở các cửa sổ đủ điều kiện của B8 không phải bằng chứng mô hình đạt 100% trên mọi traffic/holdout. Đánh giá B7 holdout và B8 vận hành phải trình bày riêng.

## 2. Topology đã xác nhận

| Phần tử | IP/Vai trò | Kết nối |
|---|---|---|
| `h1`–`h4` | `10.0.0.1`–`10.0.0.4`, HTTP hợp lệ | `s1` |
| `a1`–`a3` | `10.0.0.10`–`10.0.0.12`, nguồn SYN/UDP | `s2` |
| `hsrv` | `10.0.0.100`, web server đích | `score` |
| Switches | `s1`, `s2`, `score` | Ryu OpenFlow 1.3 |

`score` có DPID 3. Sensor capture ở `score-eth3` phía server. Sau khi `score` DROP, gói bị chặn không xuất hiện ở sensor downstream: phải dùng chứng cứ rule/counter của OVS, **không** suy luận “không còn dự đoán” là “không có tấn công”.

## 3. Luồng xử lý thực tế

1. Mininet tạo HTTP hợp lệ / SYN flood / UDP flood theo kịch bản và seed.
2. Sensor B8 lấy packet timing và trích xuất đúng 7 feature.
3. Sensor gọi inference API tại `127.0.0.1:8002`.
4. Prediction có ID chuyển qua relay `127.0.0.1:9012` với ACK tới Ryu.
5. Ryu áp dụng B8 policy. `DDOS_AI_MODE=ALERT_ONLY` vẫn có thể được giữ ở controller nền; chính **`B8_POLICY_MODE=ALERT_ONLY` hay `MITIGATE`** mới quyết định chặn trong B8.
6. Trong MITIGATE, cần 3 quyết định attack liên tiếp theo nguồn và giao thức trong khoảng cách cho phép, rồi áp **DROP** trên `score`.
7. Rule priority `210`, `idle_timeout=10`, `hard_timeout=0`; `idle_timeout=10` là 10 giây **không có gói match**, không phải deadline cố định từ lúc cài. Xác minh qua Barrier + FlowStats; counter và gỡ từ các bằng chứng OVS/Ryu/FlowRemoved.
8. Dashboard chỉ đọc và hiển thị; không gửi lệnh điều khiển OpenFlow khi chưa có yêu cầu/thiết kế riêng.

**Không nhầm** tên nội bộ `meter_candidate` với hành động: B8 hiện dùng `mitigation_action=DROP`, không dùng meter để rate limit.

## 4. Nguồn dữ liệu chính để nối dashboard

Thư mục theo lượt: `/home/mininet/doan-ddos-sdn/logs_v2/<run_id>/`.

| File | Công dụng |
|---|---|
| `manifest.json` | run_id, scenario, seed, mode, trạng thái, phiên bản/profile |
| `timeline.jsonl` | chuỗi sự kiện do Sensor/theo dõi tổng hợp |
| `ryu_events.jsonl` | sự kiện dự đoán nhận, policy, xác minh, lỗi, cookie, counters |
| `ovs_samples.jsonl` | số đo/trạng thái OVS theo thời gian |
| `events.jsonl` | thông tin pha thực nghiệm |
| `http_h1.csv`–`http_h4.csv` | HTTP success/failure và độ trễ theo client |
| `report.json` | báo cáo cuối lượt; **không** dùng làm nguồn live duy nhất |

Các tên sự kiện trong `timeline.jsonl` cần hỗ trợ: `AI_BENIGN`, `AI_PHAT_HIEN`, `RYU_NHAN`, `RYU_DANH_GIA`, `OVS_DA_AP_LUAT`, `OVS_DA_LOAI_GOI`, `OVS_GO_LUAT`, `OVS_DON_LUAT`. Đọc tăng dần JSONL **chỉ các dòng đầy đủ**, dùng run_id + event/sample ID + cookie để chống trùng; ghi cursor/offset khi reconnect. Không cộng cả `AI_PHAT_HIEN` và `RYU_NHAN` thành hai dự đoán. DROP counter lũy kế theo cookie: lấy số mới và delta so với số trước, **không cộng toàn bộ counter mỗi lần poll**.

Phân biệt timestamp của sự kiện, thời điểm backend nhận và frontend render. Không coi `AI_PHAT_HIEN.timestamp` là packet-first-seen nếu không có bằng chứng.

## 5. Vấn đề với bridge lưu trước đây — cần kiểm tra code hiện hành

Một bản `b8_dashboard_bridge.py` đã lưu trong thư viện dự án là bridge **đời cũ**, không thể coi là adapter B8 chuẩn:

- `path_state()` đọc từ `ryu_buoc6_mitigate/logs_ai/alert_only`, không đọc nguồn chính `logs_v2/<run_id>/...` của B8.
- `/api/health` hardcode `mode=ALERT_ONLY`, `model_family=mininet_6_feature_integration`.
- `/api/summary` hardcode model `cnn_mlp_mininet.keras`, `model_scope=integration_smoke_only`.
- `recent_jsonl()` lọc các event cũ `mitigation_confirmed`/`mitigation_removed`, chưa map đầy đủ event B8 và evidence cookie.
- Dùng `ThreadingHTTPServer` với REST polling, chưa có WebSocket tự phát sự kiện B8.
- `metric_report()` tính macro-F1 không phân biệt các lớp có support; khi dùng để báo kết quả B8 phải chỉnh theo quy tắc đánh giá thực nghiệm, lớp không có support là NA.

**Không khẳng định bản bridge cũ là bản đang chạy**; hãy mở mã trong repository Windows/VM hiện tại rồi đối chiếu bằng `git status`, đường dẫn file, API routes, log thực và kiểm thử.

## 6. Kiến trúc dashboard cần giữ

- **Frontend Windows:** React/TypeScript/Vite, chỉ nhận dữ liệu qua REST + WebSocket. Không dùng IP nội bộ Mininet (`10.0.0.*`) để kết nối tới backend quản lý VM.
- **Backend dashboard:** giữ và mở rộng backend hiện có, không tạo backend cạnh tranh khi chưa xem code. Phương án ưu tiên là chạy backend hoặc B8 adapter trên Ubuntu VM để đọc `logs_v2` tại chỗ và phát WebSocket tới frontend Windows qua mạng VMware NAT. Nếu backend hiện tại chạy Windows, cần chọn duy nhất một cơ chế chuyển sự kiện khỏi VM và chứng minh không đếm trùng.
- **Cổng dashboard:** tìm cổng backend thật đang dùng; 8003/8081 chỉ là ví dụ tùy các phiên bản, **không phải xác nhận triển khai**. Giữ AI API 8002 và relay 9012 ở loopback.
- **Bảo mật:** không lộ relay token, không đưa `.env`/key lên GitHub; giới hạn binding IP, origins và quyền truy cập trong mạng lab.

## 7. Chức năng giao diện phải phản ánh đúng B8

1. **Run monitor:** run_id, S1/S2/S4/S7/S8, seed, mode B8, phase hiện tại, revision, source LIVE/REPLAY, stale/disconnected.
2. **SDN topology:** `h1`–`h4`, `a1`–`a3`, `s1`, `s2`, `score`, `hsrv`; đánh dấu nguồn tấn công và vị trí rule (score).
3. **AI prediction:** nhãn 3 lớp, score/confidence (nếu log có), sample ID, source, giao thức; không gộp bản ghi relay/Ryu thành dự đoán thứ hai.
4. **Mitigation lifecycle:** detected → policy confirmed → FlowMod requested → OVS verified → drop count increasing → removed/expired/error. Bảo đảm `VERIFIED` dựa trên bằng chứng switch.
5. **Traffic & HTTP:** số liệu traffic *quan sát được*, HTTP request/success/failure/latency theo thời gian, chỉ số OVS/DROP đúng đơn vị; phân biệt tải yêu cầu với PPS thực đo.
6. **History:** lưu/đọc các run hoàn tất từ cùng run_id; `report.json` chỉ tổng kết khi audit hoàn tất.
7. **Performance:** tách detection latency, mitigation latency, backend-to-UI latency; đồng bộ giờ Windows–Ubuntu trước khi suy luận từ timestamp.

## 8. Kế hoạch tích hợp và tiêu chí nghiệm thu

1. **Audit repository hiện tại:** liệt kê backend/frontend, routes, test, bridge, schema, cổng và lệnh chạy. Không xóa dashboard đã xây, không làm lại UI trước khi xác định sai lệch.
2. **Schema mapping:** lấy mẫu JSONL thực từ S1 MITIGATE và S8 MITIGATE; tạo bảng raw-event → UI-event; kiểm tra run_id, sample ID, cookie, action, counter.
3. **Replay đã lưu, gắn nhãn REPLAY:** theo đúng log B8; xác minh UI khớp kết quả cuối lượt, không đếm trùng khi reconnect.
4. **Live có chủ đích:** API → Ryu → Sensor → Mininet; dùng kịch bản S1 MITIGATE seed 701 để đối chiếu cùng một run_id/cookie. Dừng/khởi động lại dashboard không được ảnh hưởng vòng đời chặn.
5. **Kiểm tra S8:** flash HTTP + SYN rồi UDP nối tiếp, không đồng thời, 6 luật đúng (3 IP × 2 giao thức) mỗi lượt MITIGATE; không nhầm tổng số luật thành số IP.
6. **Hiệu năng:** đo trễ từ nguồn sự kiện B8 tới browser; không hứa dưới một ngưỡng trước khi đo. Kiểm tra cập nhật, mất kết nối, reconnect, trùng event và counter.
7. **Bảo toàn bằng chứng:** không sửa 30 run thực nghiệm lịch sử; lần test dashboard mới lưu run riêng, đánh dấu ảnh hưởng nếu backend gây thêm tải.

## 9. Yêu cầu gửi Codex trước khi sửa code

> Hãy đọc `AGENTS.md`, tài liệu này, mã backend và frontend hiện có, cùng mẫu log B8 thật. Việc đầu tiên là báo cáo chênh lệch giữa code hiện tại với hợp đồng B8, liệt kê file và dòng gây chênh lệch, rồi đề xuất kế hoạch sửa tối thiểu. **Chưa chỉnh AI, scaler, topology, controller, script kịch bản hoặc dữ liệu gốc**. Không dựng WebSocket mới song song nếu backend đã có sẵn; không sử dụng mock làm nguồn live. Yêu cầu kiểm thử replay rồi mới live, đối chiếu ID/cookie/counter/độ trễ thực.

## 10. Bằng chứng dùng để lập handoff

- `README_KIEM_THU_B8.md` — hướng dẫn vận hành và 30 run B8 chốt 27/11/2026.
- `TONG_HOP_THUC_NGHIEM_B8.md` — thống kê B8 và phụ lục nối dashboard.
- Bản `b8_dashboard_bridge.py` đã lưu trong thư viện: ví dụ mã cũ, **chưa xác minh bản đang dùng trong repo**.
