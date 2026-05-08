import { readFileSync, writeFileSync } from 'node:fs';

const URL = 'https://lp.vp4.me/jzze';
const SENTINEL = 'הביקוש לערכה היה 1 עצום והמלאי אזל תוך זמן קצר';
const STATE_FILE = '.state.json';
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT  = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT) {
  console.error('missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID');
  process.exit(1);
}

const html = await fetch(URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
  },
}).then(r => {
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return r.text();
});

const outOfStock = html.includes(SENTINEL);
const prev = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

console.log(`prev=${prev.outOfStock} now=${outOfStock}`);

const transitionToInStock = prev.outOfStock === true && outOfStock === false;

if (transitionToInStock) {
  const msg =
    `🎉 <b>ערכת החלומות של שילב חזרה למלאי!</b> 🎉\n\n` +
    `👉 <a href="${URL}">לחצו כאן להזמנה</a>`;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    console.error('telegram', res.status, await res.text());
    process.exit(1);
  }
  console.log('alert sent');
}

if (outOfStock !== prev.outOfStock) {
  writeFileSync(STATE_FILE, JSON.stringify({ outOfStock, ts: new Date().toISOString() }, null, 2) + '\n');
  console.log('state updated');
}
