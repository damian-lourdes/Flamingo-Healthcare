/**
 * API client — all fetch calls with:
 * - JWT auth header on every request
 * - 401 → auto redirect to login
 * - Demo data fallback when backend offline
 * - Status tracking (live / demo / offline)
 */

import type {
  OutboundMessage, DashboardState, DialerStats,
  CallRecord, CallbackRecord, RecallRecord, FollowUpRecord,
  BroadcastCampaign, PatientProfile, SuccessResponse, BroadcastSendResult,
  BroadcastList, BroadcastListMember,
} from '../types'

// ── API base URL ─────────────────────────────────────────────────────────────
// Reads VITE_API_URL from the build env (.env.production), falls back to the
// known Railway API URL. Every request is prefixed with this in safeFetch.
const BASE = import.meta.env.VITE_API_URL ?? 'https://flamingo-healthcare-production.up.railway.app'

// ── Token storage ─────────────────────────────────────────────────────────────
const TOKEN_KEY = 'flamingo_token'
const USER_KEY  = 'flamingo_user'

export function getToken(): string | null    { return sessionStorage.getItem(TOKEN_KEY) }
export function getUser(): string | null     { return sessionStorage.getItem(USER_KEY) }
export function isLoggedIn(): boolean        { return !!getToken() }

export function saveAuth(token: string, username: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(USER_KEY, username)
}

export function clearAuth() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
}

// ── Status ────────────────────────────────────────────────────────────────────
export type BackendStatus = 'live' | 'demo' | 'offline'
let _status: BackendStatus = 'live'
let _listeners: ((s: BackendStatus) => void)[] = []
let _authListeners: (() => void)[] = []

export function getStatus(): BackendStatus { return _status }
export function onStatusChange(fn: (s: BackendStatus) => void) {
  _listeners.push(fn)
  return () => { _listeners = _listeners.filter(l => l !== fn) }
}
export function onAuthChange(fn: () => void) {
  _authListeners.push(fn)
  return () => { _authListeners = _authListeners.filter(l => l !== fn) }
}
function setStatus(s: BackendStatus) {
  if (_status !== s) { _status = s; _listeners.forEach(l => l(s)) }
}
function notifyAuthChange() { _authListeners.forEach(l => l()) }

// ── Core fetch ────────────────────────────────────────────────────────────────
async function safeFetch<T>(path: string, opts?: RequestInit, fallback?: T): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts?.headers as Record<string, string> ?? {}),
  }
  try {
    const r = await fetch(`${BASE}${path}`, { ...opts, headers })
    // 401 → session expired or invalid → force logout
    if (r.status === 401 && path !== '/auth/login') {
      clearAuth()
      notifyAuthChange()
      return (fallback ?? []) as T
    }
    const ct = r.headers.get('content-type') ?? ''
    if (!r.ok || !ct.includes('json')) throw new Error(`HTTP ${r.status}`)
    setStatus('live')
    return await r.json() as T
  } catch {
    if (path === '/auth/login') throw new Error('Login failed')
    const demo = demoFor(path, opts)
    if (demo !== undefined) { setStatus('demo'); return demo as T }
    setStatus('offline')
    return (fallback ?? []) as T
  }
}

const get  = <T>(path: string, fb?: T) => safeFetch<T>(path, undefined, fb)
const post = <T>(path: string, body: unknown) =>
  safeFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })

// ── Auth endpoints ────────────────────────────────────────────────────────────
export const authApi = {
  login: async (username: string, password: string): Promise<{ access_token: string; username: string }> => {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!r.ok) throw new Error('Incorrect username or password')
    return r.json()
  },
  me: () => get<{ username: string; authenticated: boolean }>('/auth/me'),
}

