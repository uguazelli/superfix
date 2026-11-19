import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Camera, Check, CheckCheck, CircleAlert, ClipboardList, LockKeyhole, Pause, Play, Sparkles } from 'lucide-react'
import { ErrorNotice, Field, Loading } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ApiError, get, send } from '@/lib/api'
import { canonicalDecimal, decimalInputPattern, localizedDecimal } from '@/lib/decimal'
import type { AuthSession } from '@/features/auth/types'
import {
  loadCase, queueCaseOperation, removeDraft, removeCase, resolveCaseConflict, saveCachedCase,
  saveCase, setCaseConflict, type CachedCase, type PendingOperation,
} from '@/lib/device-vault'
import { IntakeForm } from './intake-form'
import { ConversationPanel } from './conversation-panel'
import { RepairCompletion } from './repair-completion'
import { missingWorkLogFields, WorkLogDetails, WorkLogSummary } from './repair-work-log'
import { ApplianceIcon, StatusPill } from './repair-display'
import type { Answer, AnswerStatus, ConversationView, Decision, Intake, Question, Repair, Round, WorkLog } from './types'
import { useCategories } from './use-categories'
import { useDeviceDraft } from './use-device-draft'
import { ApplianceHistory, ApplianceLinkPanel, CallbackForm, HandoffPanel, RepairTimeline, ReturnVisitPanel } from './repair-operations'

type Change = {path: string; method: string; value?: unknown; idempotencyKey?: string; photo?: File; photoKind?: 'SYMPTOM' | 'MODEL_PLATE'}

export function RepairDetailPage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const client = useQueryClient()
  const ownerId = client.getQueryData<AuthSession>(['me'])?.user.id
  const query = useQuery({
    queryKey: ['repair', id], queryFn: async () => {
      const cached = id && ownerId ? await loadCase(ownerId, id) : undefined
      try {
        const server = await get<Repair>('/cases/' + id)
        if (cached?.localOnly) return cached.repair
        if (cached?.operations.length) return cached.repair
        if (ownerId) await saveCase(ownerId, server)
        return server
      } catch (error) {
        if (cached?.operations.length && !cached.localOnly && error instanceof ApiError && error.status === 404 && ownerId && id) {
          await removeCase(ownerId, id)
        }
        if (!cached || (!(error instanceof TypeError) &&
            !(cached.localOnly && error instanceof ApiError && error.status === 404))) throw error
        return {...cached.repair, deviceState: cached.conflict ? 'CONFLICT' as const : cached.localOnly || cached.operations.length ? 'PENDING' as const : undefined,
          conflictServer: cached.serverRepair}
      }
    }, enabled: Boolean(id),
    refetchInterval: ({state}) => state.data?.status === 'PROCESSING' ? 1000 : false,
  })
  useEffect(() => {
    const reconnect = () => { void client.invalidateQueries({queryKey: ['me']}) }
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [client])
  return <>
    <Link className="back-link" to="/repairs"><ArrowLeft size={16} />{t('backToRepairs')}</Link>
    <ErrorNotice error={query.error} />
    {query.isPending && <Loading />}
    {query.data && <Case key={query.data.id} repair={query.data} />}
  </>
}

