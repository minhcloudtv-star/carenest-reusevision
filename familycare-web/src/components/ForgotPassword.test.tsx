import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
  window.history.replaceState({}, '', '/quen-mat-khau')
  localStorage.clear()
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  window.history.replaceState({}, '', '/')
})

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status })
}
async function requestCode() {
  fireEvent.change(screen.getByLabelText('Email tài khoản'), { target: { value: 'care@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mã OTP' }))
  await screen.findByLabelText('Chữ số 1')
}
function pasteCode() {
  fireEvent.paste(screen.getByLabelText('Chữ số 1'), { clipboardData: { getData: () => '012345' } })
}

it('hoàn tất luồng email → OTP → mật khẩu mới mà không lưu bí mật', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response({ challenge_id: 'challenge-1' }))
    .mockResolvedValueOnce(response({ verification_token: 'proof-1' }))
    .mockResolvedValueOnce(response(null, 204))
  vi.stubGlobal('fetch', fetchMock)
  render(<App />)
  await requestCode()
  expect(fetchMock).toHaveBeenCalledTimes(1) // Trang công khai không tải dữ liệu giám sát.
  expect((screen.getByRole('button', { name: 'Xác nhận mã OTP' }) as HTMLButtonElement).disabled).toBe(true)
  pasteCode()
  expect(document.activeElement).toBe(screen.getByLabelText('Chữ số 6'))
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận mã OTP' }))
  await screen.findByLabelText('Mật khẩu mới')
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'New-password-123!' } })
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), { target: { value: 'different' } })
  fireEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }))
  expect(screen.getByRole('alert').textContent).toContain('chưa khớp')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), { target: { value: 'New-password-123!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }))
  await screen.findByText(/Đã đặt lại mật khẩu/)
  expect(fetchMock.mock.calls.map(call => [call[0], JSON.parse(call[1].body)])).toEqual([
    ['https://api.example.test/auth/forgot-password', { email: 'care@example.test' }],
    ['https://api.example.test/auth/otp/verify', { challenge_id: 'challenge-1', code: '012345', purpose: 'reset_password' }],
    ['https://api.example.test/auth/reset-password', { challenge_id: 'challenge-1', verification_token: 'proof-1', new_password: 'New-password-123!' }],
  ])
  expect(localStorage.length).toBe(0)
})

it('OTP hết hạn hoặc bị khóa không cho đặt mật khẩu và có thể yêu cầu mã mới', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ challenge_id: 'c' }))
    .mockResolvedValueOnce(response({}, 410)).mockResolvedValueOnce(response({}, 429))
  vi.stubGlobal('fetch', fetchMock)
  render(<App />)
  await requestCode(); pasteCode()
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận mã OTP' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('hết hạn'))
  expect(screen.queryByLabelText('Mật khẩu mới')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận mã OTP' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('15 phút'))
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu mã mới' }))
  expect(screen.getByLabelText('Email tài khoản')).toBeTruthy()
})
