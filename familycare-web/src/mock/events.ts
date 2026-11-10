import type { CareEvent, EventType } from '../types/event'

const types: EventType[] = [
  'BED_EXIT', 'DOOR_APPROACH', 'OUT_OF_VIEW', 'LOW_POSTURE_REVIEW',
  'MONITORING_UNAVAILABLE', 'BED_EXIT', 'DOOR_APPROACH', 'OUT_OF_VIEW',
]

export const events: CareEvent[] = types.map((type, index) => ({
  event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  camera_id: 'camera-demo-01',
  type,
  ts: `2026-11-10T${String(9 + index).padStart(2, '0')}:00:00+07:00`,
  confidence: 0.9,
  acknowledged_by: null,
}))
