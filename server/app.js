require('dotenv').config();
const express = require('express'), helmet = require('helmet'), cookie = require('cookie-parser'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), multer = require('multer'), crypto = require('crypto');
const D = require('./db'), { q, one, run, ins, tx } = D;

const SECRET = process.env.JWT_SECRET || (D.PROD ? null : crypto.randomBytes(32).toString('hex'));
const missing = []; if (!D.hasDb) missing.push('DATABASE_URL'); if (!SECRET) missing.push('JWT_SECRET');
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); // TODO: strict CSP once inline handlers are removed
app.use(express.json({ limit: '1mb' })); app.use(cookie());

// ---------- helpers ----------
class UserError extends Error { constructor(m, code = 400) { super(m); this.code = code; } }
const fail = (m, code) => { throw new UserError(m, code); };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').replace(/^-|-$/g, '') || 'item';
const uniqueSlug = async (d, table, base, exceptId = 0) => { let s = base, n = 1; while (await d.one(`SELECT id FROM ${table} WHERE slug=? AND id!=?`, s, exceptId)) s = `${base}-${++n}`; return s; };
const num = v => (v === '' || v == null || isNaN(v) ? null : Number(v));
const intIds = a => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(Number.isInteger))];
const notify = (d, type, message) => d.run('INSERT INTO notifications(type,message) VALUES(?,?)', type, message);
const getSettings = async () => Object.fromEntries((await q('SELECT key,value FROM settings')).map(r => [r.key, JSON.parse(r.value)]));

app.use(wrap(async (req, res, next) => { // config + database ready
  if (missing.length) return bad(res, 'Server not configured. Missing environment variable(s): ' + missing.join(', '), 500);
  try { await D.ready(); } catch (e) { console.error('DB init failed:', e); return bad(res, e.configHint ? e.message : 'The database is not reachable. Check DATABASE_URL and the function logs.', 500); }
  next();
}));
app.use(wrap(async (req, res, next) => { // session from httpOnly cookie
  let p; try { if (req.cookies.token) p = jwt.verify(req.cookies.token, SECRET); } catch { /* invalid token: logged out */ }
  if (p) {
    const u = await one('SELECT u.id,u.name,u.email,u.phone,u.active,u.role_id,r.name role,r.permissions perms FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?', p.id);
    if (u && u.active) { u.perms = JSON.parse(u.perms || '[]'); req.user = u; }
  }
  next();
}));
const need = perm => (req, res, next) => !req.user ? bad(res, 'Please log in', 401)
  : !req.user.role || !(req.user.perms.includes('*') || req.user.perms.includes(perm)) ? bad(res, 'You do not have permission for this action', 403) : next();
const publicUser = u => u && { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role || null, perms: u.perms || [] };
const setCookie = (res, id) => res.cookie('token', jwt.sign({ id }, SECRET, { expiresIn: '7d' }), { httpOnly: true, sameSite: 'strict', secure: D.PROD, maxAge: 7 * 864e5 });
app.use('/api', (req, res, next) => (req.method !== 'GET' && !req.is('json') && !req.is('multipart/form-data') && req.headers['content-length'] > 0) ? bad(res, 'Unsupported content type', 415) : next());

// attempt limiter stored in the database (works across serverless instances)
const tooMany = async (req, kind, max) => (await one("SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND kind=? AND created_at>now()-interval '15 minutes'", req.ip, kind)).n >= max;
const hit = req => run('INSERT INTO login_attempts(ip,kind) VALUES(?,?)', req.ip, req.path.includes('login') ? 'login' : 'register');

