import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { Card, Mono, Empty, Btn } from '../components/ui'
import { ago } from '../utils'
import type { RecallRecord, FollowUpRecord } from '../types'

export function FollowUpsPage() {
  const [recalls,   setRecalls]   = useState<RecallRecord[]>([])
  const [followups, setFollowups] = useState<FollowUpRecord[]>([])

  const load = useCallback(async () => {
    const [r, f] = await Promise.all([api.recalls(), api.followups()])
    setRecalls(r)
    setFollowups(f)
  }, [])

  useEffect(() => { load() }, [load])

  const markDone = async (id: number) => {
    await api.markFollowUpDone(id)
    load()
  }

  return (
    <div>
      {/* Post Visit Follow Up */}
      <Card
        title="Post visit follow up"
        subtitle="Patients automatically scheduled for a check-in message 30, 60, or 90 days after their last visit. No action needed — messages send automatically."
        style={{ marginBottom: 12 }}
      >
        {recalls.length === 0
          ? <Empty msg="No post visit follow ups due" />
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

      {/* Follow-up Queue */}
      <Card
        title="Follow-up queue"
        subtitle="Patients who missed or cancelled an appointment and need to be contacted by reception to rebook. Mark as done once you have spoken to the patient."
      >
        {followups.length === 0
          ? <Empty msg="No pending follow-ups — all clear" />
          : (
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Phone</th>
                  <th>Doctor</th>
                  <th>Specialty</th>
                  <th>Original appt</th>
                  <th>Added</th>
                  <th>Action</th>
                </tr>
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
                    <td>
                      <Btn variant="sm" className="btn-primary" onClick={() => markDone(f.id)}>
                        Done
                      </Btn>
                    </td>
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
