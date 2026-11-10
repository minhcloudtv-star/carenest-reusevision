import { afterEach, expect, it, vi } from 'vitest'
import { createAlerts } from './alerts'
import { events } from './mock/events'

afterEach(() => vi.unstubAllGlobals())

function setup(permission: NotificationPermission = 'granted') {
  const show = vi.fn()
  class FakeNotification {
    static permission = permission
    static requestPermission = vi.fn(async () => permission)
    constructor(title: string, options: unknown) { show(title, options) }
  }
  const start = vi.fn()
  const close = vi.fn(async () => {})
  class FakeAudio {
    state = 'running'
    currentTime = 0
    destination = {}
    resume = vi.fn(async () => {})
    close = close
    createOscillator = () => ({ frequency: { value: 0 }, connect: vi.fn(), start, stop: vi.fn() })
    createGain = () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() })
  }
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('AudioContext', FakeAudio)
  return { show, start, close, request: FakeNotification.requestPermission }
}

it('chỉ âm thanh và thông báo cho BED_EXIT mới sau khi người dùng bật, không lặp', async () => {
  const { show, start, close, request } = setup()
  const alerts = createAlerts()
  alerts.remember([events[0]])
  expect(request).not.toHaveBeenCalled()
  expect(await alerts.enableSound()).toBe(true)
  expect(await alerts.enableNotifications()).toBe('granted')
  await alerts.notify(events[0])
  await alerts.notify(events[1])
  expect(show).not.toHaveBeenCalled()
  const fresh = { ...events[0], event_id: 'new-bed-exit' }
  await alerts.notify(fresh)
  await alerts.notify(fresh)
  expect(show).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledTimes(1)
  alerts.dispose()
  expect(close).toHaveBeenCalledOnce()
})

it('mặc định không cảnh báo, từ chối quyền không gây lỗi và âm thanh vẫn hoạt động', async () => {
  const { show, start } = setup('denied')
  const alerts = createAlerts()
  await alerts.notify(events[0])
  expect(show).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  await alerts.enableSound()
  expect(await alerts.enableNotifications()).toBe('denied')
  await alerts.notify({ ...events[0], event_id: 'another-event' })
  expect(start).toHaveBeenCalledOnce()
  expect(show).not.toHaveBeenCalled()
  alerts.dispose()
})

it('dùng service worker showNotification khi có registration hoạt động', async () => {
  const { show } = setup()
  const showNotification = vi.fn(async () => {})
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ active: {}, showNotification }) } })
  const alerts = createAlerts()
  await alerts.enableNotifications()
  await alerts.notify(events[0])
  expect(showNotification).toHaveBeenCalledOnce()
  expect(show).not.toHaveBeenCalled()
})
