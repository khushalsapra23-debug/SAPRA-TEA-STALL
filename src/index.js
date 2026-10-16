// SAPRA TEA STALL - ordering backend (Cloudflare Worker + D1)

const SHOP = {
  name: 'SAPRA TEA STALL',
  address: 'WZ-18, Phool Bagh, Ashok Park Main, Rohtak Road, New Delhi – 110026',
  landmark: 'Under Ashok Park Main Metro Station',
  hours: 'Daily, 12 PM – 12 AM',
  phone: '7011875286',
  wa: '917011875286', // country code + number
  franchise: ['Amul', 'Havmor', 'Pepsi', 'Campa'],
  directions: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('SAPRA TEA STALL, WZ-18, Phool Bagh, Ashok Park Main, Rohtak Road, New Delhi 110026')
};

const ORDER_STATUS = ['New', 'Preparing', 'Ready', 'Collected', 'Cancelled'];
const PAY_STATUS = ['Pay at shop', 'Paid (cash)', 'Paid (online)'];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return json({ ok: false, message: 'Something went wrong. Please try again.' }, 500);
    }
  }
};

async function route(req, env, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/menu' && m === 'GET') return getMenu(env);
  if (p === '/api/order' && m === 'POST') return placeOrder(req, env);
  if (p === '/api/festival' && m === 'GET') return getFestival(env);
  if (p === '/api/festival/order' && m === 'POST') return placeFestivalOrder(req, env);
  if (p.startsWith('/api/festival/img/') && m === 'GET') return festivalImage(env, p.slice('/api/festival/img/'.length));

  if (p.startsWith('/api/admin/')) {
    if (!parseStaff(env).size) return json({ ok: false, message: 'Staff logins are not set up yet. The owner must add STAFF_LOGINS in Cloudflare (see README).' }, 503);
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const nowS = Math.floor(Date.now() / 1000);
    const rec = await env.DB.prepare('SELECT n, t FROM login_fails WHERE ip = ?').bind(ip).first();
    const recent = !!rec && nowS - rec.t < 600;
    if (recent && rec.n >= 5) return json({ ok: false, message: 'Too many wrong attempts. Please wait 10 minutes and try again.' }, 429);
    if (!(await isAdmin(req, env))) {
      const n = recent ? rec.n + 1 : 1;
      await env.DB.prepare('INSERT INTO login_fails (ip, n, t) VALUES (?,?,?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, t = excluded.t').bind(ip, n, nowS).run();
      return json({ ok: false, message: 'Wrong PIN.' }, 401);
    }
    if (rec) await env.DB.prepare('DELETE FROM login_fails WHERE ip = ?').bind(ip).run();
    if (p === '/api/admin/orders' && m === 'GET') return adminOrders(env);
    if (p === '/api/admin/order' && m === 'POST') return adminUpdateOrder(req, env);
    if (p === '/api/admin/accepting' && m === 'POST') return adminAccepting(req, env);
    if (p === '/api/admin/menu' && m === 'GET') return adminMenu(env);
    if (p === '/api/admin/menu' && m === 'POST') return adminSaveMenu(req, env);
    if (p === '/api/admin/schedule' && m === 'POST') return adminSchedule(req, env);
    if (p === '/api/admin/festival' && m === 'GET') return adminFestival(env);
    if (p === '/api/admin/festival' && m === 'POST') return adminSaveFestival(req, env);
  }
  return json({ ok: false, message: 'Not found.' }, 404);
}

