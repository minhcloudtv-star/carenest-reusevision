# Schema sự kiện
| Trường | Kiểu | Mô tả |
|---|---|---|
| event_id | uuid | |
| camera_id | string | |
| type | enum | BED_EXIT / DOOR_APPROACH / OUT_OF_VIEW / LOW_POSTURE_REVIEW / MONITORING_UNAVAILABLE |
| ts | ISO8601 | |
| confidence | float | |
| acknowledged_by | string? | |
