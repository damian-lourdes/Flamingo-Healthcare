const config = require('../config');
const GRAPH  = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

function post(payload) {
  return fetch(GRAPH, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) console.error('[wa]', JSON.stringify(d?.error||d));
    return d;
  });
}

const sendText    = (to, body)    => post({ to, type:'text', text:{ body, preview_url:false } });
const sendButtons = (to, body, buttons) => post({
  to, type:'interactive',
  interactive:{ type:'button', body:{ text:body },
    action:{ buttons: buttons.map(b=>({ type:'reply', reply:{ id:b.id, title:b.title } })) } },
});

module.exports = { sendText, sendButtons };