/* ---------- Helpers ---------- */
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Daily auto-pause window, in India time. Works across midnight too (e.g. pause 23:00, resume 10:00).
const timeOk = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const fmt12 = (t) => { const h = Number(t.slice(0, 2)); return (h % 12 || 12) + ':' + t.slice(3) + ' ' + (h >= 12 ? 'PM' : 'AM'); };
const inWindow = (from, to, now) => (from === to ? false : from < to ? now >= from && now < to : now >= from || now < to);

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value;
  const yes = (v) => (v || 'YES').toUpperCase() !== 'NO';
  const all = yes(s.accepting), shopOn = yes(s.shop_accepting), festOn = yes(s.festival_accepting);
  const d = istNow();
  const nowT = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  const sched = (pre, defFrom, defTo) => {
    const on = (s[pre + '_sched_on'] || 'NO').toUpperCase() === 'YES';
    const from = timeOk(s[pre + '_sched_from']) ? s[pre + '_sched_from'] : defFrom;
    const to = timeOk(s[pre + '_sched_to']) ? s[pre + '_sched_to'] : defTo;
    return { on, from, to, active: on && inWindow(from, to, nowT) };
  };
  const shopSched = sched('shop', '00:00', '12:00'), festSched = sched('festival', '23:00', '10:00');
  const msg = s.pause_message || '';
  const autoMsg = (x) => 'Orders are paused for now. We will start taking orders again at ' + fmt12(x.to) + '.';
  // accepting = the "pause everything" switch. shopAccepting / festAccepting also take the separate switches and the daily auto-pause into account.
  return {
    accepting: all, shopOn, festOn,
    shopAccepting: all && shopOn && !shopSched.active,
    festAccepting: all && festOn && !festSched.active,
    shopSched, festSched,
    message: msg,
    shopMessage: (!all || !shopOn) ? msg : shopSched.active ? autoMsg(shopSched) : msg,
    festMessage: (!all || !festOn) ? msg : festSched.active ? autoMsg(festSched) : msg
  };
}

function istNow() {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}

