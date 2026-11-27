# API Contract đề xuất — Dashboard B8 SDN DDoS

**Ngày:** 27/11/2026  
**Trạng thái:** DRAFT có căn cứ từ JSON thực; chưa phải API đã triển khai  
**Mục đích:** Bàn giao cho GitHub Copilot/Codex để kiểm toán và triển khai backend dashboard **chỉ đọc**; không sửa hệ thống AI–Ryu–Mininet.

## 1. Tình trạng đã xác minh

- Ubuntu VM quản lý: `192.168.159.130` (`eth0`), Windows chạy frontend Vite/React. Chưa xác nhận kết nối TCP Windows → Ubuntu bằng thử nghiệm từ Windows.
- Project Ubuntu `/home/mininet/doan-ddos-sdn`. Kịch bản `b8_kich_ban_live.py`; topology `sdn_topo_final.py`; controller `v2_integrated/ryu_b8_b735_mitigate.py`, revision `B8_ACK_IDLE_DROP_1`.
- Mô hình B7.3.5_TRIAL_3, ba lớp `benign`, `syn_flood`, `udp_flood`, bảy đặc trưng theo đúng thứ tự: Protocol, Flow Duration, Total Fwd Packets, Total Length of Fwd Packets, Flow Bytes/s, Flow Packets/s, Average Packet Size. SHA model trong mẫu: `e409da09a80d8ca1d26f51fbc188d9a6b77f915c983cc1877685b8839d71dbe5`.
- Inference API B8: `127.0.0.1:8002`; relay ACK: `127.0.0.1:9012`; Ryu OpenFlow: 6653. Giữ nguyên và **không công bố các cổng nội bộ ra mạng Windows**. `B8_POLICY_MODE` là mode chính sách (`ALERT_ONLY`/`MITIGATE`); không suy từ `DDOS_AI_MODE` hay `auto_mitigation_allowed` của prediction.
- Lượt để lấy mẫu schema: `20261126_060516_b8s8_mitigate_72aead` (S8 MITIGATE, seed 1101). Lượt S1 cũ: `20261119_095814_b8s1_mitigate_a12da0` (seed 701, phiên bản kịch bản cũ hơn).
- Hai run có `ovs_samples.jsonl` **0 byte**. Điều này không làm mất bằng chứng DROP vì `ryu_events.jsonl` chứa `b8_drop_counter` và `b8_mitigation_flow_removed`.
- Theo mã `b8_kich_ban_live.py` đã kiểm tra: `Timeline` mở `timeline.jsonl`, `ryu_events.jsonl` khi Sensor bắt đầu `monitor_session`; hàm `json_line` ghi và `flush()` mỗi dòng. Có thể thiết kế tail live; vẫn phải chạy thử live và đo độ trễ. `report.json` chỉ dùng cho tổng kết, không phải nguồn live duy nhất.
- Repository Windows theo Copilot audit: giao diện React đã có nhưng backend/REST/WebSocket chưa triển khai trong repository; thư mục `backend/` trống. Không mặc định `b8_dashboard_bridge.py` đời cũ đang chạy.

## 2. Nguồn và quyền ưu tiên

| Nguồn | Cách dùng | Ghi chú |
|---|---|---|
| `logs_v2/<run_id>/manifest.json` | Metadata run, model, mode, trạng thái, profile và revision | Có thể thay đổi trạng thái khi run kết thúc; không tự suy LIVE chỉ từ `status` |
| `ryu_events.jsonl` | **Nguồn chính** cho `v2_prediction`, `b8_live_policy_decision`, `b8_mitigation_requested`, `b8_mitigation_confirmed`, `b8_drop_counter`, `b8_mitigation_flow_removed`, `b8_mitigation_cleaned` | Theo `run_id`, `sample_id` và `cookie` |
| `timeline.jsonl` | Pha run, sự kiện dễ đọc, Sensor receipt `AI_BENIGN`/`AI_PHAT_HIEN`, `seen_at` | Không đếm trùng Ryu raw + timeline thành hai predictions hoặc hai luật |
| `events.jsonl` | Pha, thời gian và trạng thái kịch bản | Dùng để phân biệt base/warmup/attack/gap/recovery |
| `http_h1.csv`–`http_h4.csv` | HTTP success/failure, response latency và số request | Đơn vị/cột phải lấy từ header CSV thực tế |
| `switch_final.json`, `report.json` | Kiểm tra cuối run/replay/audit | Không thay thế cập nhật live |
| `ovs_samples.jsonl` | Bằng chứng bổ sung **nếu có** | Không được coi 0 byte là không có luật DROP |

