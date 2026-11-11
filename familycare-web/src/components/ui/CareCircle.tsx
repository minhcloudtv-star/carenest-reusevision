import { useState } from 'react'
import '../../styles/tokens.css'
import './CareCircle.css'

export interface Caregiver {
  name: string
  avatarUrl?: string
  role: string
}

export interface CareCircleProps {
  caregivers: readonly Caregiver[]
  onSelect: (caregiver: Caregiver) => void
}

function Avatar({ caregiver }: { caregiver: Caregiver }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = caregiver.avatarUrl?.trim()
  if (url && failedUrl !== url) {
    return <img className="care-circle__image" src={url} alt="" referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)} />
  }
  return <span aria-hidden="true">{Array.from(caregiver.name.trim())[0]?.toLocaleUpperCase('vi') || '?'}</span>
}

export function CareCircle({ caregivers, onSelect }: CareCircleProps) {
  return <div className="care-circle" role="group" aria-label="Người chăm sóc">
    {caregivers.map((caregiver, index) => <button key={index} type="button"
      className="care-circle__avatar" aria-label={`Xem chi tiết ${caregiver.name} — ${caregiver.role}`}
      title={`${caregiver.name} — ${caregiver.role}`} onClick={() => onSelect(caregiver)}>
      <Avatar caregiver={caregiver} />
    </button>)}
  </div>
}