function Case({ repair }: {repair: Repair}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()
  const session = client.getQueryData<AuthSession>(['me'])
  const ownerId = session?.user.id
  const isCompanyAdmin = session?.user.role === 'COMPANY_ADMIN'
  const canDeleteArchived = isCompanyAdmin || repair.technicianId === ownerId
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const [syncingNow, setSyncingNow] = useState(false)
  const [justSynced, setJustSynced] = useState(false)
  const [syncAttempt, setSyncAttempt] = useState(0)
  const syncing = useRef(false)
  const categories = useCategories()
  const { details, status, id, version } = repair
  const requestedStep = location.pathname.split('/').filter(Boolean)[2]
  const currentStep = workflowStep(repair, requestedStep)
  useEffect(() => {
    if (repair.deviceState === 'CONFLICT' || !requestedStep || requestedStep === currentStep) return
    navigate('/repairs/' + id + '/' + currentStep, {replace: true})
  }, [currentStep, id, navigate, repair.deviceState, requestedStep])
  const base = '/cases/' + id
  const round = details.rounds.at(-1)
  const attempts = details.attempts ?? []
  const label = repair.category
    ? t('categories.' + repair.category, categories.data?.find(c => c.code === repair.category)?.label ?? repair.category)
    : t('categories.unknown')
  const findingCause = (finding: Repair['details']['finding']) => {
    if (!finding) return ''
    if (finding.translationKey) return t('guideResult.' + finding.translationKey + '.cause', finding.cause)
    if (finding.causeCode && finding.causeCode !== 'OTHER') return t('diagnosis.causes.' + finding.causeCode, finding.cause)
    return finding.cause
  }
  const findingDetails = (finding: NonNullable<Repair['details']['finding']>) => {
    const guidePrefix = finding.translationKey ? 'guideResult.' + finding.translationKey : null
    const genericPrefix = finding.causeCode && finding.causeCode !== 'OTHER' ? 'diagnosis.' + finding.causeCode : null
    const evidence = finding.evidenceQuestionIds?.length
      ? finding.evidenceQuestionIds.map((questionId, index) => {
          const sourceRound = [...details.rounds].reverse().find(item =>
            item.answers[questionId]?.status === 'ANSWERED' && item.questions.some(question => question.id === questionId))
          const question = sourceRound?.questions.find(item => item.id === questionId)
          const answer = sourceRound?.answers[questionId]
          if (!question || !answer) return finding.evidence[index] ?? ''
          let value = answer.value
          if (question.type === 'CHOICE') value = t('choice.' + value, value)
          else if (question.type === 'YES_NO' || question.type === 'CONFIRMATION') value = t(value, value)
          else if (question.type === 'NUMBER') value = localizedDecimal(value, i18n.language)
          const unit = question.unit ? t('units.' + question.unit, question.unit) : ''
          return `${t('question.' + question.id, question.label)}: ${[value, unit].filter(Boolean).join(' ')}`
        })
      : finding.evidence
    return {
      cause: findingCause(finding),
      evidence,
      limitation: guidePrefix ? t(guidePrefix + '.limitation', finding.limitation)
        : genericPrefix ? t('diagnosis.limitation', finding.limitation) : finding.limitation,
      steps: finding.steps.map((step, index) => guidePrefix ? t(guidePrefix + '.steps.' + index, step)
        : genericPrefix ? t('diagnosis.steps.' + finding.causeCode + '.' + index, step) : step),
    }
  }
  const archivedDate = repair.archivedAt
    ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'}).format(new Date(repair.archivedAt)) : null
  const queueLocal = async (command: Change) => {
    if (!ownerId) throw new TypeError('No active technician')
    const current = client.getQueryData<Repair>(['repair', id]) ?? repair
    const operation: PendingOperation = {
      path: command.path, method: command.method, value: command.value,
      idempotencyKey: command.idempotencyKey ?? crypto.randomUUID(),
      photo: command.photo, photoName: command.photo?.name, photoKind: command.photoKind,
    }
    const optimistic = applyOfflineOperation(current, operation, ownerId)
    const entry = await queueCaseOperation(ownerId, current, operation, optimistic)
    return entry.repair
  }
  const mutation = useMutation({
    mutationFn: async (command: Change) => {
      const pending = ownerId ? await loadCase(ownerId, id) : undefined
      const queueable = isOfflineSave(command)
      if (queueable && (pending?.localOnly || pending?.operations.length)) return queueLocal(command)
      if (queueable && !navigator.onLine) return queueLocal(command)
      try {
        const body = command.photo ? photoForm(command.photo, command.photoKind ?? 'SYMPTOM') : command.value
        return await send<Repair>(base + command.path, command.method, body, {idempotencyKey: command.idempotencyKey})
      } catch (error) {
        if (queueable && error instanceof TypeError) return queueLocal(command)
        throw error
      }
    },
    onMutate: () => setSaved(false),
    onSuccess: async (next, command) => {
      client.setQueryData(['repair', id], next)
      if (ownerId && next.deviceState !== 'PENDING' && next.deviceState !== 'CONFLICT') await saveCase(ownerId, next)
      if (ownerId && command.path.startsWith('?')) await removeDraft(ownerId, 'intake:' + id)
      if (ownerId && command.path === '/answers' && round) await removeDraft(ownerId, 'round:' + id + ':' + round.number)
      if (ownerId && command.path === '/diagnostic' && round) await removeDraft(ownerId, 'round:' + id + ':' + round.number)
      if (ownerId && command.path === '/checklist') await removeDraft(ownerId, 'checklist:' + id)
      if (ownerId && command.path === '/work-log') await removeDraft(ownerId, 'work-log:' + id)
      if (ownerId && command.path.startsWith('/close')) await removeDraft(ownerId, 'close:' + id)
      void client.invalidateQueries({queryKey: ['repairs']})
      if (command.path.startsWith('?')) setEditing(false)
      if (['/answers', '/checklist', '/work-log'].includes(command.path)) setSaved(true)
    },
    onError: () => { void client.invalidateQueries({queryKey: ['repair', id]}) },
  })
  const deleteArchivedMutation = useMutation({
    mutationFn: async () => {
      try {
        await send<void>(base + '?version=' + version, 'DELETE')
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error
      }
    },
    onSuccess: async () => {
      if (ownerId) {
        await Promise.all([
          removeCase(ownerId, id),
          removeDraft(ownerId, 'intake:' + id),
          ...details.rounds.map(item => removeDraft(ownerId, 'round:' + id + ':' + item.number)),
          removeDraft(ownerId, 'checklist:' + id),
          removeDraft(ownerId, 'work-log:' + id),
          removeDraft(ownerId, 'close:' + id),
        ])
      }
      client.removeQueries({queryKey: ['repair', id]})
      await client.invalidateQueries({queryKey: ['repairs']})
      navigate('/repairs')
    },
  })
  const run = (path: string, method: string, value?: unknown, options?: {idempotencyKey?: string}) =>
    mutation.mutate({path, method, value, idempotencyKey: options?.idempotencyKey})
  const transition = (action: string, decision?: Decision) => run('/transition/' + action, 'POST', {version, decision})
  const diagnose = (answers?: Record<string, Answer>) => run('/diagnostic', 'POST', {key: crypto.randomUUID(), version, answers})
  const upload = (file: File, kind: 'SYMPTOM' | 'MODEL_PLATE') => {
    mutation.mutate({path: '/photos', method: 'POST', idempotencyKey: crypto.randomUUID(), photo: file, photoKind: kind})
  }
  const canPause = !['PROCESSING', 'PAUSED', 'CLOSED'].includes(status)
  const canStop = ['DRAFT', 'AWAITING_ANSWERS', 'AI_ERROR'].includes(status)
  const usedAi = Boolean(details.finding || details.issue === 'insufficientEvidence'
    || details.rounds.some(item => !item.followUpIntake)
    || attempts.some(attempt => attempt.finding || attempt.issue === 'insufficientEvidence'))
  const conversationQuery = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => get<ConversationView>('/cases/' + id + '/conversation'),
    enabled: status === 'CHECKLIST',
    refetchInterval: ({state}) => state.data?.pendingMessageId ? 1200 : false,
    retry: false,
  })
  const assistanceShown = usedAi || Boolean(conversationQuery.data?.messages.some(message => message.role === 'ASSISTANT'))

  useEffect(() => {
    const target = '/repairs/' + id + '/' + currentStep
    if (requestedStep !== currentStep) navigate(target, {replace: true})
  }, [currentStep, id, navigate, requestedStep])

  useEffect(() => {
    if (!ownerId || repair.deviceState !== 'PENDING') return
    const sync = async () => {
      if (!navigator.onLine || syncing.current) return
      syncing.current = true
      setSyncingNow(true)
      setSyncError(false)
      try {
        const updated = await syncDeviceCase(ownerId, id)
        if (!updated) return
        client.setQueryData(['repair', id], updated)
        void client.invalidateQueries({queryKey: ['repairs']})
        if (!updated.deviceState) {
          setJustSynced(true)
          window.setTimeout(() => setJustSynced(false), 4000)
        }
        if (updated.id !== id) {
          client.setQueryData(['repair', updated.id], updated)
          navigate('/repairs/' + updated.id, {replace: true})
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          void client.invalidateQueries({queryKey: ['me']})
        } else if (error instanceof ApiError && error.status === 404) {
          await removeCase(ownerId, id)
          client.removeQueries({queryKey: ['repair', id]})
          navigate('/repairs', {replace: true})
        } else {
          setSyncError(true)
        }
      } finally {
        syncing.current = false
        setSyncingNow(false)
      }
    }
    const reconnect = () => { void sync() }
    window.addEventListener('online', reconnect)
    void sync()
    return () => window.removeEventListener('online', reconnect)
  }, [client, id, mutation.data, navigate, ownerId, repair.deviceState, syncAttempt])

  if (repair.deviceState === 'CONFLICT') return <>
    <Link className="back-link" to="/repairs"><ArrowLeft size={16} />{t('backToRepairs')}</Link>
    <header className="page-head"><div><h1>{repair.jobReference}</h1><p>{t('offline.conflict')}</p></div></header>
    <DeviceConflict repair={repair} ownerId={ownerId} />
  </>

  return <>
    <header className="page-head">
      <div className="case-heading"><span className="appliance-icon large"><ApplianceIcon code={repair.category ?? ''} size={26} /></span>
        <div><h1>{t('caseTitle', {appliance: label})}</h1><div className="case-tags"><span className="tag">{repair.jobReference}</span><StatusPill status={status} />
          {repair.archivedAt && <span className="tag">{t('archivedBadge')}</span>}
          {details.demo && <span className="tag">{t('demo')}</span>}
        </div></div></div>
      {canPause && <Button variant="outline" disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}
        onClick={() => transition('pause')}><Pause size={16} />{t('pause')}</Button>}
    </header>
    <ErrorNotice error={mutation.error} />
    <ErrorNotice error={deleteArchivedMutation.error} />
    {repair.deviceState && <p className="notice" role="status">{t(syncingNow ? 'offline.syncing' : 'offline.savedOnDevice')}</p>}
    {justSynced && !repair.deviceState && <p className="notice" role="status">{t('offline.synced')}</p>}
    {syncError && <div className="notice notice-error" role="status"><span>{t('offline.syncError')}</span>
      <Button variant="outline" onClick={() => setSyncAttempt(current => current + 1)}>{t('offline.retrySync')}</Button></div>}
    {saved && !repair.deviceState && <p className="notice" role="status">{t('saved')}</p>}
    <nav className="workflow-nav" aria-label={t('workflow.navigation')}>
      {flowSteps(repair).map((item, index) => {
        const progress = workflowProgress(repair, item, currentStep)
        const lockedLabel = item === 'checklist'
          ? t('workflow.workLogRequirements.' + (missingWorkLogFields(repair.details.workLog?.log)[0] ?? 'workStatus'))
          : t('workflow.progress.checklistRequired')
        const contents = <>
          <span className="workflow-step-number">{progress === 'complete' ? <Check size={14} aria-hidden="true" />
            : progress === 'locked' ? <LockKeyhole size={14} aria-hidden="true" /> : index + 1}</span>
          <span className="workflow-step-copy"><span>{t('workflow.steps.' + item)}</span>
            <small>{progress === 'locked'
              ? lockedLabel
              : t('workflow.progress.' + progress)}</small></span>
        </>
        const className = 'workflow-step ' + progress
        return progress === 'locked'
          ? <span key={item} className={className} aria-disabled="true">{contents}</span>
          : <Link key={item} to={'/repairs/' + id + '/' + item} className={className}
              aria-current={progress === 'current' ? 'step' : undefined}>{contents}</Link>
      })}
    </nav>
    <p className="muted workflow-status">{t('workflow.currentStep', {step: t('workflow.steps.' + currentStep)})}</p>
    {status === 'PAUSED' && <Card className="form-panel paused-workflow" role="status">
      <h2><Pause size={19} />{t('paused')}</h2>
      <p>{t('workflow.pausedAt', {step: t('workflow.steps.' + currentStep)})}</p>
      <Button className="self-start" disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}
        onClick={() => transition('resume')}><Play size={16} />{t('resume')}</Button>
    </Card>}
    <div className="case-grid">
      <div className="stack">
        {currentStep === 'history' && <Card className="form-panel">
          <h2>{t('historyManagement')}</h2>
          {status !== 'CLOSED' && !repair.archivedAt
            ? <p className="muted">{t('archiveAfterClose')}</p>
            : repair.archivedAt
            ? <p className="muted">{t('archivedOn', {date: archivedDate})}</p>
            : <p className="muted">{t('archiveHelp')}</p>}
          <div className="actions">
            {!repair.archivedAt
              ? <Button variant="outline" disabled={status !== 'CLOSED' || mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}
                  onClick={() => run('/archive', 'POST', {version})}>{t('archiveCase')}</Button>
              : <>
                  <Button variant="outline" disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}
                    onClick={() => run('/restore', 'POST', {version})}>{t('restoreCase')}</Button>
                  {canDeleteArchived && <Button variant="outline" disabled={deleteArchivedMutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}
                    onClick={() => {
                      if (window.confirm(t('deleteArchivedConfirm', {jobReference: repair.jobReference}))) deleteArchivedMutation.mutate()
                    }}>{t('deleteArchived')}</Button>}
                </>}
          </div>
          {repair.archivedAt && canDeleteArchived && <><p className="muted">{t('deleteArchiveHelp')}</p>
            <p className="muted">{t('deleteCallbacksHelp')}</p></>}
        </Card>}
        {['intake', 'diagnosis'].includes(currentStep) && details.procedure?.source && <Card className="form-panel">
          {!details.procedure.reviewed && <p className="notice" role="status">{t('draftGuidePreview')}</p>}
          <p className="muted">{details.procedure.source.title} · {details.procedure.source.revision}
            {details.procedure.source.page && ' · ' + t('procedureCitation.page', {page: details.procedure.source.page})}
            {details.procedure.source.url && <> · <a href={details.procedure.source.url} target="_blank" rel="noreferrer">{t('procedureCitation.open')}</a></>}
          </p>
          {details.procedure.applicabilityNote && <p className="muted">{details.procedure.id === 'whirlpool-wrs321sdhv-warm'
            ? t('procedureNote.whirlpoolWarm', details.procedure.applicabilityNote) : details.procedure.applicabilityNote}</p>}
          {details.procedure && i18n.language !== 'en' && <p className="notice" role="status">{t('modelGuideTranslationNotice')}</p>}
        </Card>}
        {currentStep === 'intake' && status !== 'DRAFT' && <Card className="form-panel">
          <h2>{t('workflow.intakeTitle')}</h2>
          <IntakeSummary repair={repair} />
          <p className="muted">{t('workflow.intakeReadOnly')}</p>
        </Card>}
        {status === 'DRAFT' && currentStep === 'intake' && (editing
          ? <Card className="form-panel"><IntakeForm key={id} draftKey={'intake:' + id} initial={details.intake} pending={mutation.isPending} error={mutation.error}
              onSubmit={(data: Intake) => run('?version=' + version, 'PUT', data)} submitLabel="save" cancel={() => setEditing(false)} /></Card>
          : <Card className="form-panel">
            <h2>{t('workflow.intakeTitle')}</h2>
            <IntakeSummary repair={repair} />
            <p className="muted">{t('workflow.intakeSaved')}</p>
            <div className="actions"><Button onClick={() => setEditing(true)} disabled={mutation.isPending}>{t('edit')}</Button>
              <Button onClick={() => navigate('/repairs/' + id + '/diagnosis')} disabled={!navigator.onLine || Boolean(repair.deviceState)}><Sparkles size={16} />{t('conversation.start')}</Button>
            </div>
          </Card>)}
        {currentStep === 'diagnosis' && ['DRAFT', 'DIAGNOSING', 'AWAITING_ANSWERS', 'AI_ERROR',
          'DIAGNOSIS_PROPOSED', 'INCONCLUSIVE', 'CHECKLIST', 'PAUSED'].includes(status) &&
          <ConversationPanel repair={repair} legacyRounds={details.rounds} />}
        {status === 'PROCESSING' && currentStep === 'diagnosis' && <Card className="form-panel"><Loading label={t('processing')} /></Card>}
        {status === 'AI_ERROR' && currentStep === 'diagnosis' && <Card className="form-panel"><h2><CircleAlert size={19} />{t('issue')}</h2><p>{t('errors.aiUnavailable')}</p>
          <Button onClick={() => diagnose()} disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}>{t('retry')}</Button></Card>}
        {status === 'AWAITING_ANSWERS' && currentStep === 'diagnosis' && round && <RoundForm key={round.number} ownerId={ownerId} caseId={id} round={round} busy={mutation.isPending}
          canSubmit={!repair.deviceState}
          save={answers => run('/answers', 'PUT', {version, answers})} submit={diagnose} />}
        {currentStep === 'diagnosis' && details.finding && <Card className="form-panel">
          {(() => { const translated = findingDetails(details.finding!); return <>
            <h2><Sparkles size={19} />{t(status === 'INCONCLUSIVE' ? 'inconclusiveFinding' : 'findings')}</h2><p className="finding">{translated.cause}</p>
            <h3>{t('supporting')}</h3><ul className="evidence">{translated.evidence.map((fact, i) => <li key={i}>{fact}</li>)}</ul>
            <h3>{t('guidance')}</h3><ol className="steps">{translated.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
            <p className="muted">{translated.limitation}</p>
          </> })()}
          {details.finding.decision && <p className="notice">{t('decisionValue.' + details.finding.decision)}</p>}
          {status === 'DIAGNOSIS_PROPOSED' && <div className="actions">
            <Button disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)} onClick={() => transition('checklist', 'ACCEPTED')}>{t('accept')}</Button>
            <Button variant="outline" disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)} onClick={() => transition('checklist', 'REJECTED')}>{t('reject')}</Button>
          </div>}
        </Card>}
        {currentStep === 'diagnosis' && details.issue && !['PROCESSING', 'AI_ERROR'].includes(status) && <Card className="form-panel"><h2><CircleAlert size={19} />{t('issue')}</h2>
          <p>{t('errors.' + details.issue)}</p>
          {status === 'INCONCLUSIVE' && <Button onClick={() => transition('checklist')}
            disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}>{t('continue')}</Button>}
        </Card>}
        {status === 'CHECKLIST' && ['work', 'checklist', 'review'].includes(currentStep) && <RepairCompletion step={currentStep as 'work' | 'checklist' | 'review'}
          repair={repair} ownerId={ownerId} caseId={id} busy={mutation.isPending} usedAi={assistanceShown}
          save={checks => run('/checklist', 'PUT', {version, checks})}
          saveWork={(log, onSuccess) => mutation.mutate({path: '/work-log', method: 'PUT', value: {version, log}}, {onSuccess})}
          continueDiagnosis={() => transition('continue-diagnosis')}
          close={feedback => run('/close?version=' + version, 'POST', feedback)} />}
        {currentStep === 'history' && (['CHECKLIST', 'PAUSED'].includes(status) || Boolean(repair.returnHistory?.length)) &&
          <ReturnVisitPanel repair={repair} busy={mutation.isPending} run={run} readOnly={Boolean(repair.archivedAt)} />}
        {currentStep === 'history' && <RepairTimeline repair={repair} />}
        {currentStep === 'history' && status === 'CLOSED' && <ConversationPanel repair={repair} legacyRounds={details.rounds} readOnly />}
        {currentStep === 'history' && status !== 'CLOSED' && <HandoffPanel repair={repair} busy={mutation.isPending} run={run} />}
        {currentStep === 'history' && status === 'CLOSED' && details.workLog && <WorkLogSummary log={details.workLog.log} />}
        {currentStep === 'history' && status === 'CLOSED' && !repair.archivedAt && <ApplianceLinkPanel repair={repair} />}
        {currentStep === 'review' && status === 'CLOSED' && details.feedback && <Card className="form-panel"><h2><CheckCheck size={20} />{t('completed')}</h2>
          <dl className="details"><dt>{t('outcome')}</dt><dd>{t('outcomeValue.' + details.feedback.outcome)}</dd>
            <dt>{t('rating')}</dt><dd>{t('ratingValue.' + details.feedback.rating)}</dd>
            {details.feedback.feedback && <><dt>{t('feedback')}</dt><dd>{details.feedback.feedback}</dd></>}
          </dl>
          <ul className="steps">{repair.checklist.map(item => <li key={item.id}>{t('checklist.' + item.id)} <strong>{t('checkState.' + details.checks[item.id]?.status)}</strong></li>)}</ul>
        </Card>}
        {currentStep === 'diagnosis' && canStop && <Button className="self-start" variant="ghost" onClick={() => transition('stop')}
          disabled={mutation.isPending || !navigator.onLine || Boolean(repair.deviceState)}>{t('stop')}</Button>}
        {currentStep === 'history' && attempts.length > 0 && <Card className="form-panel">
          <h2><ClipboardList size={19} />{t('followUp.previousAttempts')}</h2>
          {attempts.map((attempt, index) => <details key={attempt.continuedAt} className="round-log">
            <summary>{t('followUp.attempt', {number: index + 1})}</summary>
            <div className="stack">
              {attempt.finding && <dl className="details"><dt>{t('findings')}</dt><dd>{findingCause(attempt.finding)}</dd></dl>}
              <WorkLogDetails log={attempt.workLog.log} />
            </div>
          </details>)}
        </Card>}
        {currentStep === 'history' && details.rounds.some(r => r.submitted) && <Card className="form-panel">
          <h2><ClipboardList size={19} />{t('history')}</h2>
          {details.rounds.filter(r => r.submitted).map(r => <details key={r.number} className="round-log">
            <summary>{t('round', {number: r.number})}</summary>
            <dl className="details">{r.questions.map(q => <HistoryAnswer key={q.id} question={q} answer={r.answers[q.id]} />)}</dl>
          </details>)}
        </Card>}
        {currentStep === 'history' && status === 'CLOSED' && !repair.archivedAt && <CallbackForm repair={repair} />}
        {currentStep === 'history' && (repair.appliance || repair.parentCaseId) && <ApplianceHistory repair={repair} />}
      </div>
      {(currentStep === 'intake' || currentStep === 'history') && <Card className="form-panel case-aside">
        <h2>{t('caseDetails')}</h2>
        <dl className="details"><dt>{t('symptom')}</dt><dd>{details.intake.symptoms}</dd>
          {details.intake.brand && <><dt>{t('brand')}</dt><dd>{details.intake.brand}</dd></>}
          {details.intake.model && <><dt>{t('model')}</dt><dd>{details.intake.model}</dd></>}
          {details.intake.serialNumber && <><dt>{t('serialNumber')}</dt><dd>{details.intake.serialNumber}</dd></>}
          {details.intake.modelConfirmed && <><dt>{t('modelConfirmation')}</dt><dd>{t('confirmed')}</dd></>}
          {repair.parentCaseId && <><dt>{t('callback.originalRepair')}</dt><dd><Link to={'/repairs/' + repair.parentCaseId}>{t('callback.viewOriginal')}</Link></dd></>}
          {details.intake.fuel && <><dt>{t('fuel')}</dt><dd>{t('fuelTypes.' + details.intake.fuel)}</dd></>}
        </dl>
        <div className="photos"><h3><Camera size={17} />{t('photos')}</h3>
          <div className="photo-grid">{details.photos.map((photo, i) => {
            const path = '/api/v1' + base + '/photos/' + photo.id
            const alt = t('photoAlt', {number: i + 1})
            return <div key={photo.id}>
              {photo.id.startsWith('LOCAL-') ? <span className="tag">{t('offline.photoPending')}</span> :
                <a href={path} target="_blank" rel="noreferrer"><img alt={alt} src={path} /></a>}
              <small className="muted">{t(photo.kind === 'MODEL_PLATE' ? 'modelPlatePhotoTag' : 'symptomPhoto')}</small>
              {status === 'DRAFT' && !photo.id.startsWith('LOCAL-') && <Button variant="ghost" disabled={mutation.isPending}
                onClick={() => run('/photos/' + photo.id, 'DELETE')}>{t('removePhoto')}</Button>}
            </div>
          })}</div>
          {status === 'DRAFT' && details.photos.length < 12 && <><Field title={t('uploadSymptom')}>
            <Input type="file" accept="image/jpeg,image/png" disabled={mutation.isPending} onChange={e => {
              const file = e.currentTarget.files?.[0]
              if (file) upload(file, 'SYMPTOM')
              e.currentTarget.value = ''
            }} />
          </Field>
            <Field title={t('uploadModelPlate')}>
              <Input type="file" accept="image/jpeg,image/png" disabled={mutation.isPending} onChange={e => {
                const file = e.currentTarget.files?.[0]
                if (file) upload(file, 'MODEL_PLATE')
                e.currentTarget.value = ''
              }} />
            </Field><p className="muted small">{t('photoHint')}</p></>}
        </div>
      </Card>}
    </div>
    {stepLinks(repair, currentStep).length > 1 && <nav className="workflow-footer" aria-label={t('workflow.stepNavigation')}>
      {(() => {
        const links = stepLinks(repair, currentStep)
        const index = links.indexOf(currentStep)
        const previous = links.slice(0, index).reverse().find(step => canOpenWorkflowStep(repair, step))
        const next = links[index + 1]
        return <>
          {previous ? <Link className="button button-outline" to={'/repairs/' + id + '/' + previous}>
            {t('workflow.backTo', {step: t('workflow.steps.' + previous)})}</Link> : <span />}
          {next && (canOpenWorkflowStep(repair, next)
            ? <Link className="button button-primary" to={'/repairs/' + id + '/' + next}>
              {t('workflow.continueTo', {step: t('workflow.steps.' + next)})}</Link>
            : <Button variant="outline" disabled><LockKeyhole size={15} />{t('workflow.progress.locked')}</Button>)}
        </>
      })()}
    </nav>}
  </>
}

