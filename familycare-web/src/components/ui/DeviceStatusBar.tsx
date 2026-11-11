import type { ReactNode } from 'react'
import '../../styles/tokens.css'
import './DeviceStatusBar.css'

export interface DeviceStatusItem {
  icon: ReactNode
  label: string
  value: string | number
}

export interface DeviceStatusBarProps {
  items: readonly DeviceStatusItem[]
}

export function DeviceStatusBar({ items }: DeviceStatusBarProps) {
  return <dl className="device-status-bar" aria-label="Trạng thái thiết bị">
    {items.map((item, index) => <div className="device-status-bar__item" key={index}>
      <dt>
        <span className="device-status-bar__icon" aria-hidden="true">{item.icon}</span>
        {' '}{item.label}
      </dt>
      <dd>{item.value}</dd>
    </div>)}
  </dl>
}
