import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StatusRing } from './StatusRing'
afterEach(() => { cleanup(); vi.useRealTimers() })
it.each([
  ['ok', 'Đang giám sát', '--color-status-ok'],
  ['needs_attention', 'Cần xem', '--color-status-review'],
  ['critical', 'Nguy cấp', '--color-status-critical'],
  ['offline', 'Monitoring unavailable', '--color-status-unavailable'],
] as const)('%s dùng nhãn và token đúng', (status, label, token) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T10:05:00Z'))
  render(<StatusRing status={status} lastUpdated={new Date('2026-11-11T10:00:00Z')} />)
  expect(screen.getByRole('status').textContent).toContain(label)
  expect(document.querySelector('circle')?.getAttribute('fill')).toBe(`var(${token})`)
  expect(screen.getByText('Cập nhật 5 phút trước')).toBeTruthy()
})
it('không bịa thời gian khi chưa có heartbeat', () => {
  render(<StatusRing status="offline" lastUpdated={new Date(NaN)} />)
  expect(screen.getByText('Chưa có cập nhật')).toBeTruthy()
})

it('heartbeat mới nhận trong cùng phút vẫn hiển thị cập nhật vừa xong', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T10:00:00Z'))
  const { rerender } = render(<StatusRing status="ok" lastUpdated={new Date('2026-11-11T10:00:00Z')} />)
  act(() => vi.advanceTimersByTime(10000))
  rerender(<StatusRing status="ok" lastUpdated={new Date('2026-11-11T10:00:10Z')} />)
  act(() => vi.advanceTimersByTime(0))
  expect(screen.getByText('Cập nhật vừa xong')).toBeTruthy()
  act(() => vi.advanceTimersByTime(110000))
  expect(screen.getByText('Cập nhật 1 phút trước')).toBeTruthy()
})
