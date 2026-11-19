import { create } from 'zustand'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ClipboardList, Plus } from 'lucide-react'
import { ErrorNotice, Loading, Pager } from '@/components/common'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { get } from '@/lib/api'
import type { Page } from '@/lib/pagination'
import type { AuthSession } from '@/features/auth/types'
import { listCachedCases } from '@/lib/device-vault'
import { ApplianceIcon, StatusPill } from './repair-display'
import type { Status, Summary } from './types'
import { useCategories } from './use-categories'

const states: Status[] = ['DRAFT', 'PROCESSING', 'AWAITING_ANSWERS', 'DIAGNOSING', 'AI_ERROR', 'DIAGNOSIS_PROPOSED', 'INCONCLUSIVE', 'PAUSED', 'CHECKLIST', 'CLOSED']

const useFilters = create<{category: string; status: string; search: string; archived: boolean; page: number; update: (v: Partial<{category: string; status: string; search: string; archived: boolean; page: number}>) => void}>(
  (set) => ({ category: '', status: '', search: '', archived: false, page: 0, update: set }),
)

export function RepairListPage() {
  const { t, i18n } = useTranslation()
  const filters = useFilters()
  const client = useQueryClient()
  const ownerId = client.getQueryData<AuthSession>(['me'])?.user.id
  const categories = useCategories()
  const params = new URLSearchParams({ page: String(filters.page) })
  if (filters.archived) params.set('archived', 'true')
  if (filters.category) params.set('category', filters.category)
  if (filters.status) params.set('status', filters.status)
  if (filters.search.trim()) params.set('search', filters.search.trim())
  const repairs = useQuery({queryKey: ['repairs', params.toString()], queryFn: async (): Promise<Page<Summary> & {offline?: boolean}> => {
    try {
      return await get<Page<Summary>>('/cases?' + params.toString())
    } catch (error) {
      if (!(error instanceof TypeError) || !ownerId) throw error
      const cached = await listCachedCases(ownerId)
      const query = filters.search.trim().toLowerCase()
      const summaries = cached.map(entry => {
        const repair = entry.repair
        return {
          id: repair.id, jobReference: repair.jobReference, category: repair.category, status: repair.status,
          archivedAt: repair.archivedAt,
          symptoms: repair.details.intake.symptoms, brand: repair.appliance?.brand ?? repair.details.intake.brand,
          model: repair.appliance?.model ?? repair.details.intake.model,
          serialNumber: repair.appliance?.serialNumber ?? repair.details.intake.serialNumber,
          updatedAt: repair.updatedAt, demo: repair.details.demo, technicianId: repair.technicianId,
          parentCaseId: repair.parentCaseId, dueBack: repair.returnVisit?.scheduledFor ?? null,
          deviceState: entry.conflict ? 'CONFLICT' as const : entry.localOnly || entry.operations.length ? 'PENDING' as const : undefined,
        }
      }).filter(item => (!filters.category || item.category === filters.category) &&
        (Boolean(item.archivedAt) === filters.archived) &&
        (!filters.status || item.status === filters.status) && (!query ||
          item.jobReference.toLowerCase().includes(query) || (item.serialNumber ?? '').trim().toLowerCase() === query))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const start = filters.page * 20
      return {content: summaries.slice(start, start + 20), number: filters.page,
        totalElements: summaries.length, totalPages: Math.ceil(summaries.length / 20), offline: true}
    }
  }})
  const settings = useQuery({queryKey: ['settings'], queryFn: () => get<{demo: boolean}>('/settings')})
  const dates = new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium'})

  return <>
    <header className="page-head">
      <div><h1>{t(filters.archived ? 'archivedTitle' : 'repairs')}</h1><p>{t(filters.archived ? 'archivedDescription' : 'listDescription')}</p></div>
      <div className="actions">
        <Button variant="outline" onClick={() => filters.update({archived: !filters.archived, status: '', page: 0})}>
          {t(filters.archived ? 'viewCurrentRepairs' : 'viewArchivedHistory')}
        </Button>
        {!filters.archived && <Link className={buttonVariants()} to="/repairs/new"><Plus size={18} />{t('newRepair')}</Link>}
      </div>
    </header>
    <ErrorNotice error={[settings.error, categories.error, repairs.error].find(error =>
      error && !(error instanceof TypeError && !navigator.onLine))} />
    {repairs.data?.offline && <div className="notice" role="status">{t('offline.mode')}</div>}
    {settings.data?.demo && <div className="notice"><span className="tag">{t('demo')}</span>{t('demoNotice')}</div>}
    <Card>
      <div className="box-head"><h2>{t(filters.archived ? 'archivedTitle' : 'recentRepairs')}</h2>
        <div className="filters">
          <input className="control" aria-label={t('searchRepairs')} placeholder={t('searchRepairs')}
            value={filters.search} onChange={e => filters.update({search: e.target.value, page: 0})} />
          <select className="control" aria-label={t('appliance')} value={filters.category} onChange={e => filters.update({category: e.target.value, page: 0})}>
            <option value="">{t('allCategories')}</option>
            {categories.data?.map(c => <option key={c.code} value={c.code}>{t('categories.' + c.code, c.label)}</option>)}
          </select>
          {!filters.archived && <select className="control" aria-label={t('status')} value={filters.status} onChange={e => filters.update({status: e.target.value, page: 0})}>
            <option value="">{t('allStatuses')}</option>
            {states.map(s => <option key={s} value={s}>{t('state.' + s)}</option>)}
          </select>}
        </div>
      </div>
      {repairs.isPending && <Loading />}
      {repairs.data && (repairs.data.content.length ? <>
        <div className="list-header"><span>{t('appliance')}</span><span>{t('status')}</span><span>{t('lastUpdate')}</span><span /></div>
        {repairs.data.content.map(r => {
          const label = r.category ? categories.data?.find(c => c.code === r.category)?.label ?? r.category : t('categories.unknown')
          return <Link className="repair-row" key={r.id} to={'/repairs/' + r.id}>
            <span className="row-main"><span className="appliance-icon"><ApplianceIcon code={r.category ?? ''} /></span>
              <span className="row-copy"><strong>{r.jobReference} · {r.category ? t('categories.' + r.category, label) : label}</strong>
                {filters.archived && <span className="tag">{t('archivedBadge')}</span>}
                {!filters.archived && <span className="next-action">{t('workflow.nextActions.' + r.status)}</span>}
                <span>{r.symptoms}</span>{r.serialNumber && <span>{t('serialNumber')}: {r.serialNumber}</span>}
                {r.dueBack && <span>{t('returns.dueTitle')}: {dates.format(new Date(r.dueBack + 'T12:00:00'))}</span>}</span>
            </span>
            <StatusPill status={r.status} />
            <time dateTime={r.updatedAt}>{dates.format(new Date(r.updatedAt))}</time>
            <ArrowUpRight size={18} className="row-arrow" />
          </Link>
        })}
      </> : <div className="empty"><ClipboardList size={28} /><strong>{t('empty')}</strong><p>{t('emptyHint')}</p></div>)}
      <Pager page={filters.page} total={repairs.data?.totalPages ?? 0} setPage={page => filters.update({page})} />
    </Card>
  </>
}
