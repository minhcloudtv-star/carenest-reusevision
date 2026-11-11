import { parseEvent } from './client'
import type { CareEvent } from '../types/event'

interface Handlers {
  onEvent: (event: CareEvent) => void
  onAvailability: (available: boolean) => void
}

export function connectEvents({ onEvent, onAvailability }: Handlers): () => void {
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let failures = 0

  function connect() {
    if (stopped) return
    let failed = false
    onAvailability(false)
    function fail() {
      if (failed || stopped) return
      failed = true
      clearTimeout(watchdog)
      onAvailability(false)
      socket?.close()
      const delay = Math.min(1000 * 2 ** Math.min(failures++, 5), 30000)
      retry = setTimeout(connect, delay)
    }
    function armWatchdog() {
      clearTimeout(watchdog)
      watchdog = setTimeout(fail, 30000)
    }
    try {
      const base = import.meta.env.VITE_API_URL?.trim()
      if (!base) throw new Error('Chưa cấu hình VITE_API_URL')
      const url = new URL(base)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL không hợp lệ')
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws/events`
      url.search = ''
      url.hash = ''
      const current = new WebSocket(url.toString())
      socket = current
      armWatchdog()
      current.onopen = () => { /* Chờ heartbeat trước khi báo kết nối khả dụng. */ }
      current.onclose = fail
      current.onerror = fail
      current.onmessage = message => {
        if (stopped || failed) return
        try {
          const data = JSON.parse(message.data)
          if (data?.type === 'heartbeat') {
            failures = 0
            armWatchdog()
            onAvailability(true)
          } else {
            onEvent(parseEvent(data))
          }
        } catch {
          fail()
        }
      }
    } catch {
      fail()
    }
  }
  connect()
  return () => {
    stopped = true
    clearTimeout(retry)
    clearTimeout(watchdog)
    socket?.close()
  }
}
