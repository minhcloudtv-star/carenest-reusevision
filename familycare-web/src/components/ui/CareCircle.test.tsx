import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CareCircle } from './CareCircle'

afterEach(cleanup)

it('hiển thị ảnh khi có avatarUrl và mở đúng người chăm sóc', () => {
  const caregiver = { name: 'Lan', avatarUrl: '/avatars/lan.png', role: 'Người nhận chính' }
  const onSelect = vi.fn()
  render(<CareCircle caregivers={[caregiver]} onSelect={onSelect} />)
  const button = screen.getByRole('button', { name: 'Xem chi tiết Lan — Người nhận chính' })
  const image = button.querySelector('img')!
  expect(image.getAttribute('src')).toBe(caregiver.avatarUrl)
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
  fireEvent.click(button)
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(caregiver)
})

it('hiển thị chữ cái đầu khi không có ảnh và chọn đúng người trong danh sách', () => {
  const caregivers = [
    { name: '  ánh Nguyễn ', role: 'Gia đình' },
    { name: 'Bình', role: 'Người chăm sóc' },
  ]
  const onSelect = vi.fn()
  render(<CareCircle caregivers={caregivers} onSelect={onSelect} />)
  expect(screen.getAllByRole('button')).toHaveLength(2)
  expect(screen.getByText('Á')).toBeTruthy()
  expect(screen.getByText('B')).toBeTruthy()
  expect(document.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Bình — Người chăm sóc' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(caregivers[1])
})

it('dùng chữ cái khi ảnh lỗi và không làm lỗi khi danh sách rỗng', () => {
  const { rerender } = render(<CareCircle caregivers={[{ name: 'Lan', role: 'Gia đình', avatarUrl: '/missing.png' }]} onSelect={vi.fn()} />)
  fireEvent.error(document.querySelector('img')!)
  expect(screen.getByText('L')).toBeTruthy()
  expect(document.querySelector('img')).toBeNull()
  rerender(<CareCircle caregivers={[]} onSelect={vi.fn()} />)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})
