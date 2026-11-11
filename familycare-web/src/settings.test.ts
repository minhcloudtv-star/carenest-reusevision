import { afterEach, expect, it, vi } from 'vitest'
import { loadSettings, phoneNumber, SETTINGS_KEY } from './settings'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it.each(['care@example.test', 'javascript:alert(1)', '0901234567;ext=1', '', '123'])('không tạo số gọi từ %s', value => {
  expect(phoneNumber(value)).toBeNull()
})
it.each([['+84 (901) 234-567', '+84901234567'], ['0901 234 567', '0901234567']])('chuẩn hóa số điện thoại %s', (value, expected) => {
  expect(phoneNumber(value)).toBe(expected)
})
it.each(['null', '[]', '{invalid', '{"hubUrl":"","recipients":[null]}'])('cài đặt hỏng %s được xử lý mà không crash', raw => {
  localStorage.setItem(SETTINGS_KEY, raw)
  expect(loadSettings().data.recipients).toEqual([])
  expect(loadSettings().error).toContain('Không thể đọc')
})
it('storage bị chặn không làm crash khi mở ứng dụng', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(loadSettings().error).toContain('Không thể đọc')
})
