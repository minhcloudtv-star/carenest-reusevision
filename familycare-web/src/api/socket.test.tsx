import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { events } from '../mock/events'

class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  url: string
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this) }
  close = vi.fn(() => this.onclose?.())
  heartbeat() { this.onmessage?.({ data: JSON.stringify({ type: 'heartbeat' }) }) }
  sendEvent(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubEnv('VITE_USE_MOCK', 'false')
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
    url.endsWith('/status')
      ? { connected: true, last_heartbeat_at: new Date().toISOString(), heartbeat_timeout_seconds: 60 }
      : events,
  )))))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function start() {
  render(<App />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  const socket = FakeSocket.instances[0]
  expect(socket.url).toBe('wss://api.example.test/ws/events')
  act(() => socket.heartbeat())
  expect(screen.getByRole('status').textContent).toContain('Đang giám sát')
  return socket
}

it('đứt kết nối chuyển đỏ ngay, HTTP poll không thể làm banner xanh lại', async () => {
  const socket = await start()
  act(() => socket.onclose?.())
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
})

it('nối lại với backoff tăng dần, chờ heartbeat và nhận sự kiện mới không trùng', async () => {
  const socket = await start()
  act(() => socket.onerror?.())
  await act(async () => { await vi.advanceTimersByTimeAsync(999) })
  expect(FakeSocket.instances).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(FakeSocket.instances).toHaveLength(2)
  act(() => FakeSocket.instances[1].onclose?.())
  await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
  expect(FakeSocket.instances).toHaveLength(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const reconnected = FakeSocket.instances[2]
  act(() => reconnected.onopen?.())
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
  act(() => reconnected.heartbeat())
  expect(screen.getByRole('status').textContent).toContain('Đang giám sát')
  const incoming = { ...events[0], event_id: '00000000-0000-4000-8000-000000000099', ts: '2099-01-01T00:00:00Z' }
  act(() => { reconnected.sendEvent(incoming); reconnected.sendEvent(incoming) })
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(screen.getAllByRole('listitem')[0].querySelector('time')?.dateTime).toBe(incoming.ts)
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(screen.getAllByRole('listitem')[0].querySelector('time')?.dateTime).toBe(incoming.ts)
})

it('30 giây không heartbeat chuyển đỏ và nối lại dù vẫn nhận sự kiện', async () => {
  const socket = await start()
  await act(async () => { await vi.advanceTimersByTimeAsync(29000) })
  act(() => socket.sendEvent(events[0]))
  expect(screen.getByRole('status').textContent).toContain('Đang giám sát')
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
  expect(socket.close).toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(FakeSocket.instances).toHaveLength(2)
})

it('unmount dọn timer, không tự nối lại', async () => {
  const socket = await start()
  cleanup()
  expect(socket.close).toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(FakeSocket.instances).toHaveLength(1)
})
