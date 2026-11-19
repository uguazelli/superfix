import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity as ActivityIcon, Barcode, CalendarClock, ClipboardList, RotateCcw, UsersRound } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Field, ErrorNotice, Loading, Pager, RequiredMark } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { get, send } from '@/lib/api'
import { localizedDecimal } from '@/lib/decimal'
import { loadOrCreateKey, rotateKeyAfter, saveDraft } from '@/lib/device-vault'
import type { Page } from '@/lib/pagination'
import type { AuthSession, User } from '@/features/auth/types'
import type { Part, PilotProcedureReport, Repair, ReturnVisit } from './types'
import { StatusPill } from './repair-display'

type Run = (path: string, method: string, value?: unknown, options?: {idempotencyKey?: string}) => void

function localDate(day: Date) {
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-')
}

export function ReturnVisitPanel({ repair, busy, run, readOnly = false }: {repair: Repair; busy: boolean; run: Run; readOnly?: boolean}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const ownerId = client.getQueryData<AuthSession>(['me'])?.user.id
  const [parts, setParts] = useState<Part[]>([])
  const [showSchedule, setShowSchedule] = useState(false)
  const [createKey, setCreateKey] = useState<string | null>(null)
  const [keyStorageFailed, setKeyStorageFailed] = useState(false)
  const minimumDate = localDate(new Date())
  const canSchedule = !readOnly && (repair.status === 'CHECKLIST' ||
    (repair.status === 'PAUSED' && repair.details.resumeStatus !== null))
  const visit = repair.returnVisit
  const activeReturnId = visit?.id
  const history = (repair.returnHistory ?? []).filter(item => item.id !== visit?.id)
  useEffect(() => {
    let active = true
    setCreateKey(null)
    setKeyStorageFailed(false)
    if (!ownerId) return () => { active = false }
    const storageKey = `return:${repair.id}:create-key`
    void (async () => {
      const key = activeReturnId
        ? await rotateKeyAfter(ownerId, storageKey, activeReturnId)
        : await loadOrCreateKey(ownerId, storageKey)
      if (active) setCreateKey(key)
    })().catch(() => { if (active) setKeyStorageFailed(true) })
    return () => { active = false }
  }, [ownerId, repair.id, activeReturnId])
  return <Card className="form-panel">
    <h2><CalendarClock size={19} />{t('returns.title')}</h2>
    {visit ? <VisitDetails visit={visit} repair={repair} busy={busy} run={run} readOnly={readOnly} /> :
      history.length === 0 && <p className="muted">{t('returns.empty')}</p>}
    {history.length > 0 && <section className="stack">
      <h3>{t('returns.historyTitle')}</h3>
      {history.map(item => <ReturnHistoryItem key={item.id} visit={item} />)}
    </section>}
    {canSchedule && !visit && <>
      {!showSchedule
        ? <Button variant="outline" disabled={!navigator.onLine || Boolean(repair.deviceState)} onClick={() => setShowSchedule(true)}>{t('returns.schedule')}</Button>
        : <form className="fields" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            run('/returns', 'POST', {
              version: repair.version, scheduledFor: form.get('scheduledFor'), clientDate: minimumDate, reason: form.get('reason'),
              nextAction: form.get('nextAction'), parts: parts.filter(part => part.name.trim()),
            }, {idempotencyKey: createKey ?? undefined})
          }}>
          <Field title={t('returns.date')}><Input type="date" name="scheduledFor" min={minimumDate} required /></Field>
          <Field title={t('returns.reason')}><Input name="reason" maxLength={1000} required /></Field>
          <Field title={t('returns.nextAction')}><textarea className="control" name="nextAction" rows={2} maxLength={1000} required /></Field>
          <div className="stack"><strong>{t('returns.parts')}</strong>
            {parts.map((part, index) => <div className="form-grid" key={index}>
              <Field title={t('workLog.partName')}><Input value={part.name} maxLength={120}
                onChange={event => setParts(current => current.map((item, i) => i === index ? {...item, name: event.target.value} : item))} /></Field>
              <Field title={t('workLog.partNumber')}><Input value={part.partNumber ?? ''} maxLength={120}
                onChange={event => setParts(current => current.map((item, i) => i === index ? {...item, partNumber: event.target.value} : item))} /></Field>
              <Field title={t('workLog.quantity')}><Input type="number" min={1} max={999} value={part.quantity}
                onChange={event => setParts(current => current.map((item, i) => i === index ? {...item, quantity: Number(event.target.value)} : item))} /></Field>
              <Button type="button" variant="ghost" onClick={() => setParts(current => current.filter((_, i) => i !== index))}>{t('workLog.removePart')}</Button>
            </div>)}
            {parts.length < 20 && <Button type="button" variant="outline" onClick={() =>
              setParts(current => [...current, {name: '', partNumber: '', quantity: 1}])}>{t('returns.addPart')}</Button>}
          </div>
          {keyStorageFailed && <p className="notice notice-error" role="alert">{t('offline.storageError')}</p>}
          <div className="actions"><Button type="submit" disabled={busy || !createKey || keyStorageFailed || !navigator.onLine || Boolean(repair.deviceState)}>{t('returns.save')}</Button>
            <Button type="button" variant="outline" onClick={() => setShowSchedule(false)}>{t('cancel')}</Button></div>
        </form>}
    </>}
  </Card>
}

