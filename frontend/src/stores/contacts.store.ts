import { create } from 'zustand'
import { ApiError, createContact, fetchContacts, type Contact } from '@/lib/api'

/** Состояние стора контактов. */
interface ContactsState {
  items: Contact[]
  total: number
  loading: boolean
  error: string | null
  load: () => Promise<void>
  add: (dto: { name?: string; email?: string; city?: string }) => Promise<void>
}

export const useContactsStore = create<ContactsState>((set) => ({
  items: [],
  total: 0,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const { items, total } = await fetchContacts()
      set({ items, total, loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof ApiError ? err.message : 'Не удалось загрузить контакты',
      })
    }
  },
  add: async (dto) => {
    await createContact(dto)
    await useContactsStore.getState().load()
  },
}))