// ── API endpoints (all protected) ─────────────────────────────────────────────
export const api = {
  // Dashboard
  state:           () => get<DashboardState>('/api/dashboard/state'),
  history:         (phone?: string, date?: string, limit = 200) => {
    const p = new URLSearchParams()
    if (phone) p.set('phone', phone)
    if (date)  p.set('date', date)
    p.set('limit', String(limit))
    return get<OutboundMessage[]>(`/api/dashboard/history?${p}`, [])
  },
  historyDates:    () => get<{date: string; total: number; patients: number}[]>('/api/dashboard/history/dates', []),
  patientHistory:  (phone: string) => get<OutboundMessage[]>(`/api/dashboard/history/patient/${encodeURIComponent(phone)}`, []),
  patients:        (search?: string) => {
    const p = search ? `?search=${encodeURIComponent(search)}` : ''
    return get<PatientProfile[]>(`/api/dashboard/patients${p}`, [])
  },
  upsertPatient:   (body: {phone: string; name?: string; dob?: string; specialty?: string; doctor?: string}) =>
    post<SuccessResponse>('/api/dashboard/patients', body),
  birthdays:       () => get<PatientProfile[]>('/api/dashboard/patients/birthdays', []),

  // Dialer
  dialerStats:     () => get<DialerStats>('/api/dialer/stats'),
  calls:           (limit = 100) => get<CallRecord[]>(`/api/dialer/calls?limit=${limit}`, []),
  callbacks:       () => get<CallbackRecord[]>('/api/dialer/callbacks', []),
  recalls:         () => get<RecallRecord[]>('/api/dialer/recalls', []),
  followups:       () => get<FollowUpRecord[]>('/api/dialer/followups', []),
  logCall:         (body: {phone: string; caller_name?: string; duration_sec?: number; status: string}) =>
    post<SuccessResponse>('/api/dialer/call/manual', body),
  markCallbackDone: (id: number, status: string) =>
    post<SuccessResponse>(`/api/dialer/callback/${id}/done`, { status }),
  markFollowUpDone: (id: number) =>
    post<SuccessResponse>(`/api/dialer/followup/${id}/done`, { status: 'done' }),

  // Broadcast
  broadcastHistory: () => get<BroadcastCampaign[]>('/api/broadcast/history', []),
  broadcastLists:   () => get<BroadcastList[]>('/api/broadcast/lists', []),
  broadcastListMembers: (id: number) => get<BroadcastListMember[]>(`/api/broadcast/lists/${id}/members`, []),
  createBroadcastList: (body: { name: string; description?: string; phones: string[] }) =>
    post<{ success: boolean; id: number }>('/api/broadcast/lists', body),
  sendHealthTip:   (body: {campaign_name: string; message: string; recipients: {phone: string; name?: string}[]}) =>
    post<BroadcastSendResult>('/api/broadcast/health-tip', body),
  sendOffer:       (body: {offer_title: string; offer_details: string; valid_till?: string; recipients: {phone: string; name?: string}[]}) =>
    post<BroadcastSendResult>('/api/broadcast/offer', body),
  sendPersonalised: (body: {phone: string; name: string; message: string}) =>
    post<SuccessResponse>('/api/broadcast/personalised', body),
  sendCamp:        (body: {campType: string; date: string; venue: string; details?: string; recipients: {phone: string; name?: string}[]}) =>
    post<BroadcastSendResult>('/api/broadcast/camp', body),
  getSetting:      (key: string) => get<{key: string; value: string | null}>('/api/dashboard/settings/' + key, { key, value: null }),
  setSetting:      (key: string, value: string) => post<SuccessResponse>('/api/dashboard/settings/' + key, { value }),

  // Engagement
  postConsultation: (body: {phone: string; name: string; doctor: string; specialty: string; follow_up_date?: string}) =>
    post<SuccessResponse>('/api/engagement/post-consultation', body),
  labReportReady:  (body: {phone: string; name: string; test_name: string; doctor: string}) =>
    post<SuccessResponse>('/api/engagement/lab-report-ready', body),
  discharge:       (body: {phone: string; patient_name: string; doctor: string; specialty: string}) =>
    post<SuccessResponse>('/api/engagement/discharge', body),

  // Scheduler
  runScheduler:    (job: string) => post<{success: boolean; message: string}>('/api/scheduler/run', { job }),
}

// ── Demo data (shown when backend offline) ────────────────────────────────────
const NOW = Date.now()
const MIN = 60000, HR = 3600000, DAY = 86400000
const iso  = (ms: number) => new Date(NOW - ms).toISOString()
const isoF = (ms: number) => new Date(NOW + ms).toISOString()
const t = new Date()
const mm = String(t.getMonth() + 1).padStart(2, '0')
const dd = String(t.getDate()).padStart(2, '0')

