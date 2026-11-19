import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { es } from './es'
import { pt } from './pt'
import type { DeepStringify } from './locale-types'

export const supportedLocales = ['en', 'pt-BR', 'es'] as const
export type AppLocale = typeof supportedLocales[number]
const preferenceKey = 'superfix:locale'
const pendingPreferenceKey = 'superfix:locale-pending'
const resources = {
  en: { translation: en },
  'pt-BR': { translation: pt as DeepStringify<typeof en> },
  es: { translation: es as DeepStringify<typeof en> },
}

export function normalizeLocale(value: string | null | undefined): AppLocale {
  const locale = value?.trim().toLowerCase()
  if (locale === 'pt' || locale?.startsWith('pt-')) return 'pt-BR'
  if (locale === 'es' || locale?.startsWith('es-')) return 'es'
  return 'en'
}

function storedLocale(key: string): AppLocale | null {
  try {
    const value = localStorage.getItem(key)
    return value ? normalizeLocale(value) : null
  } catch {
    return null
  }
}

function initialLocale(): AppLocale {
  const saved = storedLocale(preferenceKey)
  if (saved) return saved
  for (const language of navigator.languages ?? [navigator.language]) {
    if (language.toLowerCase().startsWith('pt')) return 'pt-BR'
    if (language.toLowerCase().startsWith('es')) return 'es'
  }
  return 'en'
}

void i18n.use(initReactI18next).init({
  lng: initialLocale(),
  fallbackLng: 'en',
  supportedLngs: [...supportedLocales],
  load: 'currentOnly',
  resources,
  interpolation: { escapeValue: false },
})

export async function changeLanguage(locale: AppLocale): Promise<void> {
  await i18n.changeLanguage(locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  try { localStorage.setItem(preferenceKey, locale) } catch { /* Keep the current language for this session. */ }
}

export function markLocalePending(locale: AppLocale): void {
  try {
    localStorage.setItem(preferenceKey, locale)
    localStorage.setItem(pendingPreferenceKey, locale)
  } catch { /* The language remains active for this session. */ }
}

export function pendingLocale(): AppLocale | null {
  return storedLocale(pendingPreferenceKey)
}

export function clearPendingLocale(): void {
  try { localStorage.removeItem(pendingPreferenceKey) } catch { /* Ignore unavailable browser storage. */ }
}

export default i18n
