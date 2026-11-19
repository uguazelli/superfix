import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Camera, MessageCircle, RotateCcw, Send, Sparkles, Wrench } from 'lucide-react'
import { ErrorNotice, Field, Loading } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { get, send } from '@/lib/api'
import type { AuthSession } from '@/features/auth/types'
import { useDeviceDraft } from './use-device-draft'
import { IntakeForm } from './intake-form'
import type { ConversationHandoff, ConversationView, Intake, Repair, Round } from './types'

type ComposerDraft = {text: string; photoIds: string[]; clientKey: string}
type HandoffDraft = {key: string; summary: string; possibleCause: string; evidence: string; unresolved: string; source: ConversationHandoff['source']}

const emptyComposer = (): ComposerDraft => ({text: '', photoIds: [], clientKey: crypto.randomUUID()})
const emptyHandoff = (): HandoffDraft => ({key: crypto.randomUUID(), summary: '', possibleCause: '', evidence: '', unresolved: '', source: 'UNDETERMINED'})

export function ConversationPanel({repair, legacyRounds, readOnly = false}: {repair: Repair; legacyRounds: Round[]; readOnly?: boolean}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const userId = client.getQueryData<AuthSession>(['me'])?.user.id
  const id = repair.id
  const draft = useDeviceDraft<ComposerDraft>(userId, 'conversation:' + id, emptyComposer())
  const conversationCache = useDeviceDraft<ConversationView | null>(userId, 'conversation-cache:' + id, null)
  const handoff = useDeviceDraft<HandoffDraft>(userId, 'conversation-handoff:' + id, emptyHandoff())
  const uploadDraft = useDeviceDraft<File | undefined>(userId, 'conversation-photo:' + id, undefined)
  const serverHandoffApplied = useRef(false)
  const query = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => get<ConversationView>('/cases/' + id + '/conversation'),
    enabled: repair.deviceState !== 'PENDING' && repair.deviceState !== 'CONFLICT',
    refetchInterval: ({state}) => state.data?.pendingMessageId ? 1200 : false,
    retry: false,
  })
  const view: ConversationView = query.data ?? conversationCache.value ?? {
    conversationId: null, caseId: id, caseVersion: repair.version, caseStatus: repair.status, started: false,
    imageAnalysisAvailable: false, photoLimit: 12, photos: repair.details.photos, messages: [], handoff: null,
    intakeUpdates: [], contextLimited: false, requestsUsed: 0, requestLimit: 50, pendingMessageId: null,
    hasMoreMessages: false, nextBeforeSequence: null,
  }
  const caseVersion = view.caseVersion
  const pending = Boolean(view.pendingMessageId)
  const latestSuggestion = useMemo(() => view.messages.slice().reverse().find(message =>
    message.role === 'ASSISTANT' && message.suggestion?.summary?.trim())?.suggestion ?? null,
  [view.messages])

  useEffect(() => {
    if (!query.data || !conversationCache.loaded) return
    const merged = mergeLatestConversation(query.data, conversationCache.value)
    if (merged !== query.data) client.setQueryData(['conversation', id], merged)
    conversationCache.setValue(merged)
  }, [client, conversationCache.loaded, conversationCache.setValue, conversationCache.value, id, query.data])

  useEffect(() => {
    if (!view.handoff || !handoff.loaded || serverHandoffApplied.current) return
    serverHandoffApplied.current = true
    handoff.setValue(current => current.summary || current.possibleCause ? current : ({
      summary: view.handoff?.summary ?? '', possibleCause: view.handoff?.possibleCause ?? '',
      evidence: (view.handoff?.evidence ?? []).join('\n'), unresolved: (view.handoff?.unresolved ?? []).join('\n'),
      source: view.handoff?.source ?? 'UNDETERMINED', key: current.key,
    }))
  }, [handoff.loaded, handoff.setValue, view.handoff])

  useEffect(() => {
    if (view.caseVersion !== repair.version) {
      void client.invalidateQueries({queryKey: ['repair', id]})
      void client.invalidateQueries({queryKey: ['repairs']})
    }
  }, [client, id, repair.version, view.caseVersion])

  const applyConversation = async (next: ConversationView) => {
    const current = client.getQueryData<ConversationView>(['conversation', id]) ?? conversationCache.value
    const merged = mergeLatestConversation(next, current)
    client.setQueryData(['conversation', id], merged)
    if (conversationCache.loaded) conversationCache.setValue(merged)
    await Promise.all([
      client.invalidateQueries({queryKey: ['repair', id]}),
      client.invalidateQueries({queryKey: ['repairs']}),
    ])
  }

  const start = useMutation({
    mutationFn: () => send<ConversationView>('/cases/' + id + '/conversation/start', 'POST',
      {key: crypto.randomUUID(), version: caseVersion}),
    onSuccess: applyConversation,
    onError: () => { void client.invalidateQueries({queryKey: ['conversation', id]}) },
  })
  const submitMessage = useMutation({
    mutationFn: (value: ComposerDraft) => send<ConversationView>('/cases/' + id + '/conversation/messages', 'POST',
      {key: value.clientKey, version: caseVersion, text: value.text, photoIds: value.photoIds}),
    onSuccess: next => {
      applyConversation(next)
      draft.setValue(emptyComposer())
    },
    onError: () => { void client.invalidateQueries({queryKey: ['conversation', id]}) },
  })
  const retry = useMutation({
    mutationFn: (messageId: string) => send<ConversationView>('/cases/' + id + '/conversation/messages/' + messageId + '/retry',
      'POST', {key: crypto.randomUUID(), version: caseVersion}),
    onSuccess: applyConversation,
  })
  const loadOlder = useMutation({
    mutationFn: (beforeSequence: number) => get<ConversationView>(
      '/cases/' + id + '/conversation?beforeSequence=' + beforeSequence + '&limit=40'),
    onSuccess: page => {
      const current = client.getQueryData<ConversationView>(['conversation', id]) ?? conversationCache.value
      const merged = mergeOlderConversation(page, current)
      client.setQueryData(['conversation', id], merged)
      if (conversationCache.loaded) conversationCache.setValue(merged)
    },
  })
  const continueToWork = useMutation({
    mutationFn: () => send<ConversationView>('/cases/' + id + '/conversation/continue-to-work', 'POST', {
      key: handoff.value.key, version: caseVersion,
      summary: handoff.value.summary,
      possibleCause: handoff.value.possibleCause,
      evidence: lines(handoff.value.evidence),
      unresolved: lines(handoff.value.unresolved),
      source: handoff.value.source,
    }),
    onSuccess: async next => {
      await applyConversation(next)
      handoff.setValue(current => ({...current, key: crypto.randomUUID()}))
      navigate('/repairs/' + id + '/work')
    },
  })
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'SYMPTOM')
      return send<Repair>('/cases/' + id + '/photos', 'POST', form, {idempotencyKey: crypto.randomUUID()})
    },
    onSuccess: next => {
      client.setQueryData(['repair', id], next)
      void client.invalidateQueries({queryKey: ['conversation', id]})
      void client.invalidateQueries({queryKey: ['repairs']})
      uploadDraft.clear()
      uploadDraft.setValue(undefined)
    },
  })
  const saveIntake = useMutation({
    mutationFn: async ({intake, modelPlate}: {intake: Intake; modelPlate?: File}) => {
      let next = await send<Repair>('/cases/' + id + '?version=' + caseVersion, 'PUT', intake)
      if (modelPlate) {
        const form = new FormData()
        form.append('file', modelPlate)
        form.append('kind', 'MODEL_PLATE')
        next = await send<Repair>('/cases/' + id + '/photos', 'POST', form, {idempotencyKey: crypto.randomUUID()})
      }
      return next
    },
    onSuccess: next => {
      client.setQueryData(['repair', id], next)
      void client.invalidateQueries({queryKey: ['conversation', id]})
      void client.invalidateQueries({queryKey: ['repairs']})
    },
  })

  const updateDraft = (change: Partial<ComposerDraft>) => draft.setValue(current => ({...current, ...change}))
  const offline = !navigator.onLine
  const viewOnly = readOnly || repair.status === 'CLOSED' || Boolean(repair.archivedAt)
  const canMutate = !viewOnly && !offline && !repair.deviceState && repair.status !== 'PAUSED'
  const startAllowed = ['DRAFT', 'AWAITING_ANSWERS', 'AI_ERROR', 'DIAGNOSIS_PROPOSED', 'INCONCLUSIVE', 'DIAGNOSING', 'CHECKLIST'].includes(repair.status)
  const requestLimitReached = view.requestLimit > 0 && view.requestsUsed >= view.requestLimit
  const allBusy = start.isPending || submitMessage.isPending || retry.isPending || continueToWork.isPending || upload.isPending || saveIntake.isPending
  const submit = () => {
    if (!view.started || pending || requestLimitReached || !draft.loaded || !canMutate) return
    const hasPhotos = draft.value.photoIds.length > 0
    if (!draft.value.text.trim() && !hasPhotos) return
    submitMessage.mutate(draft.value)
  }

  const visibleConversation = view.started
  if (viewOnly && !visibleConversation) return null
  return <div className="conversation-layout">
    <section className="stack conversation-main">
      <Card className="form-panel conversation-card">
        <div className="box-head"><div><h2><MessageCircle size={20} />{t('conversation.title')}</h2>
          <p className="muted">{t('conversation.description')}</p></div>
          {visibleConversation && <span className="tag">{t('state.' + view.caseStatus)}</span>}
        </div>
        {viewOnly && <p className="notice" role="status">{t('conversation.readOnly')}</p>}
        {repair.details.demo && <p className="notice"><span className="tag">{t('demo')}</span> {t('demoNotice')}</p>}
        {view.contextLimited && <p className="notice">{t('conversation.limitedContext')}</p>}
        {repair.deviceState === 'PENDING' && <p className="notice" role="status">{t('offline.connectForNextStep')}</p>}
        {offline && visibleConversation && <p className="notice" role="status">{t('conversation.offline')}</p>}
        {query.isPending && !conversationCache.value && repair.deviceState !== 'PENDING' && <Loading />}
        {query.error && (navigator.onLine || !(query.error instanceof TypeError)) && repair.deviceState !== 'PENDING' && <ErrorNotice error={query.error} />}
        {requestLimitReached &&
          <p className="notice" role="status">{t('conversation.requestLimit', {used: view.requestsUsed, limit: view.requestLimit})}</p>}
        {view.intakeUpdates.length > 0 && <section className="conversation-intake-updates" aria-label={t('conversation.intakeUpdatesTitle')}>
          <h3>{t('conversation.intakeUpdatesTitle')}</h3>
          {view.intakeUpdates.map(update => <article key={update.id} className="conversation-intake-update">
            <div><strong>{t('conversation.intakeField.' + update.field)}</strong><span>{update.previousValue
              ? <>{update.previousValue} → </> : null}{update.value}</span></div>
            <blockquote>{update.evidenceQuote}</blockquote>
            {update.sourcePhotoId
              ? <a href={'#photo-' + update.sourcePhotoId}>{t('conversation.viewSourcePhoto')}</a>
              : <a href={'#message-' + update.sourceMessageId}>{t('conversation.viewSourceMessage')}</a>}
          </article>)}
        </section>}

        {!visibleConversation && !viewOnly && <div className="conversation-start">
          <p>{t('conversation.startHelp')}</p>
          {start.error && <ErrorNotice error={start.error} />}
          {legacyRounds.length > 0 && <LegacyHistory rounds={legacyRounds} />}
          <div className="actions">
            <Button disabled={!canMutate || !startAllowed || allBusy} onClick={() => start.mutate()}>
              <Sparkles size={16} />{start.isPending ? t('working') : t('conversation.start')}
            </Button>
          </div>
          {!repair.details.intake.category && !repair.details.intake.symptoms && <p className="muted small">{t('conversation.emptyStart')}</p>}
        </div>}

        {visibleConversation && <>
          <div className="conversation-messages" aria-live="polite" aria-relevant="additions text">
            {view.messages.length === 0 && <p className="conversation-welcome">{t('conversation.welcome')}</p>}
            {view.messages.map(message => <article id={'message-' + message.id} key={message.id} className={'chat-message ' + message.role.toLowerCase()}>
              <div className="chat-message-head"><strong>{t(message.role === 'ASSISTANT' ? 'conversation.assistant' : message.role === 'CONTEXT' ? 'conversation.caseContext' : 'conversation.technician')}</strong>
                <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(i18n.language, {hour: 'numeric', minute: '2-digit'}).format(new Date(message.createdAt))}</time></div>
              <p className="chat-message-text">{message.text}</p>
              {message.attachments.length > 0 && <div className="chat-attachments">{message.attachments.map(photo =>
                <a id={'photo-' + photo.id} key={photo.id} href={'/api/v1/cases/' + id + '/photos/' + photo.id} target="_blank" rel="noreferrer">
                  <img src={'/api/v1/cases/' + id + '/photos/' + photo.id} alt={photo.kind === 'MODEL_PLATE' ? t('modelPlatePhotoTag') : t('symptomPhoto')} />
                </a>)}</div>}
              {message.role === 'ASSISTANT' && message.suggestion?.summary && <div className="chat-suggestion">
                <strong>{t('conversation.suggestion')}</strong><p>{message.suggestion.summary}</p>
                {message.suggestion.uncertainty && <small>{t('conversation.uncertainty')}: {message.suggestion.uncertainty}</small>}
                <Button variant="outline" className="conversation-small-button" disabled={!canMutate || allBusy} onClick={() => handoff.setValue(current => ({
                  ...current, possibleCause: message.suggestion?.summary ?? '',
                  evidence: (message.suggestion?.evidenceMessageIds ?? []).map(source => {
                    const technicianMessage = view.messages.find(item => item.id === source && item.role === 'TECHNICIAN')
                    return technicianMessage ? `${t('conversation.technician')}: ${technicianMessage.text}` : ''
                  }).filter(Boolean).join('\n'),
                  source: 'AI_ACCEPTED',
                }))}>{t('conversation.useSuggestion')}</Button>
              </div>}
              {message.state === 'QUEUED' && <small className="muted">{t('conversation.queued')}</small>}
              {message.state === 'RUNNING' && <small className="muted">{t('conversation.running')}</small>}
              {message.state === 'FAILED' && <div className="notice notice-error" role="status">
                <span>{t('conversation.failed')}</span>
                {message.failureCode === 'AI_LIMIT' && <span>{t('conversation.requestLimit', {used: view.requestsUsed, limit: view.requestLimit})}</span>}
                {message.failureCode === 'COMPANY_AI_LIMIT' && <span>{t('conversation.companyRequestLimit')}</span>}
                {message.role === 'TECHNICIAN' && <Button variant="outline" className="conversation-small-button"
                  disabled={!canMutate || allBusy || requestLimitReached} onClick={() => retry.mutate(message.id)}>
                  <RotateCcw size={15} />{t('conversation.retry')}</Button>}
              </div>}
              {message.state === 'CANCELLED' && <small className="muted">{t('conversation.cancelled')}</small>}
            </article>)}
          </div>
          {view.hasMoreMessages && view.nextBeforeSequence !== null && <div className="actions conversation-load-older">
            <ErrorNotice error={loadOlder.error} />
            <Button variant="outline" className="conversation-small-button" disabled={!navigator.onLine || loadOlder.isPending}
              onClick={() => loadOlder.mutate(view.nextBeforeSequence!)}>
              {loadOlder.isPending ? t('working') : t('conversation.loadOlder')}
            </Button>
          </div>}
          {!viewOnly && <div className="conversation-composer">
            <ErrorNotice error={submitMessage.error || retry.error} />
            <Field title={t('conversation.composer')}><textarea className="control" maxLength={4000} rows={4}
              value={draft.value.text} disabled={!draft.loaded || pending || requestLimitReached || repair.status === 'CLOSED' || repair.status === 'PAUSED'}
              placeholder={t('conversation.composerPlaceholder')}
              onChange={event => updateDraft({text: event.target.value})} /></Field>
            {view.photos.length > 0 && <details className="photo-picker"><summary>{t('conversation.attachPhotos')}</summary>
              <div className="photo-picker-list">{view.photos.map(photo => <label key={photo.id}>
                <input type="checkbox" checked={draft.value.photoIds.includes(photo.id)} disabled={pending || repair.status === 'CLOSED'}
                  onChange={event => updateDraft({photoIds: event.target.checked
                    ? [...new Set([...draft.value.photoIds, photo.id])].slice(0, view.photoLimit)
                    : draft.value.photoIds.filter(photoId => photoId !== photo.id)})} />
                <img src={'/api/v1/cases/' + id + '/photos/' + photo.id} alt="" />
                <span>{t(photo.kind === 'MODEL_PLATE' ? 'modelPlatePhotoTag' : 'symptomPhoto')}</span>
              </label>)}</div>
            </details>}
            <div className="actions conversation-actions">
              <label className="button button-outline conversation-upload"><Camera size={16} />{t('conversation.uploadPhoto')}
                <input type="file" accept="image/jpeg,image/png" disabled={!uploadDraft.loaded || repair.status === 'CLOSED' || repair.status === 'PAUSED' || Boolean(repair.deviceState)}
                  onChange={event => { const file = event.currentTarget.files?.[0]; if (file) uploadDraft.setValue(file); event.currentTarget.value = '' }} />
              </label>
              <Button onClick={submit} disabled={!canMutate || pending || requestLimitReached || allBusy || !draft.loaded ||
                (!draft.value.text.trim() && !draft.value.photoIds.length)}><Send size={16} />{submitMessage.isPending ? t('conversation.sending') : t('conversation.send')}</Button>
            </div>
            <p className="muted small">{t('conversation.photoLimit', {count: view.photoLimit})}</p>
            {draft.value.photoIds.length > 0 && <p className="muted small">{t('conversation.selected')}: {draft.value.photoIds.length}
              <Button variant="ghost" className="conversation-small-button" onClick={() => updateDraft({photoIds: []})}>{t('conversation.removeSelection')}</Button></p>}
            {uploadDraft.value && <div className="notice conversation-pending-photo" role="status">
              <span>{uploadDraft.value.name}</span>
              {upload.error && <ErrorNotice error={upload.error} />}
              <Button variant="outline" className="conversation-small-button" disabled={!canMutate || upload.isPending || view.photos.length >= view.photoLimit}
                onClick={() => upload.mutate(uploadDraft.value!)}>{upload.isPending ? t('working') : t('conversation.uploadPhoto')}</Button>
              <Button variant="ghost" className="conversation-small-button" onClick={() => { uploadDraft.clear(); uploadDraft.setValue(undefined) }}>{t('cancel')}</Button>
            </div>}
            {!view.imageAnalysisAvailable && draft.value.photoIds.length > 0 && <p className="notice" role="status">{t('conversation.imageUnavailable')}</p>}
            {draft.storageFailed && <p className="notice notice-error" role="status">{t('offline.storageError')}</p>}
          </div>}
        </>}
      </Card>

      {visibleConversation && !viewOnly && <Card className="form-panel conversation-intake">
        <details>
          <summary><strong>{t('conversation.editInformation')}</strong></summary>
          <IntakeForm key={id + ':conversation-intake'} draftKey={'conversation-intake:' + id} initial={repair.details.intake}
            pending={saveIntake.isPending} error={saveIntake.error} submitLabel="conversation.saveInformation"
            onSubmit={(intake, modelPlate) => saveIntake.mutate({intake, modelPlate})} />
        </details>
      </Card>}
      {legacyRounds.length > 0 && visibleConversation && <Card className="form-panel"><LegacyHistory rounds={legacyRounds} /></Card>}
    </section>

    <aside className="stack conversation-aside">
      {!viewOnly ? <Card className="form-panel">
        <h2><Wrench size={19} />{t('conversation.continueTitle')}</h2>
        <p className="muted">{t('conversation.continueHelp')}</p>
        <div className="fields">
          <Field title={t('conversation.summary')}><textarea className="control" rows={3} maxLength={4000} value={handoff.value.summary}
            disabled={repair.status === 'CLOSED' || repair.status === 'PAUSED'} onChange={e => handoff.setValue(v => ({...v, summary: e.target.value}))} /></Field>
          <Field title={t('conversation.possibleCause')}><textarea className="control" rows={2} maxLength={1000} value={handoff.value.possibleCause}
            disabled={repair.status === 'CLOSED' || repair.status === 'PAUSED'} onChange={e => handoff.setValue(v => ({...v, possibleCause: e.target.value}))} /></Field>
          <Field title={t('conversation.evidence')}><textarea className="control" rows={2} value={handoff.value.evidence}
            disabled={repair.status === 'CLOSED' || repair.status === 'PAUSED'} onChange={e => handoff.setValue(v => ({...v, evidence: e.target.value}))} /></Field>
          <Field title={t('conversation.unresolved')}><textarea className="control" rows={2} value={handoff.value.unresolved}
            disabled={repair.status === 'CLOSED' || repair.status === 'PAUSED'} onChange={e => handoff.setValue(v => ({...v, unresolved: e.target.value}))} /></Field>
          <Field title={t('conversation.source')}><select className="control" value={handoff.value.source}
            disabled={repair.status === 'CLOSED' || repair.status === 'PAUSED'} onChange={e => handoff.setValue(v => ({...v, source: e.target.value as HandoffDraft['source']}))}>
            <option value="TECHNICIAN">{t('conversation.sourceTechnician')}</option>
            <option value="AI_ACCEPTED">{t('conversation.sourceAi')}</option>
            <option value="UNDETERMINED">{t('conversation.sourceUnknown')}</option>
          </select></Field>
        </div>
        {handoff.storageFailed && <p className="notice notice-error" role="status">{t('offline.storageError')}</p>}
        {continueToWork.error && <ErrorNotice error={continueToWork.error} />}
        <Button className="self-start" disabled={!canMutate || continueToWork.isPending} onClick={() => continueToWork.mutate()}>
          <Wrench size={16} />{continueToWork.isPending ? t('working') : t('conversation.continue')}</Button>
      </Card> : view.handoff && <Card className="form-panel">
        <h2><Wrench size={19} />{t('conversation.savedHandoff')}</h2>
        {view.handoff.summary && <p>{view.handoff.summary}</p>}
        {view.handoff.possibleCause && <p><strong>{t('conversation.possibleCause')}:</strong> {view.handoff.possibleCause}</p>}
        {view.handoff.evidence.length > 0 && <><h3>{t('conversation.evidence')}</h3><ul>{view.handoff.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {view.handoff.unresolved.length > 0 && <><h3>{t('conversation.unresolved')}</h3><ul>{view.handoff.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        <p className="muted">{t('conversation.source')}: {t(view.handoff.source === 'TECHNICIAN'
          ? 'conversation.sourceTechnician' : view.handoff.source === 'AI_ACCEPTED'
            ? 'conversation.sourceAi' : 'conversation.sourceUnknown')}</p>
      </Card>}
      {visibleConversation && !viewOnly && latestSuggestion && <Card className="form-panel">
        <h2><Sparkles size={19} />{t('conversation.suggestion')}</h2><p>{latestSuggestion.summary}</p>
        {latestSuggestion.uncertainty && <p className="muted">{t('conversation.uncertainty')}: {latestSuggestion.uncertainty}</p>}
      </Card>}
    </aside>
  </div>
}

function LegacyHistory({rounds}: {rounds: Round[]}) {
  const { t } = useTranslation()
  return <details className="legacy-chat-history"><summary>{t('conversation.priorHistory')}</summary>
    {rounds.map(round => <section key={round.number}><h3>{t('round', {number: round.number})}</h3>
      <dl className="details">{round.questions.map(question => {
        const answer = round.answers[question.id]
        let value = answer?.status === 'ANSWERED' ? answer.value : answer ? t('answerState.' + answer.status) : t('noEntry')
        if (answer?.reason) value += ' · ' + answer.reason
        return <div key={question.id}><dt>{question.label}</dt><dd>{value}</dd></div>
      })}</dl>
    </section>)}
  </details>
}

function mergeLatestConversation(next: ConversationView, previous: ConversationView | null | undefined): ConversationView {
  if (!previous?.started || !next.started || next.conversationId !== previous.conversationId) return next
  const messages = new Map(previous.messages.map(message => [message.id, message]))
  next.messages.forEach(message => messages.set(message.id, message))
  const ordered = [...messages.values()].sort((left, right) => left.sequence - right.sequence)
  const hasMoreMessages = previous.hasMoreMessages
  const nextBeforeSequence = hasMoreMessages ? ordered[0]?.sequence ?? next.nextBeforeSequence : null
  if (ordered.length === next.messages.length && hasMoreMessages === next.hasMoreMessages
      && nextBeforeSequence === next.nextBeforeSequence) return next
  return {...next, messages: ordered, hasMoreMessages, nextBeforeSequence}
}

function mergeOlderConversation(page: ConversationView, current: ConversationView | null | undefined): ConversationView {
  if (!current?.started || !page.started || page.conversationId !== current.conversationId) return page
  const messages = new Map(page.messages.map(message => [message.id, message]))
  current.messages.forEach(message => messages.set(message.id, message))
  return {
    ...page,
    messages: [...messages.values()].sort((left, right) => left.sequence - right.sequence),
    hasMoreMessages: page.hasMoreMessages,
    nextBeforeSequence: page.hasMoreMessages ? page.nextBeforeSequence : null,
  }
}

function lines(value: string): string[] { return value.split('\n').map(item => item.trim()).filter(Boolean) }