**Cảnh báo về nguồn live:** `ryu_log` trong manifest là đường dẫn log trực tiếp của controller; `ryu_events.jsonl` trong thư mục run do Sensor tổng hợp khi chạy. Kiểm thử quyền truy cập và tốc độ ghi trên máy ảo trước khi khai thác live. Không phát nhiều luồng cùng nội dung mà chưa có quy tắc dedupe.

## 3. Tên sự kiện và ánh xạ đã có căn cứ

| Raw event trong `ryu_events.jsonl` | Ý nghĩa chuẩn hóa dự kiến | Khóa tương quan |
|---|---|---|
| `v2_prediction` | `ai.prediction` | `(run_id, id)` |
| `b8_live_policy_decision` | `policy.decision` | `(run_id, sample_id)` |
| `b8_mitigation_requested` | `mitigation.requested` | `(run_id, cookie)` + `sample_id` |
| `b8_mitigation_confirmed` | `mitigation.confirmed` | `(run_id, cookie)` + `sample_id` |
| `b8_drop_counter` | `mitigation.counter` | `(run_id, cookie)` và danh tính bản ghi |
| `b8_mitigation_flow_removed` | `mitigation.removed` | `(run_id, cookie)` |
| `b8_mitigation_cleaned` | `mitigation.cleaned` | `(run_id, cookie)` |

`timeline.jsonl` có `AI_BENIGN`, `AI_PHAT_HIEN`, `RYU_NHAN`, `RYU_DANH_GIA`, `RYU_YEU_CAU`, `OVS_DA_AP_LUAT`, `OVS_DA_LOAI_GOI`, `OVS_GO_LUAT`, `OVS_DON_LUAT`, `PHA_KICH_BAN`; dùng làm trình bày và đối chiếu, không nhân đôi cùng một thực thể prediction/rule.

**Định nghĩa OpenFlow:** `b8_mitigation_flow_removed.reason=0` nghĩa là `OFPRR_IDLE_TIMEOUT` ở OpenFlow 1.3. `idle_timeout_s=10` có nghĩa là gỡ sau thời gian *không có gói match*, không phải 10 giây từ lúc cài. `hard_timeout_s=0` không đặt giới hạn tổng thời gian cố định.

**Tên legacy:** `decision="meter_candidate"` là tên quyết định nội bộ cũ; hành động thật trong B8 mẫu là `mitigation_action="DROP"`, `meter_id=null`, `dpid=3`. UI phải ghi **DROP**, không được báo rate limiting/meter.

## 4. Schema đầu vào B8: các trường xác nhận qua mẫu S8

### 4.1 AI prediction — `v2_prediction`

- `run_id` (string), `id` (prediction ID), `timestamp` (Unix seconds), `prediction` (enum), `confidence` (0..1), `src_ip`, `src_port`, `dst_ip`, `dst_port`, `phase`, `values` (mảng 7 đặc trưng), `candidate`, `model_sha256`, `schema_version`, `mode`.
- `truth`, `label_valid` trong log phục vụ đánh giá; **không đưa vào AI inference và không hiển thị như nhãn thật của realtime traffic**.
- `auto_mitigation_allowed=false` trong một prediction mẫu không được dùng để phủ định chính sách B8 MITIGATE. `mode` của raw event mẫu là `MITIGATE`.

### 4.2 Policy — `b8_live_policy_decision`

- `run_id`, `timestamp`, `mode`, `sample_id`, `src_ip`, `dst_ip`, `ip_proto`, `prediction`, `decision`, `consecutive`.
- `sample_id` nối với `v2_prediction.id`. Đây không phải prediction thứ hai.

### 4.3 Luật — `requested`/`confirmed`

- `run_id`, `timestamp`, `mode`, `sample_id`, `src_ip`, `dst_ip`, `ip_proto`, `prediction`, `decision`, `consecutive`, `cookie`, `dpid`, `mitigation_action`, `meter_id`, `idle_timeout_s`, `hard_timeout_s`.
- B8 mẫu: `consecutive=3`, `mitigation_action=DROP`, `dpid=3`, `meter_id=null`, `idle_timeout_s=10`, `hard_timeout_s=0`.
- `confirmed` là bằng chứng xác nhận *được controller ghi nhận*. Muốn kiểm thử nghiêm ngặt, đối chiếu mã controller/FlowStats/Barrier theo contract B8; frontend không tự suy VERIFIED từ một chuỗi status không rõ nguồn.

### 4.4 Counter — `b8_drop_counter`

