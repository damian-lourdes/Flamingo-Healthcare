const fs=require('fs'),path=require('path');
function patch(file,edits){const full=path.resolve(file);if(!fs.existsSync(full)){console.log(`SKIP  ${file} (not found)`);return;}
 let src=fs.readFileSync(full,'utf8'),ch=false;
 for(const e of edits){if(src.includes(e.done)){console.log(`ok    ${file}: ${e.label} (already applied)`);continue;}
  if(!src.includes(e.anchor)){console.log(`WARN  ${file}: ${e.label} — anchor NOT found, skipped`);continue;}
  src=src.replace(e.anchor,e.replace);ch=true;console.log(`DONE  ${file}: ${e.label}`);}
 if(ch)fs.writeFileSync(full,src);}

patch('outbound/server/config/index.js',[
 {label:'exotel config',done:'exotel: {',
  anchor:'onCallNumber: process.env.ON_CALL_NUMBER || null,',
  replace:`onCallNumber: process.env.ON_CALL_NUMBER || null,
  exotel: {
    sid:        process.env.EXOTEL_SID || '',
    apiKey:     process.env.EXOTEL_API_KEY || '',
    apiToken:   process.env.EXOTEL_API_TOKEN || '',
    subdomain:  process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com',
    callerId:   process.env.EXOTEL_CALLER_ID || '',
    agentNumber:process.env.EXOTEL_AGENT_NUMBER || '',
  },`},
]);

patch('frontend/src/api/client.ts',[
 {label:'leadDetail/callLead',done:'leadDetail:',
  anchor:"  moveLead:        (phone: string, body: {status:string; assignedTo?:string; nextActionAt?:string}) => post<SuccessResponse>('/api/leads/' + phone + '/stage', body),",
  replace:`  moveLead:        (phone: string, body: {status:string; assignedTo?:string; nextActionAt?:string}) => post<SuccessResponse>('/api/leads/' + phone + '/stage', body),
  leadDetail:      (phone: string) => get<{lead:any; timeline:any[]}>('/api/leads/' + phone, { lead:null, timeline:[] }),
  callLead:        (phone: string) => post<any>('/api/leads/' + phone + '/call', {}),`},
]);

console.log('\nDone. Review with: git diff');