type WorkflowStep = 'intake' | 'diagnosis' | 'work' | 'checklist' | 'review' | 'history'
type WorkflowProgress = 'complete' | 'current' | 'upcoming' | 'attention' | 'available' | 'locked'

const completionSteps: WorkflowStep[] = ['intake', 'diagnosis', 'work', 'checklist', 'review']

function flowSteps(repair: Repair): WorkflowStep[] {
  if (repair.status === 'CLOSED') return ['review', 'history']
  const activeStatus = repair.status === 'PAUSED' ? repair.details.resumeStatus : repair.status
  if (activeStatus === 'CHECKLIST') return [...completionSteps, 'history']
  return ['intake', 'diagnosis', 'history']
}

function workflowStep(repair: Repair, requested?: string): WorkflowStep {
  const steps = flowSteps(repair)
  const activeStatus = repair.status === 'PAUSED' ? repair.details.resumeStatus : repair.status
  if (steps.includes(requested as WorkflowStep)) {
    const requestedStep = requested as WorkflowStep
    if (canOpenWorkflowStep(repair, requestedStep)) return requestedStep
    if (requestedStep === 'checklist') return 'work'
    if (requestedStep === 'review') return hasCompleteWorkLog(repair) ? 'checklist' : 'work'
  }
  if (activeStatus === 'CHECKLIST') {
    if (!hasCompleteWorkLog(repair)) return 'work'
    if (!hasCompleteChecklist(repair)) return 'checklist'
    return 'review'
  }
  if (repair.status === 'CLOSED') return 'review'
  return activeStatus === 'DRAFT' ? 'intake' : 'diagnosis'
}

