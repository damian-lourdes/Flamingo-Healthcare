import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Card, Mono, Empty } from '../components/ui'
import { ago } from '../utils'
import type { RecallRecord, FollowUpRecord } from '../types'

export function RecallsPage() {
  const [recalls, setRecalls]   = useState<RecallRecord[]>([])
  const [followups, setFollowups] = useState<FollowUpRecord[]>([])

  useEffect(() => {
    api.recalls().then(setRecalls)
    api.followups().then(setFollowups)
  }, [])

  return (
    <div className="grid-2">
      <Card title="Due recalls" subtitle="30/60/90-day check-up reminders">
        {recalls.length === 0
          ? <Empty msg="No due recalls" />
          : (
            <table>
              <thead><tr><th>Patient</th><th>Specialty</th><th>Days</th><th>Due</th></tr></thead>
              <tbody>
                {recalls.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.name || r.phone}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12.5 }}>{r.specialty || '—'}</td>
                    <td><Mono>{r.recall_days}d</Mono></td>
                    <td><Mono>{ago(r.recall_at)}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Card>

      <Card title="No-show recovery queue">
        {followups.length === 0
          ? <Empty msg="No pending follow-ups" />
          : (
            <table>
              <thead><tr><th>Patient</th><th>Doctor</th><th>Missed slot</th></tr></thead>
              <tbody>
                {followups.map(f => (
                  <tr key={f.id}>
                    <td style={{ fontWeight: 500 }}>{f.name || f.phone}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12.5 }}>{f.doctor || '—'}</td>
                    <td><Mono>{f.original_dt || '—'}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Card>
    </div>
  )
}