// ---------- auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  if (await tooMany(req, 'register', 10)) fail('Too many attempts. Try again in a few minutes.', 429);
  const { name, email, phone, password } = req.body;
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '')) fail('Enter your name and a valid email');
  if (!password || password.length < 8) fail('Password must be at least 8 characters');
  if (await one('SELECT id FROM users WHERE email=?', email.toLowerCase())) fail('An account with this email already exists', 409);
  await hit(req);
  const id = await ins('INSERT INTO users(name,email,phone,password_hash) VALUES(?,?,?,?)', name.trim(), email.toLowerCase(), phone || null, bcrypt.hashSync(password, 12));
  await notify(D, 'customer', `New customer: ${name}`); setCookie(res, id);
  res.json({ user: publicUser({ id, name, email, phone }) });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  if (await tooMany(req, 'login', 10)) fail('Too many attempts. Try again in a few minutes.', 429);
  const { email, password } = req.body;
  const u = await one('SELECT u.*,r.name role,r.permissions perms FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.email=?', String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) { await hit(req); fail('Incorrect email or password', 401); }
  if (!u.active) fail('This account is disabled', 403);
  await run("DELETE FROM login_attempts WHERE ip=? OR created_at<now()-interval '1 day'", req.ip);
  u.perms = JSON.parse(u.perms || '[]'); setCookie(res, u.id); res.json({ user: publicUser(u) });
}));
app.post('/api/auth/logout', (req, res) => res.clearCookie('token').json({ ok: true }));
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) || null }));
app.put('/api/me', wrap(async (req, res) => {
  if (!req.user) fail('Please log in', 401);
  await run('UPDATE users SET name=?,phone=? WHERE id=?', req.body.name || req.user.name, req.body.phone ?? req.user.phone, req.user.id); res.json({ ok: true });
}));
app.put('/api/me/password', wrap(async (req, res) => {
  if (!req.user) fail('Please log in', 401);
  const u = await one('SELECT password_hash FROM users WHERE id=?', req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) fail('Current password is incorrect');
  if (!req.body.next || req.body.next.length < 8) fail('New password must be at least 8 characters');
  await run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(req.body.next, 12), req.user.id); res.json({ ok: true });
}));

