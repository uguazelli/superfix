import { useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorNotice, Field, Loading } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApplianceIcon } from './repair-display'
import type { Intake } from './types'
import { useCategories } from './use-categories'
import { useDeviceDraft } from './use-device-draft'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthSession } from '@/features/auth/types'

const emptyIntake: Intake = {
  category: null, symptoms: '', brand: '', model: '', fuel: null, hazard: null,
  serialNumber: '', modelConfirmed: false, diagnosticTopic: '',
}

export function IntakeForm({ initial = emptyIntake, draftKey = 'new-intake', onSubmit, pending, error, submitLabel, cancel }: {
  initial?: Intake; draftKey?: string; onSubmit: (input: Intake, modelPlate?: File) => void
  pending: boolean; error: unknown; submitLabel: string; cancel?: () => void
}) {
  const { t } = useTranslation()
  const owner = useQueryClient().getQueryData<AuthSession>(['me'])?.user.id
  const intakeDraft = useDeviceDraft(owner, draftKey, initial)
  const plateDraft = useDeviceDraft<File | undefined>(owner, draftKey + ':model-plate', undefined)
  const data = intakeDraft.value
  const setData = intakeDraft.setValue
  const initialValues = useRef(initial)
  useEffect(() => {
    if (!intakeDraft.loaded) return
    const previous = initialValues.current
    setData(current => {
      const next = {...current}
      for (const key of Object.keys(initial) as (keyof Intake)[]) {
        if (current[key] === previous[key]) Object.assign(next, {[key]: initial[key]})
      }
      return next
    })
    initialValues.current = initial
  }, [initial, intakeDraft.loaded, setData])
  const modelPlate = plateDraft.value
  const setModelPlate = plateDraft.setValue
  const categories = useCategories()
  const set = (value: Partial<Intake>) => setData(current => ({...current, ...value}))
  const fuel = ['dryer', 'cooktop'].includes(data.category ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit({...data, fuel: fuel ? data.fuel : null}, modelPlate)
  }

  return <form onSubmit={submit} className="fields">
    <fieldset className="fields" disabled={!intakeDraft.loaded || pending}>
    <fieldset><legend>{t('appliance')} · {t('optional')}</legend><div className="category-grid">
      {categories.data?.map(c => <label key={c.code} className="category-tile">
        <input type="radio" name="category" checked={data.category === c.code} onChange={() =>
          set({category: c.code, fuel: null, diagnosticTopic: c.code === 'refrigerator' ? data.diagnosticTopic : ''})} />
        <ApplianceIcon code={c.code} size={24} /><span>{t('categories.' + c.code, c.label)}</span>
      </label>)}
    </div></fieldset>
    {categories.isPending && <Loading />}
    <div className="form-grid">
      <Field title={t('brand') + ' · ' + t('optional')}><Input value={data.brand ?? ''} maxLength={120} onChange={e => set({brand: e.target.value})} /></Field>
      <Field title={t('model') + (data.modelConfirmed ? '' : ' · ' + t('optional'))}><Input value={data.model ?? ''} maxLength={120} required={Boolean(data.modelConfirmed)}
        onChange={e => set({model: e.target.value})} /></Field>
      <Field title={t('serialNumber') + ' · ' + t('optional')}><Input value={data.serialNumber ?? ''} maxLength={120}
        onChange={e => set({serialNumber: e.target.value})} /></Field>
    </div>
    <label className="check-row"><input type="checkbox" checked={data.modelConfirmed ?? false}
      onChange={e => set({modelConfirmed: e.target.checked})} />{t('modelConfirmed')}</label>
    {data.modelConfirmed && <Field title={t('modelPlatePhoto') + ' · ' + t('optional')}>
      <Input type="file" accept="image/jpeg,image/png" onChange={event => setModelPlate(event.currentTarget.files?.[0])} />
    </Field>}
    {data.category === 'refrigerator' && <Field title={t('diagnosticTopic') + ' · ' + t('optional')}>
      <select className="control" value={data.diagnosticTopic ?? ''} onChange={e => set({diagnosticTopic: e.target.value})}>
        <option value="">{t('choose')}</option><option value="refrigerator-warm">{t('refrigeratorWarm')}</option>
      </select>
    </Field>}
    {data.diagnosticTopic === 'refrigerator-warm' && <p className="notice">
      {data.model?.trim().toUpperCase() === 'SUPERFIX-TRAINING-R1' ? t('trainingGuideNotice') : t('genericGuideNotice')}
    </p>}
    {fuel && <Field title={t('fuel') + ' · ' + t('optional')}><select className="control" value={data.fuel ?? ''} onChange={e => set({fuel: (e.target.value || null) as Intake['fuel']})}>
      <option value="">{t('choose')}</option>
      {['ELECTRIC', 'GAS', 'DUAL', 'UNKNOWN'].map(value => <option key={value} value={value}>{t('fuelTypes.' + value)}</option>)}
    </select></Field>}
    <Field title={t('symptom') + ' · ' + t('optional')}>
      <textarea className="control" value={data.symptoms} maxLength={4000} onChange={e => set({symptoms: e.target.value})}
        placeholder={t('symptomsPlaceholder')} rows={5} />
    </Field>
    <Field title={t('hazard') + ' · ' + t('optional')}><select className="control" value={data.hazard === null ? '' : String(data.hazard)}
      onChange={e => set({hazard: e.target.value === '' ? null : e.target.value === 'true'})}>
      <option value="">{t('hazardUnknown')}</option><option value="false">{t('hazardNotSuspected')}</option><option value="true">{t('hazardSuspected')}</option>
    </select>
    </Field><p className="muted small">{t('hazardHelp')}</p>
    </fieldset>
    <ErrorNotice error={error || categories.error} />
    {intakeDraft.storageFailed && <p className="notice notice-error" role="status">{t('offline.storageError')}</p>}
    {intakeDraft.loaded && !navigator.onLine && intakeDraft.persistence === 'SAVING' && <p className="notice" role="status">{t('offline.savingOnDevice')}</p>}
    {intakeDraft.loaded && !navigator.onLine && intakeDraft.persistence === 'SAVED' && <p className="notice" role="status">{t('offline.savedOnDevice')}</p>}
    <div className="actions">
      <Button type="submit" disabled={pending || !intakeDraft.loaded}>{t(pending ? 'working' : submitLabel)}</Button>
      {cancel && <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>}
    </div>
  </form>
}
