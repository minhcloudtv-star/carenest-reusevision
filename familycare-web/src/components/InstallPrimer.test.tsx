import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InstallPrimer } from './InstallPrimer'
import App from '../App'

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_USE_MOCK', 'true') })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function capture(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn(async () => {})
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) })
  act(() => { window.dispatchEvent(event) })
  return { event, prompt }
}

it('không hiện khi mở app; mở sự kiện mới hiện giải thích, chỉ bấm cài mới prompt', async () => {
  render(<App />)
  const { event, prompt } = capture()
  expect(event.defaultPrevented).toBe(true)
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
  expect(prompt).not.toHaveBeenCalled()
  fireEvent.click(document.querySelector('.event-button')!)
  expect(screen.getByText(/Cài CareNest lên/)).toBeTruthy()
  expect(prompt).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cài lên màn hình chính' })) })
  expect(prompt).toHaveBeenCalledOnce()
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
})
it('đợi đủ 30 giây hiển thị, Để sau không gọi popup và không nhắc lại trong lần mở', () => {
  render(<InstallPrimer eventViewed={false} />)
  const { prompt } = capture()
  act(() => { vi.advanceTimersByTime(29999) })
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  fireEvent.click(screen.getByRole('button', { name: 'Để sau' }))
  capture()
  act(() => { vi.advanceTimersByTime(30000) })
  expect(prompt).not.toHaveBeenCalled()
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
})
it('không tính thời gian ở tab ẩn; hỗ trợ sự kiện cài đến sau khi đã dùng thử', () => {
  let visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  render(<InstallPrimer eventViewed={false} />)
  act(() => { vi.advanceTimersByTime(10000); visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
  act(() => { vi.advanceTimersByTime(60000) })
  capture()
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(20000) })
  expect(screen.getByText(/Cài CareNest lên/)).toBeTruthy()
})
it('ẩn sau appinstalled, không hiện nếu chạy standalone', () => {
  const { unmount } = render(<InstallPrimer eventViewed />)
  capture()
  act(() => { window.dispatchEvent(new Event('appinstalled')) })
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
  unmount()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  render(<InstallPrimer eventViewed />)
  capture()
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
})
it('xử lý người dùng từ chối và lỗi popup mà không tự gọi lại', async () => {
  const { unmount } = render(<InstallPrimer eventViewed />)
  const { prompt } = capture('dismissed')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cài lên màn hình chính' })) })
  expect(prompt).toHaveBeenCalledOnce()
  expect(screen.queryByText(/Cài CareNest lên/)).toBeNull()
  unmount()
  render(<InstallPrimer eventViewed />)
  const next = capture()
  next.prompt.mockRejectedValueOnce(new Error('blocked'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cài lên màn hình chính' })) })
  expect(screen.getByRole('alert').textContent).toContain('Không thể mở cài đặt')
  expect(next.prompt).toHaveBeenCalledOnce()
})
