import { useTranslation } from 'react-i18next'
import { ClipboardList, Droplets, Flame, Refrigerator, WashingMachine, Wind } from 'lucide-react'
import type { Status } from './types'

const icons = { refrigerator: Refrigerator, washer: WashingMachine, dryer: Wind, dishwasher: Droplets, cooktop: Flame }
export function ApplianceIcon({ code, size = 19 }: {code: string; size?: number}) {
  const Icon = icons[code as keyof typeof icons] ?? ClipboardList
  return <Icon size={size} aria-hidden="true" />
}

export function StatusPill({ status }: {status: Status}) {
  const { t } = useTranslation()
  return <span className="status" data-state={status}><i />{t('state.' + status)}</span>
}
