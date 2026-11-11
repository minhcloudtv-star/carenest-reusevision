export function phoneNumber(contact: string): string | null {
  const normalized = contact.trim().replace(/[\s().-]/g, '')
  return /^\+?[0-9]{7,15}$/.test(normalized) ? normalized : null
}

export const SETTINGS_KEY = 'familycare.settings.v1'
export interface Recipient { id: string; name: string; contact: string }
export interface SettingsData { recipients: Recipient[]; hubUrl: string; primaryRecipientId?: string }

export function loadSettings(): { data: SettingsData; error: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { data: { recipients: [], hubUrl: '' }, error: '' }
    const data = JSON.parse(raw) as SettingsData
    if (!data || typeof data.hubUrl !== 'string' || !Array.isArray(data.recipients)
      || !data.recipients.every(item => item && typeof item.id === 'string'
        && typeof item.name === 'string' && typeof item.contact === 'string')) throw new Error()
    return { data, error: '' }
  } catch {
    return { data: { recipients: [], hubUrl: '' }, error: 'Không thể đọc cài đặt đã lưu. Vui lòng kiểm tra lại cấu hình.' }
  }
}

