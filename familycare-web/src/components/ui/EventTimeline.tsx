import type { CareEvent } from '../../types/event'
import { eventLabels } from '../../eventPresentation'
import { EmptyState } from './EmptyState'
import '../../styles/tokens.css'
import './EventTimeline.css'
export function EventTimeline({ events, onSelect, showEmpty = true }: {
  events: readonly CareEvent[]; onSelect: (id: string) => void; showEmpty?: boolean
}) {
  if (!events.length) return showEmpty ? <EmptyState /> : null
  return <ul className="event-timeline" aria-label="Dòng thời gian sự kiện">
    {events.map(event => <li key={event.event_id} className="event-timeline__item"
      style={{ '--timeline-color': `var(${event.type === 'MONITORING_UNAVAILABLE' ? '--color-status-unavailable' : '--color-status-review'})` } as import('react').CSSProperties}>
      <button className="event-button event-timeline__button" type="button" onClick={() => onSelect(event.event_id)}>
        <time dateTime={event.ts}>{new Date(event.ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
        <h3>{eventLabels[event.type].name}</h3>
        <span className={`badge ${event.acknowledged_by ? 'processed' : ''}`}>{event.acknowledged_by ? 'Đã xử lý' : 'Chưa xử lý'}</span>
        {event.acknowledged_by && <span>Người xử lý: {event.acknowledged_by}</span>}
      </button>
    </li>)}
  </ul>
}
