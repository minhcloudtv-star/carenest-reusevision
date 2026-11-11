import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { EmergencyActionBar } from './EmergencyActionBar'

afterEach(cleanup)

const recipient = { recipientName: 'Chị Lan', phoneNumber: '+84901234567' }

it('hiện nút gọi người nhận chính với liên kết tel khi show=true', () => {
  render(<EmergencyActionBar show {...recipient} />)
  expect(screen.getByRole('complementary', { name: 'Liên hệ khẩn cấp' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Gọi Chị Lan' }).getAttribute('href'))
    .toBe('tel:+84901234567')
})

it('không render phần tử nào khi show=false, kể cả sau khi đã hiện', () => {
  const { container, rerender } = render(<EmergencyActionBar show={false} {...recipient} />)
  expect(container.childElementCount).toBe(0)
  rerender(<EmergencyActionBar show {...recipient} />)
  expect(screen.getByRole('link', { name: 'Gọi Chị Lan' })).toBeTruthy()
  rerender(<EmergencyActionBar show={false} {...recipient} />)
  expect(container.childElementCount).toBe(0)
  expect(screen.queryByRole('link')).toBeNull()
})
