import { useEffect, useState } from 'react'
import { Settings } from './components/Settings'
import { StatusBanner } from './components/StatusBanner'
import { events } from './mock/events'
import { acknowledgeEvent, getEvents, getStatus, isHeartbeatFresh } from './api/client'
import type { MonitoringStatus } from './api/client'
import type { CareEvent, EventType } from './types/event'
import { connectEvents } from './api/socket'
import { createAlerts } from './alerts'
import './App.css'

const labels: Record<EventType, { icon: string; name: string }> = {
  BED_EXIT: { icon: '↗', name: 'Rời giường' },
  DOOR_APPROACH: { icon: '⇥', name: 'Đến gần cửa' },
  OUT_OF_VIEW: { icon: '◌', name: 'Ngoài tầm quan sát' },
  LOW_POSTURE_REVIEW: { icon: '↓', name: 'Cần kiểm tra tư thế thấp' },
  MONITORING_UNAVAILABLE: { icon: '⚠', name: 'Giám sát không khả dụng' },
}

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
})

type Page = 'overview' | 'history' | 'settings'
const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Tổng quan', icon: '⌂' },
  { id: 'history', label: 'Lịch sử', icon: '◷' },
  { id: 'settings', label: 'Cài đặt', icon: '⚙' },
]

function App() {
  const [alerts] = useState(createAlerts)
  const [soundMessage, setSoundMessage] = useState('Âm thanh chưa bật')
  const [notificationMessage, setNotificationMessage] = useState('Thông báo chưa bật')
  useEffect(() => () => alerts.dispose(), [alerts])
  const useMock = import.meta.env.VITE_USE_MOCK === 'true'
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  const [streamAvailable, setStreamAvailable] = useState(false)
  const [status, setStatus] = useState<MonitoringStatus | null>(null)
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(!useMock)
  const [ackPending, setAckPending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [page, setPage] = useState<Page>('overview')
  const [typeFilter, setTypeFilter] = useState<EventType | ''>('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [appEvents, setAppEvents] = useState<CareEvent[]>(() => useMock ? events.map(event => ({ ...event })) : [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [acknowledgedTimes, setAcknowledgedTimes] = useState<Record<string, string>>({})
  const selected = appEvents.find(event => event.event_id === selectedId)

  useEffect(() => {
    if (useMock) return
    let active = true
    let inFlight = false
    const liveEvents = new Map<string, CareEvent>()
    const disconnect = connectEvents({
      onAvailability: setStreamAvailable,
      onEvent: event => {
        void alerts.notify(event)
        liveEvents.set(event.event_id, event)
        setAppEvents(current => [event, ...current.filter(item => item.event_id !== event.event_id)])
      },
    })
    async function refresh() {
      if (inFlight) return
      inFlight = true
      try {
        const [nextEvents, nextStatus] = await Promise.all([getEvents(), getStatus()])
        if (active) {
          alerts.remember(nextEvents)
          setAppEvents([...new Map([...nextEvents, ...liveEvents.values()].map(event => [event.event_id, event])).values()])
          setStatus(nextStatus)
          setApiError('')
          setNow(Date.now())
        }
      } catch {
        if (active) {
          setStatus(null)
          setApiError('Không thể tải dữ liệu giám sát. Vui lòng thử lại.')
        }
      } finally {
        inFlight = false
        if (active) setLoading(false)
      }
    }
    void refresh()
    const poll = setInterval(() => { void refresh() }, 10000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { active = false; disconnect(); clearInterval(poll); clearInterval(clock) }
  }, [useMock, alerts])

  async function acknowledge() {
    if (!selected || selected.acknowledged_by || ackPending) return
    const id = selected.event_id
    if (useMock) {
      setAppEvents(current => current.map(event => event.event_id === id
        ? { ...event, acknowledged_by: 'Người chăm sóc (demo)' } : event))
      setAcknowledgedTimes(current => ({ ...current, [id]: new Date().toISOString() }))
      return
    }
    setAckPending(true)
    try {
      const updated = await acknowledgeEvent(id)
      setAppEvents(current => current.map(event => event.event_id === id ? updated : event))
    } catch {
      setStatus(null)
      setApiError('Không thể xác nhận sự kiện. Vui lòng thử lại.')
    } finally {
      setAckPending(false)
    }
  }

  const sortedEvents = [...appEvents].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
  const visibleEvents = page === 'history'
    ? sortedEvents.filter(event => (!typeFilter || event.type === typeFilter)
      && (statusFilter === 'all' || Boolean(event.acknowledged_by) === (statusFilter === 'processed')))
    : sortedEvents.slice(0, 5)
  return (
    <main>
      <StatusBanner connected={online && Boolean(status?.connected) && streamAvailable && !apiError} heartbeatFresh={Boolean(status && isHeartbeatFresh(status, now))} />
      <header>
        <p className="brand">FamilyCare</p>
        <h1>{selected ? 'Chi tiết sự kiện' : pages.find(item => item.id === page)?.label}</h1>
        <p>{useMock ? 'Dữ liệu minh họa · Chưa kết nối hệ thống giám sát' : 'Dữ liệu từ hệ thống giám sát'}</p>
      </header>
      {apiError && <p role="alert">{apiError}</p>}
      {loading && <p>Đang tải dữ liệu…</p>}
      {selected ? (
        <section aria-labelledby="detail-title" className="event-detail">
          <button type="button" onClick={() => setSelectedId(null)}>{page === 'history' ? '← Về lịch sử' : '← Về tổng quan'}</button>
          <h2 id="detail-title">{labels[selected.type].name}</h2>
          <dl>
            <dt>Mã sự kiện</dt><dd>{selected.event_id}</dd>
            <dt>Camera</dt><dd>{selected.camera_id}</dd>
            <dt>Thời gian sự kiện</dt>
            <dd><time dateTime={selected.ts}>{new Date(selected.ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ Việt Nam)</time></dd>
            <dt>Độ tin cậy</dt><dd>{selected.confidence}</dd>
            <dt>Trạng thái</dt><dd><span className={`badge ${selected.acknowledged_by ? 'processed' : ''}`}>{selected.acknowledged_by ? 'Đã xử lý' : 'Chưa xử lý'}</span></dd>
            {selected.acknowledged_by && <><dt>Người xác nhận</dt><dd>{selected.acknowledged_by}</dd></>}
            {acknowledgedTimes[selected.event_id] && <>
              <dt>Thời gian xác nhận (giờ Việt Nam)</dt>
              <dd><time dateTime={acknowledgedTimes[selected.event_id]}>{new Date(acknowledgedTimes[selected.event_id]).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</time></dd>
            </>}
          </dl>
          <button className="confirm-button" type="button" disabled={Boolean(selected.acknowledged_by) || ackPending} onClick={acknowledge}>Xác nhận đã xử lý</button>
          <p className="local-note">{useMock ? 'Xác nhận chỉ lưu trong phiên này, sẽ mất khi tải lại trang.' : 'Xác nhận được gửi tới hệ thống. Chỉ cập nhật khi API trả thành công.'} Trạng thái giám sát không thay đổi.</p>
        </section>
      ) : page === 'settings' ? (
        <>
        <Settings events={appEvents} />
        <section className="event-detail" aria-labelledby="settings-title">
          <h2 id="settings-title">Thông tin ứng dụng</h2>
          <h3>Cài lên màn hình chính</h3>
          <p>Android: mở menu trình duyệt, chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”. iPhone: mở bằng Safari, chọn Chia sẻ → Thêm vào MH chính.</p>
          <p>Cần truy cập bằng HTTPS. Sau lần tải đầu, giao diện có thể mở khi ngoại tuyến; dữ liệu giám sát vẫn cần kết nối mạng.</p>
          <div className="alert-settings">
            <h3>Cảnh báo rời giường</h3>
            <button type="button" onClick={async () => setSoundMessage(await alerts.enableSound() ? 'Đã bật âm thanh' : 'Không thể bật âm thanh trên trình duyệt này')}>Bật âm thanh</button>
            <p aria-live="polite">{soundMessage}</p>
            <button type="button" onClick={async () => {
              const permission = await alerts.enableNotifications()
              setNotificationMessage(permission === 'granted' ? 'Đã bật thông báo' : permission === 'denied' ? 'Thông báo bị từ chối. Có thể đổi quyền trong cài đặt trình duyệt.' : permission === 'default' ? 'Chưa cấp quyền thông báo' : 'Trình duyệt chưa hỗ trợ thông báo ở chế độ này')
            }}>Bật thông báo</button>
            <p aria-live="polite">{notificationMessage}</p>
            <p>Chỉ cảnh báo sự kiện rời giường mới khi app đang mở. Không gửi cảnh báo từ lịch sử.</p>
          </div>
          <p>{useMock ? 'FamilyCare đang dùng dữ liệu minh họa, chưa kết nối API.' : 'FamilyCare đang dùng API được cấu hình qua VITE_API_URL.'}</p>
          <p>Ứng dụng chỉ hiển thị sự kiện văn bản, không hiển thị hay lưu video/ảnh.</p>
        </section>
        </>
      ) : <section aria-labelledby="events-title">
        <h2 id="events-title">{page === 'history' ? 'Tất cả sự kiện' : '5 sự kiện mới nhất'}</h2>
        {page === 'history' && <div className="filters">
          <label>Loại sự kiện
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as EventType | '')}>
              <option value="">Tất cả loại</option>
              {Object.entries(labels).map(([type, label]) => <option key={type} value={type}>{label.name}</option>)}
            </select>
          </label>
          <label>Trạng thái xử lý
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chưa xử lý</option>
              <option value="processed">Đã xử lý</option>
            </select>
          </label>
        </div>}
        <p className="date-note">Giờ Việt Nam · Mới nhất trước</p>
        {!loading && !apiError && visibleEvents.length === 0 && <p>Không có sự kiện phù hợp.</p>}
        <ul className="events">
          {visibleEvents.map(event => (
            <li key={event.event_id}>
              <button className="event-button" type="button" onClick={() => setSelectedId(event.event_id)}>
              <span className="event-icon" aria-hidden="true">{labels[event.type].icon}</span>
              <div className="event-content">
                <h3>{labels[event.type].name}</h3>
                <time dateTime={event.ts}>{new Date(event.ts).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · {timeFormat.format(new Date(event.ts))}</time>
              </div>
              <span className={`badge ${event.acknowledged_by ? 'processed' : ''}`}>{event.acknowledged_by ? 'Đã xử lý' : 'Chưa xử lý'}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>}
      <nav className="bottom-nav" aria-label="Điều hướng chính">
        {pages.map(item => <button key={item.id} type="button"
          aria-current={page === item.id ? 'page' : undefined}
          onClick={() => { setPage(item.id); setSelectedId(null) }}>
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </button>)}
      </nav>
    </main>
  )
}

export default App
