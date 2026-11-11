import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { events } from './mock/events'

beforeEach(() => vi.stubEnv('VITE_USE_MOCK', 'true'))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })

it('hiện đúng 5 sự kiện mới nhất từ 8 sự kiện giả đủ 5 loại', () => {
  render(<App />)
  expect(events).toHaveLength(8)
  expect(new Set(events.map(event => event.type)).size).toBe(5)
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(5)
  const expected = [...events].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 5)
  items.forEach((item, index) => {
    expect(item.querySelector('time')?.dateTime).toBe(expected[index].ts)
    expect(within(item).getByText('Chưa xử lý')).toBeTruthy()
  })
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
})

it('mở chi tiết và xác nhận đúng sự kiện, giữ trạng thái khi quay lại', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T10:30:00.000Z'))
  render(<App />)
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'))
  expect(screen.getByRole('heading', { name: 'Chi tiết sự kiện' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã xử lý' }))
  expect(screen.getByText('Đã xử lý')).toBeTruthy()
  expect(screen.getByText('Người chăm sóc (demo)')).toBeTruthy()
  expect(document.querySelector('time[datetime="2026-11-10T10:30:00.000Z"]')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Xác nhận đã xử lý' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')

  fireEvent.click(screen.getByRole('button', { name: '← Về tổng quan' }))
  const items = screen.getAllByRole('listitem')
  expect(within(items[0]).getByText('Đã xử lý')).toBeTruthy()
  expect(screen.getAllByText('Chưa xử lý')).toHaveLength(4)
  fireEvent.click(within(items[0]).getByRole('button'))
  expect(screen.getByText('Người chăm sóc (demo)')).toBeTruthy()
  expect(document.querySelector('time[datetime="2026-11-10T10:30:00.000Z"]')).toBeTruthy()
  expect(events.every(event => !event.acknowledged_by)).toBe(true)
})

it('lịch sử sắp xếp mới nhất trước, lọc kết hợp và giữ xác nhận qua điều hướng', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử' }))
  const sorted = [...events].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
  screen.getAllByRole('listitem').forEach((item, index) => {
    expect(item.querySelector('time')?.dateTime).toBe(sorted[index].ts)
  })
  fireEvent.change(screen.getByLabelText('Loại sự kiện'), { target: { value: 'BED_EXIT' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã xử lý' }))
  fireEvent.click(screen.getByRole('button', { name: '← Về lịch sử' }))
  fireEvent.change(screen.getByLabelText('Trạng thái xử lý'), { target: { value: 'processed' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(within(screen.getAllByRole('listitem')[0]).getByText('Đã xử lý')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Trạng thái xử lý'), { target: { value: 'pending' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(within(screen.getAllByRole('listitem')[0]).getByText('Chưa xử lý')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Trạng thái xử lý'), { target: { value: 'processed' } })
  fireEvent.change(screen.getByLabelText('Loại sự kiện'), { target: { value: 'DOOR_APPROACH' } })
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  expect(screen.getByText('Không có sự kiện phù hợp.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }))
  expect(screen.getByRole('heading', { name: 'Cài đặt' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cài đặt' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(screen.getByRole('button', { name: 'Tổng quan' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(screen.getByText('Đã xử lý')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
})

it('mở Care Circle và chi tiết đúng thành viên từ cấu hình đã lưu', () => {
  localStorage.setItem('familycare.settings.v1', JSON.stringify({ hubUrl: '', primaryRecipientId: 'lan', recipients: [
    { id: 'lan', name: 'Lan', contact: '0901234567' },
  ] }))
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Thành viên' }))
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Lan — Người nhận chính' }))
  const detail = screen.getByRole('region', { name: 'Chi tiết người chăm sóc' })
  expect(within(detail).getByText('0901234567')).toBeTruthy()
  fireEvent.click(within(detail).getByRole('button', { name: 'Đóng chi tiết' }))
  expect(screen.queryByRole('region', { name: 'Chi tiết người chăm sóc' })).toBeNull()
  localStorage.clear()
})

it('rời trang Thành viên rồi xóa người đã chọn không tự mở chi tiết người khác', () => {
  localStorage.setItem('familycare.settings.v1', JSON.stringify({ hubUrl: '', recipients: [
    { id: 'lan', name: 'Lan', contact: '0901234567' },
    { id: 'binh', name: 'Bình', contact: '0901234568' },
  ] }))
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Thành viên' }))
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Lan — Người chăm sóc' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cài đặt' }))
  fireEvent.click(screen.getByRole('button', { name: 'Xóa Lan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Thành viên' }))
  expect(screen.queryByRole('region', { name: 'Chi tiết người chăm sóc' })).toBeNull()
  localStorage.clear()
})
