import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { fmtTrigger, fmtDate, fmtTime } from '../utils'
import type { OutboundMessage } from '../types'

interface PatientSummary {
  phone: string
  name: string | null
  count: number
  last: string
}

export function HistoryPage() {
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [filtered, setFiltered] = useState<PatientSummary[]>([])
  const [thread, setThread]     = useState<OutboundMessage[]>([])
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const msgs = await api.history()
    const byPhone: Record<string, PatientSummary> = {}
    for (const m of msgs) {
      if (!byPhone[m.phone]) byPhone[m.phone] = { phone: m.phone, name: m.patient_name, count: 0, last: m.sent_at ?? '' }
      byPhone[m.phone].count++
      if (m.sent_at && m.sent_at > byPhone[m.phone].last) byPhone[m.phone].last = m.sent_at
    }
    const list = Object.values(byPhone).sort((a, b) => b.last.localeCompare(a.last))
    setPatients(list)
    setFiltered(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadThread = async (phone: string) => {
    setSelectedPhone(phone)
    const msgs = await api.patientHistory(phone)
    // The backend returns newest-first (for the "most recent contact" sort
    // used elsewhere), but a chat thread reads top-to-bottom as oldest-first,
    // newest-at-the-bottom — the same convention as WhatsApp itself. Sort
    // here rather than relying on API order, since that order is meant for
    // a different use case (the patient list's "last contacted" sort).
    const sorted = [...msgs].sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
    setThread(sorted)
    setTimeout(() => {
      const el = document.getElementById('hist-thread-inner')
      if (el) el.scrollTop = el.scrollHeight
    }, 50)
  }

  const handleSearch = (q: string) => {
    setSearch(q)
    setFiltered(patients.filter(p =>
      p.phone.includes(q) || (p.name ?? '').toLowerCase().includes(q.toLowerCase())
    ))
  }

  // Group thread by date
  const byDate: Record<string, OutboundMessage[]> = {}
  for (const m of thread) {
    const d = fmtDate(m.sent_at)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(m)
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-header">
        <div>
          <div className="card-title">WhatsApp message history</div>
          <div className="card-sub">All outbound messages — date wise</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="inp" placeholder="Search phone or patient…"
            style={{ width: 220 }} value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="hist-split">
        {/* Patient list */}
        <div className="hist-list">
          {loading
            ? <div className="empty">Loading…</div>
            : filtered.length === 0
            ? <div className="empty">No messages yet</div>
            : filtered.map(p => (
              <div
                key={p.phone}
                className={`hist-item ${selectedPhone === p.phone ? 'sel' : ''}`}
                onClick={() => loadThread(p.phone)}
              >
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name || p.phone}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{p.phone}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{p.count} messages</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{p.last ? fmtDate(p.last) : '—'}</span>
                </div>
              </div>
            ))
          }
        </div>

        {/* Message thread — outbound-only, so every bubble is "ours" and
            right-aligned, same convention as WhatsApp's own UI. justify-content
            is also set inline here (not just via the .msg-row CSS class) as a
            safety net, since the class-based rule alone wasn't visibly taking
            effect in production. */}
        <div className="hist-thread" id="hist-thread-inner">
          {!selectedPhone
            ? <div className="empty" style={{ margin: 'auto' }}>Select a patient to view messages</div>
            : Object.keys(byDate).length === 0
            ? <div className="empty" style={{ margin: 'auto' }}>No messages</div>
            : Object.entries(byDate).map(([date, msgs]) => (
              <div key={date}>
                <div className="date-divider">{date}</div>
                {msgs.map(m => (
                  <div key={m.id} className="msg-row">
                    <div className="msg-col">
                      <div className="trigger-pill">{fmtTrigger(m.trigger_type)}</div>
                      <div className="msg-bubble" dangerouslySetInnerHTML={{ __html: m.message.replace(/\n/g, '<br/>') }} />
                      <div className="msg-meta">{fmtTime(m.sent_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}
