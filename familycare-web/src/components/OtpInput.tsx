import { useRef } from 'react'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Controlled six-digit OTP; keep the value in memory only. */
export function OtpInput({ value, onChange, disabled = false }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? ' ')
  function update(index: number, text: string) {
    const numbers = text.replace(/\D/g, '').slice(0, 6 - index)
    if (text && !numbers) return
    const next = [...digits]
    if (!numbers) next[index] = ' '
    else [...numbers].forEach((number, offset) => { next[index + offset] = number })
    onChange(next.join('').replace(/ +$/, ''))
    if (numbers) refs.current[Math.min(index + numbers.length, 5)]?.focus()
  }
  return <fieldset className="otp-fieldset" disabled={disabled}>
    <legend>Mã OTP gồm 6 chữ số</legend>
    <div className="otp-inputs">
      {digits.map((digit, index) => <input key={index}
        ref={element => { refs.current[index] = element }}
        aria-label={`Chữ số ${index + 1}`} value={digit.trim()} type="text"
        inputMode="numeric" pattern="[0-9]" autoComplete={index === 0 ? 'one-time-code' : 'off'}
        onFocus={event => event.target.select()}
        onChange={event => update(index, event.target.value)}
        onPaste={event => { event.preventDefault(); update(index, event.clipboardData.getData('text')) }}
        onKeyDown={event => {
          if (event.key === 'Backspace' && !digit.trim() && index > 0) refs.current[index - 1]?.focus()
          if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
          if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus()
        }} />)}
    </div>
  </fieldset>
}
