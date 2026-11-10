# CareNest AI – ReuseVision

Tái sử dụng điện thoại Android cũ thành nút giám sát thị giác máy tính,
kết nối Cloud AI và ứng dụng FamilyCare.

Luồng: Android Vision Node -> Cloud Ingest -> Pose/Zones -> Behavior Engine -> Event Store -> FamilyCare (push + acknowledge)

## Cấu trúc
| Thư mục | Nội dung |
|---|---|---|
| `android-node/` | Kotlin + CameraX, truyền hình, heartbeat|
| `cloud/ingest/` | FastAPI nhận stream, xác thực camera|
| `cloud/vision/` | MediaPipe pose, tracking, vùng BED/FLOOR/DOOR|
| `cloud/behavior/` | State machine: BED_EXIT, DOOR_APPROACH, OUT_OF_VIEW, LOW_POSTURE_REVIEW|
| `familycare-web/` | Dashboard PWA, lịch sử, acknowledge|
| `infra/` | Docker, deploy, cấu hình môi trường|
| `benchmarks/` | Đo precision/recall, latency, chi phí inference |
| `docs/` | PRD, schema sự kiện, consent, KPI, khảo sát|

## Nguyên tắc bắt buộc
- Không commit video, ảnh người thật, khóa API.
- Không lưu video gốc mặc định.
- Mất kết nối: UI phải hiển thị "monitoring unavailable", không hiển thị trạng thái an toàn giả.

## Chạy thử cloud
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r cloud/requirements.txt
uvicorn cloud.ingest.main:app --reload
pytest cloud/tests -q
```
