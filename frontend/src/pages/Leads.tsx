import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Btn, Empty } from '../components/ui'

type Lead = { id:number; phone:string; name:string; lead_status:string; lead_source:string; referred_by?:string; assigned_to?:string; next_action_at?:string; last_contact?:string }

const STAGES: [string,string][] = [['new','New'],['contacted','Contacted'],['qualified','Qualified'],['booked','Booked'],['converted','Converted'],['lost','Lost']]
const SRC: Record<string,[string,string]> = { call:['#FAEEDA','#854F0B'], whatsapp:['#E1F5EE','#0F6E56'], campaign:['#E6F1FB','#0C447C'], walkin:['#F1EFE8','#444441'], referral:['#EEEDFE','#3C3489'] }
const srcLabel: Record<string,string> = { call:'Call', whatsapp:'WhatsApp', campaign:'Campaign', walkin:'Walk-in', referral:'Referral' }
const blank = { name:'', phone:'', source:'walkin', referredBy:'', assignedTo:'', nextActionAt:'', notes:'' }

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [showForm, setShowForm] = useState(false)
  const [f, setF] = useState({ ...blank })
  const [saving, setSaving] = useState(false)

  const load = () => api.listLeads().then(setLeads)
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!f.phone || !f.name) return
    setSaving(true); await api.addLead(f); setSaving(false)
    setShowForm(false); setF({ ...blank }); load()
  }
  const move = async (phone:string, status:string) => { await api.moveLead(phone, { status }); load() }

  const badge = (s:string) => {
    const c = SRC[s] || ['#eee','#444']
    return <span style={{ background:c[0], color:c[1], fontSize:11, padding:'2px 7px', borderRadius:6 }}>{srcLabel[s] || s || '—'}</span>
  }

  return (
    <div className="card" style={{ padding:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ fontSize:13, color:'var(--text2)' }}>{leads.length} open lead{leads.length===1?'':'s'}</div>
        <Btn variant="primary" onClick={() => setShowForm(v => !v)}>{showForm ? 'Close' : '+ Add lead'}</Btn>
      </div>

      {showForm && (
        <div style={{ border:'1px solid var(--border)', borderRadius:8, padding:14, marginBottom:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <input className="inp" placeholder="Name" value={f.name} onChange={e=>setF({...f, name:e.target.value})} />
          <input className="inp" placeholder="Phone +91..." value={f.phone} onChange={e=>setF({...f, phone:e.target.value})} />
          <select className="inp" value={f.source} onChange={e=>setF({...f, source:e.target.value})}>
            <option value="walkin">Walk-in</option><option value="referral">Referral</option>
            <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="campaign">Campaign</option>
          </select>
          {f.source === 'referral'
            ? <input className="inp" placeholder="Referred by (doctor / patient)" value={f.referredBy} onChange={e=>setF({...f, referredBy:e.target.value})} />
            : <input className="inp" placeholder="Assigned to (staff)" value={f.assignedTo} onChange={e=>setF({...f, assignedTo:e.target.value})} />}
          <input className="inp" type="datetime-local" value={f.nextActionAt} onChange={e=>setF({...f, nextActionAt:e.target.value})} />
          <input className="inp" placeholder="Notes" value={f.notes} onChange={e=>setF({...f, notes:e.target.value})} />
          <div style={{ gridColumn:'1 / -1' }}><Btn variant="primary" loading={saving} onClick={add}>Save lead</Btn></div>
        </div>
      )}

      {leads.length === 0
        ? <Empty msg="No open leads" />
        : (
          <div style={{ display:'flex', gap:12, overflowX:'auto', paddingBottom:6 }}>
            {STAGES.map(([key,label]) => {
              const items = leads.filter(l => (l.lead_status || 'new') === key)
              if (key === 'lost' && items.length === 0) return null
              return (
                <div key={key} style={{ flex:'0 0 184px', minWidth:184 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, fontSize:12.5, fontWeight:500, color:'var(--text2)' }}>
                    <span>{label}</span><span>{items.length}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {items.map(l => (
                      <div key={l.id} style={{ border:'1px solid var(--border)', borderRadius:8, padding:10 }}>
                        <div style={{ fontSize:13, fontWeight:500, marginBottom:5 }}>{l.name || l.phone}</div>
                        <div style={{ marginBottom:6 }}>{badge(l.lead_source)}</div>
                        <div style={{ fontSize:11, color:'var(--text3)', fontFamily:"'DM Mono', monospace" }}>{l.phone}</div>
                        {l.referred_by && <div style={{ fontSize:11, color:'var(--text3)' }}>via {l.referred_by}</div>}
                        {l.assigned_to && <div style={{ fontSize:11, color:'var(--text3)' }}>owner: {l.assigned_to}</div>}
                        <select className="inp" style={{ marginTop:8, fontSize:12, padding:'4px 6px' }} value={key} onChange={e => move(l.phone, e.target.value)}>
                          {STAGES.map(([k,lb]) => <option key={k} value={k}>{lb}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
