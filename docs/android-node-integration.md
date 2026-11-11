# Chuẩn bị tích hợp Android Node → Cloud → FamilyCare

## Hiện trạng

- `android-node/` mới có README, chưa có project Kotlin/CameraX hoặc APK.
- Cloud có `/health` và router Telegram; chưa có xác thực thiết bị, ingest,
  kho sự kiện hoặc API giám sát.
- FamilyCare đã chờ `GET /events`, `GET /status`, `POST /events/{id}/ack`
  và WebSocket `/ws/events`. Các endpoint này chưa được triển khai ở cloud.
- Đây là kế hoạch tích hợp, không phải giao thức đã triển khai hoặc kết quả
  thử nghiệm trên điện thoại thật. Không thay đổi `docs/event-schema.md`.

## Phân chia dữ liệu

1. Android gửi heartbeat và metadata thiết bị qua kết nối được xác thực.
   Đề xuất heartbeat mỗi 10 giây, hết hạn sau 30 giây; cloud dùng thời điểm
   nhận tại server để xét hạn, không tin đồng hồ điện thoại.
2. Pin và tín hiệu là telemetry riêng, không thêm vào `CareEvent`. Giá trị
   không đo được là `null`; không suy luận tín hiệu từ việc có kết nối mạng.
   Khi triển khai phải ghi rõ đơn vị tín hiệu (ví dụ Wi-Fi RSSI dBm), thời điểm
   đo và camera tương ứng. Không trộn Wi-Fi RSSI với sóng di động.
3. Dữ liệu phục vụ suy luận hình ảnh đi qua kênh riêng được đồng ý và xác thực;
   không lưu video gốc mặc định, không ghi ảnh vào log, không chuyển ảnh đến web.
4. Cloud tạo và lưu sự kiện AI đúng schema hiện tại, sau đó phát cho FamilyCare.
   Android không được tự khai báo `acknowledged_by` hoặc quyền người chăm sóc.
5. Đánh giá nguy hiểm của AI chưa có trong schema; chưa kích hoạt `critical`
   hoặc gọi khẩn cấp từ `confidence` hay tên loại sự kiện. Cần thống nhất hợp
   đồng đánh giá AI riêng trước khi nối phần giao diện này.

## Hợp đồng web phải giữ

- `/events`: mảng sự kiện theo `docs/event-schema.md`, giới hạn theo gia đình
  của tài khoản đã xác thực; trả ổn định `event_id` để web gộp, không nhân đôi.
- `/status`: `{ connected, last_heartbeat_at, heartbeat_timeout_seconds }`.
  Dữ liệu phải phản ánh camera được giám sát; chưa có heartbeat thì trả trạng
  thái không khả dụng theo hợp đồng được parser web chấp nhận, không bịa thời
  điểm heartbeat. Cần bổ sung hỗ trợ trạng thái chưa có heartbeat ở parser
  trước khi dùng `null` cho `last_heartbeat_at`.
- `/ws/events`: gửi sự kiện trực tiếp và `{ "type": "heartbeat" }` dưới 30 giây.
  Heartbeat WebSocket chỉ chứng minh kênh cloud → web; không thay thế heartbeat
  Android. Web chỉ báo đang giám sát khi cả hai kênh cùng khả dụng.
- `/events/{id}/ack`: cloud xác định người xác nhận từ tài khoản, lưu bền vững,
  đồng bộ cơ chế Telegram fallback rồi trả sự kiện đã cập nhật.
- API web lấy gốc URL từ `VITE_API_URL`; không đưa thông tin xác thực thiết bị
  vào biến `VITE_*`.

## Ghép đôi và cô lập dữ liệu

- Cần triển khai ghép đôi camera với gia đình trước khi nhận dữ liệu thật.
  Danh tính camera/gia đình phải lấy từ thông tin xác thực đã kiểm tra ở server,
  không tin `camera_id` hoặc mã gia đình tự khai báo trong payload.
- Thông tin xác thực thiết bị có thể thu hồi, lưu bằng cơ chế bảo vệ của Android;
  không đặt token trong URL, README, mã nguồn hoặc log.
- Khi thiếu cấu hình xác thực, từ chối ingest và truy cập dữ liệu.
- Nếu có nhiều camera, cần chốt camera đang được theo dõi hoặc quy tắc tổng hợp;
  không để một camera online che khuất camera khác đã mất giám sát.

## Trình tự triển khai

1. Chốt hợp đồng xác thực/ghép đôi và telemetry; tạo project Android với quyền
   camera có màn giải thích, foreground service và thao tác dừng rõ ràng.
2. Làm heartbeat xuyên suốt trước: Android → cloud → `/status` → web.
3. Thêm telemetry pin/tín hiệu, dùng dữ liệu chưa biết khi thiếu hoặc đã quá hạn.
4. Triển khai kho sự kiện, API đọc/ack và WebSocket tương thích web hiện tại;
   nối Telegram sau khi lưu sự kiện/ack thành công.
5. Nối pipeline suy luận, kiểm tra sự kiện trùng và dữ liệu đến muộn. Chưa hiển
   thị trạng thái nguy cấp khi chưa có hợp đồng đánh giá nguy hiểm của AI.

## Kịch bản thử nghiệm dự kiến

| Tình huống | Kết quả cần kiểm tra |
|---|---|
| Chưa ghép đôi | Ingest bị từ chối; web Monitoring unavailable |
| Kết nối, có heartbeat Android và WebSocket hợp lệ | Đang giám sát; không tuyên bố an toàn |
| Ngắt mạng Android quá 30 giây, cloud/web còn mạng | Monitoring unavailable |
| WebSocket ngắt nhưng HTTP còn hoạt động | Monitoring unavailable |
| Mở lại kết nối nhưng chưa có heartbeat mới | Tiếp tục mất giám sát |
| Heartbeat mới hợp lệ và các kênh phục hồi | Khôi phục giám sát |
| Pin/tín hiệu thiếu hoặc quá hạn | Chưa có dữ liệu; không bịa số |
| Sai đồng hồ Android | Không kéo dài độ tươi của heartbeat |
| Gửi lại cùng event_id sau nối lại | Không nhân đôi sự kiện |
| Xác nhận sự kiện | Giữ logic ack và hủy fallback đang chờ |
| Thiết bị/tài khoản gia đình khác | Không đọc hoặc ghi chéo dữ liệu |
| Dừng camera/service hoặc thu hồi quyền | Mất giám sát, không chỉ dựa vào heartbeat tiến trình |

Các kịch bản trên chưa chạy. Test tự động trước, sau đó mới thử trên thiết bị
được ghép đôi; không dùng video hoặc ảnh người thật làm fixture trong repository.
