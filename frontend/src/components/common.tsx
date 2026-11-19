import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowLeft, ArrowRight, LoaderCircle, Wrench } from 'lucide-react'
import { ApiError } from '@/lib/api'
import type { AppLocale } from '@/app/i18n'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

export function Brand() {
  return <div className="brand"><span className="brand-icon"><Wrench size={19} /></span><span>SuperFix</span></div>
}

export function ErrorNotice({ error }: {error: unknown}) {
  const { t } = useTranslation()
  if (!error) return null
  return <div className="notice notice-error" role="alert"><AlertCircle size={17} />
    {t('errors.' + (error instanceof ApiError ? error.code : 'generic'), {defaultValue: t('errors.generic')})}
  </div>
}

export function Loading({ label }: {label?: string}) {
  const { t } = useTranslation()
  return <p className="loading" role="status"><LoaderCircle size={18} className="animate-spin" />{label ?? t('loading')}</p>
}

export function LanguagePicker({ value, onChange, disabled = false, className }: {
  value: AppLocale; onChange: (locale: AppLocale) => void; disabled?: boolean; className?: string
}) {
  const { t } = useTranslation()
  return <label className={cn('language-setting', className)}>
    <span>{t('language')}</span>
    <select className="language-control" aria-label={t('language')} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as AppLocale)}>
      <option value="en">{t('languages.en')}</option>
      <option value="pt-BR">{t('languages.pt-BR')}</option>
      <option value="es">{t('languages.es')}</option>
    </select>
  </label>
}

type FieldControlProps = {id?: string; required?: boolean; 'aria-required'?: boolean}

export function Field({ title, children, required }: {
  title: ReactNode; children: ReactElement<FieldControlProps>; required?: boolean
}) {
  const { t } = useTranslation()
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  const isRequired = required ?? Boolean(children.props.required)
  return <div className="field"><label htmlFor={id}>{title}{isRequired && <RequiredMark label={t('required')} accessibleText={false} />}</label>
    {cloneElement(children, {id, ...(isRequired ? {'aria-required': true} : {})})}</div>
}

export function RequiredMark({ label, accessibleText = true }: {label?: string; accessibleText?: boolean} = {}) {
  const { t } = useTranslation()
  return <><span className="required-mark" aria-hidden="true">*</span>
    {accessibleText && <span className="sr-only">{label ?? t('required')}</span>}</>
}

export function Pager({ page, total, setPage }: {page: number; total: number; setPage: (page: number) => void}) {
  const { t } = useTranslation()
  if (total < 2) return null
  return <nav className="pager">
    <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={15} />{t('previous')}</Button>
    <span>{t('page', {number: page + 1, total})}</span>
    <Button variant="outline" disabled={page + 1 >= total} onClick={() => setPage(page + 1)}>{t('next')}<ArrowRight size={15} /></Button>
  </nav>
}