// ---------- uploaded images (stored in Postgres, served with long cache headers) ----------
app.get('/uploads/:name', wrap(async (req, res) => {
  const m = await one('SELECT mime,data FROM media WHERE filename=?', req.params.name);
  if (!m) return res.status(404).end();
  res.set({ 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(m.data);
}));

// ---------- products ----------
const SORTS = { newest: 'p.id DESC', price_asc: 'COALESCE(NULLIF(p.sale_price,0),p.price) ASC', price_desc: 'COALESCE(NULLIF(p.sale_price,0),p.price) DESC', name: 'p.name ASC', stock: 'p.stock ASC' };
const NOVAR = 'NOT EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id)';
async function listProducts(qs, admin) {
  const w = [], a = [];
  if (!admin) w.push("p.status='published' AND (c.id IS NULL OR c.active=1)");
  if (qs.q) { const l = `%${qs.q}%`; w.push('(p.name ILIKE ? OR p.sku ILIKE ? OR p.tags ILIKE ? OR b.name ILIKE ? OR c.name ILIKE ?)'); a.push(l, l, l, l, l); }
  if (qs.category) { const v = String(qs.category); if (/^\d+$/.test(v)) { w.push('(c.id=? OR c.parent_id=?)'); a.push(+v, +v); } else { w.push('(c.slug=? OR c.parent_id IN (SELECT id FROM categories WHERE slug=?))'); a.push(v, v); } }
  if (qs.brand) { const v = String(qs.brand); if (/^\d+$/.test(v)) { w.push('b.id=?'); a.push(+v); } else { w.push('b.name=?'); a.push(v); } }
  if (qs.min && !isNaN(qs.min)) { w.push('COALESCE(NULLIF(p.sale_price,0),p.price)>=?'); a.push(+qs.min); }
  if (qs.max && !isNaN(qs.max)) { w.push('COALESCE(NULLIF(p.sale_price,0),p.price)<=?'); a.push(+qs.max); }
  for (const f of ['featured', 'is_new', 'best_seller']) if (qs[f]) w.push(`p.${f}=1`);
  if (qs.sale) w.push('(p.sale_price>0 AND p.sale_price<p.price)');
  if (admin && qs.status) { w.push('p.status=?'); a.push(qs.status); }
  if (admin && qs.stock === 'low') w.push(`(p.stock<=p.low_stock AND p.stock>0 AND ${NOVAR})`);
  if (admin && qs.stock === 'out') w.push(`((p.stock<=0 AND ${NOVAR}) OR (NOT ${NOVAR} AND (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id=p.id)<=0))`);
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '', from = 'FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id';
  const limit = Math.min(+qs.limit || 24, 100), page = Math.max(+qs.page || 1, 1);
  const total = (await one(`SELECT COUNT(*) n ${from} ${where}`, ...a)).n;
  const items = await q(`SELECT p.*,c.name category,c.slug category_slug,b.name brand ${from} ${where} ORDER BY ${SORTS[qs.sort] || SORTS.newest} LIMIT ? OFFSET ?`, ...a, limit, (page - 1) * limit);
  items.forEach(shape); await attachVariants(D, items);
  return { items, total, page, pages: Math.max(Math.ceil(total / limit), 1) };
}
function shape(p) { p.images = JSON.parse(p.images || '[]'); p.price_now = p.sale_price > 0 && p.sale_price < p.price ? p.sale_price : p.price; p.discount_pct = p.price_now < p.price ? Math.round(100 - p.price_now / p.price * 100) : 0; return p; }
async function attachVariants(d, items) {
  if (!items.length) return;
  const vs = await d.q(`SELECT * FROM variants WHERE product_id IN (${items.map(() => '?').join(',')}) ORDER BY id`, ...items.map(p => p.id));
  for (const p of items) {
    p.variants = vs.filter(v => v.product_id === p.id).map(v => ({ ...v, options: JSON.parse(v.options || '{}'), price_now: v.price > 0 ? v.price : p.price_now }));
    p.available = p.variants.length ? p.variants.reduce((s, v) => s + Math.max(v.stock, 0), 0) : Math.max(p.stock, 0);
    p.in_stock = p.available > 0 || !!p.allow_backorder;
  }
}
app.get('/api/products', wrap(async (req, res) => res.json(await listProducts(req.query, false))));
app.get('/api/products/:slug', wrap(async (req, res) => {
  const p = await one("SELECT p.*,c.name category,c.slug category_slug,b.name brand FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id WHERE p.slug=? AND p.status='published'", req.params.slug);
  if (!p) fail('Product not found', 404);
  await run('UPDATE products SET views=views+1 WHERE id=?', p.id); shape(p); await attachVariants(D, [p]); res.json(p);
}));
app.get('/api/categories', wrap(async (req, res) => res.json(await q('SELECT * FROM categories WHERE active=1 ORDER BY sort,name'))));
app.get('/api/settings', wrap(async (req, res) => res.json(await getSettings())));
app.get('/api/banners', wrap(async (req, res) => res.json(await q('SELECT * FROM banners WHERE active=1 ORDER BY sort,id'))));

// ---------- checkout ----------
async function adjustStock(d, p, v, delta, reason, userId) {
  const cur = v ? v.stock : p.stock, after = cur + delta;
  if (v) await d.run('UPDATE variants SET stock=? WHERE id=?', after, v.id); else await d.run('UPDATE products SET stock=? WHERE id=?', after, p.id);
  await d.run('INSERT INTO inventory_log(product_id,variant_id,product_name,change,stock_after,reason,user_id) VALUES(?,?,?,?,?,?,?)', p.id, v?.id || null, v ? `${p.name} (${v.name})` : p.name, delta, after, reason, userId);
  const label = `${p.name}${v ? ' (' + v.name + ')' : ''}`;
  if (after <= 0 && cur > 0) await notify(d, 'stock', `Out of stock: ${label}`);
  else if (after <= p.low_stock && cur > p.low_stock) await notify(d, 'stock', `Low stock: ${label} – ${after} left`);
}
app.post('/api/orders', wrap(async (req, res) => {
  const b = req.body, S = await getSettings();
  const raw = Array.isArray(b.items) ? b.items : [];
  if (!raw.length) fail('Your cart is empty');
  if (!b.name || !b.phone || !b.city || !b.address) fail('Name, phone, city and address are required');
  const pm = S.payment_methods.find(m => m.id === b.payment_method && m.enabled);
  if (!pm) fail('Choose an available payment method');
  const merged = new Map(); // same product+option on two lines counts once for the stock check
  for (const it of raw) {
    const pid = Math.floor(+it.product_id), vid = it.variant_id ? Math.floor(+it.variant_id) : null, qty = Math.floor(+it.qty);
    if (!(pid > 0) || !(qty > 0) || (it.variant_id && !(vid > 0))) fail('An item in your cart is no longer available');
    const k = pid + ':' + vid; merged.set(k, { pid, vid, qty: (merged.get(k)?.qty || 0) + qty });
  }
  const out = await tx(async t => {
    let subtotal = 0; const lines = [];
    for (const { pid, vid, qty } of merged.values()) {
      const p = await t.one("SELECT * FROM products WHERE id=? AND status='published' FOR UPDATE", pid);
      if (!p) fail('An item in your cart is no longer available');
      const v = vid ? await t.one('SELECT * FROM variants WHERE id=? AND product_id=? FOR UPDATE', vid, p.id) : null;
      if (vid && !v) fail(`${p.name}: selected option is no longer available`);
      if (!v && await t.one('SELECT 1 x FROM variants WHERE product_id=?', p.id)) fail(`${p.name}: please choose an option`);
      const have = v ? v.stock : p.stock;
      if (qty > have && !p.allow_backorder) fail(`${p.name}${v ? ' (' + v.name + ')' : ''}: only ${Math.max(have, 0)} left in stock`);
      const price = v && v.price > 0 ? v.price : (p.sale_price > 0 && p.sale_price < p.price ? p.sale_price : p.price);
      subtotal += price * qty; lines.push({ p, v, qty, price });
    }
    if (subtotal < (S.min_order || 0)) fail(`Minimum order is ${S.min_order} ${S.currency}`);
    const shipping = subtotal >= (S.free_shipping_over || Infinity) ? 0 : S.shipping_fee || 0, total = subtotal + shipping; // coupons: step 2
    const id = await t.ins('INSERT INTO orders(user_id,customer_name,phone,email,city,area,address,notes,subtotal,shipping,total,payment_method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      req.user?.id || null, b.name, b.phone, b.email || null, b.city, b.area || null, b.address, b.notes || null, subtotal, shipping, total, pm.id);
    const number = 'GS-' + String(id).padStart(6, '0'); await t.run('UPDATE orders SET number=? WHERE id=?', number, id);
    for (const { p, v, qty, price } of lines) {
      await t.run('INSERT INTO order_items(order_id,product_id,variant_id,name,variant_name,sku,price,qty,image) VALUES(?,?,?,?,?,?,?,?,?)', id, p.id, v?.id || null, p.name, v?.name || null, v?.sku || p.sku, price, qty, JSON.parse(p.images || '[]')[0] || null);
      await adjustStock(t, p, v, -qty, `Order ${number}`, null);
    }
    await notify(t, 'order', `New order ${number} – ${total} ${S.currency}`);
    return { id, number, total };
  });
  res.json(out);
}));
app.get('/api/my/orders', wrap(async (req, res) => {
  if (!req.user) fail('Please log in', 401);
  const os = await q('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', req.user.id);
  for (const o of os) o.items = await q('SELECT * FROM order_items WHERE order_id=?', o.id); res.json(os);
}));

// ---------- admin ----------
const admin = express.Router();
admin.param('id', (req, res, next, v) => /^\d+$/.test(v) ? next() : bad(res, 'Invalid id'));
app.use('/api/admin', admin);
admin.get('/stats', need('orders'), wrap(async (req, res) => {
  const live = "status NOT IN ('cancelled','returned')", sum = async w => (await one(`SELECT COALESCE(SUM(total),0) t FROM orders WHERE ${live} ${w}`)).t, cnt = async s => (await one(s)).n;
  const [total, today, week, month, oAll, oPend, oDone, cust, prods, low, outS, daily, recent, top, notes] = await Promise.all([
    sum(''), sum('AND created_at::date=CURRENT_DATE'), sum("AND created_at>=now()-interval '7 days'"), sum("AND created_at>=now()-interval '30 days'"),
    cnt('SELECT COUNT(*) n FROM orders'), cnt("SELECT COUNT(*) n FROM orders WHERE status='pending'"), cnt("SELECT COUNT(*) n FROM orders WHERE status='delivered'"),
    cnt('SELECT COUNT(*) n FROM users WHERE role_id IS NULL'), cnt('SELECT COUNT(*) n FROM products'),
    cnt('SELECT COUNT(*) n FROM products p WHERE p.stock<=p.low_stock AND p.stock>0 AND ' + NOVAR), cnt('SELECT COUNT(*) n FROM products p WHERE p.stock<=0 AND ' + NOVAR),
    q(`SELECT to_char(created_at,'YYYY-MM-DD') d,COUNT(*) orders,SUM(total) sales FROM orders WHERE ${live} AND created_at>=now()-interval '14 days' GROUP BY d ORDER BY d`),
    q('SELECT id,number,customer_name,total,status,created_at FROM orders ORDER BY id DESC LIMIT 6'),
    q('SELECT name,SUM(qty) sold,SUM(qty*price) revenue FROM order_items GROUP BY name ORDER BY sold DESC LIMIT 5'),
    q('SELECT * FROM notifications ORDER BY id DESC LIMIT 8')]);
  res.json({ sales: { total, today, week, month }, orders: { total: oAll, pending: oPend, completed: oDone }, customers: cust, products: prods, low, out: outS, daily, recent, top, notifications: notes });
}));

const sniff = b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF ? ['image/jpeg', '.jpg'] : b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG' ? ['image/png', '.png'] : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? ['image/webp', '.webp'] : null;
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4e6 } }).single('file');
admin.post('/upload', need('products'), (req, res, next) => uploader(req, res, err => err ? bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 4 MB)' : err.message) : next()), wrap(async (req, res) => {
  if (!req.file) fail('No file received');
  const kind = sniff(req.file.buffer); if (!kind) fail('Only JPG, PNG or WebP images are allowed'); // checks real file content, not just the name
  const filename = crypto.randomBytes(12).toString('hex') + kind[1], url = '/uploads/' + filename;
  await run('INSERT INTO media(filename,url,mime,size,data) VALUES(?,?,?,?,?)', filename, url, kind[0], req.file.size, req.file.buffer); res.json({ url });
}));

