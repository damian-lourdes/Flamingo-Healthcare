// All types mirror the FastAPI Pydantic models

export interface OutboundMessage {
  id: number
  phone: string
  patient_name: string | null
  trigger_type: string
  message: string
  sent_at: string | null
}

export interface EngagementStat {
  trigger_type: string
  n: number
}

export interface DialerStats {
  total_calls: number
  answered_calls: number
  missed_calls: number
  avg_duration_sec: number
  pending_callbacks: number
}

export interface DashboardState {
  dialer_stats: DialerStats
  engagement_stats: EngagementStat[]
  pending_callbacks: number
  due_recalls: number
  pending_followups: number
  messages_sent: number
  patients_reached: number
  broadcasts_sent: number
  // Service health
  outbound_healthy: boolean
  whatsapp_healthy: boolean
  whatsapp_error: string | null
  // Delivery stats
  delivery_stats: Record<string, number>
  // DPDP consent
  consented_patients: number
}

export interface CallRecord {
  id: number
  phone: string
  caller_name: string | null
  duration_sec: number | null
  status: string
  agent: string | null
  notes: string | null
  called_at: string | null
}

export interface CallbackRecord {
  id: number
  phone: string
  caller_name: string | null
  missed_at: string | null
  status: string
}

export interface RecallRecord {
  id: number
  phone: string
  name: string | null
  specialty: string | null
  recall_at: string | null
  recall_days: number | null
  status: string
}

export interface FollowUpRecord {
  id: number
  phone: string
  name: string | null
  doctor: string | null
  specialty: string | null
  original_dt: string | null
  status: string
  created_at: string | null
}

export interface BroadcastCampaign {
  id: number
  name: string | null
  message: string | null
  recipient_count: number | null
  sent_count: number | null
  failed_count: number | null
  sent_at: string | null
}

export interface PatientProfile {
  id: number
  phone: string
  name: string | null
  dob: string | null
  specialty: string | null
  doctor: string | null
  branch: string | null
  opt_in: boolean | null
  last_contact: string | null
  created_at: string | null
}

export interface SuccessResponse {
  success: boolean
  message?: string
}

export interface BroadcastSendResult {
  success: boolean
  sent: number
  failed: number
  total: number
}

export interface BroadcastList {
  id: number
  name: string
  description: string | null
  phone_count: number
  created_at: string
}

export interface BroadcastListMember {
  phone: string
  name: string | null
}

export type Page =
  | 'overview'
  | 'history'
  | 'dialer'
  | 'followups'
  | 'broadcast'
  | 'personalised'
  | 'automations'
  | 'leads'
