import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBanner } from './StatusBanner'

afterEach(cleanup)

describe('StatusBanner', () => {
  it('hiện banner xanh khi kết nối và heartbeat còn hạn', () => {
    render(<StatusBanner connected heartbeatFresh />)
    expect(screen.getByRole('status').textContent).toContain('Đang giám sát')
    expect(screen.getByRole('status').classList.contains('monitoring')).toBe(true)
  })

  it.each([[false, true], [true, false], [false, false]])(
    'hiện banner đỏ nếu mất kết nối hoặc heartbeat quá hạn (%s, %s)',
    (connected, heartbeatFresh) => {
      render(<StatusBanner connected={connected} heartbeatFresh={heartbeatFresh} />)
      expect(screen.getByRole('status').textContent).toContain('Monitoring unavailable')
      expect(screen.getByRole('status').classList.contains('unavailable')).toBe(true)
      expect(screen.queryByText('Đang giám sát')).toBeNull()
    },
  )
})
