import type { FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Brand, ErrorNotice, Field, LanguagePicker } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { send } from '@/lib/api'
import { changeLanguage, markLocalePending, normalizeLocale, type AppLocale } from '@/app/i18n'
import i18n from '@/app/i18n'

export function AuthScreen({ change, onSignOut, onSignedIn }: {change?: boolean; onSignOut?: () => void; onSignedIn?: () => void}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const request = useMutation({
    mutationFn: (form: FormData) => change
      ? send('/auth/password', 'POST', { currentPassword: form.get('currentPassword'), password: form.get('password') })
      : send('/auth/login', 'POST', new URLSearchParams({ email: String(form.get('email')), password: String(form.get('password')) })),
    onSuccess: async () => {
      if (change) client.setQueryData(['me'], null)
      else {
        onSignedIn?.()
        await client.invalidateQueries({queryKey: ['me']})
      }
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    request.mutate(new FormData(event.currentTarget))
  }
  return <main className="auth-shell">
    <div className="auth-art"><Brand /><div className="auth-copy"><p>{t('authLine')}</p><span>{t('authText')}</span></div></div>
    <div className="auth-body">
      <Card className="auth-card">
        <div className="mobile-brand"><Brand /></div>
        <LanguagePicker className="auth-language" value={normalizeLocale(i18n.resolvedLanguage)} onChange={(locale: AppLocale) => {
          markLocalePending(locale)
          void changeLanguage(locale)
        }} />
        <h1>{t(change ? 'passwordTitle' : 'welcome')}</h1>
        <p className="muted">{t(change ? 'passwordIntro' : 'signInIntro')}</p>
        <form onSubmit={submit} className="fields">
          {change ? <Field title={t('current')}><Input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
            : <Field title={t('email')}><Input name="email" type="email" autoComplete="username" required /></Field>}
          <Field title={t(change ? 'newPassword' : 'password')}>
            <Input name="password" type="password" autoComplete={change ? 'new-password' : 'current-password'} minLength={change ? 8 : undefined} required />
          </Field>
          {change && <p className="muted small">{t('passwordHint')}</p>}
          <ErrorNotice error={request.error} />
          <Button type="submit" disabled={request.isPending}>{t(request.isPending ? 'working' : change ? 'savePassword' : 'signIn')}</Button>
          {change && <Button variant="ghost" onClick={onSignOut}>{t('signOut')}</Button>}
        </form>
      </Card>
    </div>
  </main>
}
