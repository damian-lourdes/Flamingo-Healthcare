import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { TabBar, Card, Btn, Mono, Empty } from '../components/ui'
import { parseRecipients, TEMPLATES } from '../utils'
import type { PatientProfile } from '../types'

export function PersonalisedPage() {
  const [tab, setTab] = useState('birthday')
  const [birthdays, setBirthdays] = useState<PatientProfile[]>([])

  // Birthday form
  const [bdPhone, setBdPhone] = useState('')
  const [bdName, setBdName]   = useState('')
  const [bdDob, setBdDob]     = useState('')

  // Custom msg
  const [pmMsg, setPmMsg]     = useState('')
  const [pmRecip, setPmRecip] = useState('')
  const [pmResult, setPmResult] = useState('')
  const [pmLoading, setPmLoading] = useState(false)

  // Scheduler
  const [schedResult, setSchedResult] = useState('')

  useEffect(() => {
    api.birthdays().then(setBirthdays)
  }, [])

  const saveBirthday = async () => {
    if (!bdPhone || !bdDob) return
    await api.upsertPatient({ phone: bdPhone, name: bdName || undefined, dob: bdDob })
    setBdPhone(''); setBdName(''); setBdDob('')
    api.birthdays().then(setBirthdays)
  }

  const runScheduler = async (job: string) => {
    const r = await api.runScheduler(job)
    setSchedResult(r.message || 'Running…')
    setTimeout(() => setSchedResult(''), 3000)
  }

  const sendPersonalised = async () => {
    if (!pmMsg || !pmRecip) return
    setPmLoading(true)
    let sent = 0, failed = 0
    for (const { phone, name } of parseRecipients(pmRecip)) {
      try { await api.sendPersonalised({ phone, name: name ?? phone, message: pmMsg }); sent++ }
      catch { failed++ }
    }
    setPmResult(`Done — sent: ${sent} failed: ${failed}`)
    setPmLoading(false)
  }

  return (
    <div className="card">
      <TabBar
        tabs={[
          { key: 'birthday', label: 'Birthday messages' },
          { key: 'custom',   label: 'Custom message' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'birthday' && (
        <div style={{ padding: 16 }}>
          {/* Automation status banner */}
          <div style={{ background: 'var(--teal-dim)', border: '1px solid var(--teal-b)', borderRadius: 'var(--rs)', padding: '12px 15px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--teal)' }}>Automation is ON</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>All personalised messages run automatically every day at 9:00 AM</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 5 }}>
                Birthdays &nbsp;·&nbsp; Anniversaries &nbsp;·&nbsp; Festival greetings &nbsp;·&nbsp;
                7-day post-visit &nbsp;·&nbsp; 90-day re-engagement &nbsp;·&nbsp; Recalls &nbsp;·&nbsp; No-show recovery
              </div>
              {schedResult && <div style={{ fontSize: 13, color: 'var(--teal)', marginTop: 6 }}>✓ {schedResult}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Btn variant="primary" onClick={() => runScheduler('birthdays')}>Run birthdays now</Btn>
              <Btn onClick={() => runScheduler('all')}>Run all now</Btn>
            </div>
          </div>

          <Card title="Today's birthdays" subtitle="Sent automatically at 9 AM" style={{ marginBottom: 12 }}>
            {birthdays.length === 0
              ? <Empty msg="No birthdays today" />
              : (
                <table>
                  <thead><tr><th>Name</th><th>Phone</th><th>Age</th></tr></thead>
                  <tbody>
                    {birthdays.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>{p.name || '—'}</td>
                        <td><Mono>{p.phone}</Mono></td>
                        <td><Mono>{p.dob ? new Date().getFullYear() - new Date(p.dob).getFullYear() : '—'}</Mono></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Card>

          <Card title="Add patient birthday" subtitle="Birthday messages are sent automatically">
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
              <div>
                <div className="form-label">Phone</div>
                <input className="inp" placeholder="+91 XXXXXXXXXX" value={bdPhone} onChange={e => setBdPhone(e.target.value)} />
              </div>
              <div>
                <div className="form-label">Name</div>
                <input className="inp" placeholder="Patient name" value={bdName} onChange={e => setBdName(e.target.value)} />
              </div>
              <div>
                <div className="form-label">Date of birth</div>
                <input className="inp" type="date" value={bdDob} onChange={e => setBdDob(e.target.value)} />
              </div>
              <Btn variant="primary" onClick={saveBirthday}>Save</Btn>
            </div>
          </Card>
        </div>
      )}

      {tab === 'custom' && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Template</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                {Object.entries({ anniversary: 'Anniversary', followup: 'Follow-up nudge', health: 'Health reminder', festival: 'Festival wishes' })
                  .map(([key, label]) => (
                    <Btn key={key} style={{ fontSize: 12.5 }} onClick={() => setPmMsg(TEMPLATES[key])}>{label}</Btn>
                  ))}
              </div>
              <div className="form-label" style={{ marginBottom: 8 }}>
                Message <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{'{'} name {'}'} {'{'} hospital {'}'}</span>
              </div>
              <textarea className="inp" id="pm-msg" rows={7} style={{ resize: 'vertical' }}
                placeholder="Hi {name}! …" value={pmMsg} onChange={e => setPmMsg(e.target.value)} />
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Send to</div>
              <textarea className="inp" rows={8} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13, marginBottom: 10 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={pmRecip} onChange={e => setPmRecip(e.target.value)} />
              <Btn variant="primary" style={{ width: '100%' }} loading={pmLoading} onClick={sendPersonalised}>
                Send personalised messages
              </Btn>
              {pmResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{pmResult}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