function ReturnHistoryItem({ visit }: {visit: ReturnVisit}) {
  const { t, i18n } = useTranslation()
  const date = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'})
  const timestamp = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'})
  return <div className="inset stack">
    <strong>{date.format(new Date(visit.scheduledFor + 'T12:00:00'))} · {t('returns.state.' + visit.status)}</strong>
    <span>{visit.reason} · {visit.nextAction}</span>
    {visit.startedAt && <span>{t('returns.startedAt')}: {timestamp.format(new Date(visit.startedAt))}</span>}
    {visit.completedAt && <span>{t('returns.completedAt')}: {timestamp.format(new Date(visit.completedAt))}</span>}
    {visit.parts.length > 0 && <ul className="evidence">{visit.parts.map(part => <li key={part.id}>
      {part.name}{part.partNumber ? ' · ' + part.partNumber : ''} × {part.quantity} — {t('returns.partState.' + part.status)}
    </li>)}</ul>}
  </div>
}

function VisitDetails({ visit, repair, busy, run, readOnly }: {visit: ReturnVisit; repair: Repair; busy: boolean; run: Run; readOnly: boolean}) {
  const { t, i18n } = useTranslation()
  const [rescheduling, setRescheduling] = useState(false)
  const minimumDate = localDate(new Date())
  const date = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'}).format(new Date(visit.scheduledFor + 'T12:00:00'))
  const timestamp = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'})
  return <div className="stack">
    <p><strong>{date}</strong> · {t('returns.state.' + visit.status)}</p>
    <dl className="details"><dt>{t('returns.reason')}</dt><dd>{visit.reason}</dd>
      <dt>{t('returns.nextAction')}</dt><dd>{visit.nextAction}</dd></dl>
    {visit.startedAt && <p>{t('returns.startedAt')}: {timestamp.format(new Date(visit.startedAt))}</p>}
    {visit.completedAt && <p>{t('returns.completedAt')}: {timestamp.format(new Date(visit.completedAt))}</p>}
    {visit.parts.length > 0 && <div><h3>{t('returns.parts')}</h3><ul className="steps">
      {visit.parts.map(part => <li key={part.id}>
        {part.name}{part.partNumber ? ' · ' + part.partNumber : ''} × {part.quantity} — {t('returns.partState.' + part.status)}
        {!readOnly && visit.status === 'SCHEDULED' && part.status === 'REQUESTED' && <span className="inline-actions">
          <Button variant="ghost" disabled={busy || !navigator.onLine || Boolean(repair.deviceState)} onClick={() => run('/returns/' + visit.id + '/parts/' + part.id, 'PATCH',
            {version: repair.version, status: 'RECEIVED'})}>{t('returns.markReceived')}</Button>
          <Button variant="ghost" disabled={busy || !navigator.onLine || Boolean(repair.deviceState)} onClick={() => run('/returns/' + visit.id + '/parts/' + part.id, 'PATCH',
            {version: repair.version, status: 'CANCELLED'})}>{t('returns.cancelPart')}</Button>
        </span>}
      </li>)}
    </ul></div>}
    {!readOnly && visit.status === 'SCHEDULED' && <div className="actions">
      {!rescheduling ? <Button variant="outline" disabled={busy || !navigator.onLine || Boolean(repair.deviceState)} onClick={() => setRescheduling(true)}>{t('returns.reschedule')}</Button>
        : <form className="actions" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            run('/returns/' + visit.id, 'PATCH', {
              version: repair.version, status: 'SCHEDULED', clientDate: minimumDate, scheduledFor: form.get('scheduledFor'),
            })
            setRescheduling(false)
          }}><Field title={t('returns.date')}><Input name="scheduledFor" type="date" min={minimumDate} defaultValue={visit.scheduledFor} required /></Field>
            <Button type="submit" disabled={busy || !navigator.onLine || Boolean(repair.deviceState)}>{t('save')}</Button></form>}
      <Button variant="ghost" disabled={busy || !navigator.onLine || Boolean(repair.deviceState)} onClick={() => run('/returns/' + visit.id, 'PATCH',
        {version: repair.version, status: 'CANCELLED', clientDate: minimumDate})}>{t('returns.cancel')}</Button>
    </div>}
  </div>
}

