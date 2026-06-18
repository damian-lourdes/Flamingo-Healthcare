import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { TabBar, Card, Btn, Mono, Empty, Select } from '../components/ui'
import { parseRecipients, ago, renderTemplatePreview } from '../utils'
import type { BroadcastCampaign, BroadcastList, BroadcastListMember } from '../types'

type WTemplate = { name: string; language: string; category: string; status: string; placeholder_count: number; body_text: string; examples?: string[]; synced_at?: string; has_image_header?: boolean }

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
  const [tab, setTab] = useState('campaign')
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([])

  // Send-a-campaign tab — live Meta template picker, grouped by Meta's own
  // category (MARKETING / UTILITY / AUTHENTICATION) so staff can tell
  // templates apart at a glance without needing separate fixed-purpose tabs
  // for what is, underneath, always the same send mechanism.
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

  // Banner image upload, only relevant when the selected template has an
  // IMAGE header (has_image_header). bannerMediaId is what actually gets
  // sent; bannerPreview is just a local object-URL thumbnail.
  const [bannerFile, setBannerFile]           = useState<File | null>(null)
  const [bannerPreview, setBannerPreview]     = useState('')
  const [bannerMediaId, setBannerMediaId]     = useState('')
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerError, setBannerError]         = useState('')

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
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [fileUploading, setFileUploading] = useState(false)
  const [fileError, setFileError]   = useState('')

  const loadHistory = () => api.broadcastHistory().then(setCampaigns)
  useEffect(() => { loadHistory() }, [])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab])
  useEffect(() => { if (tab === 'campaign') loadTemplates() }, [tab])

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
    // Reset banner state so a previous template's image isn't accidentally
    // reused against a different template.
    if (bannerPreview) URL.revokeObjectURL(bannerPreview)
    setBannerFile(null); setBannerPreview(''); setBannerMediaId(''); setBannerError('')
  }

  const handleBannerSelect = async (file: File | null) => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview)
    setBannerFile(file); setBannerMediaId(''); setBannerError('')
    if (!file) { setBannerPreview(''); return }
    setBannerPreview(URL.createObjectURL(file))
    setBannerUploading(true)
    const r = await api.uploadTemplateImage(file)
    setBannerUploading(false)
    if (r.success && r.mediaId) setBannerMediaId(r.mediaId)
    else setBannerError(r.message || 'Upload failed — try again.')
  }

  const sendTpl = async () => {
    if (!selTpl || !cpRecip) return
    if (selectedTemplate?.has_image_header && !bannerMediaId) {
      setCpResult('Upload a banner image for this template before sending.')
      return
    }
    setCpLoading(true)
    const t = templates.find(x => x.name === selTpl)
    const r = await api.sendTemplateMsg({
      name: selTpl, language: t?.language || 'en',
      params: tplValues, recipients: parseRecipients(cpRecip),
      campaignName: selTpl,
      ...(bannerMediaId ? { headerMediaId: bannerMediaId } : {}),
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
    const recipients = parseRecipients(listRecip)
    const r = editingId
      ? await api.updateBroadcastList(editingId, { name: listName, description: listDesc || undefined, phones: recipients })
      : await api.createBroadcastList({ name: listName, description: listDesc || undefined, phones: recipients })
    if ((r as any).success === false) {
      setListResult('Save failed')
    } else {
      setListResult(editingId
        ? `Updated "${listName}" — ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`
        : `Saved "${listName}" with ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`)
      setListName(''); setListDesc(''); setListRecip(''); setListInfo(''); setEditingId(null)
      // Editing a list whose members panel was open would otherwise show
      // stale data, so drop any cached members for this id and force a
      // re-fetch next time it's expanded.
      if (editingId) setMembers(m => { const next = { ...m }; delete next[editingId]; return next })
      loadLists()
    }
    setListLoading(false)
  }

  // Loads a list's current name/description/members into the form fields so
  // they can be changed and re-saved via the same createList/updateBroadcastList path.
  const startEditList = async (list: BroadcastList) => {
    setEditingId(list.id)
    setListName(list.name || '')
    setListDesc(list.description || '')
    setListResult('')
    setListInfo('Loading current recipients…')
    const rows = await api.broadcastListMembers(list.id)
    setListRecip(rows.map(r => r.name ? `${r.phone},${r.name}` : r.phone).join('\n'))
    setListInfo(`Editing "${list.name}" — ${rows.length} recipient${rows.length === 1 ? '' : 's'} loaded`)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setListName(''); setListDesc(''); setListRecip(''); setListInfo(''); setListResult('')
  }

  const deleteList = async (list: BroadcastList) => {
    if (!window.confirm(`Delete "${list.name}"? This can't be undone.`)) return
    setDeletingId(list.id)
    const r = await api.deleteBroadcastList(list.id)
    setDeletingId(null)
    if ((r as any).success === false) {
      setListResult('Delete failed')
      return
    }
    if (editingId === list.id) cancelEdit()
    loadLists()
  }

  // Parses an uploaded Excel/CSV file and drops the result straight into the
  // same recipients textarea used for manual entry — so staff can review,
  // fix, or remove rows before saving, exactly like a manual paste would be.
  const handleListFile = async (file: File | null) => {
    if (!file) return
    setFileError(''); setFileUploading(true)
    const r = await api.parseListFile(file)
    setFileUploading(false)
    if (!r.success || !r.rows) {
      setFileError(r.message || 'Could not read that file')
      return
    }
    const lines = r.rows.map(row => row.name ? `${row.phone},${row.name}` : row.phone).join('\n')
    setListRecip(lines)
    setListInfo(
      `Loaded ${r.rows.length} contact${r.rows.length === 1 ? '' : 's'} from file` +
      (r.warning ? ` — ${r.warning}` : '') +
      ' — review below before saving'
    )
  }

  const selectedTemplate = templates.find(t => t.name === selTpl)

  // Templates grouped by Meta's own category (MARKETING / UTILITY /
  // AUTHENTICATION / etc.) so the dropdown gives staff real context about
  // each template instead of a flat, undifferentiated list. Falls back to
  // "Other" for any template without a recognised category.
  const templatesByCategory = templates.reduce<Record<string, WTemplate[]>>((acc, t) => {
    const key = t.category || 'Other'
    ;(acc[key] ||= []).push(t)
    return acc
  }, {})

  return (
    <div className="card">
      <TabBar
        tabs={[
          { key: 'campaign', label: 'Send a campaign' },
          { key: 'lists',    label: 'Lists' },
          { key: 'history',  label: 'Campaign history' },
        ]}
        active={tab}
        onChange={setTab}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {syncMsg && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{syncMsg}</span>}
            <Btn variant="sm" loading={syncing} onClick={syncTemplates}>↻ Sync templates</Btn>
          </div>
        }
      />

      {tab === 'campaign' && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>
            Templates are pulled live from Meta — only ones approved there can be sent.
          </div>

          {tplLoading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading templates…</div>
          ) : templates.length === 0 ? (
            <Empty msg="No approved templates yet — submit one in WhatsApp Manager, then click Sync templates above." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div className="form-label" style={{ marginBottom: 4 }}>Template</div>
                <select className="inp" value={selTpl} onChange={e => selectTemplate(e.target.value)} style={{ marginBottom: 10 }}>
                  <option value="">Select an approved template…</option>
                  {Object.entries(templatesByCategory).map(([category, group]) => (
                    <optgroup key={category} label={category}>
                      {group.map(t => (
                        <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                {selectedTemplate && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--bg2)', borderRadius: 8, padding: 10, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                    {selectedTemplate.body_text}
                  </div>
                )}

                {selectedTemplate?.has_image_header && (
                  <div style={{ marginBottom: 10 }}>
                    <div className="form-label" style={{ marginBottom: 4 }}>
                      Banner image <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— required for this template</span>
                    </div>
                    <input type="file" accept="image/jpeg,image/png" style={{ fontSize: 12.5 }}
                      onChange={e => handleBannerSelect(e.target.files?.[0] || null)} />
                    {bannerPreview && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <img src={bannerPreview} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                        <div style={{ fontSize: 12 }}>
                          <div style={{ color: 'var(--text3)' }}>{bannerFile?.name}</div>
                          <div style={{ color: bannerUploading ? 'var(--text3)' : bannerMediaId ? 'var(--teal)' : 'var(--red)' }}>
                            {bannerUploading ? 'Uploading to WhatsApp…' : bannerMediaId ? '✓ Uploaded' : (bannerError || 'Upload failed')}
                          </div>
                        </div>
                      </div>
                    )}
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
                <Btn variant="primary" style={{ width: '100%', marginTop: 6 }} loading={cpLoading}
                  disabled={!selTpl || bannerUploading || !!(selectedTemplate?.has_image_header && !bannerMediaId)}
                  onClick={sendTpl}>Send template</Btn>
                {cpResult && <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text2)' }}>{cpResult}</div>}
              </div>
            </div>
          )}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <label className="inp" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  width: 'auto', padding: '6px 12px', fontSize: 12.5,
                }}>
                  {fileUploading ? 'Reading file…' : '📄 Upload Excel/CSV'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    disabled={fileUploading}
                    onChange={e => { handleListFile(e.target.files?.[0] || null); e.target.value = '' }}
                  />
                </label>
                <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>or load below, or type manually</span>
              </div>
              {fileError && <div style={{ fontSize: 12, color: 'var(--red, #c0392b)', marginBottom: 6 }}>{fileError}</div>}
              <RecipientPicker onLoad={(text, info) => { setListRecip(text); setListInfo(info) }} />
              <textarea className="inp" rows={6} style={{ resize: 'vertical', fontFamily: "'DM Mono', monospace", fontSize: 13 }}
                placeholder={"+919XXXXXXXXX,Ravi Kumar\n+919XXXXXXXXX,Priya Nair"}
                value={listRecip} onChange={e => { setListRecip(e.target.value); setListInfo('') }} />
              {listInfo && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{listInfo}</div>}
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <Btn variant="primary" style={{ width: '100%' }} loading={listLoading} onClick={createList}>
                  {editingId ? 'Update list' : 'Save list'}
                </Btn>
                {editingId && <Btn variant="sm" onClick={cancelEdit}>Cancel</Btn>}
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
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Btn variant="sm" loading={membersLoading === l.id} onClick={() => toggleMembers(l.id)}>
                              {expandedId === l.id ? 'Hide' : 'View'} members
                            </Btn>
                            <Btn variant="sm" onClick={() => startEditList(l)}>Edit</Btn>
                            <Btn variant="sm" loading={deletingId === l.id} onClick={() => deleteList(l)}>Delete</Btn>
                          </div>
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
