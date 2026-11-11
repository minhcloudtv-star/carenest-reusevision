import { useEffect, useRef, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Browser prompt is deferred until both engagement and an explicit click. */
export function InstallPrimer({ eventViewed }: { eventViewed: boolean }) {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [engaged, setEngaged] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  useEffect(() => {
    function capture(event: Event) {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    function complete() { setInstalled(true); setInstallEvent(null) }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', complete)
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', complete)
    }
  }, [])
  useEffect(() => {
    let remaining = 30000
    let started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    function start() {
      if (document.visibilityState === 'hidden') return
      started = Date.now()
      timer = setTimeout(() => setEngaged(true), remaining)
    }
    function visibility() {
      if (document.visibilityState === 'hidden') {
        if (timer !== undefined) {
          clearTimeout(timer); timer = undefined
          remaining = Math.max(0, remaining - (Date.now() - started))
        }
      } else if (timer === undefined) start()
    }
    start()
    document.addEventListener('visibilitychange', visibility)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => { if (eventViewed) setEngaged(true) }, [eventViewed])

  async function install() {
    if (!installEvent || busy.current) return
    busy.current = true; setPending(true); setError('')
    // Each captured browser event may be used only once.
    const event = installEvent
    setInstallEvent(null)
    try {
      await event.prompt()
      const choice = await event.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setDismissed(true)
    } catch {
      setError('Không thể mở cài đặt. Bạn có thể chọn “Cài đặt ứng dụng” trong menu trình duyệt.')
    } finally { busy.current = false; setPending(false) }
  }

  if (installed || dismissed || !engaged || (!installEvent && !pending && !error)) return null
  return <section className="settings-panel install-primer" aria-labelledby="install-title">
    <h2 id="install-title">Cài CareNest lên màn hình chính để nhận cảnh báo kịp thời</h2>
    <p>Cài đặt giúp bạn mở ứng dụng nhanh hơn. Hiện cảnh báo chỉ hoạt động khi ứng dụng đang mở; cài đặt không tự cấp quyền thông báo.</p>
    {error && <p role="alert">{error}</p>}
    <div className="install-actions">
      <button type="button" className="confirm-button" disabled={pending || !installEvent} onClick={() => { void install() }}>{pending ? 'Đang mở cài đặt…' : 'Cài lên màn hình chính'}</button>
      <button type="button" disabled={pending} onClick={() => setDismissed(true)}>Để sau</button>
    </div>
  </section>
}
