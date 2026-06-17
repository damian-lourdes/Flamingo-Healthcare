import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { TabBar, Card, Btn, Mono, Empty, Select } from '../components/ui'
import { parseRecipients, ago, renderTemplatePreview } from '../utils'
import type { BroadcastCampaign, BroadcastList, BroadcastListMember } from '../types'

type WTemplate = { name: string; language: string; category: string; status: string; placeholder_count: number; body_text: string; examples?: string[]; synced_at?: string }

// A small WhatsApp-style bubble showing exactly what the message will look
// like once placeholders are filled in — same rendering logic Meta uses,
// done client-side so staff see it before they send anything.
function MessagePreview({ bodyText, recipientName, extraParams }: { bodyText: string; recipientName: string; extraParams: string[] }) {
  if (!bodyText) return null
  const text = renderTemplatePreview(bodyText, recipientName, extraParams)
  return (
    <div style={{ marginTop: 10 }}>
      <div className="form-label" style={{ marginBottom: 4, fontSize: 11.5, color: 'var(--text3)' }}>Preview</div>
      <div style={{
        background: '#E7FFDB', borderRadius: '10px 10px 10px 2px', padding: '10px 12px',
        fontSize: 13.5, lineHeight: 1.5, color: '#111', whiteSpace: 'pre-wrap',
        maxWidth: 360, boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      }}>
        {text}
      </div>
    </div>
  )
}

// Small read-only status tag for tabs that always use one fixed, known
// template (Health tip, Offer) — shows whether it's still approved on
// Meta's side, sourced from the same sync cache the Camp tab uses.
function TemplateStatusBadge({ templateName, allTemplates }: { templateName: string; allTemplates: WTemplate[] }) {
  const t = allTemplates.find(x => x.name === templateName)
  if (!t) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--bg2)', display: 'inline-block', padding: '3px 9px', borderRadius: 6, marginBottom: 10 }}>
        📋 Template <Mono>{templateName}</Mono> — not yet synced. Click Sync on the Camp tab to check its status.
      </div>
    )
  }
  const ok = t.status === 'APPROVED'
  return (
    <div style={{
      fontSize: 12, display: 'inline-block', padding: '3px 9px', borderRadius: 6, marginBottom: 10,
      background: ok ? 'var(--bg2)' : '#FDECEC', color: ok ? 'var(--text2)' : '#B42318',
    }}>
      {ok ? '📋' : '⚠️'} Using approved template <Mono>{templateName}</Mono>
      {!ok && ` — status: ${t.status}. Sends may not deliver until approved.`}
      {t.synced_at && <span style={{ color: 'var(--text3)' }}> · synced {ago(t.synced_at)}</span>}
    </div>
  )
}

