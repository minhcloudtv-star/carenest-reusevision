export type EventType =
  | 'BED_EXIT'
  | 'DOOR_APPROACH'
  | 'OUT_OF_VIEW'
  | 'LOW_POSTURE_REVIEW'
  | 'MONITORING_UNAVAILABLE'

export interface CareEvent {
  event_id: string
  camera_id: string
  type: EventType
  ts: string
  confidence: number
  acknowledged_by?: string | null
}
