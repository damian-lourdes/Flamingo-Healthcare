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

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="Messages sent"     value={state ? engTotal : '—'} color="var(--teal)"   desc="all time" />
        <StatCard label="Patients reached"  value={state?.patients_reached ?? '—'} color="var(--blue)"   desc="unique numbers" />
        <StatCard label="Missed calls"      value={ds?.missed_calls ?? '—'} color="var(--red)"    desc="last 7 days" />
        <StatCard label="Pending callbacks" value={ds?.pending_callbacks ?? '—'} color="var(--amber)"  desc="in queue" />
        <StatCard label="Broadcasts sent"   value={state?.broadcasts_sent ?? '—'} color="var(--purple)" desc="campaigns" />
      </div>

      <div className="grid-2">
        <Card title="Engagement by trigger" subtitle="All time">
          {(state?.engagement_stats.length ?? 0) === 0
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

        <Card title="Recent calls">
          {calls.length === 0
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
  )
}
