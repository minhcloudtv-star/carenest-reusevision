interface StatusBannerProps {
  connected: boolean
  heartbeatFresh: boolean
}

export function StatusBanner({ connected, heartbeatFresh }: StatusBannerProps) {
  const monitoring = connected && heartbeatFresh
  return (
    <div role="status" aria-live="polite" className={`status-banner ${monitoring ? 'monitoring' : 'unavailable'}`}>
      <span aria-hidden="true">{monitoring ? '●' : '⚠'}</span>
      <strong>{monitoring ? 'Đang giám sát' : 'Monitoring unavailable'}</strong>
    </div>
  )
}