export function HandoffPanel({ repair, busy, run }: {repair: Repair; busy: boolean; run: Run}) {
  const { t, i18n } = useTranslation()
  const session = useQueryClient().getQueryData<AuthSession>(['me'])
  const user = session?.user
  const isAdmin = user?.role === 'COMPANY_ADMIN'
  const technicians = useQuery({
    queryKey: ['technicians'], queryFn: () => get<User[]>('/team/technicians'), enabled: isAdmin,
  })
  const [note, setNote] = useState('')
  const assignedName = technicians.data?.find(technician => technician.id === repair.technicianId)?.name ??
    (user?.id === repair.technicianId ? user.name : repair.technicianId)
  const timestamp = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'})
  if (!isAdmin || repair.status === 'CLOSED') return null
  return <Card className="form-panel">
    <h2><UsersRound size={19} />{t('handoff.title')}</h2>
    <p className="muted">{t('handoff.current')}: {repair.technicianId === repair.createdBy ? t('handoff.creator') + ' · ' + assignedName : assignedName}</p>
    {technicians.isPending && <Loading />}
    <ErrorNotice error={technicians.error} />
    {technicians.data && <form className="fields" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      run('/assignee', 'PUT', {version: repair.version, technicianId: data.get('technicianId'), note})
      setNote('')
    }}>
      <Field title={t('handoff.technician')}><select className="control" name="technicianId" defaultValue={repair.technicianId} required>
        {technicians.data.map(technician => <option key={technician.id} value={technician.id}>
          {technician.name}{technician.id === repair.technicianId ? ' · ' + t('handoff.currentlyAssigned') : ''}
        </option>)}
      </select></Field>
      <Field title={t('handoff.note') + ' · ' + t('optional')}><Input value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></Field>
      <Button className="self-start" type="submit" disabled={busy || !navigator.onLine || Boolean(repair.deviceState) || technicians.data.length === 0}>{t('handoff.assign')}</Button>
    </form>}
    {repair.assignments?.length > 0 && <section className="stack">
      <h3>{t('handoff.history')}</h3>
      {repair.assignments.map((assignment, index) => <div className="inset stack" key={assignment.createdAt + index}>
        <strong>{t('handoff.from')}: {assignment.previousTechnicianName ?? '—'} · {t('handoff.to')}: {assignment.technicianName}</strong>
        <span>{t('handoff.by')}: {assignment.actorName} · {timestamp.format(new Date(assignment.createdAt))}</span>
        {assignment.note && <span>{assignment.note}</span>}
      </div>)}
    </section>}
  </Card>
}

