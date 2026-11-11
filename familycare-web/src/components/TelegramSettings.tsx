import { useEffect, useRef, useState } from 'react'
import { telegramRequest } from '../api/telegram'

export function TelegramSettings() {
  const [chatId, setChatId] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const busy = useRef(false)
  useEffect(() => {
    let active = true
    telegramRequest('GET').then(data => {
      if (active) { setChatId(data.chat_id); setSaved(data.chat_id) }
    }).catch(() => {
      if (active) setError('Chưa tải được cấu hình kênh dự phòng. Máy chủ có thể chưa hỗ trợ hoặc bạn chưa đăng nhập.')
    }).finally(() => { if (active) setPending(false) })
    return () => { active = false }
  }, [])
  async function perform(test: boolean) {
    if (busy.current) return
    const value = chatId.trim()
    if (value && !/^-?[1-9][0-9]{0,19}$/.test(value)) { setError('Nhập Telegram chat ID dạng số, có thể bắt đầu bằng dấu trừ.'); return }
    busy.current = true; setPending(true); setError(''); setMessage('')
    try {
      if (test) {
        await telegramRequest('POST')
        setMessage('Máy chủ đã gửi tin nhắn thử. Hãy kiểm tra cuộc trò chuyện Telegram.')
      } else {
        const data = await telegramRequest('PUT', value)
        setSaved(data.chat_id); setChatId(data.chat_id)
        setMessage(value ? 'Đã lưu kênh Telegram trên máy chủ.' : 'Đã tắt kênh Telegram.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất yêu cầu.') }
    finally { busy.current = false; setPending(false) }
  }
  return <section aria-labelledby="fallback-title">
    <h3 id="fallback-title">Kênh dự phòng</h3>
    <p>Telegram gửi thêm cảnh báo rời giường chưa được xác nhận sau thời gian cấu hình trên máy chủ. Tin nhắn chứa loại sự kiện và thời gian, được gửi qua dịch vụ Telegram.</p>
    <p>Mở cuộc trò chuyện với bot và bấm Start trước khi gửi thử. Để trống chat ID và lưu để tắt kênh.</p>
    {error && <p role="alert">{error}</p>}
    <p aria-live="polite">{message}</p>
    <form onSubmit={event => { event.preventDefault(); void perform(false) }}>
      <label>Telegram chat ID<input value={chatId} disabled={pending} maxLength={21} autoComplete="off" onChange={event => setChatId(event.target.value)} /></label>
      <button type="submit" disabled={pending}>Lưu kênh dự phòng</button>
      <button type="button" disabled={pending || !saved || saved !== chatId.trim()} onClick={() => { void perform(true) }}>Gửi thử</button>
    </form>
  </section>
}