async function nextOrderId(env, prefix = 'ST') {
  const d = istNow().toISOString(); // yyyy-mm-ddThh:mm...
  const day = d.slice(8, 10) + d.slice(5, 7) + d.slice(2, 4); // ddmmyy
  const row = await env.DB
    .prepare('INSERT INTO seq (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(day).first();
  return prefix + day + '-' + String(row.n).padStart(3, '0');
}

// PIN-only login. Set the secret STAFF_LOGINS to 4-digit PINs separated by commas, e.g. "1234,5678,4321".
// A label is optional: "owner:1234,ravi:5678". Every PIN must be different.
// ADMIN_PASSWORD, if set, also works as a PIN.
function parseStaff(env) {
  const m = new Map(); // pin -> label
  if (env.ADMIN_PASSWORD) m.set(String(env.ADMIN_PASSWORD).replace(/["'\s]/g, ''), 'admin');
  // Accepts commas, semicolons, spaces or new lines between entries, and ignores quotes.
  for (const part of String(env.STAFF_LOGINS || '').replace(/["'\u201c\u201d\u2018\u2019]/g, '').split(/[,;\s]+/)) {
    if (!part) continue;
    const i = part.lastIndexOf(':');
    const pin = (i < 0 ? part : part.slice(i + 1)).replace(/\D/g, '');
    const label = i < 0 ? 'staff' : part.slice(0, i).trim() || 'staff';
    if (pin) m.set(pin, label);
  }
  return m;
}

async function isAdmin(req, env) {
  const given = req.headers.get('x-admin-password') || '';
  const enc = new TextEncoder();
  const hash = async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(v)));
  const g = await hash(given);
  let ok = false;
  for (const pin of parseStaff(env).keys()) {
    const h = await hash(pin);
    let diff = 0;
    for (let i = 0; i < g.length; i++) diff |= g[i] ^ h[i];
    if (diff === 0) ok = true;
  }
  return ok;
}

/* ---------- Customer API ---------- */
async function getMenu(env) {
  const st = await getSettings(env);
  const { results } = await env.DB
    .prepare('SELECT id, category, item, variant, price FROM menu WHERE available = 1 AND price > 0 ORDER BY sort, id')
    .all();
  return json({ shop: SHOP, accepting: st.shopAccepting, pauseMessage: st.shopMessage, menu: results });
}

async function placeOrder(req, env) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, message: 'Invalid request.' }, 400);

  const st = await getSettings(env);
  if (!st.shopAccepting) return json({ ok: false, paused: true, message: st.shopMessage });

  const name = clean(body.name).slice(0, 60);
  const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
  const method = body.method === 'UPI' ? 'UPI at shop' : 'Cash at shop';
  const note = clean(body.note).slice(0, 140);
  if (!name) return json({ ok: false, message: 'Please enter your name.' });
  if (!/^[6-9]\d{9}$/.test(phone)) return json({ ok: false, message: 'Please enter a valid 10-digit mobile number.' });

  // Merge duplicate ids, validate quantities
  const want = new Map();
  for (const it of Array.isArray(body.items) ? body.items.slice(0, 40) : []) {
    const id = Math.floor(Number(it.id)), qty = Math.floor(Number(it.qty));
    if (!(id > 0) || !(qty >= 1 && qty <= 20)) return json({ ok: false, message: 'Some items in your cart are invalid. Please refresh and try again.' });
    want.set(id, Math.min(20, (want.get(id) || 0) + qty));
  }
  if (!want.size) return json({ ok: false, message: 'Your cart is empty.' });

  // Prices always come from the database, never from the browser
  const ids = [...want.keys()];
  const { results } = await env.DB
    .prepare(`SELECT id, item, variant, price, available FROM menu WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all();
  const byId = new Map(results.map((r) => [r.id, r]));

  const lines = [];
  let total = 0;
  for (const [id, qty] of want) {
    const r = byId.get(id);
    if (!r || !r.available || r.price <= 0) {
      return json({ ok: false, message: 'An item in your cart is no longer available. Please refresh the page.' });
    }
    lines.push({ label: r.item + (r.variant ? ' (' + r.variant + ')' : ''), qty, price: r.price });
    total += r.price * qty;
  }

  const orderId = await nextOrderId(env);
  const payStatus = 'Pay at shop';
  const itemsText = lines.map((l) => l.qty + ' x ' + l.label).join(', ');

  await env.DB
    .prepare('INSERT INTO orders (order_id, created_at, name, phone, items_text, total, method, pay_status, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(orderId, istNow().toISOString(), name, phone, itemsText, total, method, payStatus, note)
    .run();

  return json({ ok: true, orderId, total, method, payStatus, lines, name, phone });
}

/* ---------- Admin API ---------- */
async function adminOrders(env) {
  // Shop orders and festival orders (IDs starting FS) are returned separately so each has its own list.
  const shop = await env.DB.prepare("SELECT * FROM orders WHERE order_id NOT LIKE 'FS%' ORDER BY id DESC LIMIT 100").all();
  const fest = await env.DB.prepare("SELECT * FROM orders WHERE order_id LIKE 'FS%' ORDER BY id DESC LIMIT 100").all();
  const st = await getSettings(env);
  return json({ ok: true, orders: shop.results, festOrders: fest.results, accepting: st.accepting, shopOn: st.shopOn, festOn: st.festOn, pauseMessage: st.message, sched: { shop: st.shopSched, festival: st.festSched } });
}

async function adminUpdateOrder(req, env) {
  const b = await req.json().catch(() => ({}));
  const sets = [], vals = [];
  if (b.status !== undefined) {
    if (!ORDER_STATUS.includes(b.status)) return json({ ok: false, message: 'Bad status.' }, 400);
    sets.push('status = ?'); vals.push(b.status);
  }
  if (b.pay_status !== undefined) {
    if (!PAY_STATUS.includes(b.pay_status)) return json({ ok: false, message: 'Bad payment status.' }, 400);
    sets.push('pay_status = ?'); vals.push(b.pay_status);
  }
  if (!sets.length) return json({ ok: false, message: 'Nothing to change.' }, 400);
  await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE order_id = ?`).bind(...vals, String(b.order_id)).run();
  return json({ ok: true });
}

async function adminAccepting(req, env) {
  const b = await req.json().catch(() => ({}));
  const up = (k, v) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v);
  const stmts = [];
  // scope: 'all' (default, pauses shop and festival together), 'shop', 'festival', or 'message' (only saves the pause message)
  if (b.scope !== 'message') {
    const key = b.scope === 'shop' ? 'shop_accepting' : b.scope === 'festival' ? 'festival_accepting' : 'accepting';
    stmts.push(up(key, b.accepting ? 'YES' : 'NO'));
  }
  if (typeof b.message === 'string' && clean(b.message)) stmts.push(up('pause_message', clean(b.message).slice(0, 300)));
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

async function adminSchedule(req, env) {
  const b = await req.json().catch(() => ({}));
  const scope = b.scope === 'festival' ? 'festival' : b.scope === 'shop' ? 'shop' : '';
  if (!scope) return json({ ok: false, message: 'Bad request.' }, 400);
  if (!timeOk(b.from) || !timeOk(b.to)) return json({ ok: false, message: 'Please choose both times.' }, 400);
  if (b.from === b.to) return json({ ok: false, message: 'Pause time and resume time cannot be the same.' }, 400);
  await setSetting(env, scope + '_sched_on', b.on ? 'YES' : 'NO');
  await setSetting(env, scope + '_sched_from', b.from);
  await setSetting(env, scope + '_sched_to', b.to);
  return json({ ok: true });
}

async function adminMenu(env) {
  const { results } = await env.DB.prepare('SELECT id, category, item, variant, price, available, sort FROM menu ORDER BY sort, id').all();
  return json({ ok: true, menu: results });
}

async function adminSaveMenu(req, env) {
  const b = await req.json().catch(() => ({}));
  if (b.delete && b.id) {
    await env.DB.prepare('DELETE FROM menu WHERE id = ?').bind(Number(b.id)).run();
    return json({ ok: true });
  }
  const category = clean(b.category).slice(0, 40), item = clean(b.item).slice(0, 60), variant = clean(b.variant).slice(0, 40);
  const price = Math.max(0, Math.floor(Number(b.price) || 0));
  const available = b.available ? 1 : 0;
  if (!category || !item) return json({ ok: false, message: 'Category and item name are required.' }, 400);
  if (b.id) {
    await env.DB.prepare('UPDATE menu SET category=?, item=?, variant=?, price=?, available=? WHERE id=?')
      .bind(category, item, variant, price, available, Number(b.id)).run();
  } else {
    await env.DB.prepare('INSERT INTO menu (category, item, variant, price, available, sort) VALUES (?,?,?,?,?, (SELECT COALESCE(MAX(sort),0)+1 FROM menu))')
      .bind(category, item, variant, price, available).run();
  }
  return json({ ok: true });
}

/* ---------- Festival Special ---------- */
// The table is created automatically the first time it is needed, so no manual SQL step is required.
let festReady = false;
async function ensureFestival(env) {
  if (festReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS festival (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, image TEXT NOT NULL DEFAULT '', img_v INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0)"
  ).run();
  festReady = true;
}

// Festival settings live in the settings table. The section is OFF until staff switch it on.
async function festivalSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'festival_%'").all();
  const v = {};
  for (const r of results) v[r.key] = r.value;
  return {
    on: (v.festival_on || 'NO').toUpperCase() === 'YES',
    title: v.festival_title || 'Festival Special',
    festivalName: v.festival_name || '',
    contactName: v.festival_contact_name || 'Ekta',
    phone: v.festival_phone || '7011875287'
  };
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

async function getFestival(env) {
  await ensureFestival(env);
  const st = await festivalSettings(env);
  if (!st.on) return json({ ok: true, on: false, items: [], title: st.title, festivalName: st.festivalName });
  const shop = await getSettings(env);
  const { results } = await env.DB
    .prepare("SELECT id, name, description, price, img_v, (image <> '') AS has_img FROM festival WHERE available = 1 ORDER BY sort, id")
    .all();
  return json({ ok: true, on: true, accepting: shop.festAccepting, pauseMessage: shop.festMessage, title: st.title, festivalName: st.festivalName, contactName: st.contactName, phone: st.phone, items: results });
}

async function festivalImage(env, idStr) {
  await ensureFestival(env);
  const id = Math.floor(Number(idStr));
  if (!(id > 0)) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare('SELECT image FROM festival WHERE id = ?').bind(id).first();
  const mm = row && /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(row.image);
  if (!mm) return new Response('Not found', { status: 404 });
  const bin = atob(mm[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // The page adds ?v=<version>, so the browser may keep each picture for a long time.
  return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
}

async function adminFestival(env) {
  await ensureFestival(env);
  const { results } = await env.DB
    .prepare("SELECT id, name, description, price, img_v, available, sort, (image <> '') AS has_img FROM festival ORDER BY sort, id")
    .all();
  return json({ ok: true, settings: await festivalSettings(env), items: results });
}

async function adminSaveFestival(req, env) {
  await ensureFestival(env);
  const b = await req.json().catch(() => ({}));

  if (b.action === 'settings') {
    if (b.on !== undefined) await setSetting(env, 'festival_on', b.on ? 'YES' : 'NO');
    if (b.festivalName !== undefined) await setSetting(env, 'festival_name', clean(b.festivalName).slice(0, 40));
    if (b.title !== undefined) await setSetting(env, 'festival_title', clean(b.title).slice(0, 40) || 'Festival Special');
    if (b.contactName !== undefined) await setSetting(env, 'festival_contact_name', clean(b.contactName).slice(0, 40) || 'Ekta');
    if (b.phone !== undefined) {
      const ph = String(b.phone).replace(/\D/g, '').slice(-10);
      if (!/^[6-9]\d{9}$/.test(ph)) return json({ ok: false, message: 'Please enter a valid 10-digit mobile number.' }, 400);
      await setSetting(env, 'festival_phone', ph);
    }
    return json({ ok: true });
  }
  if (b.delete && b.id) {
    await env.DB.prepare('DELETE FROM festival WHERE id = ?').bind(Number(b.id)).run();
    return json({ ok: true });
  }

  const name = clean(b.name).slice(0, 60);
  const description = clean(b.description).slice(0, 300);
  const price = Math.max(0, Math.floor(Number(b.price) || 0));
  const available = b.available ? 1 : 0;
  if (!name) return json({ ok: false, message: 'Item name is required.' }, 400);

  // image: undefined = keep the current picture, '' = remove it, data URL = replace it
  let image = null;
  if (typeof b.image === 'string') {
    if (b.image === '') image = '';
    else if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.image) && b.image.length <= 450000) image = b.image;
    else return json({ ok: false, message: 'That picture is not usable or is too large. Please try another one.' }, 400);
  }

  if (b.id) {
    if (image === null) {
      await env.DB.prepare('UPDATE festival SET name=?, description=?, price=?, available=? WHERE id=?')
        .bind(name, description, price, available, Number(b.id)).run();
    } else {
      await env.DB.prepare('UPDATE festival SET name=?, description=?, price=?, available=?, image=?, img_v=img_v+1 WHERE id=?')
        .bind(name, description, price, available, image, Number(b.id)).run();
    }
  } else {
    await env.DB.prepare('INSERT INTO festival (name, description, price, image, img_v, available, sort) VALUES (?,?,?,?,1,?, (SELECT COALESCE(MAX(sort),0)+1 FROM festival))')
      .bind(name, description, price, image || '', available).run();
  }
  return json({ ok: true });
}

async function placeFestivalOrder(req, env) {
  await ensureFestival(env);
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, message: 'Invalid request.' }, 400);

  const shop = await getSettings(env);
  if (!shop.festAccepting) return json({ ok: false, paused: true, message: shop.festMessage });
  const fs = await festivalSettings(env);
  if (!fs.on) return json({ ok: false, message: 'The festival section is not open right now.' });

  const name = clean(body.name).slice(0, 60);
  const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
  const method = body.method === 'UPI' ? 'UPI at shop' : 'Cash at shop';
  const note = clean(body.note).slice(0, 140);
  if (!name) return json({ ok: false, message: 'Please enter your name.' });
  if (!/^[6-9]\d{9}$/.test(phone)) return json({ ok: false, message: 'Please enter a valid 10-digit mobile number.' });

  const want = new Map();
  for (const it of Array.isArray(body.items) ? body.items.slice(0, 40) : []) {
    const id = Math.floor(Number(it.id)), qty = Math.floor(Number(it.qty));
    if (!(id > 0) || !(qty >= 1 && qty <= 20)) return json({ ok: false, message: 'Some items in your cart are invalid. Please refresh and try again.' });
    want.set(id, Math.min(20, (want.get(id) || 0) + qty));
  }
  if (!want.size) return json({ ok: false, message: 'Your cart is empty.' });

  const ids = [...want.keys()];
  const { results } = await env.DB
    .prepare(`SELECT id, name, price, available FROM festival WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all();
  const byId = new Map(results.map((r) => [r.id, r]));

  const lines = [];
  let total = 0;
  for (const [id, qty] of want) {
    const r = byId.get(id);
    if (!r || !r.available || r.price <= 0) {
      return json({ ok: false, message: 'An item in your cart is no longer available. Please refresh the page.' });
    }
    lines.push({ label: r.name, qty, price: r.price });
    total += r.price * qty;
  }

  const orderId = await nextOrderId(env, 'FS');
  const itemsText = '[' + fs.title + '] ' + lines.map((l) => l.qty + ' x ' + l.label).join(', ');
  await env.DB
    .prepare('INSERT INTO orders (order_id, created_at, name, phone, items_text, total, method, pay_status, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(orderId, istNow().toISOString(), name, phone, itemsText, total, method, 'Pay at shop', note)
    .run();

  return json({ ok: true, orderId, total, method, lines, name, phone, title: fs.title, contactName: fs.contactName, festPhone: fs.phone });
}
