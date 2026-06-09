/* Flamingo Healthcare — Demo seed data
 * Run once: node server/seed.js
 * Seeds realistic dummy data for dashboard demo.
 */
require('../server/config');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT)||5432,
  database: process.env.DB_NAME||'flamingo', user: process.env.DB_USER||'postgres',
  password: process.env.DB_PASSWORD||'', max: 3,
});

const patients = [
  { phone:'+919841211001', name:'Arun Prasad',       dob:'1982-04-15', specialty:'General Medicine / Diabetology', doctor:'Dr. J. Pranu Chakravarthy' },
  { phone:'+919730022002', name:'Meena Devi',         dob:'1990-06-03', specialty:'Obstetrics & Gynaecology',       doctor:'Dr. S. Aarthi' },
  { phone:'+919621233003', name:'Ravi Shankar',       dob:'1975-11-20', specialty:'General & Laparoscopic Surgery', doctor:'Dr. C. Gunasekar' },
  { phone:'+919512444004', name:'Kavitha S.',         dob:'1988-02-28', specialty:'General Medicine / Diabetology', doctor:'Dr. J. Pranu Chakravarthy' },
  { phone:'+919403655005', name:'Suresh Kumar',       dob:'2015-08-10', specialty:'Paediatrics',                    doctor:'Dr. Praveen' },
  { phone:'+919394866006', name:'Lakshmi Priya',      dob:'1965-09-14', specialty:'Obstetrics & Gynaecology',       doctor:'Dr. K. Parvathavarthini' },
  { phone:'+919286077007', name:'Vijay Anand',        dob:'1978-03-22', specialty:'Orthopaedics',                   doctor:'Dr. Bala Krishnan' },
  { phone:'+919177288008', name:'Geetha R.',          dob:'1985-07-05', specialty:'Fertility',                      doctor:'Dr. S. Tamilarasi' },
  { phone:'+919068499009', name:'Mohan Raj',          dob:'1960-12-01', specialty:'ENT',                            doctor:'Dr. Selva Kumar' },
  { phone:'+918959610010', name:'Priya Nair',         dob:'1995-01-18', specialty:'Dermatology',                    doctor:'Dr. Preethi M.' },
  { phone:'+918850721011', name:'Anand Krishnan',     dob:'1970-05-30', specialty:'General Medicine',               doctor:'Dr. P. Balamanikandan' },
  { phone:'+918741832012', name:'Sumathi Devi',       dob:'1983-10-08', specialty:'Obstetrics & Gynaecology',       doctor:'Dr. S. Aarthi' },
];

const triggerTypes = [
  'enquiry','appt_booked','reminder_2h','post_consultation',
  'lab_prep','lab_report_ready','ip_admission','ip_day2',
  'discharge','post_discharge','missed_followup','call_thankyou',
  'birthday','recall_30d','recall_60d','broadcast',
];