const PF = ['name', 'short_desc', 'description', 'price', 'sale_price', 'sku', 'barcode', 'category_id', 'stock', 'low_stock', 'allow_backorder', 'video', 'weight', 'dimensions', 'tags', 'status', 'featured', 'is_new', 'best_seller', 'seo_title', 'seo_desc'];
const NUMS = ['price', 'sale_price', 'category_id', 'stock', 'low_stock', 'weight'], FLAGS = ['allow_backorder', 'featured', 'is_new', 'best_seller'];
async function saveProduct(t, b, id) {
  if (!b.name || !String(b.name).trim()) fail('Product name is required');
  if (!(num(b.price) >= 0)) fail('Enter a valid price');
  if (num(b.sale_price) > num(b.price)) fail('Sale price must be lower than the regular price');
  const d = {}; for (const k of PF) if (k in b) d[k] = NUMS.includes(k) ? num(b[k]) : FLAGS.includes(k) ? (b[k] ? 1 : 0) : b[k];
  for (const k of ['stock', 'low_stock']) if (k in d && d[k] != null) d[k] = Math.floor(d[k]);
  if (d.status && !['published', 'draft'].includes(d.status)) fail('Invalid status');
  if (b.brand !== undefined) { const n = String(b.brand || '').trim(); d.brand_id = n ? ((await t.one('SELECT id FROM brands WHERE name=?', n))?.id || await t.ins('INSERT INTO brands(name,slug) VALUES(?,?)', n, slugify(n))) : null; }
  if (Array.isArray(b.images)) d.images = JSON.stringify(b.images.filter(s => typeof s === 'string'));
  d.slug = await uniqueSlug(t, 'products', slugify(b.slug || b.name), id || 0);
  const k = Object.keys(d);
  if (id) await t.run(`UPDATE products SET ${k.map(x => x + '=?').join(',')} WHERE id=?`, ...k.map(x => d[x]), id);
  else id = await t.ins(`INSERT INTO products(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`, ...k.map(x => d[x]));
  if (Array.isArray(b.variants)) {
    const keep = [];
    for (const v of b.variants) {
      if (!v.name) continue;
      const f = [v.name, JSON.stringify(v.options || {}), v.sku || null, num(v.price), Math.floor(num(v.stock) || 0), v.image || null], vid = Number.isInteger(+v.id) ? +v.id : 0;
      if (vid && await t.one('SELECT id FROM variants WHERE id=? AND product_id=?', vid, id)) { await t.run('UPDATE variants SET name=?,options=?,sku=?,price=?,stock=?,image=? WHERE id=?', ...f, vid); keep.push(vid); }
      else keep.push(await t.ins('INSERT INTO variants(name,options,sku,price,stock,image,product_id) VALUES(?,?,?,?,?,?,?)', ...f, id));
    }
    await t.run(`DELETE FROM variants WHERE product_id=? ${keep.length ? `AND id NOT IN (${keep.join(',')})` : ''}`, id);
  }
  return id;
}
const fullProduct = async (d, id) => { const p = await d.one('SELECT p.*,b.name brand FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.id=?', id); shape(p); await attachVariants(d, [p]); return p; };
admin.get('/products', need('products'), wrap(async (req, res) => res.json(await listProducts(req.query, true))));
admin.get('/products/:id', need('products'), wrap(async (req, res) => (await one('SELECT id FROM products WHERE id=?', req.params.id)) ? res.json(await fullProduct(D, req.params.id)) : fail('Not found', 404)));
admin.post('/products', need('products'), wrap(async (req, res) => res.json(await tx(async t => fullProduct(t, await saveProduct(t, req.body))))));
admin.put('/products/:id', need('products'), wrap(async (req, res) => res.json(await tx(async t => fullProduct(t, await saveProduct(t, req.body, +req.params.id))))));
admin.delete('/products/:id', need('products'), wrap(async (req, res) => { await run('DELETE FROM products WHERE id=?', req.params.id); res.json({ ok: true }); }));
admin.post('/products/:id/duplicate', need('products'), wrap(async (req, res) => {
  if (!await one('SELECT id FROM products WHERE id=?', req.params.id)) fail('Not found', 404);
  res.json(await tx(async t => { const p = await fullProduct(t, req.params.id); return fullProduct(t, await saveProduct(t, { ...p, name: p.name + ' (copy)', slug: p.slug + '-copy', status: 'draft', sku: null, variants: p.variants.map(v => ({ ...v, id: null, sku: null })) })); }));
}));
admin.post('/products/bulk', need('products'), wrap(async (req, res) => {
  const { action, value } = req.body, ids = intIds(req.body.ids); if (!ids.length) fail('Select at least one product');
  const ph = ids.map(() => '?').join(','), n = num(value);
  await tx(async t => {
    if (action === 'delete') await t.run(`DELETE FROM products WHERE id IN (${ph})`, ...ids);
    else if (action === 'publish' || action === 'unpublish') await t.run(`UPDATE products SET status=? WHERE id IN (${ph})`, action === 'publish' ? 'published' : 'draft', ...ids);
    else if (action === 'price_percent') { if (n == null) fail('Enter a percentage'); await t.run(`UPDATE products SET price=ROUND((price*(1+?::float8/100.0))::numeric)::float8,sale_price=CASE WHEN sale_price>0 THEN ROUND((sale_price*(1+?::float8/100.0))::numeric)::float8 ELSE sale_price END WHERE id IN (${ph})`, n, n, ...ids); }
    else if (action === 'set_stock') { if (n == null || n < 0) fail('Enter a stock quantity'); for (const id of ids) { const p = await t.one('SELECT * FROM products WHERE id=? FOR UPDATE', id); if (p && !await t.one('SELECT 1 x FROM variants WHERE product_id=?', id)) await adjustStock(t, p, null, Math.floor(n) - p.stock, 'Bulk update', req.user.id); } }
    else fail('Unknown action');
  });
  res.json({ ok: true });
}));
admin.get('/products-export.csv', need('products'), wrap(async (req, res) => {
  const rows = await q('SELECT p.id,p.name,p.sku,p.price,p.sale_price,p.stock,p.status,c.name category,b.name brand FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id ORDER BY p.id');
  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  res.type('text/csv').attachment('products.csv').send(['id,name,sku,price,sale_price,stock,status,category,brand', ...rows.map(r => Object.values(r).map(esc).join(','))].join('\n'));
}));

