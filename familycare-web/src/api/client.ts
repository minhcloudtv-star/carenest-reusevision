import type { CareEvent, EventType } from '../types/event'

export interface MonitoringStatus {
  connected: boolean
  last_heartbeat_at: string
  heartbeat_timeout_seconds: number
}

const eventTypes: EventType[] = ['BED_EXIT', 'DOOR_APPROACH', 'OUT_OF_VIEW', 'LOW_POSTURE_REVIEW', 'MONITORING_UNAVAILABLE']

export function parseEvent(value: unknown): CareEvent {
  const event = value as CareEvent | null
  if (!event || typeof event.event_id !== 'string' || typeof event.camera_id !== 'string'
    || !eventTypes.includes(event.type) || !Number.isFinite(Date.parse(event.ts))
    || typeof event.confidence !== 'number' || !Number.isFinite(event.confidence)
    || (event.acknowledged_by != null && typeof event.acknowledged_by !== 'string')) {
    throw new Error('Dữ liệu sự kiện không hợp lệ')
  }
  return event
}

async function request(path: string, method = 'GET'): Promise<unknown> {
  const baseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Chưa cấu hình VITE_API_URL')
  const response = await fetch(`${baseUrl}${path}`, {
    method, signal: AbortSignal.timeout(8000), cache: 'no-store',
  })
  if (!response.ok) throw new Error(`API trả lỗi ${response.status}`)
  return response.json()
}

export async function getEvents(): Promise<CareEvent[]> {
  const data = await request('/events')
  if (!Array.isArray(data)) throw new Error('Danh sách sự kiện không hợp lệ')
  return data.map(parseEvent)
}

export async function getStatus(): Promise<MonitoringStatus> {
  const data = await request('/status') as MonitoringStatus | null
  if (!data || typeof data.connected !== 'boolean'
    || !Number.isFinite(Date.parse(data.last_heartbeat_at))
    || typeof data.heartbeat_timeout_seconds !== 'number'
    || !Number.isFinite(data.heartbeat_timeout_seconds) || data.heartbeat_timeout_seconds <= 0) {
    throw new Error('Trạng thái giám sát không hợp lệ')
  }
  return data
}

export function isHeartbeatFresh(status: MonitoringStatus, now = Date.now()): boolean {
  const age = now - Date.parse(status.last_heartbeat_at)
  return age >= 0 && age < status.heartbeat_timeout_seconds * 1000
}

export async function acknowledgeEvent(id: string): Promise<CareEvent> {
  const event = parseEvent(await request(`/events/${encodeURIComponent(id)}/ack`, 'POST'))
  if (event.event_id !== id || !event.acknowledged_by) throw new Error('Xác nhận không hợp lệ')
  return event
}
