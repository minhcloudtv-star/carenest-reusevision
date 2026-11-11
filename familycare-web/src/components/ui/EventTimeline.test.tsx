import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EventTimeline } from './EventTimeline'
import { events } from '../../mock/events'
afterEach(cleanup)
it('hiện đúng số mốc và mở đúng mã sự kiện qua callback hiện có', () => {
  const onSelect = vi.fn()
  render(<EventTimeline events={events} onSelect={onSelect} />)
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(events.length)
  fireEvent.click(within(items[2]).getByRole('button'))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(events[2].event_id)
  expect(items[2].querySelector('time')?.dateTime).toBe(events[2].ts)
})
it('hiện trạng thái rỗng và người xử lý', () => {
  const { rerender } = render(<EventTimeline events={[]} onSelect={vi.fn()} />)
  expect(screen.getByText('Không có sự kiện phù hợp.')).toBeTruthy()
  rerender(<EventTimeline events={[{ ...events[0], acknowledged_by: 'Lan' }]} onSelect={vi.fn()} />)
  expect(screen.getByText('Đã xử lý')).toBeTruthy()
  expect(screen.getByText('Người xử lý: Lan')).toBeTruthy()
})
