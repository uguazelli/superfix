import { ClipboardCheck, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Field, RequiredMark } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { canonicalDecimal, decimalInputPattern, localizedDecimal } from '@/lib/decimal'
import type { Part, Reading, VerificationResult, WorkLog, WorkStatus } from './types'

const workStatuses: WorkStatus[] = ['PERFORMED', 'NOT_PERFORMED']
const verificationResults: VerificationResult[] = ['PASSED', 'FAILED', 'NOT_PERFORMED']

export type WorkLogRequirement = 'workStatus' | 'workPerformed' | 'verificationResult' | 'verificationNotes' | 'verificationReason'

export function missingWorkLogFields(log: WorkLog | null | undefined): WorkLogRequirement[] {
  const missing: WorkLogRequirement[] = []
  const workStatus = log?.workStatus
  const verification = log?.verification
  if (!workStatus) missing.push('workStatus')
  if (workStatus === 'PERFORMED' && !log?.workPerformed?.trim()) missing.push('workPerformed')
  if (!verification?.result) missing.push('verificationResult')
  else if (!verification.notes?.trim()) {
    missing.push(verification.result === 'NOT_PERFORMED' ? 'verificationReason' : 'verificationNotes')
  }
  return missing
}

export const emptyWorkLog: WorkLog = {
  confirmedFault: '', confirmedCauseCode: null, workStatus: null, workPerformed: '', parts: [], readings: [], verification: null,
}

interface WorkLogFormProps {
  log: WorkLog
  busy: boolean
  modified: boolean
  onChange: (log: WorkLog) => void
  onSave: () => void
}

export function WorkLogForm({ log, busy, modified, onChange, onSave }: WorkLogFormProps) {
  const { t, i18n } = useTranslation()
  function update(patch: Partial<WorkLog>) {
    onChange({...log, ...patch})
  }
  function updatePart(index: number, patch: Partial<Part>) {
    update({parts: log.parts.map((part, i) => i === index ? {...part, ...patch} : part)})
  }
  function updateReading(index: number, patch: Partial<Reading>) {
    update({readings: log.readings.map((reading, i) => i === index ? {...reading, ...patch} : reading)})
  }
  const partsWithoutWork = log.workStatus === 'NOT_PERFORMED' && log.parts.length > 0
  const readingMissingValue = log.readings.some(reading => reading.beforeValue == null && reading.afterValue == null)

  return <Card className="form-panel">
    <h2><ClipboardCheck size={19} />{t('workLog.title')}</h2>
    <form onSubmit={event => { event.preventDefault(); onSave() }}>
      <fieldset className="fields" disabled={busy}>
        <Field title={t('workLog.confirmedFault') + ' · ' + t('optional')}>
          <textarea className="control" rows={2} maxLength={1000} value={log.confirmedFault ?? ''}
            onChange={e => update({confirmedFault: e.target.value})} />
        </Field>
        <Field title={t('workLog.confirmedCause') + ' · ' + t('optional')}>
          <select className="control" value={log.confirmedCauseCode ?? ''} onChange={e =>
            update({confirmedCauseCode: e.target.value || null})}>
            <option value="">{t('choose')}</option>
            {['SETTINGS', 'INSTALLATION', 'CLOSURE', 'COMPONENT', 'OTHER'].map(code =>
              <option key={code} value={code}>{t('causeCode.' + code)}</option>)}
          </select>
        </Field>
        <Field title={t('workLog.workStatus')} required>
          <select className="control" value={log.workStatus ?? ''} onChange={e => update({workStatus: (e.target.value || null) as WorkStatus | null})}>
            <option value="">{t('choose')}</option>
            {workStatuses.map(status => <option key={status} value={status}>{t('workLog.workState.' + status)}</option>)}
          </select>
        </Field>
        {log.workStatus && <Field title={t(log.workStatus === 'PERFORMED' ? 'workLog.workPerformed' : 'workLog.noWorkNotes')}
          required={log.workStatus === 'PERFORMED'}>
          <textarea className="control" rows={3} maxLength={4000} value={log.workPerformed ?? ''}
            onChange={e => update({workPerformed: e.target.value})} />
        </Field>}

        <div className="fields">
          <div className="box-head tight"><h3>{t('workLog.parts')}</h3>
            <Button variant="outline" disabled={log.parts.length >= 20 || log.workStatus === 'NOT_PERFORMED'}
              onClick={() => update({parts: [...log.parts, {name: '', partNumber: '', quantity: 1}]})}>
              <Plus size={15} />{t('workLog.addPart')}
            </Button>
          </div>
          {partsWithoutWork && <p className="muted">{t('errors.partsWithoutWork')}</p>}
          {log.parts.map((part, index) => <fieldset className="question" key={index}>
            <legend>{t('workLog.partIndex', {number: index + 1})}</legend>
            <Field title={t('workLog.partName')}>
              <Input value={part.name} maxLength={120} required onChange={e => updatePart(index, {name: e.target.value})} />
            </Field>
            <div className="form-grid">
              <Field title={t('workLog.partNumber') + ' · ' + t('optional')}>
                <Input value={part.partNumber ?? ''} maxLength={120} onChange={e => updatePart(index, {partNumber: e.target.value})} />
              </Field>
              <Field title={t('workLog.quantity')}>
                <Input type="number" min={1} max={999} step={1} required value={part.quantity || ''}
                  onChange={e => updatePart(index, {quantity: Number(e.target.value)})} />
              </Field>
            </div>
            <Button className="self-start" variant="ghost" onClick={() => update({parts: log.parts.filter((_, i) => i !== index)})}>
              {t('workLog.removePart')}
            </Button>
          </fieldset>)}
        </div>

        <div className="fields">
          <div className="box-head tight"><h3>{t('workLog.readings')}</h3>
            <Button variant="outline" disabled={log.readings.length >= 20}
              onClick={() => update({readings: [...log.readings, {name: '', unit: '', beforeValue: null, afterValue: null}]})}>
              <Plus size={15} />{t('workLog.addReading')}
            </Button>
          </div>
          {readingMissingValue && <p className="muted">{t('errors.readingRequired')}</p>}
          {log.readings.map((reading, index) => <fieldset className="question" key={index}>
            <legend>{t('workLog.readingIndex', {number: index + 1})} <RequiredMark /></legend>
            <div className="form-grid">
              <Field title={t('workLog.readingName')}>
                <Input value={reading.name} maxLength={120} required onChange={e => updateReading(index, {name: e.target.value})} />
              </Field>
              <Field title={t('workLog.unit') + ' · ' + t('optional')}>
                <Input value={reading.unit ?? ''} maxLength={24} onChange={e => updateReading(index, {unit: e.target.value})} />
              </Field>
              <Field title={t('workLog.before')}>
                <Input type="text" inputMode="decimal" value={localizedDecimal(reading.beforeValue, i18n.language)} pattern={decimalInputPattern}
                  onChange={e => updateReading(index, {beforeValue: e.target.value ? canonicalDecimal(e.target.value) : null})} />
              </Field>
              <Field title={t('workLog.after')}>
                <Input type="text" inputMode="decimal" value={localizedDecimal(reading.afterValue, i18n.language)} pattern={decimalInputPattern}
                  onChange={e => updateReading(index, {afterValue: e.target.value ? canonicalDecimal(e.target.value) : null})} />
              </Field>
            </div>
            <Button className="self-start" variant="ghost" onClick={() => update({readings: log.readings.filter((_, i) => i !== index)})}>
              {t('workLog.removeReading')}
            </Button>
          </fieldset>)}
        </div>

        <fieldset className="question">
          <legend>{t('workLog.verification')}</legend>
          <Field title={t('workLog.verificationResult')} required>
            <select className="control" value={log.verification?.result ?? ''} onChange={e => {
              const result = e.target.value as VerificationResult | ''
              update({verification: result ? {result, notes: log.verification?.notes ?? ''} : null})
            }}>
              <option value="">{t('choose')}</option>
              {verificationResults.map(result => <option key={result} value={result}>{t('workLog.result.' + result)}</option>)}
            </select>
          </Field>
          {!log.verification?.result && <p className="muted small">{t('workflow.finalVerificationRequired')}</p>}
          {log.verification && <Field title={t(log.verification.result === 'NOT_PERFORMED' ? 'workLog.testReason' : 'workLog.testNotes')} required>
            <textarea className="control" rows={3} maxLength={2000} value={log.verification.notes ?? ''}
              onChange={e => {
                if (log.verification) update({verification: {...log.verification, notes: e.target.value}})
              }} />
          </Field>}
          {log.verification && !log.verification.notes?.trim() && <p className="muted small">
            {t(log.verification.result === 'NOT_PERFORMED'
              ? 'workflow.finalVerificationReasonRequired' : 'workflow.finalVerificationNotesRequired')}
          </p>}
        </fieldset>
        <Button className="self-start" type="submit" disabled={!modified || partsWithoutWork || readingMissingValue}>{t('workLog.save')}</Button>
      </fieldset>
    </form>
  </Card>
}

