import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from '@/lib/api'
import type { Category } from './types'
import type { AuthSession } from '@/features/auth/types'
import { cacheCategories, loadCategories } from '@/lib/device-vault'

export function useCategories() {
  const client = useQueryClient()
  const owner = client.getQueryData<AuthSession>(['me'])?.user.id
  return useQuery({queryKey: ['categories'], queryFn: async () => {
    try {
      const categories = await get<Category[]>('/categories')
      if (owner) await cacheCategories(owner, categories)
      return categories
    } catch (error) {
      if (!(error instanceof TypeError) || !owner) throw error
      const saved = await loadCategories(owner)
      if (!saved) throw error
      return saved
    }
  }})
}
