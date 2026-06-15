import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { StatCard, Card, CallBadge, Mono, Empty } from '../components/ui'
import { fmtTrigger, ago } from '../utils'
import type { DashboardState, CallRecord } from '../types'

export function OverviewPage() {
  const [state, setState] = useState<DashboardState | null>(null)
  const [calls, setCalls]   = useState<CallRecord[]>([])

  useEffect(() => {
    api.state().then(setState)
    api.calls(6).then(setCalls)
  }, [])

  const ds = state?.dialer_stats
  const engTotal = (state?.engagement_stats ?? []).reduce((s, r) => s + r.n, 0)

  // ── Delivery stats
  const delivery = state?.delivery_stats ?? {}
  const dlSent      = delivery['sent']      || 0
  const dlDelivered = delivery['delivered'] || 0
  const dlRead      = delivery['read']      || 0
  const dlFailed    = delivery['failed']    || 0
  const dlTotal     = dlSent + dlDelivered + dlRead + dlFailed
  const dlRate      = dlTotal > 0 ? Math.round(((dlDelivered + dlRead) / dlTotal) * 100) : null

  return (
    <div>

      {/* ── Service health alerts ── */}
      {state && !state.outbound_healthy && (
        <div style={{
          background: 'rgba(181,43,32,0.08)', border: '1px solid rgba(181,43,32,0.3)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--red)', fontSize: 14 }}>
              Outbound service offline
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
              WhatsApp automation is not running. Patient messages are not being sent.
              Check that the outbound service is running.
            </div>
          </div>
        </div>
      )}

      {state && state.outbound_healthy && !state.whatsapp_healthy && (
        <div style={{
          background: 'rgba(217,92,0,0.08)', border: '1px solid rgba(217,92,0,0.3)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--orange)', fontSize: 14 }}>
              WhatsApp sending errors detected
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
              {state.whatsapp_error || 'Multiple consecutive WhatsApp send failures detected. Check Meta API credentials and token validity.'}
            </div>
          </div>
        </div>
      )}

      {/* ── Stat grid ── */}
      <div className="stat-grid">
        <StatCard label="Messages sent"     value={state ? engTotal : '—'} color="var(--teal)"   desc="all time" />
        <StatCard label="Patients reached"  value={state?.patients_reached ?? '—'} color="var(--blue)"   desc="unique numbers" />
        <StatCard label="Missed calls"      value={ds?.missed_calls ?? '—'} color="var(--red)"    desc="last 7 days" />
        <StatCard label="Pending callbacks" value={ds?.pending_callbacks ?? '—'} color="var(--amber)"  desc="in queue" />
        <StatCard label="Consented patients" value={state?.consented_patients ?? '—'} color="var(--green)" desc="DPDP opt-in" />
      </div>

      <div className="grid-2">

        {/* ── Engagement by trigger ── */}
        <Card title="Engagement by trigger" subtitle="All time">
          {(state?.engagement_stats?.length ?? 0) === 0
            ? <Empty msg="No messages sent yet" />
            : (
              <table>
                <thead><tr><th>Trigger</th><th>Count</th></tr></thead>
                <tbody>
                  {(state?.engagement_stats ?? []).map(r => (
                    <tr key={r.trigger_type}>
                      <td>{fmtTrigger(r.trigger_type)}</td>
                      <td><Mono>{r.n}</Mono></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Card>

        {/* ── Right column ── */}
        <div>
          {/* Delivery stats */}
          {dlTotal > 0 && (
            <Card title="Message delivery (7 days)" subtitle={dlRate !== null ? `${dlRate}% delivery rate` : ''} style={{ marginBottom: 12 }}>
              <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Delivered', value: dlDelivered, color: 'var(--teal)' },
                  { label: 'Read',      value: dlRead,      color: 'var(--blue)' },
                  { label: 'Sent',      value: dlSent,      color: 'var(--text2)' },
                  { label: 'Failed',    value: dlFailed,    color: 'var(--red)' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', padding: '8px', background: 'var(--bg3)', borderRadius: 8 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'DM Mono', monospace" }}>{s.value}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recent calls */}
          <Card title="Recent calls">
            {(calls?.length ?? 0) === 0
              ? <Empty msg="No calls yet" />
              : (
                <table>
                  <thead><tr><th>Phone</th><th>Status</th><th>When</th></tr></thead>
                  <tbody>
                    {calls.slice(0, 6).map(c => (
                      <tr key={c.id}>
                        <td><Mono>{c.phone}</Mono></td>
                        <td><CallBadge status={c.status} /></td>
                        <td><Mono>{ago(c.called_at)}</Mono></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Card>
        </div>

      </div>
    </div>
  )
}
