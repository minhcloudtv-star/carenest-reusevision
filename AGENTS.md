# Repository Guidelines

## Dự án

CareNest AI ReuseVision: Android Vision Node -> Cloud -> FamilyCare.

## Quyền riêng tư và độ tin cậy

- Không commit video, ảnh người thật, khóa API hoặc file `.env`.
- Không lưu video gốc mặc định.
- Khi mất kết nối, UI phải hiển thị "monitoring unavailable".

## Công nghệ và kiểm thử

`cloud/` sử dụng Python 3.11, FastAPI, pytest và ruff.

Chạy test từ thư mục gốc của repository:

```bash
pytest cloud/tests -q
```

Kiểm tra lint:

```bash
ruff check cloud
```

## familycare-web

- Công nghệ: React + TypeScript + Vite; kiểm thử bằng Vitest + Testing Library.
- Chạy các lệnh trong thư mục `familycare-web/`: `npm run dev` để phát triển, `npm test` để kiểm thử, `npm run build` để build.
- Mọi sự kiện phải tuân theo `docs/event-schema.md`. Không tự đổi schema.
- Giao diện KHÔNG BAO GIỜ hiển thị trạng thái "an toàn" giả. Khi mất kết nối hoặc heartbeat quá hạn, hiển thị "Monitoring unavailable".
- Không hiển thị hay lưu video/ảnh. Chỉ hiển thị sự kiện dạng văn bản.
- Lấy địa chỉ API từ biến môi trường `VITE_API_URL`, không hard-code.
- Giao diện tiếng Việt, chữ lớn, tương phản cao, nút bấm đủ lớn cho người dùng lớn tuổi.
- Không cài thêm thư viện lớn khi chưa hỏi người dùng.

## Quy trình làm việc

- Làm từng bước nhỏ, giữ mỗi thay đổi tập trung vào một mục tiêu.
- Chạy test trước khi báo hoàn tất; nêu rõ kết quả hoặc lỗi gặp phải.
- Hỏi người dùng trước khi cài thư viện lớn.
