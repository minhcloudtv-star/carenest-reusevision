import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DeviceStatusBar } from './DeviceStatusBar'

afterEach(cleanup)

it('hiển thị icon, nhãn và giá trị tương ứng cho ba chỉ số thiết bị', () => {
  const items = [
    { icon: '▰', label: 'Pin', value: '85%' },
    { icon: '▂', label: 'Tín hiệu', value: '−65 dBm' },
    { icon: '◷', label: 'Heartbeat cuối', value: '10:30' },
  ]
  render(<DeviceStatusBar items={items} />)
  const bar = screen.getByLabelText('Trạng thái thiết bị')
  expect(within(bar).getAllByRole('term')).toHaveLength(3)
  expect(within(bar).getAllByRole('definition')).toHaveLength(3)
  items.forEach(item => {
    const term = within(bar).getByText(item.label)
    const group = term.parentElement!
    expect(within(group).getByText(item.value)).toBeTruthy()
    expect(within(group).getByText(item.icon).getAttribute('aria-hidden')).toBe('true')
  })
})

it('cập nhật giá trị theo props và chấp nhận danh sách rỗng', () => {
  const { rerender } = render(<DeviceStatusBar items={[{ icon: '▰', label: 'Pin', value: 85 }]} />)
  expect(screen.getByText('85')).toBeTruthy()
  rerender(<DeviceStatusBar items={[{ icon: '▰', label: 'Pin', value: 0 }]} />)
  expect(screen.queryByText('85')).toBeNull()
  expect(screen.getByText('0')).toBeTruthy()
  rerender(<DeviceStatusBar items={[]} />)
  expect(screen.queryAllByRole('term')).toHaveLength(0)
})