export function WorkLogSummary({ log }: {log: WorkLog}) {
  const { t } = useTranslation()
  return <Card className="form-panel">
    <h2><ClipboardCheck size={19} />{t('workLog.title')}</h2>
    <WorkLogDetails log={log} />
  </Card>
}

export function WorkLogDetails({ log }: {log: WorkLog}) {
  const { t, i18n } = useTranslation()
  return <>
    <dl className="details">
      <dt>{t('workLog.confirmedFault')}</dt><dd>{log.confirmedFault?.trim() || t('workLog.faultUnconfirmed')}</dd>
      {log.confirmedCauseCode && <><dt>{t('workLog.confirmedCause')}</dt><dd>{t('causeCode.' + log.confirmedCauseCode)}</dd></>}
      <dt>{t('workLog.workStatus')}</dt><dd>{t('workLog.workState.' + log.workStatus)}</dd>
      {log.workPerformed?.trim() && <><dt>{t(log.workStatus === 'PERFORMED' ? 'workLog.workPerformed' : 'workLog.noWorkNotes')}</dt>
        <dd>{log.workPerformed}</dd></>}
      {log.verification && <>
        <dt>{t('workLog.verificationResult')}</dt><dd>{t('workLog.result.' + log.verification.result)}</dd>
        <dt>{t(log.verification.result === 'NOT_PERFORMED' ? 'workLog.testReason' : 'workLog.testNotes')}</dt><dd>{log.verification.notes}</dd>
      </>}
    </dl>
    {!!log.parts.length && <><h3>{t('workLog.parts')}</h3><ul className="evidence">
      {log.parts.map((part, i) => <li key={i}>{part.name}{part.partNumber && ' · ' + part.partNumber} × {part.quantity}</li>)}
    </ul></>}
    {!!log.readings.length && <><h3>{t('workLog.readings')}</h3><dl className="details">
      {log.readings.map((reading, i) => {
        const values = []
        if (reading.beforeValue !== null) values.push(t('workLog.before') + ' ' + [localizedDecimal(reading.beforeValue, i18n.language), reading.unit].filter(Boolean).join(' '))
        if (reading.afterValue !== null) values.push(t('workLog.after') + ' ' + [localizedDecimal(reading.afterValue, i18n.language), reading.unit].filter(Boolean).join(' '))
        return <div key={i}><dt>{reading.name}</dt><dd>{values.join(' · ')}</dd></div>
      })}
    </dl></>}
  </>
}