// categories
admin.get('/categories', need('categories'), wrap(async (req, res) => res.json(await q('SELECT c.*,(SELECT COUNT(*) FROM products WHERE category_id=c.id) products FROM categories c ORDER BY sort,name'))));
const saveCat = async (b, id) => {
  if (!b.name) fail('Category name is required');
  if (id && +b.parent_id === id) fail('A category cannot be its own parent');
  const f = [b.name, b.description || null, b.image || null, num(b.parent_id), Math.floor(num(b.sort) || 0), b.active === false || b.active === 0 ? 0 : 1];
  if (id) { await run('UPDATE categories SET name=?,description=?,image=?,parent_id=?,sort=?,active=?,slug=? WHERE id=?', ...f, await uniqueSlug(D, 'categories', slugify(b.slug || b.name), id), id); return id; }
  return ins('INSERT INTO categories(name,description,image,parent_id,sort,active,slug) VALUES(?,?,?,?,?,?,?)', ...f, await uniqueSlug(D, 'categories', slugify(b.name)));
};
admin.post('/categories', need('categories'), wrap(async (req, res) => res.json(await one('SELECT * FROM categories WHERE id=?', await saveCat(req.body)))));
admin.put('/categories/:id', need('categories'), wrap(async (req, res) => res.json(await one('SELECT * FROM categories WHERE id=?', await saveCat(req.body, +req.params.id)))));
admin.delete('/categories/:id', need('categories'), wrap(async (req, res) => { await run('DELETE FROM categories WHERE id=?', req.params.id); res.json({ ok: true }); }));

