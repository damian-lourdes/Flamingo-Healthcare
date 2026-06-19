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

  // ── Delivery stats — calculation kept (backend still tracks this data via
  // state.delivery_stats), only the display card below was removed per
  // request. Re-add the Card block further down to restore the view.
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

      {/* "WhatsApp sending errors detected" banner removed per request —
          state.whatsapp_healthy / state.whatsapp_error are still tracked by
          the backend, only this display block was taken out. To restore,
          re-add the {state && state.outbound_healthy && !state.whatsapp_healthy && (...)}
          block that used to sit here. */}

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
          {/* "Message delivery (7 days)" card removed per request — dlSent/
              dlDelivered/dlRead/dlFailed/dlTotal/dlRate are still computed
              above (backend data still tracked), only this display Card was
              taken out. To restore, re-add the {dlTotal > 0 && (<Card .../>)}
              block that used to sit here. */}

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