- `run_id`, `timestamp`, `sample_id`, `cookie`, `packet_count`, `counter_source`, `dpid`, `mitigation_action` và các trường nhận diện nguồn/đích/giao thức.
- Ví dụ từ cookie `0xb83524a71b55e4bc`: `packet_count=142`, `counter_source=verified_flow_stats`; cuối đời luật `b8_mitigation_flow_removed.packet_count=7300`, `byte_count=394200`, `reason=0`.
- Cùng cookie, counter **lũy kế** phải cập nhật bằng max/giá trị mới; delta là `new - previous` chỉ khi hai mẫu so sánh tương thích, không giảm/reset. Không bao giờ cộng 142+7300 thành 7442 packet.
- `OVS_DA_LOAI_GOI.delta=142`/`total=142` ở timeline là biểu diễn dẫn xuất của counter, không phải packet mới độc lập.

### 4.5 Removal — `b8_mitigation_flow_removed` và `b8_mitigation_cleaned`

- FlowRemoved chứa `timestamp`, `reason`, `packet_count`, `byte_count`, `cookie`, `sample_id`, `dpid`, ...; cleaned chứa `timestamp`, `cookie`, `sample_id`, ...
- `reason=0` là idle-timeout (OpenFlow 1.3); hiển thị `EXPIRED_IDLE`, rồi `CLEANED` khi có event thực. `removed` không đồng nghĩa luật chưa chặn.

## 5. Normalized contract dự kiến (chưa được Copilot triển khai)

Một sự kiện phát qua WebSocket nên có envelope, ví dụ (đây là **schema đề xuất**, không phải payload của server hiện hữu):

```json
{
  "schema_version": "b8.dashboard.v1",
  "run_id": "20261126_060516_b8s8_mitigate_72aead",
  "event_id": "stable-unique-event-key",
  "cursor": "opaque-resume-token",
  "kind": "mitigation.counter",
  "raw_event": "b8_drop_counter",
  "source_stream": "ryu_events.jsonl",
  "source_timestamp": 1795701942.7707245,
  "backend_received_at": null,
  "data_mode": "REPLAY",
  "policy_mode": "MITIGATE",
  "keys": {
    "sample_id": "v2_live_20261126_140516_862",
    "cookie": "0xb83524a71b55e4bc"
  },
  "payload": {
    "src_ip": "10.0.0.10",
    "dst_ip": "10.0.0.100",
    "ip_proto": 6,
    "dpid": 3,
    "mitigation_action": "DROP",
    "counter_source": "verified_flow_stats",
    "packet_count": 142
  }
}
```

- `event_id`: ổn định qua restart/replay, không sinh ngẫu nhiên mỗi lần poll. Có thể dựa trên `(run_id, source_stream, byte_offset hoặc sequence của dòng hoàn chỉnh)`; thiết kế phải xét việc truncate/rotate và không nhầm dữ liệu các run.
- `cursor`: token opaque để resume, không buộc frontend hiểu byte offset. Không đưa secret hoặc token nội bộ B8 vào payload.
- `data_mode`: `LIVE` khi backend đang theo dõi run hiện hành, `REPLAY` khi đọc run đã lưu. **Tách biệt** `policy_mode` (`ALERT_ONLY`/`MITIGATE`).
- Source timestamp, Sensor `seen_at`, backend nhận và browser nhận/render là bốn ý nghĩa thời gian khác nhau; không gắn nhãn latency nếu không đúng cặp mốc đo. `AI_PHAT_HIEN.timestamp` theo mã B8 là thời điểm Sensor console nhận prediction; `flow_last_ts` là timestamp gói cuối trong luồng.
- Cần đồng bộ/đo sai lệch đồng hồ Windows–Ubuntu trước khi tính network/browser latency tuyệt đối.

## 6. Giao diện backend dashboard dự kiến (KHÔNG PHẢI endpoint đã có)

- `GET /api/health` — trạng thái dashboard backend và nguồn log; không khẳng định Ryu/AI khỏe chỉ vì HTTP trả 200.
- `GET /api/runs` — danh sách run theo manifest với metadata / revision / status.
- `GET /api/runs/{run_id}/snapshot` — read model một run tại cursor nhất quán (gồm prediction, policy, rules, counter, traffic/HTTP nếu có).
- `GET /api/runs/{run_id}/events?after=<cursor>&limit=...` — nạp lịch sử/phát bù có phân trang.
- `WS /ws/runs/{run_id}?after=<cursor>` — stream sự kiện mới, heartbeat và `resync_required` khi cursor hết hiệu lực.
- Kiểm tra run_id regex, quyền truy cập và path traversal; giới hạn origin/permission với mạng VMware; giới hạn tần suất / băng thông khi nhiều prediction; không đọc ghi file data B8.
- REST snapshot rồi WS subscribe phải **không có khoảng trống**: snapshot trả `as_of_cursor=C`; stream từ C phát bù rồi nối live. Backend lưu cursor/offset đúng theo từng stream, khử trùng event khi reconnect, idempotent update phía client.

