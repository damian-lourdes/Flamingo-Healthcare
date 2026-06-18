import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Btn, Empty, Badge } from '../components/ui'
import { ago } from '../utils'
import type { StaffUser, Role } from '../types'

const blank = { username: '', password: '', role: 'front_desk' as Role, displayName: '' }

export function StaffPage() {
  const [staff, setStaff]       = useState<StaffUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [f, setF]               = useState({ ...blank })
  const [saving, setSaving]     = useState(false)
  const [formError, setFormError] = useState('')
  const [busyUsername, setBusyUsername] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    api.listStaff().then(rows => { setStaff(rows); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!f.username || !f.password) { setFormError('Username and password are required'); return }
    setSaving(true); setFormError('')
    const r = await api.createStaff({
      username: f.username, password: f.password, role: f.role,
      displayName: f.displayName || undefined,
    })
    setSaving(false)
    if (!r.success) { setFormError(r.message || 'Could not create account'); return }
    setShowForm(false); setF({ ...blank }); load()
  }

  const toggleActive = async (u: StaffUser) => {
    setBusyUsername(u.username)
    await api.setStaffActive(u.username, !u.active)
    setBusyUsername(null)
    load()
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>
        Admin accounts can reach everything, including Campaigns and this page. Front desk accounts cover Dialer,
        Follow Ups, Leads, Message History, and one-off Personalised messages — Campaigns and template
        management stay admin-only since they send to many patients at once.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>{staff.length} account{staff.length === 1 ? '' : 's'}</div>
        <Btn variant="primary" onClick={() => { setShowForm(v => !v); setFormError('') }}>
          {showForm ? 'Close' : '+ Add account'}
        </Btn>
      </div>

      {showForm && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input className="inp" placeholder="Username" value={f.username}
            onChange={e => setF({ ...f, username: e.target.value })} />
          <input className="inp" type="password" placeholder="Password (min. 8 characters)" value={f.password}
            onChange={e => setF({ ...f, password: e.target.value })} />
          <select className="inp" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>
            <option value="front_desk">Front desk</option>
            <option value="admin">Admin</option>
          </select>
          <input className="inp" placeholder="Display name (optional)" value={f.displayName}
            onChange={e => setF({ ...f, displayName: e.target.value })} />
          <div style={{ gridColumn: '1 / -1' }}>
            {formError && <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 8 }}>{formError}</div>}
            <Btn variant="primary" loading={saving} onClick={add}>Create account</Btn>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
      ) : staff.length === 0 ? (
        <Empty msg="No accounts yet" />
      ) : (
        <table>
          <thead>
            <tr><th>Username</th><th>Display name</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {staff.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 500 }}>{u.username}</td>
                <td style={{ color: 'var(--text3)' }}>{u.display_name || '—'}</td>
                <td><Badge variant={u.role === 'admin' ? 'purple' : 'blue'}>{u.role === 'admin' ? 'Admin' : 'Front desk'}</Badge></td>
                <td><Badge variant={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Deactivated'}</Badge></td>
                <td><span className="mono" style={{ fontSize: 12.5, color: 'var(--text3)' }}>{ago(u.created_at)}</span></td>
                <td>
                  <Btn variant="sm" loading={busyUsername === u.username} onClick={() => toggleActive(u)}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
