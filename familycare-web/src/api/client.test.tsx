import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { events } from '../mock/events'
import { acknowledgeEvent, getEvents, getStatus, isHeartbeatFresh } from './client'

vi.mock('./socket', () => ({
  connectEvents: ({ onAvailability }: { onAvailability: (value: boolean) => void }) => {
    onAvailability(true)
    return () => {}
  },
}))

const fetchMock = vi.fn()
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
const healthy = () => ({ connected: true, last_heartbeat_at: new Date().toISOString(), heartbeat_timeout_seconds: 30 })

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCK', 'false')
  vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('tải API thật và chỉ xác nhận sau khi POST thành công', async () => {
  fetchMock.mockImplementation((url: string, options: RequestInit) => {
    if (url.endsWith('/status')) return Promise.resolve(response(healthy()))
    if (options.method === 'POST') return Promise.resolve(response({ ...events[7], acknowledged_by: 'caregiver-01' }))
    return Promise.resolve(response(events))
  })
  render(<App />)
  await screen.findByText('Đang giám sát')
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã xử lý' }))
  await screen.findByText('caregiver-01')
  expect(screen.getByText('Đã xử lý')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledWith(`https://api.example.test/events/${events[7].event_id}/ack`, expect.objectContaining({ method: 'POST' }))
})

it.each(['/events', '/status'])('lỗi %s làm banner đỏ, không dùng dữ liệu giả', async path => {
  fetchMock.mockImplementation((url: string) => url.endsWith(path)
    ? Promise.resolve(new Response('', { status: 503 }))
    : Promise.resolve(response(url.endsWith('/status') ? healthy() : events)))
  render(<App />)
  await screen.findByRole('alert')
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
  expect(screen.queryByText('Đang giám sát')).toBeNull()
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
})

it('POST lỗi giữ sự kiện chưa xử lý và chuyển banner đỏ', async () => {
  fetchMock.mockImplementation((url: string, options: RequestInit) => {
    if (options.method === 'POST') return Promise.reject(new Error('offline'))
    return Promise.resolve(response(url.endsWith('/status') ? healthy() : events))
  })
  render(<App />)
  await screen.findByText('Đang giám sát')
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã xử lý' }))
  await screen.findByRole('alert')
  expect(screen.getByText('Chưa xử lý')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
})

it('heartbeat quá hạn không được hiển thị đang giám sát', async () => {
  fetchMock.mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/status')
    ? { ...healthy(), last_heartbeat_at: '2020-01-01T00:00:00Z' } : events)))
  render(<App />)
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
  const status = { connected: true, last_heartbeat_at: '2026-01-01T00:00:00Z', heartbeat_timeout_seconds: 30 }
  expect(isHeartbeatFresh(status, Date.parse('2026-01-01T00:00:29Z'))).toBe(true)
  expect(isHeartbeatFresh(status, Date.parse('2026-01-01T00:00:30Z'))).toBe(false)
})

it('từ chối dữ liệu API sai và cấu hình API trống', async () => {
  fetchMock.mockResolvedValue(response([{ ...events[0], type: 'SAFE' }]))
  await expect(getEvents()).rejects.toThrow()
  fetchMock.mockResolvedValue(response({ connected: true }))
  await expect(getStatus()).rejects.toThrow()
  fetchMock.mockResolvedValue(response(events[0]))
  await expect(acknowledgeEvent(events[0].event_id)).rejects.toThrow()
  vi.stubEnv('VITE_API_URL', '')
  fetchMock.mockClear()
  await expect(getEvents()).rejects.toThrow('VITE_API_URL')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('chế độ mock không gọi fetch', () => {
  vi.stubEnv('VITE_USE_MOCK', 'true')
  render(<App />)
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([
  [[], 'ok'],
  [events, 'needs_attention'],
  [events.map(event => ({ ...event, acknowledged_by: 'Lan' })), 'ok'],
] as const)('Overview truyền trạng thái tổng hợp cho StatusRing', async (snapshot, expected) => {
  fetchMock.mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/status') ? healthy() : snapshot)))
  render(<App />)
  await waitFor(() => expect(screen.getByRole('status').getAttribute('data-status')).toBe(expected))
  expect(screen.queryByRole('link', { name: /^Gọi / })).toBeNull()
})

it('đánh giá AI nguy hiểm làm hiện nút gọi; xác nhận thành công thì ẩn', async () => {
  localStorage.setItem('familycare.settings.v1', JSON.stringify({ hubUrl: '', primaryRecipientId: 'lan', recipients: [
    { id: 'lan', name: 'Lan', contact: '0901234567' },
  ] }))
  fetchMock.mockImplementation((url: string, options: RequestInit) => Promise.resolve(response(
    url.endsWith('/status') ? healthy() : options.method === 'POST'
      ? { ...events[7], acknowledged_by: 'Lan' } : events,
  )))
  render(<App dangerousEventIds={new Set([events[7].event_id])} />)
  await waitFor(() => expect(screen.getByRole('status').getAttribute('data-status')).toBe('critical'))
  expect(screen.getByRole('link', { name: 'Gọi Lan' }).getAttribute('href')).toBe('tel:0901234567')
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã xử lý' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Gọi Lan' })).toBeNull())
  localStorage.clear()
})

