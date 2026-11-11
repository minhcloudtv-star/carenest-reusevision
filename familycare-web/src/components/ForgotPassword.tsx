import { useRef, useState } from 'react'
import { forgotPassword, resetPassword, verifyResetOtp } from '../api/auth'
import { OtpInput } from './OtpInput'

export function ForgotPassword() {
  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [challenge, setChallenge] = useState('')
  const [proof, setProof] = useState('')
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState('')
  async function submit() {
    if (busy.current) return
    if (step === 'password' && password !== confirmation) { setError('Hai mật khẩu chưa khớp.'); return }
    busy.current = true; setPending(true); setError('')
    try {
      if (step === 'email') { setChallenge(await forgotPassword(email.trim())); setStep('otp') }
      else if (step === 'otp') { setProof(await verifyResetOtp(challenge, code)); setCode(''); setStep('password') }
      else if (step === 'password') {
        await resetPassword(challenge, proof, password)
        setPassword(''); setConfirmation(''); setProof(''); setChallenge(''); setEmail(''); setStep('done')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất yêu cầu.') }
    finally { busy.current = false; setPending(false) }
  }
  return <main>
    <header><p className="brand">FamilyCare</p><h1>Quên mật khẩu</h1></header>
    <section className="settings-panel recovery-panel">
      {error && <p role="alert">{error}</p>}
      {step === 'done' ? <p role="status">Đã đặt lại mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.</p> :
        <form onSubmit={event => { event.preventDefault(); void submit() }} aria-busy={pending}>
          {step === 'email' && <label>Email tài khoản<input type="email" autoComplete="email" required value={email} disabled={pending} onChange={event => setEmail(event.target.value)} /></label>}
          {step === 'otp' && <>
            <p role="status">Nếu tài khoản tồn tại, mã xác thực sẽ được gửi đến email của bạn. Mã có hiệu lực 5 phút.</p>
            <OtpInput value={code} onChange={setCode} disabled={pending} />
          </>}
          {step === 'password' && <>
            <label>Mật khẩu mới<input type="password" autoComplete="new-password" required value={password} disabled={pending} onChange={event => setPassword(event.target.value)} /></label>
            <label>Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" required value={confirmation} disabled={pending} onChange={event => setConfirmation(event.target.value)} /></label>
          </>}
          <button className="confirm-button" disabled={pending || (step === 'otp' && !/^\d{6}$/.test(code))} type="submit">
            {pending ? 'Đang xử lý…' : step === 'email' ? 'Gửi mã OTP' : step === 'otp' ? 'Xác nhận mã OTP' : 'Đặt mật khẩu mới'}
          </button>
          {step !== 'email' && <button type="button" disabled={pending} onClick={() => {
            setStep('email'); setCode(''); setChallenge(''); setProof(''); setPassword(''); setConfirmation(''); setError('')
          }}>Yêu cầu mã mới</button>}
        </form>}
      <a href="/">Về FamilyCare</a>
    </section>
  </main>
}