function stepLinks(repair: Repair, _current: WorkflowStep) { return flowSteps(repair) }

function workflowProgress(repair: Repair, step: WorkflowStep, current: WorkflowStep): WorkflowProgress {
  if (step === current) return 'current'
  if (step === 'history') return 'available'
  if (repair.status === 'CLOSED') return 'complete'
  if (!canOpenWorkflowStep(repair, step)) return 'locked'

  const activeStatus = repair.status === 'PAUSED' ? repair.details.resumeStatus : repair.status
  if (step === 'intake') return activeStatus && activeStatus !== 'DRAFT' ? 'complete' : 'upcoming'
  if (step === 'diagnosis') {
    if (activeStatus === 'CHECKLIST') return 'complete'
    return activeStatus && activeStatus !== 'DRAFT' ? 'attention' : 'upcoming'
  }
  if (activeStatus !== 'CHECKLIST') return 'upcoming'
  if (step === 'work') return hasCompleteWorkLog(repair) ? 'complete' : 'attention'
  if (step === 'checklist') return hasCompleteChecklist(repair) ? 'complete' : 'upcoming'
  if (step === 'review') return 'upcoming'
  return 'upcoming'
}

function canOpenWorkflowStep(repair: Repair, step: WorkflowStep) {
  const activeStatus = repair.status === 'PAUSED' ? repair.details.resumeStatus : repair.status
  if (activeStatus !== 'CHECKLIST') return true
  if (step === 'checklist') return hasCompleteWorkLog(repair)
  if (step === 'review') return hasCompleteWorkLog(repair) && hasCompleteChecklist(repair)
  return true
}