// inventory
admin.get('/inventory', need('inventory'), wrap(async (req, res) => {
  const rows = await q(`SELECT p.id product_id,NULL::int variant_id,p.name,NULL::text variant,p.sku,p.stock,p.low_stock,p.price FROM products p WHERE ${NOVAR}
    UNION ALL SELECT p.id,v.id,p.name,v.name,v.sku,v.stock,p.low_stock,COALESCE(NULLIF(v.price,0),p.price) FROM variants v JOIN products p ON p.id=v.product_id ORDER BY name`);
  const s = String(req.query.q || '').toLowerCase(), f = req.query.filter;
  const list = rows.filter(r => (!s || `${r.name} ${r.variant || ''} ${r.sku || ''}`.toLowerCase().includes(s)) && (!f || (f === 'out' ? r.stock <= 0 : r.stock > 0 && r.stock <= r.low_stock)));
  res.json({ summary: { total_products: (await one('SELECT COUNT(*) n FROM products')).n, total_units: rows.reduce((a, r) => a + Math.max(r.stock, 0), 0), low: rows.filter(r => r.stock > 0 && r.stock <= r.low_stock).length, out: rows.filter(r => r.stock <= 0).length, value: rows.reduce((a, r) => a + Math.max(r.stock, 0) * r.price, 0) }, items: list, history: await q('SELECT * FROM inventory_log ORDER BY id DESC LIMIT 30') });
}));
admin.post('/inventory/adjust', need('inventory'), wrap(async (req, res) => {
  const { variant_id, delta, set, note } = req.body, pid = Math.floor(+req.body.product_id);
  const out = await tx(async t => {
    const p = await t.one('SELECT * FROM products WHERE id=? FOR UPDATE', pid); if (!p) fail('Product not found', 404);
    const v = variant_id ? await t.one('SELECT * FROM variants WHERE id=? AND product_id=? FOR UPDATE', Math.floor(+variant_id), pid) : null;
    if (variant_id && !v) fail('Variant not found', 404);
    const cur = v ? v.stock : p.stock, isSet = set != null && set !== '', d = isSet ? Math.floor(+set) - cur : Math.floor(+delta);
    if (isNaN(d)) fail('Enter a number');
    await adjustStock(t, p, v, d, note || (isSet ? 'Manual set' : 'Manual adjustment'), req.user.id); return cur + d;
  });
  res.json({ ok: true, stock: out });
}));

