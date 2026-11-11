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
