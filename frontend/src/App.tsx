import React, { useEffect, useState } from 'react'
import { Sidebar }          from './components/Sidebar'
import { LoginPage }        from './pages/Login'
import { OverviewPage }     from './pages/Overview'
import { HistoryPage }      from './pages/History'
import { DialerPage }       from './pages/Dialer'
import { FollowUpsPage }      from './pages/Recalls'
import { BroadcastPage }    from './pages/Broadcast'
import { PersonalisedPage } from './pages/Personalised'
import { AutomationsPage }  from './pages/Automations'
import {
  api, getStatus, onStatusChange, onAuthChange,
  isLoggedIn, getUser, clearAuth,
  type BackendStatus,
} from './api/client'
import type { Page } from './types'

const PAGE_META: Record<Page, [string, string]> = {
  overview:    ['Overview',          'Live stats'],
  history:     ['Message History',   'Date-wise outbound WhatsApp messages'],
  dialer:      ['Dialer',            'Inbound call tracking & callbacks'],
  followups:     ['Follow Ups',           'Due followups & no-show recovery'],
  broadcast:   ['Campaigns',         'Health tips, offers, packages'],
  personalised:['Personalised',      'Birthday, anniversary, custom messages'],
  automations: ['Message Templates', 'Every outgoing WhatsApp message — full library'],
}

export default function App() {
  const [loggedIn, setLoggedIn]         = useState(isLoggedIn())
  const [username, setUsername]         = useState(getUser() ?? '')
  const [page, setPage]                 = useState<Page>('overview')
  const [status, setStatus]             = useState<BackendStatus>(getStatus())
  const [callbackCount, setCallbackCount] = useState(0)
  const [followupCount, setFollowUpCount]     = useState(0)

  // Auth change listener (handles 401 auto-logout)
  useEffect(() => onAuthChange(() => {
    setLoggedIn(false)
    setUsername('')
  }), [])

  // Backend status
  useEffect(() => onStatusChange(setStatus), [])

  // Badge counts — only when logged in
  const loadCounts = async () => {
    if (!isLoggedIn()) return
    const [cbs, followups, fups] = await Promise.all([
      api.callbacks(),
      api.followups(),
      api.followups(),
    ])
    setCallbackCount(cbs.length)
    setFollowUpCount((followups?.length ?? 0) + (fups?.length ?? 0))
  }

  useEffect(() => {
    if (!loggedIn) return
    loadCounts()
    const t = setInterval(loadCounts, 30000)
    return () => clearInterval(t)
  }, [loggedIn])

  const handleLogin = (user: string) => {
    setUsername(user)
    setLoggedIn(true)
  }

  const handleLogout = () => {
    clearAuth()
    setLoggedIn(false)
    setUsername('')
    setPage('overview')
  }

  // ── Not logged in → show login page ────────────────────────────────────────
  if (!loggedIn) {
    return <LoginPage onLogin={handleLogin} />
  }

  // ── Logged in → show dashboard ─────────────────────────────────────────────
  const [title, subtitle] = PAGE_META[page]
  const statusLabel = status === 'live' ? 'System live' : status === 'demo' ? 'Demo data' : 'Offline'
  const statusColor = status === 'live' ? 'var(--text2)' : status === 'demo' ? 'var(--amber)' : 'var(--orange)'
  const dotClass    = status === 'live' ? 'live' : status === 'demo' ? 'demo' : 'offline'

  return (
    <div className="app">
      <Sidebar
        current={page}
        onChange={setPage}
        callbackCount={callbackCount}
        followupCount={followupCount}
        username={username}
        onLogout={handleLogout}
      />

      <div className="main">
        <div className="topbar">
          <div style={{ flex: 1 }}>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{subtitle}</div>
          </div>
          <div className="topbar-status" style={{ color: statusColor }}>
            <span className={`status-dot ${dotClass}`} />
            <span>{statusLabel}</span>
          </div>
          <button className="btn" onClick={loadCounts}>↻ Refresh</button>
        </div>

        <div className="content">
          {page === 'overview'     && <OverviewPage />}
          {page === 'history'      && <HistoryPage />}
          {page === 'dialer'       && <DialerPage />}
          {page === 'followups'      && <FollowUpsPage />}
          {page === 'broadcast'    && <BroadcastPage />}
          {page === 'personalised' && <PersonalisedPage />}
          {page === 'automations'  && <AutomationsPage />}
        </div>
      </div>
    </div>
  )
}
