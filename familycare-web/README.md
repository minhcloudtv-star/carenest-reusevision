# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Cấu hình API FamilyCare

Sao chép `.env.example` thành `.env.local` (không commit file thật), đặt
`VITE_API_URL` thành URL gốc backend và khởi động lại Vite.
`VITE_USE_MOCK=true` dùng 8 sự kiện giả và xác nhận trong bộ nhớ, không gọi API.
Mặc định dùng API thật; không tự chuyển sang mock khi API lỗi.
Các biến `VITE_*` công khai trong bundle, không chứa khóa API hoặc bí mật.

Hợp đồng frontend đang sử dụng (backend hiện mới có `/health`):

- `GET /events`: trả JSON mảng sự kiện theo `docs/event-schema.md`.
- `GET /status`: trả `{ "connected": true, "last_heartbeat_at": "2026-11-10T10:00:00Z", "heartbeat_timeout_seconds": 30 }`.
- `POST /events/{id}/ack`: không có body, trả sự kiện đã cập nhật với
  `acknowledged_by` do backend xác định từ danh tính người dùng. Chưa tích hợp đăng nhập.

Ứng dụng lấy lại dữ liệu mỗi 10 giây, timeout request 8 giây và kiểm tra
hạn heartbeat mỗi giây. Dữ liệu lỗi, API lỗi hoặc heartbeat quá hạn làm banner
hiện `Monitoring unavailable`. Không suy luận trạng thái giám sát từ danh sách sự kiện.
Thời gian xác nhận chỉ có trong demo; API chưa có trường này trong schema.

### WebSocket sự kiện

Frontend kết nối `/ws/events` dựa trên `VITE_API_URL` (HTTP → WS, HTTPS → WSS).
Server gửi từng sự kiện JSON trực tiếp theo `docs/event-schema.md`, và gửi
`{"type":"heartbeat"}` ít nhất mỗi 30 giây. Đây là hợp đồng transport frontend
đang dùng; backend cần triển khai endpoint tương ứng.

Chỉ heartbeat mới làm kết nối khả dụng; mở socket hoặc nhận sự kiện không thay
thế heartbeat. Banner xanh còn yêu cầu `/status` hợp lệ và không có lỗi API.
Đứt socket, lỗi message hoặc không có heartbeat trong 30 giây làm banner đỏ.
App nối lại sau 1, 2, 4, 8, 16, rồi tối đa 30 giây; nhận heartbeat thì đặt lại
backoff. Sự kiện được gộp theo `event_id`, sắp xếp theo `ts` mới nhất trước và
không mất khi snapshot HTTP cũ trả về. Chế độ mock không mở WebSocket.


### PWA và cảnh báo khi app mở

`npm run build` tạo manifest, icon PNG 192/512 (có maskable), apple-touch icon
180 và service worker. Dùng `npm run preview -- --host 0.0.0.0` để xem bản build;
kiểm tra trên điện thoại qua hosting HTTPS. Service worker tắt trong dev.
Android: menu Chrome → Cài đặt ứng dụng. iPhone: Safari → Chia sẻ → Thêm vào
MH chính. Khả năng cài/thông báo tùy trình duyệt; iOS cần mở app đã thêm vào
màn hình chính để xin quyền thông báo trên các phiên bản hỗ trợ.

Service worker chỉ precache giao diện, không cache API, WebSocket hoặc sự kiện.
Ngoại tuyến hiện Monitoring unavailable, không dùng dữ liệu cache để báo đang
giám sát. Lần tải đầu cần mạng. Bản cập nhật service worker chờ phiên mới,
không tự reload làm mất trạng thái người dùng.

Trong Cài đặt, bấm Bật âm thanh và Bật thông báo. Âm thanh dùng Web Audio,
không tải file media; thông báo dùng Notification API, ưu tiên
ServiceWorkerRegistration.showNotification trên thiết bị di động. Chỉ BED_EXIT
mới nhận qua WebSocket mới cảnh báo, không cảnh báo lại snapshot hoặc cùng
mã sự kiện. Quyền từ chối/không hỗ trợ không ngăn hiển thị sự kiện. Tùy chọn bật
chỉ giữ trong phiên. Không có Web Push: đóng app thì không nhận cảnh báo;
hệ điều hành có thể tạm ngưng tab nền.

## Quên mật khẩu

Trang công khai: `/quen-mat-khau` (hosting cần trả `index.html` cho đường dẫn này).
Không mở API/WebSocket giám sát khi ở trang này. Không lưu email, OTP, mật khẩu
hoặc bằng chứng xác minh vào storage; tải lại sẽ bắt đầu lại luồng.

Hợp đồng API dự kiến, cần backend triển khai/xác nhận:

- `POST /auth/forgot-password`: `{ email }` → `{ challenge_id }`.
  Backend phải phản hồi chung cho email tồn tại/không tồn tại để tránh dò tài khoản.
- `POST /auth/otp/verify`: `{ challenge_id, code, purpose: "reset_password" }`
  → `{ verification_token }` ngắn hạn, ràng buộc với challenge và mục đích.
- `POST /auth/reset-password`: `{ challenge_id, verification_token, new_password }`
  → `204` hoặc JSON thành công. Backend tiêu thụ bằng chứng một lần, kiểm tra chính
  sách mật khẩu và thu hồi phiên cũ. Luồng này không gửi lại OTP sau khi đã tiêu thụ.
- Mã lỗi: `400/401/410/422` thông tin/mã không hợp lệ; `429` giới hạn thử/khóa.
  Thời hạn OTP 5 phút và khóa 15 phút phải được backend thực thi.

Mọi endpoint dùng `VITE_API_URL`. `OtpInput` là component controlled dùng chung,
không gắn với API hay mục đích OTP; có thể dùng lại khi triển khai xóa tài khoản
và thêm người nhận cảnh báo. Hai thao tác này chưa được nối OTP trong thay đổi này.