export function CallbackForm({ repair }: {repair: Repair}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const ownerId = client.getQueryData<AuthSession>(['me'])?.user.id
  const [open, setOpen] = useState(false)
  const [hazard, setHazard] = useState(false)
  const [requestKey, setRequestKey] = useState<string | null>(null)
  const [keyStorageFailed, setKeyStorageFailed] = useState(false)
  useEffect(() => {
    let active = true
    setRequestKey(null)
    setKeyStorageFailed(false)
    if (!ownerId) return () => { active = false }
    void loadOrCreateKey(ownerId, `callback:${repair.id}:create-key`).then(key => {
      if (active) setRequestKey(key)
    }).catch(() => { if (active) setKeyStorageFailed(true) })
    return () => { active = false }
  }, [ownerId, repair.id])
  const callback = useMutation({
    mutationFn: ({input, key}: {input: {symptoms: string; hazard: boolean; fuel: string | null}; key: string}) =>
      send<Repair>('/cases/' + repair.id + '/callbacks', 'POST', input, {idempotencyKey: key}),
    onSuccess: async result => {
      if (ownerId) await saveDraft(ownerId, `callback:${repair.id}:create-key`, crypto.randomUUID()).catch(() => undefined)
      void client.invalidateQueries({queryKey: ['repairs']})
      navigate('/repairs/' + result.id)
    },
  })
  return <Card className="form-panel">
    <h2><RotateCcw size={19} />{t('callback.title')}</h2>
    {!open ? <Button variant="outline" disabled={!navigator.onLine} onClick={() => setOpen(true)}>{t('callback.start')}</Button> :
      <form className="fields" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        if (!requestKey) return
        callback.mutate({input: {symptoms: String(data.get('symptoms')), hazard, fuel: repair.details.intake.fuel}, key: requestKey})
      }}>
        <p className="muted">{t('callback.parent', {reference: repair.jobReference})}</p>
        <Field title={t('symptom')}><textarea className="control" name="symptoms" rows={4} maxLength={4000} required /></Field>
        <div className="hazard"><label><input type="checkbox" checked={hazard} onChange={event => setHazard(event.target.checked)} />{t('hazard')}</label><p>{t('hazardHelp')}</p></div>
        <ErrorNotice error={callback.error} />
        {keyStorageFailed && <p className="notice notice-error" role="alert">{t('offline.storageError')}</p>}
        <div className="actions"><Button type="submit" disabled={callback.isPending || !requestKey || keyStorageFailed || !navigator.onLine}>{t('callback.create')}</Button>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>{t('cancel')}</Button></div>
      </form>}
  </Card>
}

