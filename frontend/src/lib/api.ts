/** API-клиент фронтенда. Backend: http://localhost:3000. */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/** Ошибка API с текстом от сервера. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (body.message) message = Array.isArray(body.message) ? body.message.join('; ') : body.message
    } catch {
      // тело не JSON — оставляем HTTP-код
    }
    throw new ApiError(message, res.status)
  }
  // 204/пустое тело
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Контакт (chat id — строки: JSON-сериализация безопасна). */
export interface Contact {
  id: string
  name: string | null
  email: string | null
  city: string | null
  tags: string[]
  telegramChatId: string | null
  telegramConsentAt: string | null
  telegramUnsubscribedAt: string | null
  telegramBlockedAt: string | null
  createdAt: string
}

/** Кампания. */
export interface Campaign {
  id: string
  name: string
  channel: 'TELEGRAM' | 'MAX' | 'WHATSAPP'
  kind: 'SERVICE' | 'MARKETING'
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED'
  templateContent: string
  scheduledAt: string | null
  createdAt: string
  _count?: { contacts: number }
}

/** Список контактов (пагинация). */
export async function fetchContacts(limit = 50, offset = 0): Promise<{ items: Contact[]; total: number }> {
  return request(`/contacts?limit=${limit}&offset=${offset}`)
}

/** Создание контакта. */
export async function createContact(dto: { name?: string; email?: string; city?: string }): Promise<Contact> {
  return request('/contacts', { method: 'POST', body: JSON.stringify(dto) })
}

/** Список кампаний. */
export async function fetchCampaigns(limit = 50, offset = 0): Promise<{ items: Campaign[]; total: number }> {
  return request(`/campaigns?limit=${limit}&offset=${offset}`)
}

/** Создание кампании. */
export async function createCampaign(dto: {
  name: string
  channel: 'TELEGRAM' | 'MAX'
  templateContent: string
  scheduledAt?: string
}): Promise<Campaign> {
  return request('/campaigns', { method: 'POST', body: JSON.stringify(dto) })
}

/** Запуск кампании. */
export async function startCampaign(id: string): Promise<{ queued: number; skipped: number; failed: number }> {
  return request(`/campaigns/${id}/start`, { method: 'POST' })
}
