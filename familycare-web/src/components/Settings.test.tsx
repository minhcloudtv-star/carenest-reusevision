import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Settings, SETTINGS_KEY } from './Settings'
import { events } from '../mock/events'

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('thêm/xóa người nhận và lưu hub qua lần mở lại', () => {
  const { unmount } = render(<Settings events={events} />)
  fireEvent.change(screen.getByLabelText('Tên người nhận'), { target: { value: 'Người chăm sóc' } })
  fireEvent.change(screen.getByLabelText('Số điện thoại hoặc email'), { target: { value: 'demo@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Thêm người nhận' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Địa chỉ hub' }), { target: { value: 'https://hub.example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ hub' }))
  expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).recipients).toHaveLength(1)
  unmount()
  render(<Settings events={events} />)
  expect(screen.getByText('demo@example.test')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'Địa chỉ hub' }) as HTMLInputElement).value).toBe('https://hub.example.test')
  expect(screen.getByText(/camera-demo-01 — Chưa xác minh/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Xóa Người chăm sóc' }))
  expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).recipients).toHaveLength(0)
  expect(screen.getByText('Chưa có người nhận cảnh báo.')).toBeTruthy()
})

it('dữ liệu lưu hỏng hoặc storage bị chặn hiển thị lỗi, không báo đã lưu', () => {
  localStorage.setItem(SETTINGS_KEY, '{invalid')
  render(<Settings events={[]} />)
  expect(screen.getByRole('alert').textContent).toContain('Không thể đọc')
  expect(screen.getByText('Chưa có thông tin camera.')).toBeTruthy()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  fireEvent.change(screen.getByRole('textbox', { name: 'Địa chỉ hub' }), { target: { value: 'https://hub.example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ hub' }))
  expect(screen.getByRole('alert').textContent).toContain('Không thể lưu')
  expect(screen.queryByText('Đã lưu cài đặt trên thiết bị này.')).toBeNull()
})

it('không lưu địa chỉ sai giao thức hoặc thông tin liên hệ trùng', () => {
  render(<Settings events={[]} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Địa chỉ hub' }), { target: { value: 'ftp://hub.example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ hub' }))
  expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
  for (let i = 0; i < 2; i++) {
    fireEvent.change(screen.getByLabelText('Tên người nhận'), { target: { value: 'Demo' } })
    fireEvent.change(screen.getByLabelText('Số điện thoại hoặc email'), { target: { value: 'demo@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm người nhận' }))
  }
  expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).recipients).toHaveLength(1)
  expect(screen.getByRole('alert').textContent).toContain('đã có trong danh sách')
})
