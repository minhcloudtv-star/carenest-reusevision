import { expect, it } from 'vitest'
import { overviewStatus } from './eventPresentation'
import { events } from './mock/events'
it('ưu tiên mất giám sát, sau đó nguy hiểm do AI, cần xem và đang giám sát', () => {
  const risks = new Set([events[0].event_id])
  expect(overviewStatus(events, false, risks)).toBe('offline')
  expect(overviewStatus(events, true, risks)).toBe('critical')
  expect(overviewStatus(events, true)).toBe('needs_attention')
  expect(overviewStatus([], true)).toBe('ok')
  expect(overviewStatus(events.map(event => ({ ...event, acknowledged_by: 'Lan' })), true, risks)).toBe('ok')
})
it('xét cả sự kiện nằm ngoài 5 mục mới nhất và không suy diễn nguy cấp từ confidence', () => {
  expect(overviewStatus(events, true, new Set([events[7].event_id]))).toBe('critical')
  expect(overviewStatus([{ ...events[3], confidence: 1 }], true)).toBe('needs_attention')
})
