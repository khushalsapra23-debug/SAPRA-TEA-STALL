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
  }
  return json({ ok: false, message: 'Not found.' }, 404);
}

/* ---------- Helpers ---------- */
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value;
  return { accepting: (s.accepting || 'YES').toUpperCase() !== 'NO', message: s.pause_message || '' };
}

function istNow() {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}

async function nextOrderId(env) {
  const d = istNow().toISOString(); // yyyy-mm-ddThh:mm...
  const day = d.slice(8, 10) + d.slice(5, 7) + d.slice(2, 4); // ddmmyy
  const row = await env.DB
    .prepare('INSERT INTO seq (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(day).first();
  return 'ST' + day + '-' + String(row.n).padStart(3, '0');
}

// PIN-only login. Set the secret STAFF_LOGINS to 4-digit PINs separated by commas, e.g. "1234,5678,4321".
// A label is optional: "owner:1234,ravi:5678". Every PIN must be different.
// ADMIN_PASSWORD, if set, also works as a PIN.
function parseStaff(env) {
  const m = new Map(); // pin -> label
  if (env.ADMIN_PASSWORD) m.set(String(env.ADMIN_PASSWORD).trim(), 'admin');
  for (const part of String(env.STAFF_LOGINS || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.lastIndexOf(':');
    const pin = (i < 0 ? t : t.slice(i + 1)).trim();
    const label = i < 0 ? 'staff' : t.slice(0, i).trim() || 'staff';
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
  return json({ shop: SHOP, accepting: st.accepting, pauseMessage: st.message, menu: results });
}

async function placeOrder(req, env) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, message: 'Invalid request.' }, 400);

  const st = await getSettings(env);
  if (!st.accepting) return json({ ok: false, paused: true, message: st.message });

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
  const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all();
  const st = await getSettings(env);
  return json({ ok: true, orders: results, accepting: st.accepting, pauseMessage: st.message });
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
  const stmts = [env.DB.prepare("INSERT INTO settings (key, value) VALUES ('accepting', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(b.accepting ? 'YES' : 'NO')];
  if (typeof b.message === 'string' && clean(b.message)) {
    stmts.push(env.DB.prepare("INSERT INTO settings (key, value) VALUES ('pause_message', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(clean(b.message).slice(0, 300)));
  }
  await env.DB.batch(stmts);
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
