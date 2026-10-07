import { create } from 'zustand'
import {
  ApiError,
  createCampaign,
  fetchCampaigns,
  startCampaign,
  type Campaign,
} from '@/lib/api'

/** Состояние стора кампаний. */
interface CampaignsState {
  items: Campaign[]
  total: number
  loading: boolean
  error: string | null
  load: () => Promise<void>
  add: (dto: { name: string; channel: 'TELEGRAM' | 'MAX'; templateContent: string }) => Promise<void>
  start: (id: string) => Promise<string>
}

export const useCampaignsStore = create<CampaignsState>((set) => ({
  items: [],
  total: 0,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const { items, total } = await fetchCampaigns()
      set({ items, total, loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof ApiError ? err.message : 'Не удалось загрузить кампании',
      })
    }
  },
  add: async (dto) => {
    await createCampaign(dto)
    await useCampaignsStore.getState().load()
  },
  start: async (id) => {
    const result = await startCampaign(id)
    await useCampaignsStore.getState().load()
    return `В очередь: ${result.queued}, ошибок: ${result.failed}`
  },
}))
