import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { TabBar, Card, Btn, Mono, Empty } from '../components/ui'
import { parseRecipients, ago } from '../utils'
import type { BroadcastCampaign } from '../types'

export function BroadcastPage() {
  const [tab, setTab] = useState('health-tip')
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([])

  // Health tip fields
  const [htName, setHtName]       = useState('')
  const [htMsg, setHtMsg]         = useState('')
  const [htRecip, setHtRecip]     = useState('')
  const [htResult, setHtResult]   = useState('')
  const [htLoading, setHtLoading] = useState(false)

  // Offer fields
  const [ofTitle, setOfTitle]     = useState('')
  const [ofDetails, setOfDetails] = useState('')
  const [ofValid, setOfValid]     = useState('')
  const [ofRecip, setOfRecip]     = useState('')
  const [ofResult, setOfResult]   = useState('')
  const [ofLoading, setOfLoading] = useState(false)

  const loadHistory = () => api.broadcastHistory().then(setCampaigns)
  useEffect(() => { loadHistory() }, [])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab])

  const sendHT = async () => {
    if (!htMsg || !htRecip) return
    setHtLoading(true)
    const r = await api.sendHealthTip({ campaign_name: htName || 'Health tip', message: htMsg, recipients: parseRecipients(htRecip) })
    setHtResult(r.success === false ? (r as any).message : `Done — sent: ${r.sent} failed: ${r.failed}`)
    setHtLoading(false)
    loadHistory()
  }

  const sendOffer = async () => {
    if (!ofTitle || !ofRecip) return
    setOfLoading(true)
    const r = await api.sendOffer({ offer_title: ofTitle, offer_details: ofDetails, valid_till: ofValid || undefined, recipients: parseRecipients(ofRecip) })
    setOfResult(r.success === false ? (r as any).message : `Done — sent: ${r.sent} failed: ${r.failed}`)
    setOfLoading(false)
    loadHistory()
  }

  return (
    <div className="card">
      <TabBar
        tabs={[
          { key: 'health-tip', label: 'Health tip' },
          { key: 'offer',      label: 'Offer / package' },
          { key: 'history',    label: 'Campaign history' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'health-tip' && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>Campaign name</div>
              <input className="inp" placeholder="e.g. June Diabetes Tips" value={htName} onChange={e => setHtName(e.target.value)} style={{ marginBottom: 10 }} />
              <div className="form-label" style={{ marginBottom: 4 }}>
                Message <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— use {'{'} name {'}'} for patient name</span>
              </div>
              <textarea className="inp" rows={6} style={{ resize: 'vertical' }} placeholder="Hi {name}! 👋 Health tip from Flamingo Healthcare..."
                value={htMsg} onChange={e => setHtMsg(e.target.value)} />
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Variables: {'{'} name {'}'} {'{'} hospital {'}'}</div>
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>
                Recipients <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— one per line: +91XXXXXXXXXX,Name</span>
              </div>
              <textarea className="inp" rows={8} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={htRecip} onChange={e => setHtRecip(e.target.value)} />
              <div style={{ marginTop: 10 }}>
                <Btn variant="primary" style={{ width: '100%' }} loading={htLoading} onClick={sendHT}>Send health tip</Btn>
              </div>
              {htResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{htResult}</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'offer' && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <input className="inp" placeholder="Offer title e.g. Free Health Check-up Camp" value={ofTitle} onChange={e => setOfTitle(e.target.value)} style={{ marginBottom: 8 }} />
              <textarea className="inp" rows={4} style={{ resize: 'vertical', marginBottom: 8 }} placeholder="Offer details — what is included, who can avail..."
                value={ofDetails} onChange={e => setOfDetails(e.target.value)} />
              <input className="inp" placeholder="Valid till (e.g. 30 June 2026)" value={ofValid} onChange={e => setOfValid(e.target.value)} />
            </div>
            <div>
              <textarea className="inp" rows={7} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13, marginBottom: 10 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={ofRecip} onChange={e => setOfRecip(e.target.value)} />
              <Btn variant="primary" style={{ width: '100%' }} loading={ofLoading} onClick={sendOffer}>Send offer</Btn>
              {ofResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{ofResult}</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div>
          {campaigns.length === 0
            ? <Empty msg="No campaigns yet" />
            : (
              <table>
                <thead>
                  <tr><th>Campaign</th><th>Sent</th><th>Failed</th><th>Recipients</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {campaigns.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 500 }}>{b.name || '—'}</td>
                      <td><span className="mono" style={{ color: 'var(--teal)' }}>{b.sent_count}</span></td>
                      <td><span className="mono" style={{ color: 'var(--red)' }}>{b.failed_count}</span></td>
                      <td><Mono>{b.recipient_count}</Mono></td>
                      <td><Mono>{ago(b.sent_at)}</Mono></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      )}
    </div>
  )
}
