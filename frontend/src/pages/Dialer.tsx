import React, { useEffect, useState, useCallback } from 'react'
import { api, recordingUrl } from '../api/client'
import { StatCard, Card, CallBadge, Btn, Mono, Empty } from '../components/ui'
import { ago } from '../utils'
import type { DialerStats, CallRecord, CallbackRecord } from '../types'

const BASE = 'https://outbound-production-5e64.up.railway.app'

export function DialerPage() {
  const [stats, setStats]           = useState<DialerStats | null>(null)
  const [calls, setCalls]           = useState<CallRecord[]>([])
  const [callbacks, setCallbacks]   = useState<CallbackRecord[]>([])
  const [phone, setPhone]           = useState('')
  const [name, setName]             = useState('')
  const [dur, setDur]               = useState('')
  const [status, setStatus]         = useState('answered')
  const [logging, setLogging]       = useState(false)
  const [logResult, setLogResult]   = useState('')
  const [activeTab, setActiveTab]   = useState<'queue'|'log'|'manual'|'setup'>('queue')

  const load = useCallback(async () => {
    const [s, c, cb] = await Promise.all([api.dialerStats(), api.calls(), api.callbacks()])
    setStats(s); setCalls(c); setCallbacks(cb)
  }, [])

  useEffect(() => { load() }, [load])

  const markDone = async (id: number, s: string) => {
    await api.markCallbackDone(id, s)
    load()
  }

  const logCall = async () => {
    if (!phone) return
    setLogging(true)
    setLogResult('')
    await api.logCall({ phone, caller_name: name || undefined, duration_sec: dur ? parseInt(dur) : undefined, status })
    setPhone(''); setName(''); setDur('')
    setLogResult('Call logged successfully')
    setLogging(false)
    load()
    setTimeout(() => setLogResult(''), 3000)
  }

  const WEBHOOK_URL = `${BASE}/hooks/dialer/call`

  const tabs = [
    { key: 'queue',  label: `Callback queue${callbacks.length > 0 ? ` (${callbacks.length})` : ''}` },
    { key: 'log',    label: 'Call log' },
    { key: 'manual', label: 'Log manually' },
  ]

  return (
    <div>
      {/* Stats */}
      <div className="stat-grid">
        <StatCard label="Total calls (7d)"  value={stats?.total_calls ?? '—'}       color="var(--blue)" />
        <StatCard label="Answered"           value={stats?.answered_calls ?? '—'}    color="var(--green)" />
        <StatCard label="Missed"             value={stats?.missed_calls ?? '—'}      color="var(--red)" />
        <StatCard label="Callbacks pending"  value={stats?.pending_callbacks ?? '—'} color="var(--amber)" />
        <StatCard label="Avg duration"       value={stats?.avg_duration_sec ? `${stats.avg_duration_sec}s` : '—'} color="var(--teal)" desc="answered calls" />
      </div>

      <div className="card">
        {/* Tab bar */}
        <div className="tab-row">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key as any)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Callback queue ── */}
        {activeTab === 'queue' && (
          <div>
            {callbacks.length === 0
              ? <Empty msg="No pending callbacks — all clear 🎉" />
              : (
                <table>
                  <thead>
                    <tr><th>Phone</th><th>Name</th><th>Missed at</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {callbacks.map(c => (
                      <tr key={c.id}>
                        <td><Mono>{c.phone}</Mono></td>
                        <td>{c.caller_name || '—'}</td>
                        <td><Mono>{ago(c.missed_at)}</Mono></td>
                        <td style={{ display: 'flex', gap: 4 }}>
                          <Btn variant="sm" className="btn-primary" onClick={() => markDone(c.id, 'called_back')}>
                            Called back
                          </Btn>
                          <Btn variant="sm" onClick={() => markDone(c.id, 'ignored')}>
                            Ignore
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}

        {/* ── Call log ── */}
        {activeTab === 'log' && (
          <div>
            {calls.length === 0
              ? <Empty msg="No calls logged yet" />
              : (
                <table>
                  <thead>
                    <tr><th>Phone</th><th>Name</th><th>Status</th><th>Duration</th><th>When</th><th>Recording</th></tr>
                  </thead>
                  <tbody>
                    {calls.slice(0, 100).map(c => (
                      <tr key={c.id}>
                        <td><Mono>{c.phone}</Mono></td>
                        <td>{c.caller_name || '—'}</td>
                        <td><CallBadge status={c.status} /></td>
                        <td><Mono>{c.duration_sec ? `${c.duration_sec}s` : '—'}</Mono></td>
                        <td><Mono>{ago(c.called_at)}</Mono></td>
                        <td>
                          {c.recording_url
                            ? <audio controls preload="none" style={{ height: 28, width: 180 }} src={recordingUrl(c.id)} />
                            : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        )}

        {/* ── Manual log ── */}
        {activeTab === 'manual' && (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 14 }}>
              Use this when your PBX does not support webhooks, or to log a call that was missed in the system.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px 150px auto', gap: 10, alignItems: 'end' }}>
              <div>
                <div className="form-label">Phone number</div>
                <input className="inp" placeholder="+91 XXXXXXXXXX" value={phone}
                  onChange={e => setPhone(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && logCall()} />
              </div>
              <div>
                <div className="form-label">Caller name</div>
                <input className="inp" placeholder="Optional" value={name}
                  onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <div className="form-label">Duration (s)</div>
                <input className="inp" type="number" min="0" placeholder="0" value={dur}
                  onChange={e => setDur(e.target.value)} />
              </div>
              <div>
                <div className="form-label">Status</div>
                <select className="inp" value={status} onChange={e => setStatus(e.target.value)}
                  style={{ background: 'var(--bg2)', cursor: 'pointer' }}>
                  <option value="answered">Answered</option>
                  <option value="missed">Missed</option>
                  <option value="abandoned">Abandoned</option>
                </select>
              </div>
              <Btn variant="primary" loading={logging} onClick={logCall}>Log call</Btn>
            </div>
            {logResult && (
              <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--teal)', fontWeight: 500 }}>
                ✓ {logResult}
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text3)' }}>
              Missed calls logged here will automatically send a WhatsApp callback notice to the patient
              and appear in the Callback queue above.
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
