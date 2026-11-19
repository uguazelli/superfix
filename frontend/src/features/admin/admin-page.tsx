import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Building2, Plus } from 'lucide-react'
import { ErrorNotice, Field, Loading, Pager } from '@/components/common'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { get, send } from '@/lib/api'
import type { Page } from '@/lib/pagination'
import type { Company, Plan } from './types'

export function AdminPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [planPage, setPlanPage] = useState(0)
  const [companyPage, setCompanyPage] = useState(0)
  const [showPlan, setShowPlan] = useState(false)
  const [editCompany, setEditCompany] = useState<Company | 'new' | null>(null)
  const plans = useQuery({queryKey: ['plans', planPage], queryFn: () => get<Page<Plan>>('/admin/plans?page=' + planPage)})
  const companies = useQuery({queryKey: ['companies', companyPage], queryFn: () => get<Page<Company>>('/admin/companies?page=' + companyPage)})
  const planOptions = useQuery({
    queryKey: ['plan-options'], enabled: Boolean(editCompany),
    queryFn: async () => {
      const first = await get<Page<Plan>>('/admin/plans')
      const rest = await Promise.all(Array.from({length: Math.max(0, first.totalPages - 1)}, (_, i) => get<Page<Plan>>('/admin/plans?page=' + (i + 1))))
      return [first, ...rest].flatMap(page => page.content)
    },
  })
  const planMutation = useMutation({
    mutationFn: (form: FormData) => send('/admin/plans', 'POST', {
      name: form.get('name'), maxUsers: Number(form.get('maxUsers')),
      monthlyAiLimit: form.get('monthlyAiLimit') ? Number(form.get('monthlyAiLimit')) : null,
    }),
    onSuccess: () => {
      setShowPlan(false)
      void client.invalidateQueries({queryKey: ['plans']})
      void client.invalidateQueries({queryKey: ['plan-options']})
    },
  })
  const companyMutation = useMutation({
    mutationFn: (form: FormData) => {
      const id = editCompany && editCompany !== 'new' ? editCompany.id : null
      return send('/admin/companies' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', {
        name: form.get('name'), planId: form.get('planId'), active: form.get('active') === 'on',
      })
    },
    onSuccess: () => {setEditCompany(null); void client.invalidateQueries({queryKey: ['companies']})},
  })
  const editing = editCompany && editCompany !== 'new' ? editCompany : null
  return <>
    <header className="page-head"><div><h1>{t('administration')}</h1><p>{t('adminIntro')}</p></div></header>
    <ErrorNotice error={plans.error || companies.error} />
    <div className="admin-grid">
      <Card className="form-panel">
        <div className="box-head tight"><h2>{t('plans')}</h2>
          <Button variant="outline" onClick={() => {planMutation.reset(); setShowPlan(!showPlan)}}><Plus size={16} />{t('createPlan')}</Button>
        </div>
        {showPlan && <form className="fields inset" onSubmit={event => {
          event.preventDefault(); planMutation.mutate(new FormData(event.currentTarget))
        }}>
          <Field title={t('name')}><Input name="name" maxLength={80} required /></Field>
          <Field title={t('seats')}><Input name="maxUsers" type="number" min={1} max={10000} required /></Field>
          <Field title={t('requests') + ' · ' + t('optional')}><Input name="monthlyAiLimit" type="number" min={1} max={2147483647} /></Field>
          <ErrorNotice error={planMutation.error} />
          <Button type="submit" disabled={planMutation.isPending}>{t('createPlan')}</Button>
        </form>}
        {plans.isPending && <Loading />}
        {plans.data?.content.length === 0 && <p className="muted">{t('noRecords')}</p>}
        {plans.data?.content.map(p => <div className="admin-row" key={p.id}><div><strong>{p.name}</strong>
          <p>{t('seats')}: {p.maxUsers} · {p.monthlyAiLimit === null ? t('unlimited') : t('requests') + ': ' + p.monthlyAiLimit}</p></div></div>)}
        <Pager page={planPage} total={plans.data?.totalPages ?? 0} setPage={setPlanPage} />
      </Card>
      <Card className="form-panel">
        <div className="box-head tight"><h2>{t('companies')}</h2>
          <Button variant="outline" onClick={() => {companyMutation.reset(); setEditCompany(editCompany === 'new' ? null : 'new')}}
            disabled={plans.data?.totalElements === 0}><Plus size={16} />{t('createCompany')}</Button></div>
        {editCompany && <form className="fields inset" key={editing?.id ?? 'new'} onSubmit={event => {
          event.preventDefault(); companyMutation.mutate(new FormData(event.currentTarget))
        }}>
          <Field title={t('name')}><Input required name="name" maxLength={120} defaultValue={editing?.name} /></Field>
          <Field title={t('plan')}><select className="control" name="planId" key={planOptions.isPending ? "loading" : "ready"} defaultValue={editing?.planId ?? ''} required>
            <option value="" disabled>{t('choose')}</option>
            {planOptions.data?.filter(p => p.active).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
          </select></Field>
          <label className="check-line"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />{t('active')}</label>
          <ErrorNotice error={companyMutation.error || planOptions.error} />
          <div className="actions"><Button type="submit" disabled={companyMutation.isPending || planOptions.isPending}>{t(editing ? 'save' : 'createCompany')}</Button>
            <Button variant="ghost" onClick={() => setEditCompany(null)}>{t('cancel')}</Button></div>
        </form>}
        {companies.isPending && <Loading />}
        {companies.data?.content.length === 0 && <p className="muted">{t('noRecords')}</p>}
        {companies.data?.content.map(c => <div className="admin-row" key={c.id}>
          <div className="row-main"><span className="appliance-icon"><Building2 size={18} /></span><div><strong>{c.name}</strong>
            <p>{t(c.active ? 'active' : 'inactive')}</p></div></div>
          <div className="actions">
            <Button variant="ghost" onClick={() => {companyMutation.reset(); setEditCompany(c)}}>{t('editCompany')}</Button>
            <Link className="text-link" to={'/admin/companies/' + c.id}>{t('manage')} <ArrowUpRight size={15} /></Link>
          </div>
        </div>)}
        <Pager page={companyPage} total={companies.data?.totalPages ?? 0} setPage={setCompanyPage} />
      </Card>
    </div>
  </>
}
