export async function telegramRequest(method: 'GET' | 'PUT' | 'POST', chatId?: string) {
  const base = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Chưa cấu hình kết nối máy chủ.')
  let response: Response
  try {
    response = await fetch(`${base}/notify/telegram${method === 'POST' ? '/test' : ''}`, {
      method, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000),
      ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId }) } : {}),
    })
  } catch { throw new Error('Không thể kết nối máy chủ. Vui lòng thử lại.') }
  if (!response.ok) {
    if (response.status === 503) throw new Error('Kênh dự phòng chưa sẵn sàng trên máy chủ.')
    if ([401, 403].includes(response.status)) throw new Error('Bạn cần đăng nhập và có quyền cấu hình kênh dự phòng.')
    throw new Error('Không thể hoàn tất yêu cầu. Kiểm tra bot và Telegram chat ID rồi thử lại.')
  }
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object'
    || (method === 'POST' ? (data as { sent?: unknown }).sent !== true : typeof (data as { chat_id?: unknown }).chat_id !== 'string')) {
    throw new Error('Phản hồi máy chủ không hợp lệ.')
  }
  return data as { chat_id: string; sent?: boolean }
}
