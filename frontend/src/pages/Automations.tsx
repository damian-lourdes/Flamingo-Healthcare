import React from 'react'
import { Badge } from '../components/ui'

interface Template {
  title: string
  trigger: string
  color: string
  headerClass: string
  badge: { label: string; variant: 'green' | 'amber' | 'blue' | 'purple' }
  desc: string
  message: React.ReactNode
}

const TEMPLATES: Template[] = [
  {
    title: '🙏 Enquiry / registration', trigger: 'New enquiry or patient registration',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Welcome message sent the moment a patient first reaches out or is registered.',
    message: <>Hi <em>[Patient]</em>! Thank you for reaching out to Flamingo Healthcare 🙏<br/><br/>📅 Book an appointment: flamingohealthcare.in<br/>📍 Ambattur, Chennai<br/>🕐 Mon–Sat: 8 AM – 7 PM | Emergency: 24/7<br/>📞 044-2658 2424</>
  },
  {
    title: '📋 Appointment confirmed', trigger: 'MocDoc appointment status → Confirmed',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent immediately when a patient books an appointment in MocDoc.',
    message: <>Appointment confirmed ✅<br/>👨‍⚕️ <em>[Doctor name]</em><br/>🏥 <em>[Specialty]</em><br/>📅 <em>[Date &amp; time]</em><br/>📍 Flamingo Healthcare, Ambattur<br/><br/>📋 Carry: Photo ID, previous reports<br/>Reschedule: 044-2658 2424</>
  },
  {
    title: '⏰ Same-day reminder', trigger: '2 hours before appointment time',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Automatically sent 2 hours before the appointment.',
    message: <>Reminder: Your appointment is in 2 hours ⏰<br/><br/>👨‍⚕️ <em>[Doctor]</em><br/>📅 <em>[Time]</em><br/>📍 Flamingo Healthcare, Ambattur<br/>📞 044-2658 2424<br/><br/>Please arrive 10 minutes early.</>
  },
  {
    title: '🔁 Appointment rescheduled', trigger: 'MocDoc Appointment Reschedule webhook',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent immediately when an appointment is rescheduled in MocDoc.',
    message: <>Your appointment has been rescheduled ✅<br/><br/>👤 <em>[Patient]</em><br/>👨‍⚕️ <em>[Doctor]</em><br/>🏥 <em>[Specialty]</em><br/>📅 New time: <em>[New date &amp; time]</em><br/>📍 Flamingo Healthcare, Ambattur<br/><br/>📋 Please carry Photo ID and previous reports.<br/>To reschedule or cancel: 044-2658 2424</>
  },
  {
    title: '❌ Appointment cancelled', trigger: 'MocDoc Appointment Cancellation webhook',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent immediately when an appointment is cancelled. Tone adjusts depending on whether the hospital or the patient cancelled.',
    message: <>If cancelled by the patient:<br/>Your appointment with <em>[Doctor]</em> at Flamingo Healthcare has been cancelled.<br/>📅 Was scheduled: <em>[Date &amp; time]</em><br/>Whenever you are ready, we are here for you.<br/>📅 Book again: flamingohealthcare.in<br/><br/>If cancelled by the hospital:<br/>We regret to inform you that your appointment with <em>[Doctor]</em> has been cancelled.<br/>📝 Reason: <em>[Reason]</em><br/>We sincerely apologise for the inconvenience.<br/>📅 Please rebook: flamingohealthcare.in</>
  },
  {
    title: '🎫 Checked in — token number', trigger: 'MocDoc Check In webhook',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent the moment a patient checks in at reception, with their queue token if one was issued.',
    message: <>Welcome to Flamingo Healthcare, <em>[Patient]</em>! 🙏<br/><br/>You have checked in with <em>[Doctor]</em> (<em>[Specialty]</em>).<br/>🎫 Your token number: <em>[Token]</em><br/><br/>Please wait — you will be called shortly.<br/>📞 044-2658 2424</>
  },
  {
    title: '🧾 OP bill created', trigger: 'MocDoc OP Bill Creation webhook',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent when an OP bill is raised in MocDoc. Skipped automatically if the bill has no phone number on file.',
    message: <>Your bill is ready at Flamingo Healthcare 🧾<br/><br/>📋 Bill No: <em>[Bill number]</em><br/>👨‍⚕️ Consultant: <em>[Doctor]</em><br/>📝 Services: <em>[Item list]</em><br/>💰 Amount Payable: <em>[Amount]</em><br/>✅ Amount Received: <em>[Amount]</em><br/>💳 Payment: <em>[Payment type]</em><br/><br/>For queries: 044-2658 2424</>
  },
  {
    title: '🧾 OP bill cancelled', trigger: 'MocDoc OP Bill Cancellation webhook',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent when an OP bill is cancelled in MocDoc. Skipped automatically if the bill has no phone number on file.',
    message: <>Your bill has been cancelled at Flamingo Healthcare 🧾<br/><br/>📋 Bill No: <em>[Bill number]</em><br/>💰 Bill Amount: <em>[Amount]</em><br/>📝 Reason: <em>[Reason]</em><br/><br/>If you have already made a payment, please contact us for a refund.<br/>📞 044-2658 2424</>
  },
  {
    title: '🙏 After OP consultation', trigger: 'MocDoc appointment status → Completed',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent after the doctor marks the appointment as completed in MocDoc.',
    message: <>Thank you for visiting Flamingo Healthcare 🙏<br/><br/>We hope your consultation with <em>[Doctor]</em> was helpful.<br/><br/>📅 Follow-up: <em>[Date if scheduled]</em><br/>⭐ Feedback: g.page/r/flamingo-review</>
  },
  {
    title: '🧪 Lab prep instructions', trigger: 'MocDoc lab order created',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent when a lab order is raised. Instructions specific to the test type.',
    message: <>Your <em>[Test name]</em> is scheduled at Flamingo Healthcare.<br/><br/>📋 Preparation:<br/>• Fast 8–12 hours (blood tests)<br/>• Remove metal jewellery (MRI/CT)<br/>• First morning sample (urine)<br/><br/>We will notify you when your report is ready.</>
  },
  {
    title: '📄 Lab report ready', trigger: 'MocDoc lab result released',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent the moment the lab releases results in MocDoc.',
    message: <>Your <em>[Test name]</em> report is ready 📄<br/><br/>Collect at the Flamingo reception or ask Dr. <em>[Doctor]</em> to review it.<br/><br/>📅 Book follow-up: flamingohealthcare.in</>
  },
  {
    title: '🏥 IP admission', trigger: 'MocDoc IP admission created',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent to the attender\'s number when a patient is admitted as inpatient.',
    message: <><em>[Patient]</em> has been admitted to Flamingo Healthcare 🏥<br/><br/>🛏️ Ward: <em>[Ward]</em><br/>👨‍⚕️ Doctor: <em>[Doctor]</em><br/><br/>🕐 Visiting hours: 9–12 AM and 4–7 PM<br/>📞 Helpdesk (24/7): 044-2658 2424</>
  },
  {
    title: '💬 IP Day 2 feedback', trigger: '24 hours after IP admission',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent to the attender 24 hours after admission to collect in-stay feedback.',
    message: <>Flamingo Healthcare checking in on <em>[Patient]</em>'s stay 🏥<br/><br/>How has the experience been so far?<br/><br/>1️⃣ Excellent &nbsp; 2️⃣ Good &nbsp; 3️⃣ Needs improvement</>
  },
  {
    title: '🎉 At discharge', trigger: 'MocDoc IP discharge',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Sent when the patient is discharged from MocDoc.',
    message: <><em>[Patient]</em>, we are glad you are going home! 🎉<br/><br/>📋 Take all medications on time<br/>📋 Avoid strenuous activity for 7 days<br/>📋 Return if fever or severe pain<br/><br/>⭐ Leave a review: g.page/r/flamingo-review</>
  },
  {
    title: '🤗 3-5 days post discharge', trigger: '3 days after IP discharge',
    color: 'var(--teal)', headerClass: 'tpl-head',
    badge: { label: 'Live', variant: 'green' },
    desc: 'Recovery check sent automatically 3 days after the patient goes home.',
    message: <>Dear <em>[Patient]</em>,<br/><br/>It has been a few days since your discharge. How are you feeling?<br/><br/>If you have any concerns, please contact us.<br/>📞 044-2658 2424<br/>📅 Book follow-up: flamingohealthcare.in</>
  },
  {
    title: '📞 Missed follow-up / no-show', trigger: 'MocDoc appointment status → No-show',
    color: 'var(--amber)', headerClass: 'tpl-head-amber',
    badge: { label: 'Automated', variant: 'amber' },
    desc: 'Sent within 30 minutes when a patient misses their appointment.',
    message: <>Hi <em>[Patient]</em>, your appointment with <em>[Doctor]</em> on <em>[Date]</em> was not completed.<br/><br/>You can book a new slot here:<br/>📅 flamingohealthcare.in<br/>📞 044-2658 2424</>
  },
  {
    title: '📞 Answered call — thank you', trigger: 'Inbound call answered & completed',
    color: 'var(--amber)', headerClass: 'tpl-head-amber',
    badge: { label: 'Automated', variant: 'amber' },
    desc: 'Sent after an answered call completes (missed calls get the callback message instead).',
    message: <>Thank you for calling Flamingo Healthcare 🙏<br/><br/>It was our pleasure to assist you. If you have further questions, our team is always here to help.<br/>📅 Book: flamingohealthcare.in<br/>📞 044-2658 2424</>
  },
  {
    title: '📞 Missed call — callback', trigger: 'Inbound call not answered',
    color: 'var(--amber)', headerClass: 'tpl-head-amber',
    badge: { label: 'Automated', variant: 'amber' },
    desc: 'Apology and callback assurance sent automatically when a call goes unanswered.',
    message: <>Dear <em>[Patient]</em>, your call to Flamingo Healthcare was not connected.<br/><br/>Our team will call you back shortly.<br/>📞 044-2658 2424 / +91 9150565888<br/>📅 Book online: flamingohealthcare.in</>
  },
  {
    title: '🔁 30 / 60 / 90-day recall', trigger: 'Daily at 9 AM — scheduled from last visit',
    color: 'var(--blue)', headerClass: 'tpl-head-blue',
    badge: { label: 'Daily 9 AM', variant: 'blue' },
    desc: 'Automatically scheduled when a patient completes a visit. Fires at 30, 60, or 90 days.',
    message: <>Hi <em>[Patient]</em>, this is a routine <em>[30/60/90]</em>-day follow-up reminder from Flamingo Healthcare (<em>[Specialty]</em>).<br/><br/>A periodic review is recommended at this stage.<br/>📅 Book now: flamingohealthcare.in<br/>📞 044-2658 2424</>
  },
  {
    title: '🎂 Birthday message', trigger: 'Daily at 9 AM — matches date of birth',
    color: 'var(--purple)', headerClass: 'tpl-head-purple',
    badge: { label: 'Daily 9 AM', variant: 'purple' },
    desc: 'Sent automatically on the patient\'s birthday. DOB synced from MocDoc.',
    message: <>Happy Birthday, <em>[Patient]</em>! 🎂<br/><br/>The team at Flamingo Healthcare wishes you good health this year. If you are due for a check-up, you can book one anytime:<br/>📅 flamingohealthcare.in<br/>📞 044-2658 2424</>
  },
  {
    title: '🩺 Annual visit reminder', trigger: 'Daily at 9 AM — matches first visit date',
    color: 'var(--purple)', headerClass: 'tpl-head-purple',
    badge: { label: 'Daily 9 AM', variant: 'purple' },
    desc: 'Sent on the anniversary of the patient\'s first visit, as an annual check-up reminder.',
    message: <>Hi <em>[Patient]</em>, it has been a year since your first visit to Flamingo Healthcare.<br/><br/>An annual check-up is recommended.<br/>📅 Book: flamingohealthcare.in</>
  },
  {
    title: '🎉 Festival greetings', trigger: 'Daily at 9 AM — auto-detects Indian festivals',
    color: 'var(--purple)', headerClass: 'tpl-head-purple',
    badge: { label: 'Daily 9 AM', variant: 'purple' },
    desc: 'Auto-detects Pongal, Tamil New Year, Independence Day, Republic Day, Christmas, New Year and more.',
    message: <>🌾 Pongal greetings from Flamingo Healthcare!<br/><br/>Hi <em>[Patient]</em>! Happy Pongal! May this harvest season bring you joy and good health.<br/><br/>📞 044-2658 2424</>
  },
  {
    title: '👋 7-day post-visit reminder', trigger: 'Daily at 9 AM — 7 days after consultation',
    color: 'var(--purple)', headerClass: 'tpl-head-purple',
    badge: { label: 'Daily 9 AM', variant: 'purple' },
    desc: 'Sent exactly 7 days after a consultation is completed.',
    message: <>Hi <em>[Patient]</em>, this is a 1-week follow-up from Flamingo Healthcare regarding your visit with Dr. <em>[Doctor]</em>.<br/><br/>If you would like a follow-up consultation, you can book one here:<br/>📅 flamingohealthcare.in</>
  },
  {
    title: '💊 90-day re-engagement', trigger: 'Daily at 9 AM — inactive 90+ days',
    color: 'var(--purple)', headerClass: 'tpl-head-purple',
    badge: { label: 'Daily 9 AM', variant: 'purple' },
    desc: 'Sent to patients who have not been contacted in 90+ days. Professional clinical tone.',
    message: <>Hi <em>[Patient]</em>, it has been a while since your last visit to Flamingo Healthcare, Ambattur.<br/><br/>As a <em>[Specialty]</em> patient, a periodic follow-up consultation is recommended.<br/><br/>📞 044-2658 2424<br/>📅 flamingohealthcare.in</>
  },
  {
    title: '📢 Monthly health broadcast', trigger: 'Automatic — 1st of each month (also sendable manually)',
    color: 'var(--blue)', headerClass: 'tpl-head-blue',
    badge: { label: 'Auto + Manual', variant: 'blue' },
    desc: 'Monthly health tip auto-sends on the 1st; offers and camps sent on demand from Campaigns. Uses approved WhatsApp templates.',
    message: <>Dear <em>[Patient]</em>,<br/><br/><em>[Custom health tip / offer / camp details]</em><br/><br/>📍 Flamingo Healthcare, Ambattur<br/>📞 044-2658 2424</>
  },
]

export function AutomationsPage() {
  return (
    <div>
      <div className="info-banner">
        All WhatsApp messages sent automatically based on patient events from MocDoc and the daily scheduler. No manual action needed.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        {TEMPLATES.map((tpl, i) => (
          <div className="card" key={i}>
            <div className={`card-header ${tpl.headerClass}`}>
              <div>
                <div className="card-title" style={{ color: tpl.color }}>{tpl.title}</div>
                <div className="card-sub">Trigger: {tpl.trigger}</div>
              </div>
              <Badge variant={tpl.badge.variant}>{tpl.badge.label}</Badge>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text2)', marginBottom: 6 }}>{tpl.desc}</div>
              <div className="template-bubble">{tpl.message}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}><Badge variant="green">Live</Badge> Fired automatically from MocDoc events</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}><Badge variant="amber">Automated</Badge> Fired by background jobs every 30 minutes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}><Badge variant="purple">Daily 9 AM</Badge> Fired by the daily scheduler</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}><Badge variant="blue">Manual</Badge> Triggered manually from dashboard</div>
      </div>
    </div>
  )
}
