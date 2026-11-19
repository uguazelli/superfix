import { useEffect, useState } from 'react'
import { loadDraft, removeDraft, saveDraft } from '@/lib/device-vault'

export function useDeviceDraft<T>(ownerId: string | undefined, key: string, initial: T) {
  const [value, setValue] = useState(initial)
  const [loaded, setLoaded] = useState(false)
  const [persistence, setPersistence] = useState<'LOADING' | 'SAVING' | 'SAVED' | 'ERROR'>('LOADING')

  useEffect(() => {
    let current = true
    if (!ownerId) {
      setLoaded(true)
      setPersistence('SAVED')
      return () => { current = false }
    }
    void loadDraft<T>(ownerId, key).then(draft => {
      if (current && draft !== undefined) setValue(draft)
      if (current) setLoaded(true)
      if (current) setPersistence('SAVED')
    }).catch(() => {
      if (current) {
        setPersistence('ERROR')
        setLoaded(true)
      }
    })
    return () => { current = false }
  }, [ownerId, key])

  useEffect(() => {
    if (!ownerId || !loaded) return
    setPersistence('SAVING')
    const timer = window.setTimeout(() => {
      void saveDraft(ownerId, key, value).then(() => setPersistence('SAVED')).catch(() => setPersistence('ERROR'))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [ownerId, key, loaded, value])

  const clear = () => {
    if (ownerId) {
      setPersistence('SAVING')
      void removeDraft(ownerId, key).then(() => setPersistence('SAVED')).catch(() => setPersistence('ERROR'))
    }
  }

  return {value, setValue, clear, loaded, persistence, storageFailed: persistence === 'ERROR'}
}
