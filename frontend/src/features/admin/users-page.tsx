import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plus, UsersRound } from 'lucide-react'
import { ErrorNotice, Field, Loading, Pager } from '@/components/common'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { User } from '@/features/auth/types'
import { get, send } from '@/lib/api'
import type { Page } from '@/lib/pagination'

export function UsersPage({user}: {user: User}) {
  const { companyId } = useParams()
  const { t } = useTranslation()
  const client = useQueryClient()
  const platform = user.role === 'PLATFORM_ADMIN'
  const company = platform ? companyId : user.companyId
  const path = '/admin/companies/' + company + '/users'
  const [page, setPage] = useState(0)
  const [add, setAdd] = useState(false)
  const [resetId, setResetId] = useState<string | null>(null)
  const users = useQuery({queryKey: ['users', company, page], queryFn: () => get<Page<User>>(path + '?page=' + page), enabled: Boolean(company)})
  const save = useMutation({
    mutationFn: (command: {path: string; method: string; data: unknown}) => send(path + command.path, command.method, command.data),
    onSuccess: (_, command) => {
      if (!command.path) setAdd(false)
      if (command.path.endsWith('/password')) setResetId(null)
      void client.invalidateQueries({queryKey: ['users', company]})
    },
  })
  const createUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    save.mutate({path: '', method: 'POST', data: {name: form.get('name'), email: form.get('email'),
      password: form.get('password'), role: form.get('role') ?? 'TECHNICIAN'}})
  }

  return <>
    {platform && <Link to="/admin" className="back-link"><ArrowLeft size={16} />{t('administration')}</Link>}
    <header className="page-head"><div><h1>{t('employees')}</h1><p>{t('teamIntro')}</p></div>
      <Button onClick={() => {save.reset(); setAdd(!add)}}><Plus size={17} />{t('createUser')}</Button></header>
    <ErrorNotice error={users.error || save.error} />
    <Card className="form-panel">
      <h2><UsersRound size={20} />{t('team')}</h2>
      {add && <form className="fields inset" onSubmit={createUser}>
        <Field title={t('name')}><Input name="name" maxLength={120} required /></Field>
        <Field title={t('email')}><Input name="email" type="email" maxLength={254} required /></Field>
        <Field title={t('tempPassword')}><Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
        {platform && <Field title={t('role.TECHNICIAN') + ' / ' + t('role.COMPANY_ADMIN')}><select className="control" name="role">
          <option value="TECHNICIAN">{t('role.TECHNICIAN')}</option><option value="COMPANY_ADMIN">{t('role.COMPANY_ADMIN')}</option>
        </select></Field>}
        <div className="actions"><Button type="submit" disabled={save.isPending}>{t('createUser')}</Button>
          <Button variant="ghost" onClick={() => setAdd(false)}>{t('cancel')}</Button></div>
      </form>}
      {users.isPending && <Loading />}
      {users.data?.content.length === 0 && <p className="muted">{t('noRecords')}</p>}
      {users.data?.content.map(member => <div key={member.id}>
        <div className="admin-row">
          <div><strong>{member.name}</strong><p>{member.email} · {t('role.' + member.role)} · {t(member.active ? 'active' : 'inactive')}</p></div>
          {(platform || member.role === 'TECHNICIAN') && member.id !== user.id && <div className="actions">
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({
              path: '/' + member.id + '/active', method: 'PUT', data: {active: !member.active},
            })}>{t(member.active ? 'disable' : 'enable')}</Button>
            <Button variant="ghost" onClick={() => {save.reset(); setResetId(resetId === member.id ? null : member.id)}}>{t('reset')}</Button>
          </div>}
        </div>
        {resetId === member.id && <form className="fields inset" onSubmit={event => {
          event.preventDefault()
          save.mutate({path: '/' + member.id + '/password', method: 'PUT', data: {password: new FormData(event.currentTarget).get('password')}})
        }}>
          <Field title={t('tempPassword')}><Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
          <Button type="submit" disabled={save.isPending}>{t('reset')}</Button>
        </form>}
      </div>)}
      <Pager page={page} total={users.data?.totalPages ?? 0} setPage={setPage} />
    </Card>
  </>
}