it('nguy cấp nhưng thiếu người nhận chính không tạo liên kết gọi giả', async () => {
  localStorage.clear()
  fetchMock.mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/status') ? healthy() : events)))
  render(<App dangerousEventIds={new Set([events[7].event_id])} />)
  await waitFor(() => expect(screen.getByRole('status').getAttribute('data-status')).toBe('critical'))
  expect(screen.queryByRole('link', { name: /^Gọi / })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('Chọn người nhận chính')
})

it('mất giám sát ưu tiên offline nhưng vẫn giữ nút gọi cho nguy cấp ngoài 5 mốc mới nhất', async () => {
  localStorage.setItem('familycare.settings.v1', JSON.stringify({ hubUrl: '', primaryRecipientId: 'lan', recipients: [
    { id: 'lan', name: 'Lan', contact: '0901234567' },
  ] }))
  fetchMock.mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/status')
    ? { ...healthy(), last_heartbeat_at: '2020-01-01T00:00:00Z' } : events)))
  render(<App dangerousEventIds={new Set([events[0].event_id])} />)
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
  expect(screen.getByRole('status').getAttribute('data-status')).toBe('offline')
  expect(screen.queryByText('Nguy cấp')).toBeNull()
  expect(screen.getByRole('link', { name: 'Gọi Lan' }).getAttribute('href')).toBe('tel:0901234567')
  localStorage.clear()
})

it('xác nhận nguy cấp thất bại giữ nút gọi và trạng thái chưa xử lý', async () => {
  localStorage.setItem('familycare.settings.v1', JSON.stringify({ hubUrl: '', primaryRecipientId: 'lan', recipients: [
    { id: 'lan', name: 'Lan', contact: '0901234567' },
  ] }))
  fetchMock.mockImplementation((url: string, options: RequestInit) => options.method === 'POST'
    ? Promise.reject(new Error('offline'))
    : Promise.resolve(response(url.endsWith('/status') ? healthy() : events)))
  render(<App dangerousEventIds={new Set([events[7].event_id])} />)
  await waitFor(() => expect(screen.getByRole('status').getAttribute('data-status')).toBe('critical'))
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã xử lý' }))
  await screen.findByRole('alert')
  expect(screen.getByText('Chưa xử lý')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
  expect(screen.getByRole('link', { name: 'Gọi Lan' })).toBeTruthy()
  localStorage.clear()
})

it.each([
  { hubUrl: '', primaryRecipientId: 'deleted', recipients: [] },
  { hubUrl: '', primaryRecipientId: 'email', recipients: [{ id: 'email', name: 'Lan', contact: 'care@example.test' }] },
])('người nhận chính đã xóa hoặc không có số điện thoại không tạo liên kết tel', async settings => {
  localStorage.setItem('familycare.settings.v1', JSON.stringify(settings))
  fetchMock.mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/status') ? healthy() : events)))
  render(<App dangerousEventIds={new Set([events[7].event_id])} />)
  await waitFor(() => expect(screen.getByRole('status').getAttribute('data-status')).toBe('critical'))
  expect(screen.queryByRole('link', { name: /^Gọi / })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('Chọn người nhận chính')
  localStorage.clear()
})
