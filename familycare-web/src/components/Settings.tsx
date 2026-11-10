import { useState } from 'react'
import type { CareEvent } from '../types/event'

export const SETTINGS_KEY = 'familycare.settings.v1'
interface Recipient { id: string; name: string; contact: string }
interface SettingsData { recipients: Recipient[]; hubUrl: string }

function load(): { data: SettingsData; error: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { data: { recipients: [], hubUrl: '' }, error: '' }
    const data = JSON.parse(raw) as SettingsData
    if (!data || typeof data.hubUrl !== 'string' || !Array.isArray(data.recipients)
      || !data.recipients.every(item => item && typeof item.id === 'string'
        && typeof item.name === 'string' && typeof item.contact === 'string')) throw new Error()
    return { data, error: '' }
  } catch {
    return { data: { recipients: [], hubUrl: '' }, error: 'Không thể đọc cài đặt đã lưu. Vui lòng kiểm tra lại cấu hình.' }
  }
}

export function Settings({ events }: { events: CareEvent[] }) {
  const [initial] = useState(load)
  const [settings, setSettings] = useState(initial.data)
  const [hubUrl, setHubUrl] = useState(initial.data.hubUrl)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [error, setError] = useState(initial.error)
  const [message, setMessage] = useState('')
  const cameras = [...new Set(events.map(event => event.camera_id))]

  function save(next: SettingsData) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      setSettings(next)
      setError('')
      setMessage('Đã lưu cài đặt trên thiết bị này.')
      return true
    } catch {
      setMessage('')
      setError('Không thể lưu cài đặt. Bộ nhớ trình duyệt có thể bị chặn hoặc đã đầy.')
      return false
    }
  }

  return <section className="settings-panel" aria-labelledby="configuration-title">
    <h2 id="configuration-title">Cấu hình FamilyCare</h2>
    {error && <p role="alert">{error}</p>}
    <p aria-live="polite">{message}</p>
    <section aria-labelledby="recipients-title">
      <h3 id="recipients-title">Người nhận cảnh báo</h3>
      <p>Danh sách chỉ lưu trên thiết bị, chưa đồng bộ hoặc gửi cảnh báo đến người nhận.</p>
      {settings.recipients.length === 0 && <p>Chưa có người nhận cảnh báo.</p>}
      <ul className="recipient-list">
        {settings.recipients.map(recipient => <li key={recipient.id}>
          <div><strong>{recipient.name}</strong><p>{recipient.contact}</p></div>
          <button type="button" aria-label={`Xóa ${recipient.name}`} onClick={() => save({ ...settings, recipients: settings.recipients.filter(item => item.id !== recipient.id) })}>Xóa</button>
        </li>)}
      </ul>
      <form onSubmit={event => {
        event.preventDefault()
        const trimmedName = name.trim()
        const trimmedContact = contact.trim()
        if (!trimmedName || !trimmedContact) { setError('Nhập tên và thông tin liên hệ.'); return }
        if (settings.recipients.some(item => item.contact.toLowerCase() === trimmedContact.toLowerCase())) {
          setError('Thông tin liên hệ này đã có trong danh sách.'); return
        }
        if (save({ ...settings, recipients: [...settings.recipients, { id: crypto.randomUUID(), name: trimmedName, contact: trimmedContact }] })) {
          setName(''); setContact('')
        }
      }}>
        <label>Tên người nhận<input value={name} onChange={event => setName(event.target.value)} required maxLength={100} autoComplete="name" /></label>
        <label>Số điện thoại hoặc email<input value={contact} onChange={event => setContact(event.target.value)} required maxLength={200} /></label>
        <button type="submit">Thêm người nhận</button>
      </form>
    </section>
    <section aria-labelledby="cameras-title">
      <h3 id="cameras-title">Camera đã ghép đôi</h3>
      <p>Chưa xác minh trạng thái ghép đôi: hệ thống chưa cung cấp API ghép đôi camera.</p>
      {cameras.length > 0 ? <ul>{cameras.map(id => <li key={id}>{id} — Chưa xác minh (xuất hiện trong sự kiện)</li>)}</ul>
        : <p>Chưa có thông tin camera.</p>}
    </section>
    <section aria-labelledby="hub-title">
      <h3 id="hub-title">Địa chỉ hub</h3>
      <form onSubmit={event => {
        event.preventDefault()
        const value = hubUrl.trim()
        try {
          if (value) {
            const url = new URL(value)
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
          }
          save({ ...settings, hubUrl: value })
        } catch { setError('Nhập địa chỉ hub dạng http:// hoặc https://, không chứa tài khoản hoặc mật khẩu.') }
      }}>
        <label>Địa chỉ hub<input type="url" value={hubUrl} onChange={event => setHubUrl(event.target.value)} placeholder="http://hub.local:8000" /></label>
        <button type="submit">Lưu địa chỉ hub</button>
      </form>
      <p>Địa chỉ được lưu để cấu hình hub, chưa thực hiện kết nối. API ứng dụng vẫn lấy từ VITE_API_URL.</p>
    </section>
  </section>
}
