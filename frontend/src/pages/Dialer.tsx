import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { StatCard, Card, CallBadge, Btn, Mono, Empty } from '../components/ui'
import { ago } from '../utils'
import type { DialerStats, CallRecord, CallbackRecord } from '../types'

export function DialerPage() {
  const [stats, setStats]       = useState<DialerStats | null>(null)
  const [calls, setCalls]       = useState<CallRecord[]>([])
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([])
  const [phone, setPhone]       = useState('')
  const [name, setName]         = useState('')
  const [dur, setDur]           = useState('')
  const [status, setStatus]     = useState('answered')
  const [logging, setLogging]   = useState(false)

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
    await api.logCall({ phone, caller_name: name || undefined, duration_sec: dur ? parseInt(dur) : undefined, status })
    setPhone(''); setName(''); setDur('')
    setLogging(false)
    load()
  }

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="Total calls (7d)"   value={stats?.total_calls ?? '—'}      color="var(--blue)" />
        <StatCard label="Answered"            value={stats?.answered_calls ?? '—'}   color="var(--green)" />
        <StatCard label="Missed"              value={stats?.missed_calls ?? '—'}     color="var(--red)" />
        <StatCard label="Callbacks pending"   value={stats?.pending_callbacks ?? '—'} color="var(--amber)" />
        <StatCard label="Avg duration"        value={stats?.avg_duration_sec ?? '—'} color="var(--teal)" desc="seconds" />
      </div>

      <div className="grid-2">
        <Card title="Callback queue" subtitle="Missed calls — need follow-up">
          {callbacks.length === 0
            ? <Empty msg="No pending callbacks 🎉" />
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
                        <Btn variant="sm" className="btn-primary" onClick={() => markDone(c.id, 'called_back')}>Called back</Btn>
                        <Btn variant="sm" onClick={() => markDone(c.id, 'ignored')}>Ignore</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Card>

        <Card title="Call log">
          {calls.length === 0
            ? <Empty msg="No calls logged yet" />
            : (
              <table>
                <thead>
                  <tr><th>Phone</th><th>Name</th><th>Status</th><th>Duration</th><th>When</th></tr>
                </thead>
                <tbody>
                  {calls.slice(0, 50).map(c => (
                    <tr key={c.id}>
                      <td><Mono>{c.phone}</Mono></td>
                      <td>{c.caller_name || '—'}</td>
                      <td><CallBadge status={c.status} /></td>
                      <td><Mono>{c.duration_sec ? `${c.duration_sec}s` : '—'}</Mono></td>
                      <td><Mono>{ago(c.called_at)}</Mono></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Card>
      </div>

      <Card title="Log a call manually" subtitle="For PBX without webhook support">
        <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr 100px 140px auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div className="form-label">Phone</div>
            <input className="inp" placeholder="+91 XXXXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <div className="form-label">Caller name</div>
            <input className="inp" placeholder="Optional" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <div className="form-label">Duration (s)</div>
            <input className="inp" type="number" placeholder="0" value={dur} onChange={e => setDur(e.target.value)} />
          </div>
          <div>
            <div className="form-label">Status</div>
            <select className="inp" value={status} onChange={e => setStatus(e.target.value)} style={{ background: 'var(--bg2)', cursor: 'pointer' }}>
              <option value="answered">Answered</option>
              <option value="missed">Missed</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </div>
          <Btn variant="primary" loading={logging} onClick={logCall}>Log call</Btn>
        </div>
      </Card>
    </div>
  )
}
