async function post(path: string, body: object): Promise<unknown> {
  const base = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Chưa cấu hình kết nối máy chủ.')
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000), cache: 'no-store',
    })
  } catch { throw new Error('Không thể kết nối máy chủ. Vui lòng thử lại.') }
  if (!response.ok) {
    if (response.status === 429) throw new Error('Đã vượt giới hạn thử. Vui lòng thử lại sau 15 phút.')
    if ([400, 401, 410, 422].includes(response.status)) throw new Error('Mã hoặc thông tin không hợp lệ, có thể đã hết hạn. Vui lòng kiểm tra hoặc yêu cầu mã mới.')
    throw new Error('Không thể hoàn tất yêu cầu. Vui lòng thử lại.')
  }
  return response.status === 204 ? null : response.json()
}

function field(data: unknown, key: string): string {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error('Phản hồi máy chủ không hợp lệ. Vui lòng thử lại.')
  return value
}

export async function forgotPassword(email: string) {
  return field(await post('/auth/forgot-password', { email }), 'challenge_id')
}
export async function verifyResetOtp(challengeId: string, code: string) {
  return field(await post('/auth/otp/verify', { challenge_id: challengeId, code, purpose: 'reset_password' }), 'verification_token')
}
export async function resetPassword(challengeId: string, verificationToken: string, newPassword: string) {
  await post('/auth/reset-password', { challenge_id: challengeId, verification_token: verificationToken, new_password: newPassword })
}
