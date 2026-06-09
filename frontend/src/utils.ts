// ── Formatting helpers ────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  enquiry:           'Enquiry',
  appt_booked:       'Appt confirmed',
  reminder_2h:       'Same-day reminder',
  post_consultation: 'Post consultation',
  lab_prep:          'Lab prep',
  lab_report_ready:  'Lab report ready',
  ip_admission:      'IP admission',
  ip_day2:           'IP Day 2',
  discharge:         'Discharge',
  post_discharge:    'Post discharge',
  missed_followup:   'Missed follow-up',
  missed_call_wa:    'Missed call',
  broadcast:         'Broadcast',
  birthday:          'Birthday',
  personalised:      'Personalised',
}

export function fmtTrigger(t: string): string {
  if (t.startsWith('recall_')) return `Recall (${t.replace('recall_', '')})`
  if (t.startsWith('broadcast_')) return 'Broadcast'
  return TRIGGER_LABELS[t] ?? t
}

export function ago(dt: string | null): string {
  if (!dt) return '—'
  const diff = Date.now() - new Date(dt).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function fmtTime(dt: string | null): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(dt: string | null): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function parseRecipients(raw: string): { phone: string; name?: string }[] {
  return raw.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [phone, ...rest] = l.split(',')
      return { phone: phone.trim(), name: rest.join(',').trim() || undefined }
    })
}

export const TEMPLATES: Record<string, string> = {
  anniversary: `Hi {name}! 🥳 On this special occasion, Flamingo Healthcare wishes you and your family joy and great health!\n\nAs our valued patient, enjoy exclusive benefits this month.\n📅 Book: flamingohealthcare.in\n📞 044-2658 2424`,
  followup:    `Hi {name}! 👋 Flamingo Healthcare would like to check in with you.\n\nHow have you been feeling? A quick follow-up consultation can make a big difference.\n📅 Book now: flamingohealthcare.in\n📞 044-2658 2424`,
  health:      `Hi {name}! 💊 A friendly health reminder from Flamingo Healthcare.\n\nStaying on top of your health is the best gift you can give yourself.\n📅 Schedule your check-up: flamingohealthcare.in\n📞 044-2658 2424`,
  festival:    `Warmest wishes from all of us at Flamingo Healthcare! 🎉\n\nHi {name}, wishing you and your family health, happiness, and joy.\n\nWe are always here for your healthcare needs.\n📞 044-2658 2424`,
}