function hasCompleteWorkLog(repair: Repair) {
  return missingWorkLogFields(repair.details.workLog?.log).length === 0
}

function hasCompleteChecklist(repair: Repair) {
  return repair.checklist.every(item => ['CONFIRMED', 'NOT_APPLICABLE'].includes(repair.details.checks[item.id]?.status))
}

function IntakeSummary({ repair }: {repair: Repair}) {
  const { t } = useTranslation()
  const intake = repair.details.intake
  return <dl className="details">
    <dt>{t('symptom')}</dt><dd>{intake.symptoms || t('workflow.missing')}</dd>
    {intake.brand && <><dt>{t('brand')}</dt><dd>{intake.brand}</dd></>}
    {intake.model && <><dt>{t('model')}</dt><dd>{intake.model}</dd></>}
    {intake.serialNumber && <><dt>{t('serialNumber')}</dt><dd>{intake.serialNumber}</dd></>}
    {intake.fuel && <><dt>{t('fuel')}</dt><dd>{t('fuelTypes.' + intake.fuel)}</dd></>}
  </dl>
}

function photoForm(file: File, kind: 'SYMPTOM' | 'MODEL_PLATE') {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  return form
}

function isOfflineSave(command: Change) {
  return command.path.startsWith('?version=') ||
    ['/answers', '/checklist', '/work-log', '/photos'].includes(command.path)
}

