import { readFileSync, writeFileSync } from 'node:fs';

const STATE_FILE = '.state.json';
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT  = process.env.TELEGRAM_CHAT_ID;

// debug: also ping while still out of stock, to prove the watcher is alive
const sendIfOutOfStock = false;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Each site:
//   enabled  set false to skip the site entirely
//   id       state key (stable, never change it)
//   url      human link shown in the alert
//   fetchUrl what we actually GET to decide stock (defaults to url)
//   detect   (responseText) => true when OUT of stock
//   title    headline of the "back in stock" alert
//   cta      link text of the alert
const SITES = [
  {
    enabled: false,
    id: 'jzze',
    url: 'https://lp.vp4.me/jzze',
    // landing page renders this text only while sold out
    detect: (html) => html.includes('הביקוש לערכה היה עצום והמלאי אזל תוך זמן קצר'),
    title: 'ערכת החלומות של שילב חזרה למלאי!',
    cta: 'לחצו כאן להזמנה',
  },
  {
    enabled: true,
    id: 'eventer-nostalgia',
    url: 'https://www.eventer.co.il/mesibatanostalgialehet2',
    // eventer is an Angular SPA: the page HTML is empty and the configured
    // sold-out message lives in `purchaseFrameSoldOutMsg` whether or not it is
    // actually sold out, so neither is a usable signal. The live inventory is
    // in the public ticketTypes endpoint instead. Sold out == no buyable ticket
    // (price -1 means "not on sale", remaining 0 means "none left").
    fetchUrl: 'https://www.eventer.co.il/events/6a27d7c05b45d30dc6ee4ca2/ticketTypes.js',
    detect: (json) => {
      const data = JSON.parse(json);
      const types = Array.isArray(data.ticketTypes) ? data.ticketTypes : [];
      const offers = Array.isArray(data.jsonLdData) ? data.jsonLdData : [];
      // two independent "back in stock" signals, OR'd: if EITHER flips we alert.
      const buyable      = types.some(t => Number(t.price) >= 0 && t.remaining !== 0);
      const offerInStock = offers.some(o => !String(o.availability).includes('SoldOut'));
      return (buyable || offerInStock);
    },
    title: 'כרטיסים חזרו למכירה — מסיבתה נוסטלגיה, חוזרים ללכת! 🌙',
    cta: 'לחצו כאן לרכישה',
  },
];

if (!TOKEN || !CHAT) {
  console.error('missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID');
  process.exit(1);
}

async function tg(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    console.error('telegram', res.status, await res.text());
    process.exit(1);
  }
}

const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
// migrate old flat shape { outOfStock, ts } -> { jzze: { outOfStock, ts } }
const state = ('outOfStock' in raw) ? { jzze: { outOfStock: raw.outOfStock, ts: raw.ts } } : raw;

let changed = false;

for (const site of SITES) {
  if (!site.enabled) { console.log(`[${site.id}] disabled, skipping`); continue; }

  let outOfStock;
  try {
    const text = await fetch(site.fetchUrl ?? site.url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' },
    }).then(r => {
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      return r.text();
    });
    outOfStock = site.detect(text);
  } catch (e) {
    // never let one flaky site crash the run or fake a "back in stock"
    console.error(`[${site.id}] error: ${e.message}`);
    continue;
  }

  const prev = state[site.id] ?? { outOfStock: false };
  console.log(`[${site.id}] prev=${prev.outOfStock} now=${outOfStock}`);

  const transitionToInStock = prev.outOfStock === true && outOfStock === false;

  if (transitionToInStock) {
    await tg(
      `🎉 <b>${site.title}</b> 🎉\n\n` +
      `👉 <a href="${site.url}">${site.cta}</a>`
    );
    console.log(`[${site.id}] alert sent`);
  } else if (sendIfOutOfStock && outOfStock) {
    await tg(`🔍 <i>debug:</i> watcher alive, ${site.id} still out of stock — ${new Date().toISOString()}`);
    console.log(`[${site.id}] debug ping sent`);
  }

  if (outOfStock !== prev.outOfStock) {
    state[site.id] = { outOfStock, ts: new Date().toISOString() };
    changed = true;
  }
}

if (changed) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  console.log('state updated');
}