const sampleMessages = {
  enquiry:            'Thank you for contacting Flamingo Healthcare 🙏\n\nWe have received your enquiry. Book an appointment: https://flamingohealthcare.in/book-an-appointment/\n\n📍 Ambattur, Chennai\n📞 044-2658 2424',
  appt_booked:        'Appointment confirmed ✅\n\n👨‍⚕️ Dr. J. Pranu Chakravarthy\n🏥 General Medicine / Diabetology\n📅 Today 10:30 AM\n📍 Flamingo Healthcare, Ambattur\n\n📋 Please carry: Photo ID, previous reports',
  reminder_2h:        'Reminder: Your appointment is in 2 hours ⏰\n\n👨‍⚕️ Dr. J. Pranu Chakravarthy\n📅 Today 10:30 AM\n📍 Flamingo Healthcare, Ambattur\n📞 044-2658 2424',
  post_consultation:  'Thank you for visiting Flamingo Healthcare 🙏\n\nWe hope your consultation was helpful.\n\n⭐ Share your feedback: https://g.page/r/flamingo-review\n📞 044-2658 2424',
  lab_prep:           'Your Blood Glucose Fasting test is scheduled at Flamingo Healthcare.\n\n📋 Preparation:\n• Fast 8–12 hours\n• Water only\n• Continue medications unless told otherwise',
  lab_report_ready:   'Your Blood Glucose Fasting report is ready 📄\n\nCollect it at the Flamingo reception.\n📅 Book follow-up: https://flamingohealthcare.in/book-an-appointment/',
  ip_admission:       'Ravi Shankar has been admitted to Flamingo Healthcare, Ambattur 🏥\n\n🛏️ Ward: Surgical Ward 2\n👨‍⚕️ Doctor: Dr. C. Gunasekar\n\n🕐 Visiting hours: 9–12 AM and 4–7 PM\n📞 044-2658 2424',
  ip_day2:            'Hi! Flamingo Healthcare checking in on Ravi Shankar\'s stay 🏥\n\nHow has the experience been so far?\n\n1️⃣ Excellent\n2️⃣ Good\n3️⃣ Needs improvement',
  discharge:          'Ravi Shankar, we are glad you are going home! 🎉\n\n📋 Instructions from Dr. C. Gunasekar:\n• Take all medications on time\n• Avoid strenuous activity for 7 days\n\n⭐ Leave a review: https://g.page/r/flamingo-review',
  post_discharge:     'Hi Ravi Shankar! Flamingo Healthcare checking in 🤗\n\nIt has been a few days since your discharge. How are you feeling?\n\n📅 Book a follow-up: https://flamingohealthcare.in/book-an-appointment/',
  missed_followup:    'Hi Vijay Anand! We noticed you missed your appointment with Dr. Bala Krishnan (Orthopaedics).\n\n📅 Book a new slot: https://flamingohealthcare.in/book-an-appointment/\n📞 044-2658 2424',
  call_thankyou:      'Thank you for contacting Flamingo Healthcare 🙏\n\nWe have received your call and our team will get back to you shortly.\n\n📍 Flamingo Healthcare, Ambattur, Chennai\n📞 044-2658 2424 / +91 9150565888\n🕐 Mon–Sat: 8:00 AM – 7:00 PM | Emergency: 24/7',
  birthday:           'Happy Birthday, Arun Prasad! 🎂\n\nThe entire team at Flamingo Healthcare, Ambattur, Chennai wishes you a wonderful birthday filled with joy and good health.\n\n📞 044-2658 2424',
  recall_30d:         'Hi Arun Prasad! 👋 Flamingo Healthcare reminder.\n\nIt has been 30 days since your last General Medicine / Diabetology visit.\n\n📅 Book now: https://flamingohealthcare.in/book-an-appointment/',
  recall_60d:         'Hi Ravi Shankar! 👋 Flamingo Healthcare reminder.\n\nIt has been 60 days since your last General & Laparoscopic Surgery visit.\n\n📅 Book now: https://flamingohealthcare.in/book-an-appointment/',
  broadcast:          'Dear Patient, Flamingo Healthcare is conducting a Free Diabetes Screening Camp on 15 June 2026.\n\nAvail free HbA1c and Blood Glucose tests.\n📍 Flamingo Healthcare, Ambattur\n📅 9:00 AM – 1:00 PM\n📞 044-2658 2424',
};

function randomDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  d.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));
  return d;
}