function applyOfflineOperation(repair: Repair, operation: PendingOperation, ownerId: string): Repair {
  const details = {...repair.details}
  if (operation.path.startsWith('?version=')) {
    details.intake = operation.value as Intake
    return {...repair, category: details.intake.category, details, deviceState: 'PENDING'}
  }
  if (operation.path === '/answers') {
    const input = operation.value as {answers: Record<string, Answer>}
    const rounds = [...details.rounds]
    const current = rounds.at(-1)
    if (current) rounds[rounds.length - 1] = {...current, answers: input.answers, submitted: false}
    details.rounds = rounds
  } else if (operation.path === '/checklist') {
    details.checks = (operation.value as {checks: Repair['details']['checks']}).checks
  } else if (operation.path === '/work-log') {
    const input = operation.value as {log: WorkLog}
    details.workLog = {log: input.log, author: ownerId, savedAt: new Date().toISOString()}
  } else if (operation.path === '/photos' && operation.photo) {
    details.photos = [...details.photos, {
      id: 'LOCAL-' + operation.idempotencyKey, contentType: operation.photo.type || 'image/jpeg',
      size: operation.photo.size, kind: operation.photoKind ?? 'SYMPTOM', clientKey: operation.idempotencyKey,
    }]
  }
  return {...repair, details, deviceState: 'PENDING'}
}

