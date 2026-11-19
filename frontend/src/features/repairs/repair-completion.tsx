import { ClipboardList, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Field, RequiredMark } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { emptyWorkLog, missingWorkLogFields, WorkLogForm } from './repair-work-log'
import type { Check, CheckStatus, Outcome, Repair, WorkLog } from './types'
import { useDeviceDraft } from './use-device-draft'

interface CompletionProps {
  step: 'work' | 'checklist' | 'review'
  repair: Repair
  ownerId?: string
  caseId: string
  busy: boolean
  usedAi: boolean
  save: (checks: Record<string, Check>) => void
  saveWork: (log: WorkLog, onSuccess: () => void) => void
  close: (feedback: unknown) => void
  continueDiagnosis: () => void
}

interface CloseDraft { outcome: Outcome | ''; rating: 'GOOD' | 'BAD' | ''; feedback: string }
const emptyCloseDraft: CloseDraft = {outcome: '', rating: '', feedback: ''}

export function RepairCompletion({step, repair, ownerId, caseId, busy, usedAi, save, saveWork, close, continueDiagnosis}: CompletionProps) {
  const { t } = useTranslation()
  const checklistDraft = useDeviceDraft(ownerId, 'checklist:' + caseId, repair.details.checks)
  const workLogDraft = useDeviceDraft<WorkLog | null>(ownerId, 'work-log:' + caseId, null)
  const closeDraft = useDeviceDraft<CloseDraft>(ownerId, 'close:' + caseId, emptyCloseDraft)
  const checks = checklistDraft.value
  const setChecks = checklistDraft.setValue
  const draft = workLogDraft.value
  const setDraft = workLogDraft.setValue
  const review = closeDraft.value
  const setReview = closeDraft.setValue
  const reviewModified = Boolean(review.outcome || review.rating || review.feedback.trim())
  const log = repair.details.workLog?.log
  const verification = log?.verification
  const logReady = missingWorkLogFields(log).length === 0
  const activeWorkLog = draft ?? log
  const workLogRequirements = missingWorkLogFields(activeWorkLog)
  const needsFinalVerification = activeWorkLog?.workStatus === 'NOT_PERFORMED' && !activeWorkLog.verification?.result
  const outcomes: Outcome[] = []
  if (verification?.result === 'PASSED') outcomes.push('RESOLVED')
  if (verification?.result === 'FAILED') outcomes.push('UNRESOLVED')
  if (verification?.result === 'NOT_PERFORMED') outcomes.push('UNVERIFIED', 'UNRESOLVED')
  const checklistReady = repair.checklist.every(item => ['CONFIRMED', 'NOT_APPLICABLE'].includes(repair.details.checks[item.id]?.status))
  const checklistModified = Object.keys(checks).length !== Object.keys(repair.details.checks).length ||
    Object.entries(checks).some(([id, value]) => {
      const saved = repair.details.checks[id]
      return saved?.status !== value.status || saved?.reason !== value.reason
    })
  const selectedOutcome = outcomes.length === 1 ? outcomes[0] : review.outcome
  const reviewReady = closeDraft.loaded && outcomes.includes(selectedOutcome as Outcome) &&
    (!usedAi || review.rating === 'GOOD' || review.rating === 'BAD')
  const canClose = checklistReady && !checklistModified && logReady && draft === null && reviewReady && !busy &&
    checklistDraft.loaded && workLogDraft.loaded && navigator.onLine && !repair.deviceState

  return <>
    {(checklistDraft.storageFailed || workLogDraft.storageFailed || closeDraft.storageFailed) &&
      <p className="notice notice-error" role="status">{t('offline.storageError')}</p>}
    {(step === 'work' || step === 'checklist') && checklistDraft.loaded && workLogDraft.loaded && !navigator.onLine &&
      <p className="notice" role="status">{checklistDraft.persistence === 'SAVING' || workLogDraft.persistence === 'SAVING'
        ? t('offline.savingOnDevice') : t('offline.savedOnDevice')} {t('offline.connectForNextStep')}</p>}
    {step === 'review' && closeDraft.loaded && !navigator.onLine &&
      <p className="notice" role="status">{closeDraft.persistence === 'SAVING' ? t('offline.savingOnDevice') : t('offline.savedOnDevice')} {t('offline.connectForNextStep')}</p>}
    {((step === 'work' && !workLogDraft.loaded) || (step === 'checklist' && !checklistDraft.loaded) ||
      (step === 'review' && !closeDraft.loaded)) && <p className="muted">{t('loading')}</p>}

    {step === 'work' && <>
      {(!logReady || draft !== null) && <div className="notice workflow-blocker" role="status">
        <strong>{t('workflow.workStepBlockedTitle')}</strong>
        <p>{needsFinalVerification ? t('workflow.notPerformedNeedsVerification')
          : draft !== null && workLogRequirements.length === 0 ? t('workflow.saveWorkToUnlock')
          : t('workflow.workFieldsToUnlock')}</p>
        {workLogRequirements.length > 0 && <ul>{workLogRequirements.map(requirement =>
          <li key={requirement}>{t('workflow.workLogRequirements.' + requirement)}</li>)}</ul>}
      </div>}
      <WorkLogForm log={draft ?? log ?? emptyWorkLog} busy={busy || !workLogDraft.loaded} modified={draft !== null} onChange={setDraft}
        onSave={() => { if (draft) saveWork(draft, () => setDraft(null)) }} />
      {draft !== null && <p className="notice" role="status">{t(workLogDraft.persistence === 'SAVING' ? 'workflow.savingDraft' : 'workflow.savedDraft')}</p>}
      {verification?.result === 'FAILED' && logReady && <Card className="form-panel">
        <h2>{t('followUp.failedTest')}</h2><p className="muted">{t('followUp.continueHelp')}</p>
        {!repair.details.demo && <p className="muted small">{t('followUp.openAiNotice')}</p>}
        {(draft !== null) && <p className="muted small">{t('followUp.saveBeforeContinuing')}</p>}
        <Button className="self-start" disabled={busy || draft !== null || !navigator.onLine || Boolean(repair.deviceState)} onClick={continueDiagnosis}>
          <RotateCcw size={16} />{t('followUp.continue')}
        </Button>
      </Card>}
      {logReady && draft === null && <p className="muted">{t('workflow.workSaved')}</p>}
    </>}

    {step === 'checklist' && <Card className="form-panel">
      <h2><ClipboardList size={19} />{t('completion')}</h2><p className="muted">{t('checklistHelp')}</p>
      <form className="fields" onSubmit={e => {e.preventDefault(); save(checks)}}>
        <fieldset className="fields" disabled={busy || !checklistDraft.loaded}>
          {repair.checklist.map(item => {
            const found = checks[item.id]
            return <fieldset key={item.id} className="question">
              <legend>{t('checklist.' + item.id)} <RequiredMark accessibleText={false} /></legend>
              <select className="control" aria-label={t('checklist.' + item.id)} required value={found?.status ?? ''}
                onChange={e => {
                  const status = e.target.value as CheckStatus | ''
                  if (!status) {
                    setChecks(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)))
                    return
                  }
                  setChecks(current => ({...current, [item.id]: {status, reason: ''}}))
                }}>
                <option value="">{t('choose')}</option><option value="CONFIRMED">{t('checkState.CONFIRMED')}</option>
                <option value="UNRESOLVED">{t('checkState.UNRESOLVED')}</option>
                {!item.alwaysRequired && <option value="NOT_APPLICABLE">{t('checkState.NOT_APPLICABLE')}</option>}
              </select>
              {found && found.status !== 'CONFIRMED' && <Field title={t('reason')}>
                <Input maxLength={500} value={found.reason} required onChange={e =>
                  setChecks(current => ({...current, [item.id]: {...found, reason: e.target.value}}))} />
              </Field>}
            </fieldset>
          })}
          <Button className="self-start" type="submit" variant="outline" disabled={busy || !checklistModified || !checklistDraft.loaded}>
            {t('saveChecklist')}
          </Button>
        </fieldset>
      </form>
      <p className="muted">{checklistModified ? t('workflow.checklistUnsaved') : checklistReady ? t('workflow.checklistSaved') : t('errors.checklistIncomplete')}</p>
    </Card>}

    {step === 'review' && <>
      {reviewModified && <p className="notice" role="status">{t(closeDraft.persistence === 'SAVING' ? 'workflow.savingDraft' : 'workflow.savedDraft')}</p>}
      <Card className="form-panel">
        <h2>{t('workflow.reviewTitle')}</h2>
        <dl className="details">
          <dt>{t('workLog.workStatus')}</dt><dd>{log?.workStatus ? t('workLog.workState.' + log.workStatus) : t('workflow.missing')}</dd>
          <dt>{t('workLog.verificationResult')}</dt><dd>{verification?.result ? t('workLog.result.' + verification.result) : t('workflow.missing')}</dd>
          <dt>{t('completion')}</dt><dd>{checklistReady ? t('workflow.checklistSaved') : t('errors.checklistIncomplete')}</dd>
        </dl>
        <ul className="workflow-requirements">
          {!logReady && <li><Link to={'/repairs/' + caseId + '/work'}>{t('errors.repairLogIncomplete')}</Link></li>}
          {draft !== null && <li><Link to={'/repairs/' + caseId + '/work'}>{t('workflow.saveWorkDraft')}</Link></li>}
          {checklistModified && <li><Link to={'/repairs/' + caseId + '/checklist'}>{t('workflow.checklistUnsaved')}</Link></li>}
          {!checklistReady && repair.checklist.filter(item => !['CONFIRMED', 'NOT_APPLICABLE'].includes(checks[item.id]?.status))
            .map(item => <li key={item.id}><Link to={'/repairs/' + caseId + '/checklist'}>
              {t('workflow.checklistItemRequired', {item: t('checklist.' + item.id)})}</Link></li>)}
          {outcomes.length > 0 && !outcomes.includes(selectedOutcome as Outcome) && <li>{t('workflow.outcomeRequired')}</li>}
          {usedAi && review.rating !== 'GOOD' && review.rating !== 'BAD' && <li>{t('workflow.ratingRequired')}</li>}
          {!navigator.onLine && <li>{t('offline.connectForNextStep')}</li>}
        </ul>
      </Card>
      <Card className="form-panel">
        <h2>{t('workflow.closeTitle')}</h2>
        {outcomes.length === 0
          ? <p className="muted">{t('workflow.completeWorkFirst')}</p>
          : outcomes.length === 1
          ? <dl className="details"><dt>{t('outcome')}</dt><dd>{t('outcomeValue.' + outcomes[0])}</dd></dl>
          : <Field title={t('outcome')} required><select className="control" required value={review.outcome} onChange={e =>
            setReview(current => ({...current, outcome: e.target.value as Outcome | ''}))}>
            <option value="">{t('choose')}</option>{outcomes.map(value =>
              <option key={value} value={value}>{t('outcomeValue.' + value)}</option>)}
          </select></Field>}
        {usedAi && <Field title={t('rating')} required><select className="control" required value={review.rating} onChange={e =>
          setReview(current => ({...current, rating: e.target.value as CloseDraft['rating']}))}>
          <option value="">{t('choose')}</option><option value="GOOD">{t('ratingValue.GOOD')}</option><option value="BAD">{t('ratingValue.BAD')}</option>
        </select></Field>}
        <Field title={t('feedback') + ' · ' + t('optional')}><textarea className="control" rows={3} maxLength={2000}
          value={review.feedback} onChange={e => setReview(current => ({...current, feedback: e.target.value}))} /></Field>
        <Button className="self-start" disabled={!canClose} onClick={() => close({
          outcome: selectedOutcome, rating: usedAi ? review.rating : 'NOT_USED', feedback: review.feedback,
        })}>{t('close')}</Button>
      </Card>
    </>}

    {step === 'review' && repair.status === 'CLOSED' && repair.details.feedback && <Card className="form-panel">
      <h2>{t('completed')}</h2>
      <dl className="details"><dt>{t('outcome')}</dt><dd>{t('outcomeValue.' + repair.details.feedback.outcome)}</dd>
        <dt>{t('rating')}</dt><dd>{t('ratingValue.' + repair.details.feedback.rating)}</dd>
        {repair.details.feedback.feedback && <><dt>{t('feedback')}</dt><dd>{repair.details.feedback.feedback}</dd></>}</dl>
      <ul className="steps">{repair.checklist.map(item => <li key={item.id}>{t('checklist.' + item.id)} <strong>{t('checkState.' + repair.details.checks[item.id]?.status)}</strong></li>)}</ul>
    </Card>}
  </>
}
