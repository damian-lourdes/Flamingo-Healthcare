import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Card, Mono, Empty } from '../components/ui'
import { ago } from '../utils'
import type { RecallRecord, FollowUpRecord } from '../types'

export function FollowUpsPage() {
  const [recalls,  setRecalls]  = useState<RecallRecord[]>([])
  const [followups, setFollowups] = useState<FollowUpRecord[]>([])

  useEffect(() => {
    api.recalls().then(setRecalls)
    api.followups().then(setFollowups)
  }, [])

  return (
    <div>
      <Card title="Due recalls" subtitle="Patients due for a follow-up visit" style={{ marginBottom: 12 }}>
        {recalls.length === 0
          ? <Empty msg="No due recalls" />
          : (
            <table>
              <thead>
                <tr><th>Patient</th><th>Phone</th><th>Specialty</th><th>Due</th><th>Days</th></tr>
              </thead>
              <tbody>
                {recalls.map(r => (
                  <tr key={r.id}>
                    <td>{r.name || '—'}</td>
                    <td><Mono>{r.phone}</Mono></td>
                    <td>{r.specialty || '—'}</td>
                    <td><Mono>{r.recall_at ? ago(r.recall_at) : '—'}</Mono></td>
                    <td><Mono>{r.recall_days ? `${r.recall_days}d` : '—'}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Card>

      <Card title="Follow-up queue" subtitle="Patients who need a follow-up call">
        {followups.length === 0
          ? <Empty msg="No pending follow-ups" />
          : (
            <table>
              <thead>
                <tr><th>Patient</th><th>Phone</th><th>Doctor</th><th>Specialty</th><th>Original appt</th><th>Added</th></tr>
              </thead>
              <tbody>
                {followups.map(f => (
                  <tr key={f.id}>
                    <td>{f.name || '—'}</td>
                    <td><Mono>{f.phone}</Mono></td>
                    <td>{f.doctor || '—'}</td>
                    <td>{f.specialty || '—'}</td>
                    <td><Mono>{f.original_dt || '—'}</Mono></td>
                    <td><Mono>{ago(f.created_at)}</Mono></td>
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