## 7. Read model UI cần bổ sung, nhưng GIỮ component hiện có

- `run`: run ID, scenario, seed, `B8_POLICY_MODE`, phase, revision, model SHA, `LIVE|REPLAY`, freshness/last_event_at.
- `prediction`: sample ID, 3-class label, confidence khi có, source/destination, IP protocol, source_timestamp, stage (`predicted`/`ryu_received`/`policy_evaluated`). Dedupe theo prediction ID.
- `rule`: `(run_id,cookie)`, `sample_id`, IP nguồn/đích, protocol, DPID, action, status `REQUESTED` → `CONFIRMED/VERIFIED` → `DROPPING` → `REMOVED_IDLE` → `CLEANED` (hoặc lỗi), count lũy kế, delta mới nhất, counter_source, confirmed_at/removed_at. Trạng thái phải dựa vào event/bằng chứng có thật, không tự vẽ countdown 10 s.
- `performance`: detection latency, mitigation latency, backend-to-UI latency **chỉ khi đo được đúng mốc**; không mặc định `timestamp` và `seen_at` là network latency WebSocket.
- `traffic`: không tự gán Mbps nếu dữ liệu B8 không hỗ trợ đo Mbps. Phân biệt configured PPS / actual measured PPS / HTTP request & latency / counter OVS.
- S8 có **6 luật = ba IP tấn công nhân hai protocol** trong hai đợt SYN và UDP nối tiếp; không phải sáu nguồn IP, cũng không phải SYN và UDP đồng thời.

## 8. Điều kiện nghiệm thu tối thiểu

1. Replay một run S1 MITIGATE và S8 MITIGATE, hiển thị nhãn rõ `REPLAY`; không sửa bất kỳ file B8 nào.
2. Với S8, tổng dự đoán duy nhất là 5927 (= 5684 benign + 243 attack), Ryu nhận 5927; cần đối chiếu từng `id`, không chỉ tổng bằng nhau. Có sáu luật requested/confirmed/removed/cleaned; không nhân đôi với timeline.
3. Cookie mẫu `0xb83524a71b55e4bc`: request → confirmed → `packet_count=142` → `FlowRemoved.packet_count=7300` → cleaned, `reason=0` thể hiện idle-timeout. Không báo 7442.
4. Refresh/reconnect không cộng thêm prediction/rule/counter; nhận biết gap và resync.
5. Khi chưa có run hoặc backend disconnected: `—`, `unknown`, `stale` hay `disconnected`; không sinh fake traffic và không tự kết luận mạng an toàn.
6. Một run live S1 MITIGATE có chủ đích (ví dụ seed 701) cho thấy event trước khi run kết thúc; sau đó S8 nếu cần; đo độ trễ độc lập. Không cần chạy lại bộ 30 lượt B8 lịch sử.
7. Backend là reader **read-only** chạy độc lập; dừng/restart dashboard không ảnh hưởng tới Mininet, Sensor, inference, relay, Ryu, OVS hoặc luật DROP.
8. Bảo toàn frontend và Git working tree hiện có; trước khi Agent sửa, lưu trạng thái sửa đổi và commit/sao lưu có kiểm soát; không tự động reset hoặc overwrite.

## 9. Các điểm còn cần xác minh bằng thực nghiệm

- Windows `Test-NetConnection 192.168.159.130 -Port 22` và cổng backend dashboard thực tế khi được tạo; đây chưa phải kết quả được cung cấp.
- Quyền đọc và vòng đời các file JSONL ở run live, trường hợp log rotation/truncate/partial JSONL.
- Thực tế thời gian phát hiện dòng mới, WebSocket delivery, backpressure khi S8 có lượng bản ghi lớn.
- Header CSV HTTP và nguồn số liệu traffic để quy đổi đúng đơn vị; số liệu latency có thể tính hợp lệ.
- Bản backend/bridge nào (nếu có) đang chạy bên ngoài repository Windows; không nhân đôi service khi chưa kiểm tra.

**Quy tắc chung:** Giai đoạn đầu cho Copilot đọc contract và báo kế hoạch. Chỉ cho phép sửa backend/frontend khi đã sao lưu working tree và chốt thiết kế. Không yêu cầu Copilot chỉnh AI, model, topology, Ryu, sensor, relay hay dữ liệu gốc.