const DEMO = {
  history: [
    { id:1,  phone:'+919840012345', patient_name:'Ravi Kumar',   trigger_type:'appt_booked',       message:'Appointment confirmed ✅\n\n👨‍⚕️ Dr. Meena Rajan\n🏥 Cardiology\n📅 04 Jun 2026, 10:30 AM', sent_at: iso(2*HR) },
    { id:2,  phone:'+919840012345', patient_name:'Ravi Kumar',   trigger_type:'reminder_2h',       message:'Reminder: Your appointment is in 2 hours ⏰', sent_at: iso(30*MIN) },
    { id:3,  phone:'+919791023456', patient_name:'Priya Nair',   trigger_type:'post_consultation', message:'Thank you for visiting Flamingo Healthcare 🙏', sent_at: iso(DAY+2*HR) },
    { id:4,  phone:'+919791023456', patient_name:'Priya Nair',   trigger_type:'lab_report_ready',  message:'Your Lipid Profile report is ready 📄', sent_at: iso(5*HR) },
    { id:5,  phone:'+919884034567', patient_name:'Arjun Menon',  trigger_type:'discharge',         message:'Arjun Menon, we are glad you are going home! 🎉', sent_at: iso(DAY+5*HR) },
    { id:6,  phone:'+919840045678', patient_name:'Lakshmi Iyer', trigger_type:'birthday',          message:'Happy Birthday, Lakshmi Iyer! 🎂', sent_at: iso(6*HR) },
    { id:7,  phone:'+919791056789', patient_name:'Karthik Raj',  trigger_type:'enquiry',           message:'Hi Karthik Raj! Thank you for reaching out to Flamingo Healthcare 🙏', sent_at: iso(2*DAY+3*HR) },
  ] as OutboundMessage[],
  state: {
    dialer_stats: { total_calls:128, answered_calls:96, missed_calls:18, avg_duration_sec:142, pending_callbacks:4 },
    engagement_stats: [
      { trigger_type:'broadcast', n:120 }, { trigger_type:'appt_booked', n:42 },
      { trigger_type:'reminder_2h', n:38 }, { trigger_type:'post_consultation', n:31 },
      { trigger_type:'lab_report_ready', n:24 }, { trigger_type:'discharge', n:12 },
    ],
    pending_callbacks:4, due_recalls:3, pending_followups:2,
    messages_sent:283, patients_reached:11, broadcasts_sent:3,
  } as DashboardState,
  calls: [
    { id:1, phone:'+919840012345', caller_name:'Ravi Kumar',   status:'answered',  duration_sec:210, agent:null, notes:null, called_at: iso(1*HR) },
    { id:2, phone:'+919791023456', caller_name:'Priya Nair',   status:'missed',    duration_sec:null, agent:null, notes:null, called_at: iso(2*HR) },
    { id:3, phone:'+919884034567', caller_name:'Arjun Menon',  status:'answered',  duration_sec:95,  agent:null, notes:null, called_at: iso(3*HR) },
  ] as CallRecord[],
  callbacks: [
    { id:1, phone:'+919791023456', caller_name:'Priya Nair',  missed_at: iso(2*HR),  status:'pending' },
    { id:2, phone:'+919791056789', caller_name:'Karthik Raj', missed_at: iso(6*HR),  status:'pending' },
    { id:3, phone:'+919840078901', caller_name:'Suresh Babu', missed_at: iso(9*HR),  status:'pending' },
    { id:4, phone:'+919884090123', caller_name:'Mohan Das',   missed_at: iso(11*HR), status:'pending' },
  ] as CallbackRecord[],
  recalls: [
    { id:1, phone:'+919840045678', name:'Lakshmi Iyer', specialty:'Orthopaedics', recall_days:90, recall_at: isoF(DAY),   status:'pending' },
    { id:2, phone:'+919840078901', name:'Suresh Babu',  specialty:'Cardiology',   recall_days:30, recall_at: isoF(2*DAY), status:'pending' },
  ] as RecallRecord[],
  followups: [
    { id:1, phone:'+919791056789', name:'Karthik Raj', doctor:'Dr. Anand', specialty:'ENT', original_dt:'01 Jun 2026, 4:00 PM', status:'pending', created_at: iso(DAY) },
  ] as FollowUpRecord[],
  broadcasts: [
    { id:1, name:'Diabetes Screening Camp',     message:null, recipient_count:120, sent_count:118, failed_count:2, sent_at: iso(DAY) },
    { id:2, name:'Monsoon Health Tips',         message:null, recipient_count:245, sent_count:240, failed_count:5, sent_at: iso(4*DAY) },
    { id:3, name:'Master Health Checkup Offer', message:null, recipient_count:97,  sent_count:96,  failed_count:1, sent_at: iso(9*DAY) },
  ] as BroadcastCampaign[],
  patients: [
    { id:1, phone:'+919840045678', name:'Lakshmi Iyer', dob:`1979-${mm}-${dd}`, specialty:'Orthopaedics', doctor:'Dr. Rajan', branch:'Ambattur', opt_in:true, last_contact: iso(6*HR), created_at: iso(365*DAY) },
    { id:2, phone:'+919840012345', name:'Ravi Kumar',   dob:'1985-03-12', specialty:'Cardiology', doctor:'Dr. Meena Rajan', branch:'Ambattur', opt_in:true, last_contact: iso(2*HR), created_at: iso(200*DAY) },
  ] as PatientProfile[],
}

function demoFor(path: string, opts?: RequestInit): unknown {
  const method = opts?.method ?? 'GET'
  if (method !== 'GET') return { success:true, sent:1, failed:0, message:'Demo mode — not actually sent.' }
  const [p] = path.split('?')
  if (p === '/api/dashboard/state') return DEMO.state
  if (p === '/api/dashboard/history') return DEMO.history
  if (p === '/api/dashboard/history/dates') return []
  if (p.startsWith('/api/dashboard/history/patient/')) {
    const phone = decodeURIComponent(p.replace('/api/dashboard/history/patient/', ''))
    return DEMO.history.filter(m => m.phone === phone)
  }
  if (p === '/api/dashboard/patients') return DEMO.patients
  if (p === '/api/dashboard/patients/birthdays') {
    const today = new Date()
    const key = today.toLocaleDateString('en', { month:'2-digit', day:'2-digit' })
    return DEMO.patients.filter(pt => pt.dob && new Date(pt.dob).toLocaleDateString('en', { month:'2-digit', day:'2-digit' }) === key)
  }
  if (p === '/api/dialer/stats') return DEMO.state.dialer_stats
  if (p.startsWith('/api/dialer/calls')) return DEMO.calls
  if (p === '/api/dialer/callbacks') return DEMO.callbacks
  if (p === '/api/dialer/recalls') return DEMO.recalls
  if (p === '/api/dialer/followups') return DEMO.followups
  if (p === '/api/broadcast/history') return DEMO.broadcasts
  return undefined
}