async function seed() {
  console.log('Seeding demo data...');

  // Check if already seeded
  const existing = await pool.query('SELECT COUNT(*) AS n FROM outbound_messages').catch(()=>({rows:[{n:0}]}));
  if (parseInt(existing.rows[0].n) > 0) {
    console.log('Already seeded — clearing first...');
    await pool.query('TRUNCATE outbound_messages, patient_profiles, dialer_calls, callback_queue, recall_schedule, follow_up_queue, engagement_log, broadcast_campaigns RESTART IDENTITY CASCADE').catch(()=>{});
  }

  // 1. Patient profiles
  console.log('Adding patients...');
  for (const p of patients) {
    await pool.query(
      `INSERT INTO patient_profiles(phone,name,dob,specialty,doctor,branch,opt_in,last_contact)
       VALUES($1,$2,$3,$4,$5,'Ambattur',TRUE,NOW()-INTERVAL '${Math.floor(Math.random()*60)} days')
       ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name,dob=EXCLUDED.dob,specialty=EXCLUDED.specialty,doctor=EXCLUDED.doctor,last_contact=EXCLUDED.last_contact`,
      [p.phone, p.name, p.dob, p.specialty, p.doctor]
    );
  }

  // 2. Outbound messages — realistic history over past 30 days
  console.log('Adding message history...');
  const msgInserts = [
    // Arun Prasad — full journey
    { phone:'+919841211001', name:'Arun Prasad',   type:'enquiry',           daysAgo:28 },
    { phone:'+919841211001', name:'Arun Prasad',   type:'appt_booked',       daysAgo:27 },
    { phone:'+919841211001', name:'Arun Prasad',   type:'reminder_2h',       daysAgo:27 },
    { phone:'+919841211001', name:'Arun Prasad',   type:'post_consultation', daysAgo:26 },
    { phone:'+919841211001', name:'Arun Prasad',   type:'recall_30d',        daysAgo:1  },
    // Meena Devi
    { phone:'+919730022002', name:'Meena Devi',     type:'enquiry',           daysAgo:20 },
    { phone:'+919730022002', name:'Meena Devi',     type:'appt_booked',       daysAgo:19 },
    { phone:'+919730022002', name:'Meena Devi',     type:'reminder_2h',       daysAgo:19 },
    { phone:'+919730022002', name:'Meena Devi',     type:'post_consultation', daysAgo:18 },
    // Ravi Shankar — IP journey
    { phone:'+919621233003', name:'Ravi Shankar',   type:'appt_booked',       daysAgo:15 },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'lab_prep',          daysAgo:14 },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'lab_report_ready',  daysAgo:13 },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'ip_admission',      daysAgo:10 },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'ip_day2',           daysAgo:9  },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'discharge',         daysAgo:7  },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'post_discharge',    daysAgo:4  },
    { phone:'+919621233003', name:'Ravi Shankar',   type:'recall_60d',        daysAgo:0  },
    // Kavitha S.
    { phone:'+919512444004', name:'Kavitha S.',     type:'call_thankyou',     daysAgo:5  },
    { phone:'+919512444004', name:'Kavitha S.',     type:'appt_booked',       daysAgo:4  },
    { phone:'+919512444004', name:'Kavitha S.',     type:'reminder_2h',       daysAgo:4  },
    { phone:'+919512444004', name:'Kavitha S.',     type:'post_consultation', daysAgo:3  },
    // Suresh Kumar
    { phone:'+919403655005', name:'Suresh Kumar',   type:'enquiry',           daysAgo:8  },
    { phone:'+919403655005', name:'Suresh Kumar',   type:'appt_booked',       daysAgo:7  },
    { phone:'+919403655005', name:'Suresh Kumar',   type:'lab_prep',          daysAgo:6  },
    { phone:'+919403655005', name:'Suresh Kumar',   type:'lab_report_ready',  daysAgo:5  },
    // Vijay Anand — missed follow-up
    { phone:'+919286077007', name:'Vijay Anand',    type:'appt_booked',       daysAgo:12 },
    { phone:'+919286077007', name:'Vijay Anand',    type:'reminder_2h',       daysAgo:12 },
    { phone:'+919286077007', name:'Vijay Anand',    type:'missed_followup',   daysAgo:11 },
    // Lakshmi Priya — birthday + recall
    { phone:'+919394866006', name:'Lakshmi Priya',  type:'birthday',          daysAgo:3  },
    { phone:'+919394866006', name:'Lakshmi Priya',  type:'recall_30d',        daysAgo:2  },
    // Mohan Raj
    { phone:'+919068499009', name:'Mohan Raj',      type:'call_thankyou',     daysAgo:2  },
    { phone:'+919068499009', name:'Mohan Raj',      type:'appt_booked',       daysAgo:1  },
    // Priya Nair
    { phone:'+918959610010', name:'Priya Nair',     type:'post_consultation', daysAgo:7  },
    // Broadcast — sent to all patients 10 days ago
    ...patients.map(p=>({ phone:p.phone, name:p.name, type:'broadcast', daysAgo:10 })),
  ];

  for (const m of msgInserts) {
    const sentAt = randomDate(m.daysAgo + 1);
    // Ensure correct day range
    const d = new Date(); d.setDate(d.getDate() - m.daysAgo); d.setHours(9+Math.floor(Math.random()*8),Math.floor(Math.random()*60));
    await pool.query(
      'INSERT INTO outbound_messages(phone,patient_name,trigger_type,message,sent_at) VALUES($1,$2,$3,$4,$5)',
      [m.phone, m.name, m.type, sampleMessages[m.type]||'Message from Flamingo Healthcare', d]
    );
    await pool.query(
      'INSERT INTO engagement_log(phone,trigger_type,ref_id,sent_at) VALUES($1,$2,$3,$4)',
      [m.phone, m.type, null, d]
    );
  }

  // 3. Dialer calls — last 7 days
  console.log('Adding call logs...');
  const calls = [
    { phone:'+919841211001', name:'Arun Prasad',   dur:245, status:'answered', agent:'Reception', daysAgo:0 },
    { phone:'+919730022002', name:'Meena Devi',     dur:312, status:'answered', agent:'Reception', daysAgo:0 },
    { phone:'+919512444004', name:'Kavitha S.',     dur:0,   status:'missed',   agent:null,        daysAgo:0 },
    { phone:'+918850721011', name:'Unknown',         dur:0,   status:'missed',   agent:null,        daysAgo:0 },
    { phone:'+919621233003', name:'Ravi Shankar',   dur:189, status:'answered', agent:'Reception', daysAgo:1 },
    { phone:'+919403655005', name:'Suresh Kumar',   dur:423, status:'answered', agent:'Dr. Praveen', daysAgo:1 },
    { phone:'+919286077007', name:'Vijay Anand',    dur:0,   status:'missed',   agent:null,        daysAgo:2 },
    { phone:'+919068499009', name:'Mohan Raj',      dur:156, status:'answered', agent:'Reception', daysAgo:2 },
    { phone:'+918741832012', name:'Sumathi Devi',   dur:267, status:'answered', agent:'Reception', daysAgo:3 },
    { phone:'+918959610010', name:'Priya Nair',     dur:0,   status:'abandoned',agent:null,        daysAgo:3 },
    { phone:'+919394866006', name:'Lakshmi Priya',  dur:334, status:'answered', agent:'Reception', daysAgo:4 },
    { phone:'+918850721011', name:'Anand Krishnan', dur:198, status:'answered', agent:'Reception', daysAgo:5 },
    { phone:'+919177288008', name:'Geetha R.',      dur:0,   status:'missed',   agent:null,        daysAgo:5 },
    { phone:'+919841211001', name:'Arun Prasad',   dur:445, status:'answered', agent:'Dr. J. Pranu Chakravarthy', daysAgo:6 },
    { phone:'+918741832012', name:'Unknown',         dur:0,   status:'missed',   agent:null,        daysAgo:6 },
  ];

  for (const c of calls) {
    const d = new Date(); d.setDate(d.getDate()-c.daysAgo); d.setHours(8+Math.floor(Math.random()*10),Math.floor(Math.random()*60));
    const res = await pool.query(
      'INSERT INTO dialer_calls(phone,caller_name,duration_sec,status,agent,called_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [c.phone, c.name, c.dur||null, c.status, c.agent||null, d]
    );
    if (c.status === 'missed') {
      await pool.query(
        'INSERT INTO callback_queue(phone,caller_name,call_id,missed_at) VALUES($1,$2,$3,$4)',
        [c.phone, c.name, res.rows[0].id, d]
      );
    }
  }

  // Mark some callbacks as already done
  await pool.query("UPDATE callback_queue SET status='called_back' WHERE phone IN ('+919286077007','+919177288008')");

  // 4. Recall schedule
  console.log('Adding recalls...');
  const recalls = [
    { phone:'+919841211001', name:'Arun Prasad',   spec:'General Medicine / Diabetology', days:30, daysFromNow:2  },
    { phone:'+919730022002', name:'Meena Devi',     spec:'Obstetrics & Gynaecology',       days:60, daysFromNow:15 },
    { phone:'+919621233003', name:'Ravi Shankar',   spec:'General & Laparoscopic Surgery', days:90, daysFromNow:45 },
    { phone:'+919394866006', name:'Lakshmi Priya',  spec:'Obstetrics & Gynaecology',       days:30, daysFromNow:0  },
    { phone:'+918959610010', name:'Priya Nair',     spec:'Dermatology',                    days:60, daysFromNow:8  },
  ];
  for (const r of recalls) {
    const d = new Date(); d.setDate(d.getDate()+r.daysFromNow);
    await pool.query(
      'INSERT INTO recall_schedule(phone,name,specialty,recall_at,recall_days,status) VALUES($1,$2,$3,$4,$5,$6)',
      [r.phone, r.name, r.spec, d, r.days, r.daysFromNow <= 0 ? 'pending' : 'pending']
    );
  }

  // 5. Follow-up queue (no-shows)
  console.log('Adding follow-up queue...');
  await pool.query(`INSERT INTO follow_up_queue(phone,name,doctor,specialty,original_dt,status) VALUES
    ('+919286077007','Vijay Anand','Dr. Bala Krishnan','Orthopaedics','28 May 10:00 AM','pending'),
    ('+919177288008','Geetha R.','Dr. S. Tamilarasi','Fertility','30 May 11:30 AM','pending')`);

  // 6. Broadcast campaigns
  console.log('Adding broadcast history...');
  await pool.query(`INSERT INTO broadcast_campaigns(name,message,recipient_count,sent_count,failed_count,sent_at) VALUES
    ('Free Diabetes Screening Camp','Dear Patient, Flamingo Healthcare is conducting a Free Diabetes Screening Camp on 15 June 2026...',12,12,0,NOW()-INTERVAL '10 days'),
    ('World No Tobacco Day','Dear Patient, On World No Tobacco Day, Flamingo Healthcare urges you to take the first step towards a healthier life...',12,11,1,NOW()-INTERVAL '20 days'),
    ('Monsoon Health Tips','Hi {name}! Monsoon season is here. Protect yourself from seasonal infections...',8,8,0,NOW()-INTERVAL '5 days')`);

  console.log('\n✅ Demo data seeded successfully!');
  console.log(`   ${patients.length} patients`);
  console.log(`   ${msgInserts.length} outbound messages`);
  console.log(`   ${calls.length} call logs`);
  console.log(`   ${recalls.length} recall schedules`);
  console.log('   2 follow-up queue entries');
  console.log('   3 broadcast campaigns');
  await pool.end();
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