// orders
const STATUSES = ['pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled', 'returned'];
admin.get('/orders', need('orders'), wrap(async (req, res) => {
  const w = [], a = [];
  if (req.query.status) { w.push('status=?'); a.push(req.query.status); }
  if (req.query.payment_status) { w.push('payment_status=?'); a.push(req.query.payment_status); }
  if (req.query.q) { w.push('(number ILIKE ? OR customer_name ILIKE ? OR phone ILIKE ?)'); a.push(...Array(3).fill(`%${req.query.q}%`)); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '', page = Math.max(+req.query.page || 1, 1);
  res.json({ items: await q(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT 20 OFFSET ?`, ...a, (page - 1) * 20), total: (await one(`SELECT COUNT(*) n FROM orders ${where}`, ...a)).n, page });
}));
admin.get('/orders/:id', need('orders'), wrap(async (req, res) => { const o = await one('SELECT * FROM orders WHERE id=?', req.params.id); if (!o) fail('Not found', 404); res.json({ ...o, items: await q('SELECT * FROM order_items WHERE order_id=?', o.id) }); }));
admin.put('/orders/:id', need('orders'), wrap(async (req, res) => {
  const { status, payment_status } = req.body;
  if (status && !STATUSES.includes(status)) fail('Invalid status');
  if (payment_status && !['unpaid', 'paid', 'refunded'].includes(payment_status)) fail('Invalid payment status');
  await tx(async t => {
    const o = await t.one('SELECT * FROM orders WHERE id=? FOR UPDATE', req.params.id); if (!o) fail('Not found', 404);
    await t.run('UPDATE orders SET status=COALESCE(?,status),payment_status=COALESCE(?,payment_status) WHERE id=?', status || null, payment_status || null, o.id);
    if (['cancelled', 'returned'].includes(status) && !o.restocked) {
      for (const i of await t.q('SELECT * FROM order_items WHERE order_id=?', o.id)) {
        const p = await t.one('SELECT * FROM products WHERE id=? FOR UPDATE', i.product_id); if (!p) continue;
        await adjustStock(t, p, i.variant_id ? await t.one('SELECT * FROM variants WHERE id=? FOR UPDATE', i.variant_id) : null, i.qty, `Order ${o.number} ${status}`, req.user.id);
      }
      await t.run('UPDATE orders SET restocked=1 WHERE id=?', o.id);
    }
  });
  res.json({ ok: true });
}));

// customers
admin.get('/customers', need('customers'), wrap(async (req, res) => {
  const l = `%${req.query.q || ''}%`;
  res.json(await q(`SELECT u.id,u.name,u.email,u.phone,u.active,u.created_at,COUNT(o.id) orders,COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled','returned') THEN o.total END),0) spent
    FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role_id IS NULL AND (u.name ILIKE ? OR u.email ILIKE ? OR u.phone ILIKE ?) GROUP BY u.id ORDER BY u.id DESC LIMIT 200`, l, l, l));
}));
admin.get('/customers/:id', need('customers'), wrap(async (req, res) => { const u = await one('SELECT id,name,email,phone,active,created_at FROM users WHERE id=? AND role_id IS NULL', req.params.id); if (!u) fail('Not found', 404); res.json({ ...u, orders: await q('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', u.id) }); }));
admin.put('/customers/:id', need('customers'), wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=? AND role_id IS NULL', req.params.id); if (!u) fail('Not found', 404);
  await run('UPDATE users SET name=?,phone=?,active=? WHERE id=?', req.body.name ?? u.name, req.body.phone ?? u.phone, req.body.active == null ? u.active : (req.body.active ? 1 : 0), u.id); res.json({ ok: true });
}));

// settings
admin.get('/settings', need('settings'), wrap(async (req, res) => res.json(await getSettings())));
admin.put('/settings', need('settings'), wrap(async (req, res) => {
  const known = await getSettings();
  await tx(async t => { for (const [k, v] of Object.entries(req.body)) if (k in known) await t.run('UPDATE settings SET value=? WHERE key=?', JSON.stringify(v), k); });
  res.json(await getSettings());
}));

// ---------- errors ----------
app.use('/api', (req, res) => bad(res, 'Not found', 404));
app.use((err, req, res, next) => {
  if (err instanceof UserError) return bad(res, err.message, err.code);
  if (err.type === 'entity.parse.failed') return bad(res, 'Invalid request data');
  console.error(err); bad(res, 'Something went wrong on our side. Please try again.', 500);
});
module.exports = app;