export function ApplianceLinkPanel({ repair }: {repair: Repair}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const session = client.getQueryData<AuthSession>(['me'])
  const [confirmed, setConfirmed] = useState(false)
  const linkAppliance = useMutation({
    mutationFn: (input: {version: number; brand: string; model: string; serialNumber: string; confirmed: boolean}) =>
      send<Repair>('/cases/' + repair.id + '/appliance', 'PUT', input),
    onSuccess: result => {
      client.setQueryData(['repair', repair.id], result)
      void client.invalidateQueries({queryKey: ['repairs']})
    },
  })
  if (session?.user.role !== 'COMPANY_ADMIN' || repair.status !== 'CLOSED' || repair.appliance) return null
  return <Card className="form-panel">
    <h2><Barcode size={19} />{t('applianceLink.title')}</h2>
    <p className="muted">{t('applianceLink.help')}</p>
    <form className="fields" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      linkAppliance.mutate({
        version: repair.version, brand: String(data.get('brand') ?? ''), model: String(data.get('model') ?? ''),
        serialNumber: String(data.get('serialNumber') ?? ''), confirmed,
      })
    }}>
      <div className="form-grid">
        <Field title={t('brand') + ' · ' + t('optional')}><Input name="brand" maxLength={120} defaultValue={repair.details.intake.brand ?? ''} /></Field>
        <Field title={t('model')}><Input name="model" maxLength={120} required defaultValue={repair.details.intake.model ?? ''} /></Field>
        <Field title={t('serialNumber') + ' · ' + t('optional')}><Input name="serialNumber" maxLength={120} defaultValue={repair.details.intake.serialNumber ?? ''} /></Field>
      </div>
      <label className="check-row"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('applianceLink.confirm')} <RequiredMark accessibleText={false} /></label>
      <ErrorNotice error={linkAppliance.error} />
      <Button className="self-start" type="submit" disabled={!confirmed || linkAppliance.isPending || !navigator.onLine}>
        {t('applianceLink.link')}
      </Button>
    </form>
  </Card>
}

export function DueBackPage() {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(0)
  const today = new Date()
  const day = localDate(today)
  const from = '1970-01-01'
  const through = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90))
  const due = useQuery({
    queryKey: ['returns', from, through, day, page],
    queryFn: () => get<Page<ReturnVisit>>('/returns?from=' + from + '&through=' + through + '&today=' + day + '&page=' + page),
  })
  const date = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'})
  const groups = [
    {id: 'overdue', label: t('returns.overdue'), rows: due.data?.content.filter(visit => visit.scheduledFor < day) ?? []},
    {id: 'today', label: t('returns.today'), rows: due.data?.content.filter(visit => visit.scheduledFor === day) ?? []},
    {id: 'upcoming', label: t('returns.upcoming'), rows: due.data?.content.filter(visit => visit.scheduledFor > day) ?? []},
  ]
  return <>
    <header className="page-head"><div><h1>{t('returns.dueTitle')}</h1><p>{t('returns.dueDescription')}</p></div></header>
    <ErrorNotice error={due.error} />
    <Card>
      {due.isPending && <Loading />}
      {groups.map(group => group.rows.length > 0 && <section className="due-group" key={group.id}>
        <h2>{group.label}</h2>
        {group.rows.map(visit => <Link className="repair-row due-row" key={visit.id} to={'/repairs/' + visit.caseId}>
          <span className="row-main"><CalendarClock size={19} /><span className="row-copy">
            <strong>{visit.jobReference}</strong><span>{visit.reason} · {visit.nextAction}</span></span></span>
          <span>{date.format(new Date(visit.scheduledFor + 'T12:00:00'))}</span>
          <span>{visit.parts.filter(part => part.status === 'REQUESTED').length > 0 &&
            t('returns.partsRemaining', {count: visit.parts.filter(part => part.status === 'REQUESTED').length})}</span>
        </Link>)}
      </section>)}
      {due.data?.content.length === 0 && <p className="empty">{t('returns.noneDue')}</p>}
      <Pager page={page} total={due.data?.totalPages ?? 0} setPage={setPage} />
    </Card>
  </>
}

