import type { CareEvent, EventType } from './types/event'
export type OverviewStatus = 'ok' | 'needs_attention' | 'critical' | 'offline'
export const eventLabels: Record<EventType, { icon: string; name: string }> = {
  BED_EXIT: { icon: '↗', name: 'Rời giường' },
  DOOR_APPROACH: { icon: '⇥', name: 'Đến gần cửa' },
  OUT_OF_VIEW: { icon: '◌', name: 'Ngoài tầm quan sát' },
  LOW_POSTURE_REVIEW: { icon: '↓', name: 'Cần kiểm tra tư thế thấp' },
  MONITORING_UNAVAILABLE: { icon: '⚠', name: 'Giám sát không khả dụng' },
}
// AI danger assessments are separate from the unchanged CareEvent schema.
// Callers may supply only IDs from a verified AI assessment source.
export function overviewStatus(events: readonly CareEvent[], available: boolean,
  dangerousEventIds: ReadonlySet<string> = new Set()): OverviewStatus {
  if (!available) return 'offline'
  if (events.some(event => !event.acknowledged_by && dangerousEventIds.has(event.event_id))) return 'critical'
  return events.some(event => !event.acknowledged_by && event.type !== 'MONITORING_UNAVAILABLE')
    ? 'needs_attention' : 'ok'
}
