import { useEffect, useState } from 'react'
import type { OverviewStatus } from '../../eventPresentation'
import '../../styles/tokens.css'
import './StatusRing.css'
const states = {
  ok: { label: 'Đang giám sát', icon: '●', token: '--color-status-ok' },
  needs_attention: { label: 'Cần xem', icon: '◌', token: '--color-status-review' },
  critical: { label: 'Nguy cấp', icon: '⚠', token: '--color-status-critical' },
  offline: { label: 'Mất giám sát · Monitoring unavailable', icon: '⚠', token: '--color-status-unavailable' },
}
export function StatusRing({ status, lastUpdated }: { status: OverviewStatus; lastUpdated: Date }) {
  const [now, setNow] = useState(Date.now)
  const timestamp = lastUpdated.getTime()
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const immediate = setTimeout(refresh, 0)
    const timer = setInterval(refresh, 60000)
    return () => { clearTimeout(immediate); clearInterval(timer) }
  }, [timestamp])
  const state = states[status]
  const valid = Number.isFinite(timestamp) && timestamp <= now
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60000)
  return <div className="status-ring" role="status" aria-live="polite" data-status={status}>
    <svg viewBox="0 0 200 200" className="status-ring__graphic" aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill={`var(${state.token})`} />
      <text x="100" y="100" textAnchor="middle" dominantBaseline="central" fill="var(--color-on-status)">{state.icon}</text>
    </svg>
    <strong className="status-ring__label">{state.label}</strong>
    {(status === 'needs_attention' || status === 'critical') && <p>Đang giám sát</p>}
    <p>{valid ? `Cập nhật ${minutes === 0 ? 'vừa xong' : new Intl.RelativeTimeFormat('vi').format(-minutes, 'minute')}` : 'Chưa có cập nhật'}</p>
  </div>
}