// Loads recipients into the shared textarea either from every opted-in
// patient or from a saved broadcast list, in the same "phone,Name" format
// the manual textarea expects — so the result stays visible and editable
// before sending.
function RecipientPicker({ onLoad }: { onLoad: (text: string, info: string) => void }) {
  const [lists, setLists] = useState<BroadcastList[]>([])
  const [loadingAll, setLoadingAll]   = useState(false)
  const [loadingList, setLoadingList] = useState(false)

  useEffect(() => { api.broadcastLists().then(setLists) }, [])

  const toLines = (rows: { phone: string; name?: string | null }[]) =>
    rows.map(r => r.name ? `${r.phone},${r.name}` : r.phone).join('\n')

  const loadAll = async () => {
    setLoadingAll(true)
    try {
      const patients = await api.patients()
      const opted = patients.filter(p => p.opt_in !== false)
      onLoad(toLines(opted), `Loaded ${opted.length} opted-in patient${opted.length === 1 ? '' : 's'}`)
    } finally { setLoadingAll(false) }
  }

  const loadList = async (id: string) => {
    if (!id) return
    setLoadingList(true)
    try {
      const members = await api.broadcastListMembers(Number(id))
      const list = lists.find(l => String(l.id) === id)
      onLoad(toLines(members), `Loaded ${members.length} recipient${members.length === 1 ? '' : 's'} from "${list?.name || 'list'}"`)
    } finally { setLoadingList(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
      <Btn variant="sm" loading={loadingAll} onClick={loadAll}>All opted-in patients</Btn>
      {lists.length > 0 && (
        <Select
          defaultValue=""
          disabled={loadingList}
          onChange={e => loadList(e.target.value)}
          style={{ width: 'auto', fontSize: 12.5, padding: '4px 8px' }}
        >
          <option value="">Saved list…</option>
          {lists.map(l => (
            <option key={l.id} value={l.id}>{l.name} ({l.phone_count})</option>
          ))}
        </Select>
      )}
      <span style={{ fontSize: 12, color: 'var(--text3)' }}>or type/edit recipients below</span>
    </div>
  )
}

export function BroadcastPage() {
  const [tab, setTab] = useState('health-tip')
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([])

  // Health tip fields
  const [htName, setHtName]       = useState('')
  const [htMsg, setHtMsg]         = useState('')
  const [htRecip, setHtRecip]     = useState('')
  const [htInfo, setHtInfo]       = useState('')
  const [htResult, setHtResult]   = useState('')
  const [htLoading, setHtLoading] = useState(false)

  // Offer fields
  const [ofTitle, setOfTitle]     = useState('')
  const [ofDetails, setOfDetails] = useState('')
  const [ofValid, setOfValid]     = useState('')
  const [ofRecip, setOfRecip]     = useState('')
  const [ofInfo, setOfInfo]       = useState('')
  const [ofResult, setOfResult]   = useState('')
  const [ofLoading, setOfLoading] = useState(false)

  // Camp tab — live Meta template picker (replaces the old fixed form)
  const [templates, setTemplates]   = useState<WTemplate[]>([])
  const [tplLoading, setTplLoading] = useState(false)
  const [syncing, setSyncing]       = useState(false)
  const [syncMsg, setSyncMsg]       = useState('')
  const [selTpl, setSelTpl]         = useState('')
  const [tplValues, setTplValues]   = useState<string[]>([])
  const [cpRecip, setCpRecip]       = useState('')
  const [cpInfo, setCpInfo]         = useState('')
  const [cpResult, setCpResult]     = useState('')
  const [cpLoading, setCpLoading]   = useState(false)

  // Monthly tip
  const [mtTip, setMtTip]         = useState('')
  const [mtLoading, setMtLoading] = useState(false)
  const [mtResult, setMtResult]   = useState('')

  // Lists tab
  const [lists, setLists]           = useState<BroadcastList[]>([])
  const [listName, setListName]     = useState('')
  const [listDesc, setListDesc]     = useState('')
  const [listRecip, setListRecip]   = useState('')
  const [listInfo, setListInfo]     = useState('')
  const [listResult, setListResult] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [members, setMembers] = useState<Record<number, BroadcastListMember[]>>({})
  const [membersLoading, setMembersLoading] = useState<number | null>(null)

  // Live status of every synced template (incl. non-approved), for the
  // Health-tip/Offer status badges. Fetched once on mount — cheap, local cache read.
  const [allTemplates, setAllTemplates] = useState<WTemplate[]>([])
  useEffect(() => { api.listAllTemplates().then(setAllTemplates) }, [])

  const loadHistory = () => api.broadcastHistory().then(setCampaigns)
  useEffect(() => { loadHistory() }, [])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab])
  useEffect(() => {
    if (tab === 'monthly') api.getSetting('monthly_health_tip').then(r => setMtTip(r.value || ''))
  }, [tab])
  useEffect(() => { if (tab === 'camp') loadTemplates() }, [tab])

  const loadLists = () => api.broadcastLists().then(setLists)
  useEffect(() => { if (tab === 'lists') loadLists() }, [tab])

  const loadTemplates = async () => {
    setTplLoading(true)
    const list = await api.listTemplates()
    setTemplates(list)
    setTplLoading(false)
  }

  const syncTemplates = async () => {
    setSyncing(true); setSyncMsg('')
    const r = await api.syncTemplates()
    setSyncing(false)
    setSyncMsg(r.success ? `Synced — ${r.synced} template(s) from Meta` : (r.message || 'Sync failed'))
    if (r.success) loadTemplates()
  }

  const selectTemplate = (name: string) => {
    setSelTpl(name)
    setCpResult('')
    const t = templates.find(x => x.name === name)
    const extra = t ? Math.max(0, t.placeholder_count - 1) : 0
    const seed = t?.examples?.slice(1) || []
    setTplValues(Array.from({ length: extra }, (_, i) => seed[i] || ''))
  }

  const sendTpl = async () => {
    if (!selTpl || !cpRecip) return
    setCpLoading(true)
    const t = templates.find(x => x.name === selTpl)
    const r = await api.sendTemplateMsg({
      name: selTpl, language: t?.language || 'en',
      params: tplValues, recipients: parseRecipients(cpRecip),
      campaignName: selTpl,
    })
    setCpResult(r.success === false ? (r as any).message : `Done — sent: ${r.sent} failed: ${r.failed}`)
    setCpLoading(false)
    loadHistory()
  }

  const toggleMembers = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!members[id]) {
      setMembersLoading(id)
      const rows = await api.broadcastListMembers(id)
      setMembers(m => ({ ...m, [id]: rows }))
      setMembersLoading(null)
    }
  }

  const createList = async () => {
    if (!listName || !listRecip) return
    setListLoading(true)
    const phones = parseRecipients(listRecip).map(r => r.phone)
    const r = await api.createBroadcastList({ name: listName, description: listDesc || undefined, phones })
    if ((r as any).success === false) {
      setListResult('Save failed')
    } else {
      setListResult(`Saved "${listName}" with ${phones.length} recipient${phones.length === 1 ? '' : 's'}`)
      setListName(''); setListDesc(''); setListRecip(''); setListInfo('')
      loadLists()
    }
    setListLoading(false)
  }

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

  const saveMonthly = async () => {
    setMtLoading(true)
    const r = await api.setSetting('monthly_health_tip', mtTip)
    setMtResult((r as any).success === false ? 'Save failed' : 'Saved — used automatically on the 1st of each month')
    setMtLoading(false)
  }

  const selectedTemplate = templates.find(t => t.name === selTpl)

  return (
    <div className="card">
      <TabBar
        tabs={[
          { key: 'health-tip', label: 'Health tip' },
          { key: 'offer',      label: 'Offer / package' },
          { key: 'camp',       label: 'Camp' },
          { key: 'monthly',    label: 'Monthly tip' },
          { key: 'lists',      label: 'Lists' },
          { key: 'history',    label: 'Campaign history' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'health-tip' && (
        <div style={{ padding: 16 }}>
          <TemplateStatusBadge templateName="monthly_health_tip" allTemplates={allTemplates} />
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
              <MessagePreview bodyText={htMsg.replace(/\{name\}/g, '{{1}}')} recipientName="Patient Name" extraParams={[]} />
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>
                Recipients <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— one per line: +91XXXXXXXXXX,Name</span>
              </div>
              <RecipientPicker onLoad={(text, info) => { setHtRecip(text); setHtInfo(info) }} />
              <textarea className="inp" rows={8} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={htRecip} onChange={e => { setHtRecip(e.target.value); setHtInfo('') }} />
              {htInfo && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{htInfo}</div>}
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
          <TemplateStatusBadge templateName="health_package_offer" allTemplates={allTemplates} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <input className="inp" placeholder="Offer title e.g. Free Health Check-up Camp" value={ofTitle} onChange={e => setOfTitle(e.target.value)} style={{ marginBottom: 8 }} />
              <textarea className="inp" rows={4} style={{ resize: 'vertical', marginBottom: 8 }} placeholder="Offer details — what is included, who can avail..."
                value={ofDetails} onChange={e => setOfDetails(e.target.value)} />
              <input className="inp" placeholder="Valid till (e.g. 30 June 2026)" value={ofValid} onChange={e => setOfValid(e.target.value)} />
              <MessagePreview
                bodyText={(allTemplates.find(t => t.name === 'health_package_offer')?.body_text) || ''}
                recipientName="Patient Name"
                extraParams={[ofTitle, ofDetails, ofValid]}
              />
            </div>
            <div>
              <RecipientPicker onLoad={(text, info) => { setOfRecip(text); setOfInfo(info) }} />
              <textarea className="inp" rows={7} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13, marginBottom: 4 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={ofRecip} onChange={e => { setOfRecip(e.target.value); setOfInfo('') }} />
              {ofInfo && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{ofInfo}</div>}
              <Btn variant="primary" style={{ width: '100%', marginTop: 6 }} loading={ofLoading} onClick={sendOffer}>Send offer</Btn>
              {ofResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{ofResult}</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'camp' && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
              Templates are pulled live from Meta — only ones approved there can be sent.
            </div>
            <Btn variant="sm" loading={syncing} onClick={syncTemplates}>↻ Sync from Meta</Btn>
          </div>
          {syncMsg && <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>{syncMsg}</div>}

          {tplLoading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading templates…</div>
          ) : templates.length === 0 ? (
            <Empty msg="No approved templates yet — submit one in WhatsApp Manager, then Sync from Meta." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div className="form-label" style={{ marginBottom: 4 }}>Template</div>
                <select className="inp" value={selTpl} onChange={e => selectTemplate(e.target.value)} style={{ marginBottom: 10 }}>
                  <option value="">Select an approved template…</option>
                  {templates.map(t => (
                    <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>
                  ))}
                </select>

                {selectedTemplate && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--bg2)', borderRadius: 8, padding: 10, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                    {selectedTemplate.body_text}
                  </div>
                )}

                {selectedTemplate && tplValues.map((v, i) => (
                  <input key={i} className="inp" style={{ marginBottom: 8 }}
                    placeholder={`{{${i + 2}}}`}
                    value={v}
                    onChange={e => setTplValues(vals => vals.map((x, j) => j === i ? e.target.value : x))} />
                ))}
                {selectedTemplate && tplValues.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>This template only needs the recipient's name — no extra fields.</div>
                )}
                {selectedTemplate && (
                  <MessagePreview bodyText={selectedTemplate.body_text} recipientName="Patient Name" extraParams={tplValues} />
                )}
              </div>
              <div>
                <RecipientPicker onLoad={(text, info) => { setCpRecip(text); setCpInfo(info) }} />
                <textarea className="inp" rows={8} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13, marginBottom: 4 }}
                  placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                  value={cpRecip} onChange={e => { setCpRecip(e.target.value); setCpInfo('') }} />
                {cpInfo && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{cpInfo}</div>}
                <Btn variant="primary" style={{ width: '100%', marginTop: 6 }} loading={cpLoading} disabled={!selTpl} onClick={sendTpl}>Send template</Btn>
                {cpResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{cpResult}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'monthly' && (
        <div style={{ padding: 16, maxWidth: 640 }}>
          <div className="form-label" style={{ marginBottom: 4 }}>Monthly health tip</div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 8 }}>
            Sent automatically to all opted-in patients on the 1st of each month, via the approved <Mono>monthly_health_tip</Mono> template. Edit the tip text below.
          </div>
          <textarea className="inp" rows={5} style={{ resize: 'vertical' }} placeholder="e.g. Stay hydrated and aim for 30 minutes of activity daily."
            value={mtTip} onChange={e => setMtTip(e.target.value)} />
          <div style={{ marginTop: 10 }}>
            <Btn variant="primary" loading={mtLoading} onClick={saveMonthly}>Save monthly tip</Btn>
          </div>
          {mtResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{mtResult}</div>}
        </div>
      )}

      {tab === 'lists' && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>List name</div>
              <input className="inp" placeholder="e.g. Diabetic patients — Ambattur" value={listName}
                onChange={e => setListName(e.target.value)} style={{ marginBottom: 8 }} />
              <div className="form-label" style={{ marginBottom: 4 }}>Description (optional)</div>
              <input className="inp" placeholder="e.g. For monthly diabetes-care tips" value={listDesc}
                onChange={e => setListDesc(e.target.value)} />
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>
                Recipients <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— one per line: +91XXXXXXXXXX,Name</span>
              </div>
              <RecipientPicker onLoad={(text, info) => { setListRecip(text); setListInfo(info) }} />
              <textarea className="inp" rows={6} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={listRecip} onChange={e => { setListRecip(e.target.value); setListInfo('') }} />
              {listInfo && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{listInfo}</div>}
              <div style={{ marginTop: 10 }}>
                <Btn variant="primary" style={{ width: '100%' }} loading={listLoading} onClick={createList}>Save list</Btn>
              </div>
              {listResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{listResult}</div>}
            </div>
          </div>

          {lists.length === 0
            ? <Empty msg="No saved lists yet" />
            : (
              <table>
                <thead>
                  <tr><th>Name</th><th>Description</th><th>Recipients</th><th>Created</th><th></th></tr>
                </thead>
                <tbody>
                  {lists.map(l => (
                    <React.Fragment key={l.id}>
                      <tr>
                        <td style={{ fontWeight: 500 }}>{l.name || '—'}</td>
                        <td style={{ color: 'var(--text3)' }}>{l.description || '—'}</td>
                        <td><Mono>{l.phone_count}</Mono></td>
                        <td><Mono>{ago(l.created_at)}</Mono></td>
                        <td>
                          <Btn variant="sm" loading={membersLoading === l.id} onClick={() => toggleMembers(l.id)}>
                            {expandedId === l.id ? 'Hide' : 'View'} members
                          </Btn>
                        </td>
                      </tr>
                      {expandedId === l.id && (
                        <tr>
                          <td colSpan={5} style={{ background: 'var(--bg2)' }}>
                            {!members[l.id]
                              ? null
                              : members[l.id].length === 0
                                ? <Empty msg="No members" />
                                : (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 4px' }}>
                                    {members[l.id].map((m, i) => (
                                      <span key={i} className="mono" style={{ fontSize: 12.5, background: 'var(--bg)', padding: '3px 8px', borderRadius: 6 }}>
                                        {m.phone}{m.name ? ` — ${m.name}` : ''}
                                      </span>
                                    ))}
                                  </div>
                                )
                            }
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )
          }
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