export function PilotReportPage() {
  const { t, i18n } = useTranslation()
  const report = useQuery({
    queryKey: ['pilot-outcomes'], queryFn: () => get<PilotProcedureReport[]>('/pilot-outcomes'),
  })
  const reviewed = (value: string | null) => value
    ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'}).format(new Date(value))
    : t('pilotReport.notRecorded')
  return <>
    <header className="page-head"><div><h1>{t('pilotReport.title')}</h1><p>{t('pilotReport.description')}</p></div></header>
    <ErrorNotice error={report.error} />
    <Card>
      {report.isPending && <Loading />}
      {report.data?.length ? <div className="table-scroll"><table className="pilot-table">
        <thead><tr><th>{t('pilotReport.procedure')}</th><th>{t('pilotReport.reviewer')}</th>
          <th>{t('pilotReport.closedCases')}</th><th>{t('pilotReport.causeMatch')}</th>
          <th>{t('pilotReport.firstTest')}</th><th>{t('pilotReport.unknown')}</th><th>{t('pilotReport.inconclusive')}</th></tr></thead>
        <tbody>{report.data.map(item => <tr key={item.procedureId + ':' + item.revision}>
          <th scope="row">{item.model}<small>{item.procedureId} · v{item.revision}</small></th>
          <td>{item.reviewer || t('pilotReport.notRecorded')}<small>{reviewed(item.reviewedAt)}</small></td>
          <td>{item.closedCases}</td><td>{item.matchingCauses} / {item.comparableCauses}</td>
          <td>{item.passedFirstVerifications} / {item.performedFirstVerifications}</td>
          <td>{item.unknownConfirmedCauses}</td><td>{item.inconclusiveCases}</td>
        </tr>)}</tbody>
      </table></div> : !report.isPending && <p className="empty">{t('pilotReport.empty')}</p>}
    </Card>
  </>
}

export function ApplianceHistory({ repair }: {repair: Repair}) {
  const { t, i18n } = useTranslation()
  const history = repair.applianceHistory ?? []
  const date = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'})
  return <Card className="form-panel">
    <h2><ClipboardList size={19} />{t('applianceHistory.title')}</h2>
    {repair.appliance && <p>{repair.appliance.brand ? repair.appliance.brand + ' ' : ''}{repair.appliance.model}
      {repair.appliance.serialNumber && <> · {repair.appliance.serialNumber}</>}</p>}
    <div className="stack">{history.map(entry => {
      const content = <>
        <strong>{entry.jobReference}</strong><StatusPill status={entry.status} />
        <span>{date.format(new Date(entry.createdAt))} · {entry.symptoms}</span>
        {entry.confirmedFault && <span>{t('workLog.confirmedFault')}: {entry.confirmedFault}</span>}
        {entry.outcome && <span>{t('outcome')}: {t('outcomeValue.' + entry.outcome)}</span>}
        {entry.verification && <span>{t('workLog.verification')}: {t('workLog.result.' + entry.verification)}</span>}
        {entry.readings.length > 0 && <div className="stack"><strong>{t('workLog.readings')}</strong>
          {entry.readings.map((reading, index) => <span key={index}>{reading.name} · {t('workLog.before')}: {localizedDecimal(reading.beforeValue, i18n.language) || '—'}{reading.unit ? ' ' + reading.unit : ''}
            {' · '}{t('workLog.after')}: {localizedDecimal(reading.afterValue, i18n.language) || '—'}{reading.unit ? ' ' + reading.unit : ''}</span>)}
        </div>}
        {entry.usedParts.map((part, index) => <span key={index}>{t('workLog.partName')}: {part.name} × {part.quantity}</span>)}
      </>
      return entry.canOpen
        ? <Link className="history-entry" key={entry.id} to={'/repairs/' + entry.id}>{content}</Link>
        : <div className="history-entry" key={entry.id}>{content}</div>
    })}</div>
  </Card>
}

export function RepairTimeline({ repair }: {repair: Repair}) {
  const { t, i18n } = useTranslation()
  if (!repair.timeline?.length) return null
  const date = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'})
  return <Card className="form-panel">
    <h2><ActivityIcon size={19} />{t('timeline.title')}</h2>
    <ol className="timeline">{repair.timeline.map((entry, index) => <li key={entry.action + entry.createdAt + index}>
      <strong>{t('timeline.actions.' + entry.action, entry.action.toLowerCase().replaceAll('_', ' '))}</strong>
      <span>{entry.actorName} · <time dateTime={entry.createdAt}>{date.format(new Date(entry.createdAt))}</time></span>
    </li>)}</ol>
  </Card>
}