async function syncDeviceCase(ownerId: string, localId: string): Promise<Repair | null> {
  const entry = await loadCase(ownerId, localId)
  if (!entry || entry.conflict) return null
  let current: Repair

  if (entry.localOnly) {
    if (!entry.createKey || !entry.createIntake) return null
    current = await send<Repair>('/cases', 'POST', entry.createIntake, {idempotencyKey: entry.createKey})
    entry.localOnly = false
    entry.repair = current
    entry.baseVersion = current.version
    await saveCachedCase(entry)
  } else {
    current = await get<Repair>('/cases/' + entry.repair.id)
    if (current.version !== entry.baseVersion) {
      const first = entry.operations[0]
      if (current.version === entry.baseVersion + 1 && first && operationWasApplied(current, first)) {
        entry.operations.shift()
        entry.repair = current
        entry.baseVersion = current.version
        await saveCachedCase(entry)
      } else {
        await setCaseConflict(entry, current)
        return {...entry.repair, deviceState: 'CONFLICT', conflictServer: current}
      }
    }
  }

  while (entry.operations.length) {
    const operation = entry.operations[0]
    if (operation.photo) {
      current = await send<Repair>('/cases/' + current.id + '/photos', 'POST',
        photoForm(new File([operation.photo], operation.photoName || 'appliance-photo.jpg', {type: operation.photo.type}), operation.photoKind ?? 'SYMPTOM'),
        {idempotencyKey: operation.idempotencyKey})
    } else {
      let path = operation.path
      let value = operation.value
      if (path.startsWith('?version=')) {
        path = '?version=' + current.version
      } else if (value && typeof value === 'object') {
        value = {...value, version: current.version}
      }
      current = await send<Repair>('/cases/' + current.id + path, operation.method, value,
        {idempotencyKey: operation.idempotencyKey})
    }
    entry.operations.shift()
    entry.repair = current
    entry.baseVersion = current.version
    await saveCachedCase(entry)
  }

  entry.repair = current
  entry.baseVersion = current.version
  entry.localOnly = false
  entry.conflict = false
  delete entry.createKey
  delete entry.createIntake
  await removeCase(ownerId, localId)
  await saveCase(ownerId, current)
  return current
}

function operationWasApplied(repair: Repair, operation: PendingOperation) {
  if (operation.photo) return repair.details.photos.some(photo => photo.clientKey === operation.idempotencyKey)
  const value = operation.value as Record<string, unknown> | undefined
  if (!value) return false
  if (operation.path.startsWith('?version=')) return JSON.stringify(repair.details.intake) === JSON.stringify(value)
  if (operation.path === '/answers') return JSON.stringify(repair.details.rounds.at(-1)?.answers) === JSON.stringify(value.answers)
  if (operation.path === '/checklist') return JSON.stringify(repair.details.checks) === JSON.stringify(value.checks)
  if (operation.path === '/work-log') return JSON.stringify(repair.details.workLog?.log) === JSON.stringify(value.log)
  return false
}

function DeviceConflict({ repair, ownerId }: {repair: Repair; ownerId?: string}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const resolve = async (keepLocal: boolean) => {
    if (!ownerId) return
    setBusy(true)
    try {
      const entry = await loadCase(ownerId, repair.id)
      if (!entry) return
      const updated = await resolveCaseConflict(entry, keepLocal)
      if (updated) {
        client.setQueryData(['repair', repair.id], updated)
        if (updated.id !== repair.id) navigate('/repairs/' + updated.id, {replace: true})
      }
    } finally {
      setBusy(false)
    }
  }
  const server = repair.conflictServer ?? repair
  const localRound = repair.details.rounds.at(-1)
  const serverRound = server.details.rounds.at(-1)
  const sameRound = localRound?.number === serverRound?.number &&
    JSON.stringify(localRound?.questions.map(question => question.id)) ===
    JSON.stringify(serverRound?.questions.map(question => question.id))
  const canKeepLocal = server.status === repair.status && server.status !== 'CLOSED' &&
    (server.status !== 'AWAITING_ANSWERS' || sameRound)
  return <Card className="form-panel">
    <h2>{t('offline.reviewChanges')}</h2>
    <div className="form-grid">
      <section className="inset"><h3>{t('offline.thisDevice')}</h3><ConflictSnapshot repair={repair} /></section>
      <section className="inset"><h3>{t('offline.serverCopy')}</h3><ConflictSnapshot repair={server} />
        <p>{t('state.' + server.status)}</p></section>
    </div>
    <div className="actions">
      <Button disabled={busy || !canKeepLocal} onClick={() => void resolve(true)}>{t('offline.keepDeviceCopy')}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void resolve(false)}>{t('offline.useServerCopy')}</Button>
    </div>
  </Card>
}

