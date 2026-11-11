/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from 'node:fs'
const css = readFileSync('src/styles/tokens.css', 'utf8')
import { expect, it } from 'vitest'
function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
it.each(['light', 'dark'])('màu trạng thái %s có chữ trắng đạt AA và vòng tròn đủ tương phản nền', theme => {
  const block = theme === 'dark' ? css.slice(css.indexOf('@media')) : css.slice(0, css.indexOf('@media'))
  const background = block.match(/--color-background:\s*(#[0-9a-f]{6})/)![1]
  for (const status of ['ok', 'review', 'critical', 'unavailable']) {
    const color = block.match(new RegExp(`--color-status-${status}:\\s*(#[0-9a-f]{6})`))![1]
    expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color, background)).toBeGreaterThanOrEqual(3)
  }
})
