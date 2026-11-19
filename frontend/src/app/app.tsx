import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ClipboardList, LogOut, Menu, Shield, UsersRound, X } from 'lucide-react'
import { Brand, ErrorNotice, LanguagePicker, Loading } from '@/components/common'
import { Button } from '@/components/ui/button'
import { AdminPage } from '@/features/admin/admin-page'
import { UsersPage } from '@/features/admin/users-page'
import { AuthScreen } from '@/features/auth/auth-screen'
import type { AuthSession, User } from '@/features/auth/types'
import { NewRepairPage } from '@/features/repairs/new-repair-page'
import { RepairDetailPage } from '@/features/repairs/repair-detail-page'
import { RepairListPage } from '@/features/repairs/repair-list-page'
import { DueBackPage, PilotReportPage } from '@/features/repairs/repair-operations'
import { ApiError, get, send } from '@/lib/api'
import { clearDeviceWork, hasDeviceWork, loadActiveSession, saveSession, updateOfflineAccess } from '@/lib/device-vault'
import { changeLanguage, clearPendingLocale, markLocalePending, normalizeLocale, pendingLocale, type AppLocale } from '@/app/i18n'
import i18n from '@/app/i18n'

export function App() {
  const { t } = useTranslation()
  const location = useLocation()
  const client = useQueryClient()
  const [locallySignedOut, setLocallySignedOut] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileMenuButton = useRef<HTMLButtonElement>(null)
  const workspace = useRef<HTMLElement>(null)
  const localeHydratedUser = useRef<string | null>(null)

  useEffect(() => {
    setMobileNavOpen(false)
    workspace.current?.focus({preventScroll: true})
  }, [location.pathname])

  useEffect(() => {
    if (!mobileNavOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMobileNavOpen(false)
      mobileMenuButton.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpen])
  const user = useQuery({queryKey: ['me'], enabled: !locallySignedOut, queryFn: async (): Promise<AuthSession> => {
    try {
      const session = await get<AuthSession>('/auth/me')
      const saved = await saveSession(session)
      setLocallySignedOut(false)
      return saved
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      const cached = await loadActiveSession()
      if (!cached || !cached.offlineAccessEnabled || Date.parse(cached.offlineUntil) <= Date.now()) throw error
      return {...cached, offline: true}
    }
  }})
  const signOut = useMutation({
    mutationFn: () => send('/auth/logout', 'POST'),
    onSuccess: async () => {
      if (user.data?.user.id) await clearDeviceWork(user.data.user.id)
      client.clear()
      setLocallySignedOut(true)
    },
    onError: (error) => { if (error instanceof ApiError && error.status === 401) client.clear() },
  })
  const offlineAccess = useMutation({
    mutationFn: (enabled: boolean) => updateOfflineAccess(user.data!.user.id, enabled),
    onSuccess: (updated) => { if (updated) client.setQueryData(['me'], updated) },
  })
  const localePreference = useMutation({
    mutationFn: (locale: AppLocale) => send<User>('/auth/locale', 'PUT', {locale}),
    onSuccess: async (updated) => {
      clearPendingLocale()
      await changeLanguage(normalizeLocale(updated.locale))
      const current = client.getQueryData<AuthSession>(['me'])
      if (current) client.setQueryData(['me'], await saveSession({...current, user: updated}))
    },
  })
  useEffect(() => {
    const session = user.data
    const profile = session?.user
    if (!profile) {
      localeHydratedUser.current = null
      return
    }
    if (localeHydratedUser.current === profile.id) return
    localeHydratedUser.current = profile.id
    const pending = pendingLocale()
    const locale = pending ?? (profile.locale ? normalizeLocale(profile.locale) : normalizeLocale(i18n.resolvedLanguage))
    if (pending && pending === profile.locale) {
      clearPendingLocale()
      void changeLanguage(locale)
      return
    }
    if (pending || !profile.locale) {
      markLocalePending(locale)
      void changeLanguage(locale)
      if (session.offline || !navigator.onLine) {
        void saveSession({...session, user: {...profile, locale}}).then(saved => client.setQueryData(['me'], saved))
      } else {
        localePreference.mutate(locale)
      }
      return
    }
    void changeLanguage(locale)
  }, [user.data?.user.id])

  useEffect(() => {
    const syncPendingPreference = () => {
      const current = client.getQueryData<AuthSession>(['me'])
      const pending = pendingLocale()
      if (navigator.onLine && current && !current.offline && pending && !localePreference.isPending) {
        localePreference.mutate(pending)
      }
    }
    window.addEventListener('online', syncPendingPreference)
    return () => window.removeEventListener('online', syncPendingPreference)
  }, [client, localePreference.isPending])

  const selectLocale = async (locale: AppLocale) => {
    markLocalePending(locale)
    await changeLanguage(locale)
    const current = client.getQueryData<AuthSession>(['me'])
    if (current?.offline || !navigator.onLine) {
      if (current) client.setQueryData(['me'], await saveSession({...current, user: {...current.user, locale}}))
      return
    }
    localePreference.mutate(locale)
  }
  const handleSignOut = async () => {
    const userId = user.data?.user.id
    let pending = false
    if (userId) {
      try { pending = await hasDeviceWork(userId) } catch { pending = true }
    }
    if (pending && !window.confirm(t('offline.signOutWarning'))) return
    if (!navigator.onLine) {
      if (userId) await clearDeviceWork(userId)
      client.clear()
      setLocallySignedOut(true)
      return
    }
    try {
      await signOut.mutateAsync()
    } catch (error) {
      if (error instanceof TypeError) {
        if (userId) await clearDeviceWork(userId)
        client.clear()
        setLocallySignedOut(true)
      }
    }
  }
  if (locallySignedOut) return <AuthScreen key="login" onSignedIn={() => setLocallySignedOut(false)} />
  if (user.isPending) return <main className="center"><Loading /></main>
  if (user.error && !(user.error instanceof ApiError && [401, 403].includes(user.error.status))) {
    return <main className="center"><ErrorNotice error={user.error} /><Button onClick={() => void user.refetch()}>{t('retry')}</Button></main>
  }
  if (!user.data || user.error) return <AuthScreen key="login" onSignedIn={() => setLocallySignedOut(false)} />
  const me = user.data.user
  if (me.mustChangePassword) return <AuthScreen key="change-password" change onSignOut={() => void handleSignOut()} />
  const platform = me.role === 'PLATFORM_ADMIN'
  const home = platform ? '/admin' : '/repairs'

  return <div className="shell">
    <aside className={'sidebar' + (mobileNavOpen ? ' mobile-nav-open' : '')}>
      <div className="sidebar-head">
        <NavLink to={home} aria-label="SuperFix"><Brand /></NavLink>
        <Button ref={mobileMenuButton} className="mobile-menu-toggle" variant="outline"
          aria-expanded={mobileNavOpen} aria-controls="primary-navigation"
          aria-label={t(mobileNavOpen ? 'closeMenu' : 'openMenu')}
          onClick={() => setMobileNavOpen(open => !open)}>
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
      </div>
      <div id="primary-navigation" className="sidebar-panel">
        <nav className="nav" aria-label={t('workspace')}>
          {platform ? <NavLink to="/admin"><Shield size={19} />{t('administration')}</NavLink> : <>
            <NavLink to="/repairs"><ClipboardList size={19} />{t('repairs')}</NavLink>
            <NavLink to="/returns"><CalendarClock size={19} />{t('returns.dueTitle')}</NavLink>
            {me.role === 'COMPANY_ADMIN' && <NavLink to="/team"><UsersRound size={19} />{t('team')}</NavLink>}
            {me.role === 'COMPANY_ADMIN' && <NavLink to="/pilot-report"><ClipboardList size={19} />{t('pilotReport.title')}</NavLink>}
          </>}
        </nav>
        <div className="sidebar-tools">
          <LanguagePicker value={normalizeLocale(i18n.resolvedLanguage)} onChange={selectLocale} />
          {user.data.offline && <div className="offline-notice" role="status">{t('offline.mode')}</div>}
          {me.role !== 'PLATFORM_ADMIN' && <label className="offline-toggle">
            <input type="checkbox" checked={Boolean(user.data.offlineAccessEnabled)}
              disabled={!navigator.onLine || Boolean(user.data.offline) || offlineAccess.isPending}
              onChange={event => offlineAccess.mutate(event.target.checked)} />
            <span>{t('offline.enableDevice')}</span>
          </label>}
          <div className="account">
            <span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span>
            <span className="account-name"><strong>{me.name}</strong><small>{t('role.' + me.role)}</small></span>
            <button type="button" onClick={() => void handleSignOut()} aria-label={t('signOut')} title={t('signOut')} disabled={signOut.isPending}><LogOut size={18} /></button>
          </div>
        </div>
      </div>
    </aside>
    <main ref={workspace} className="workspace" tabIndex={-1}>
      <ErrorNotice error={offlineAccess.error || signOut.error} />
      {localePreference.error && !(localePreference.error instanceof TypeError) &&
        <p className="notice notice-error" role="status">{t('languageSaveError')}</p>}
      <Routes>
        {platform ? <>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/companies/:companyId" element={<UsersPage user={me} />} />
        </> : <>
          <Route path="/repairs" element={<RepairListPage />} />
          <Route path="/repairs/new" element={<NewRepairPage />} />
          <Route path="/repairs/:id/*" element={<RepairDetailPage />} />
          <Route path="/returns" element={<DueBackPage />} />
          {me.role === 'COMPANY_ADMIN' && <Route path="/team" element={<UsersPage user={me} />} />}
          {me.role === 'COMPANY_ADMIN' && <Route path="/pilot-report" element={<PilotReportPage />} />}
        </>}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </main>
  </div>
}