function ConflictSnapshot({ repair }: {repair: Repair}) {
  const { t } = useTranslation()
  const round = repair.details.rounds.at(-1)
  const log = repair.details.workLog?.log
  return <div className="conflict-snapshot">
    <p>{repair.details.intake.symptoms}</p>
    {(repair.details.intake.brand || repair.details.intake.model || repair.details.intake.serialNumber) &&
      <p>{[repair.details.intake.brand, repair.details.intake.model, repair.details.intake.serialNumber].filter(Boolean).join(' · ')}</p>}
    {round && Object.keys(round.answers).length > 0 && <div><strong>{t('answersTitle')}</strong><dl className="details">
      {round.questions.filter(question => round.answers[question.id]).map(question =>
        <HistoryAnswer key={question.id} question={question} answer={round.answers[question.id]} />)}
    </dl></div>}
    {Object.keys(repair.details.checks).length > 0 && <div><strong>{t('completion')}</strong><ul className="steps">
      {Object.entries(repair.details.checks).map(([key, check]) => <li key={key}>{t('checklist.' + key)} — {t('checkState.' + check.status)}{check.reason ? ': ' + check.reason : ''}</li>)}
    </ul></div>}
    {log && <div><strong>{t('workLog.title')}</strong><p>{log.confirmedFault || t('workLog.faultUnconfirmed')}</p>
      {log.verification && <p>{t('workLog.verificationResult')}: {t('workLog.result.' + log.verification.result)} — {log.verification.notes}</p>}
    </div>}
  </div>
}

function HistoryAnswer({ question, answer }: {question: Question; answer?: Answer}) {
  const { t } = useTranslation()
  let response = t('noEntry')
  if (answer?.status === 'ANSWERED') response = ['YES_NO', 'CONFIRMATION'].includes(question.type)
    ? t(answer.value) : [(question.type === 'CHOICE' ? t('choice.' + answer.value, answer.value) : answer.value), question.unit && t('units.' + question.unit, question.unit)].filter(Boolean).join(' ')
  else if (answer) response = [t('answerState.' + answer.status), answer.reason].filter(Boolean).join(' · ')
  return <><dt>{t('question.' + question.id, question.label)}</dt><dd>{response}</dd></>
}

function RoundForm({ round, busy, canSubmit, save, submit, ownerId, caseId }: {
  round: Round; busy: boolean; canSubmit: boolean; ownerId?: string; caseId: string
  save: (answers: Record<string, Answer>) => void; submit: (answers: Record<string, Answer>) => void
}) {
  const { t, i18n } = useTranslation()
  const answerDraft = useDeviceDraft(ownerId, 'round:' + caseId + ':' + round.number, round.answers)
  const answers = answerDraft.value
  const setAnswers = answerDraft.setValue
  const change = (id: string, value: Answer) => setAnswers(current => ({...current, [id]: value}))
  const ready = round.questions.every(question => {
    const answer = answers[question.id]
    return answer && (answer.status !== 'ANSWERED' || answer.value.trim())
  })
  return <Card className="form-panel">
    <div className="box-head tight"><h2>{t(round.followUpIntake ? 'followUp.observations' : 'answersTitle')}</h2><span className="tag">{t('round', {number: round.number})}</span></div>
    <p className="muted">{t('roundHelp')}</p>
    {answerDraft.storageFailed && <p className="notice notice-error" role="status">{t('offline.storageError')}</p>}
    {!answerDraft.loaded && <Loading />}
    {answerDraft.loaded && !navigator.onLine && answerDraft.persistence === 'SAVING' && <p className="notice" role="status">{t('offline.savingOnDevice')}</p>}
    {answerDraft.loaded && !navigator.onLine && answerDraft.persistence === 'SAVED' && <p className="notice" role="status">{t('offline.savedOnDevice')}</p>}
    <form className="fields" onSubmit={(e: FormEvent) => { e.preventDefault(); if (ready) submit(answers) }}>
      <fieldset className="fields" disabled={!answerDraft.loaded}>
      {round.questions.map(question => {
        const answer = answers[question.id]
        const choices = question.type === 'CHOICE' ? question.choices : ['yes', 'no']
        return <fieldset className="question" key={question.id}>
          <legend>{t('question.' + question.id, question.label)}</legend>
          <Field title={t('response')} required><select className="control" value={answer?.status ?? ''} onChange={e => {
            if (!e.target.value) {
              setAnswers(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== question.id)))
              return
            }
            change(question.id, {status: e.target.value as AnswerStatus, value: '', reason: ''})
          }}>
            <option value="">{t('choose')}</option>
            {['ANSWERED', 'UNKNOWN', 'UNAVAILABLE', 'NOT_PERFORMED'].map(s => <option key={s} value={s}>{t('answerState.' + s)}</option>)}
          </select></Field>
          {answer?.status === 'ANSWERED' && <Field title={[t('response'), question.unit && t('units.' + question.unit, question.unit)].filter(Boolean).join(' · ')}>
            {['TEXT', 'NUMBER'].includes(question.type)
              ? <Input type="text" inputMode={question.type === 'NUMBER' ? 'decimal' : undefined}
                  pattern={question.type === 'NUMBER' ? decimalInputPattern : undefined}
                  value={question.type === 'NUMBER' ? localizedDecimal(answer.value, i18n.language) : answer.value}
                  onChange={e => change(question.id, {...answer, value: question.type === 'NUMBER' ? canonicalDecimal(e.target.value) : e.target.value})} maxLength={1000} required />
              : <select className="control" value={answer.value} onChange={e => change(question.id, {...answer, value: e.target.value})} required>
                <option value="">{t('choose')}</option>{choices.map(c => <option key={c} value={c}>{t(question.type === 'CHOICE' ? 'choice.' + c : c, c)}</option>)}
              </select>}
          </Field>}
          {answer && answer.status !== 'ANSWERED' && <Field title={t('reason') + ' · ' + t('optional')}>
            <Input maxLength={500} value={answer.reason} onChange={e => change(question.id, {...answer, reason: e.target.value})} />
          </Field>}
        </fieldset>
      })}
      <div className="actions"><Button type="submit" disabled={!ready || busy || !canSubmit || !navigator.onLine}>{t('submitAnswers')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => save(Object.fromEntries(Object.entries(answers)
          .filter(([, a]) => a.status !== 'ANSWERED' || a.value.trim())))}>{t('saveAnswers')}</Button></div>
      </fieldset>
    </form>
  </Card>
}
