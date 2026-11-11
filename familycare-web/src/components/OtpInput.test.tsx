import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { OtpInput } from './OtpInput'
afterEach(cleanup)
function Harness() {
  const [value, setValue] = useState('')
  return <OtpInput value={value} onChange={setValue} />
}
it('tự chuyển ô, bỏ chữ, hỗ trợ quay lại và dán sáu số', () => {
  render(<Harness />)
  const first = screen.getByLabelText('Chữ số 1') as HTMLInputElement
  const second = screen.getByLabelText('Chữ số 2') as HTMLInputElement
  fireEvent.change(first, { target: { value: '0' } })
  expect(document.activeElement).toBe(second)
  fireEvent.change(second, { target: { value: 'a' } })
  expect(second.value).toBe('')
  fireEvent.keyDown(second, { key: 'Backspace' })
  expect(document.activeElement).toBe(first)
  fireEvent.paste(first, { clipboardData: { getData: () => '123456' } })
  expect(screen.getAllByRole('textbox').map(input => (input as HTMLInputElement).value).join('')).toBe('123456')
})
