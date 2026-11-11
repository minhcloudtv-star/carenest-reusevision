import '../../styles/tokens.css'
import './EmergencyActionBar.css'

export interface EmergencyActionBarProps {
  show: boolean
  recipientName: string
  phoneNumber: string
}

export function EmergencyActionBar({ show, recipientName, phoneNumber }: EmergencyActionBarProps) {
  if (!show) return null

  return <aside className="emergency-action-bar" aria-label="Liên hệ khẩn cấp">
    <a className="emergency-action-bar__call" href={`tel:${phoneNumber}`}>
      Gọi {recipientName}
    </a>
  </aside>
}
