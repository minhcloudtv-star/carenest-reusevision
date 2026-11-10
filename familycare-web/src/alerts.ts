import type { CareEvent } from './types/event'

export function createAlerts() {
  let audio: AudioContext | undefined
  let soundEnabled = false
  let notificationsEnabled = false
  const seen = new Set<string>()

  function remember(events: CareEvent[]) {
    events.forEach(event => seen.add(event.event_id))
  }

  async function enableSound() {
    if (!('AudioContext' in window)) return false
    try {
      audio ??= new AudioContext()
      await audio.resume()
      soundEnabled = audio.state === 'running'
      return soundEnabled
    } catch { return false }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return 'unsupported'
    try {
      const permission = await Notification.requestPermission()
      notificationsEnabled = permission === 'granted'
      return permission
    } catch { return 'unsupported' }
  }

  async function notify(event: CareEvent) {
    if (seen.has(event.event_id)) return
    seen.add(event.event_id)
    if (event.type !== 'BED_EXIT' || event.acknowledged_by) return
    if (soundEnabled && audio) {
      try {
        await audio.resume()
        const tone = audio.createOscillator()
        const gain = audio.createGain()
        tone.frequency.value = 880
        gain.gain.setValueAtTime(0.15, audio.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7)
        tone.connect(gain)
        gain.connect(audio.destination)
        tone.start()
        tone.stop(audio.currentTime + 0.7)
      } catch { /* Sự kiện vẫn hiển thị nếu trình duyệt chặn âm thanh. */ }
    }
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      const options = { body: 'Có sự kiện rời giường mới. Mở FamilyCare để kiểm tra.', tag: event.event_id }
      try {
        const registration = 'serviceWorker' in navigator
          ? await navigator.serviceWorker.getRegistration() : undefined
        if (registration?.active) await registration.showNotification('FamilyCare: Rời giường', options)
        else new Notification('FamilyCare: Rời giường', options)
      } catch { /* Không chặn luồng sự kiện khi thông báo không được hỗ trợ. */ }
    }
  }

  function dispose() {
    soundEnabled = false
    notificationsEnabled = false
    void audio?.close().catch(() => {})
    audio = undefined
  }

  return { remember, enableSound, enableNotifications, notify, dispose }
}
