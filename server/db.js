require('dotenv').config();
const { Pool, types } = require('pg'), bcrypt = require('bcryptjs');
types.setTypeParser(20, v => parseInt(v, 10));   // bigint (COUNT/SUM) -> number
types.setTypeParser(1700, v => parseFloat(v));   // numeric -> number
types.setTypeParser(1184, v => v); types.setTypeParser(1114, v => v); // timestamps stay as strings

const PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').replace(/([?&])channel_binding=[^&]*&?/, '$1').replace(/[?&]$/, '');
const pool = url ? new Pool({ connectionString: url, max: +process.env.PG_POOL_MAX || 3, idleTimeoutMillis: 10000,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } }) : null;

const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); }; // write SQL with ?, run as $1,$2…
const makeDb = c => ({
  q: async (sql, ...a) => (await c.query(conv(sql), a)).rows,
  one: async (sql, ...a) => (await c.query(conv(sql), a)).rows[0],
  run: async (sql, ...a) => (await c.query(conv(sql), a)).rowCount,
  ins: async (sql, ...a) => (await c.query(conv(sql) + ' RETURNING id', a)).rows[0].id
});
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(makeDb(c)); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

const DDL = `
CREATE TABLE IF NOT EXISTS roles(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, permissions TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL, phone TEXT, password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id), active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS addresses(id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT, city TEXT, area TEXT, address TEXT, phone TEXT, is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories(id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, image TEXT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS brands(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, slug TEXT, logo TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS products(id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, short_desc TEXT, description TEXT,
  price DOUBLE PRECISION NOT NULL DEFAULT 0, sale_price DOUBLE PRECISION, sku TEXT, barcode TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  stock INTEGER DEFAULT 0, low_stock INTEGER DEFAULT 5, allow_backorder INTEGER DEFAULT 0,
  images TEXT DEFAULT '[]', video TEXT, weight DOUBLE PRECISION, dimensions TEXT, tags TEXT,
  status TEXT DEFAULT 'published', featured INTEGER DEFAULT 0, is_new INTEGER DEFAULT 0, best_seller INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0, seo_title TEXT, seo_desc TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS variants(id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, options TEXT DEFAULT '{}', sku TEXT, price DOUBLE PRECISION, stock INTEGER DEFAULT 0, image TEXT);
CREATE TABLE IF NOT EXISTS inventory_log(id SERIAL PRIMARY KEY, product_id INTEGER, variant_id INTEGER, product_name TEXT,
  change INTEGER NOT NULL, stock_after INTEGER, reason TEXT, user_id INTEGER, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS orders(id SERIAL PRIMARY KEY, number TEXT UNIQUE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT, phone TEXT, email TEXT, city TEXT, area TEXT, address TEXT, notes TEXT,
  subtotal DOUBLE PRECISION, discount DOUBLE PRECISION DEFAULT 0, shipping DOUBLE PRECISION DEFAULT 0, total DOUBLE PRECISION, coupon_code TEXT,
  payment_method TEXT, payment_status TEXT DEFAULT 'unpaid', status TEXT DEFAULT 'pending', restocked INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS order_items(id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER, variant_id INTEGER, name TEXT, variant_name TEXT, sku TEXT, price DOUBLE PRECISION, qty INTEGER, image TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS coupons(id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'percent', value DOUBLE PRECISION,
  min_order DOUBLE PRECISION DEFAULT 0, category_id INTEGER, product_id INTEGER, expires_at TEXT, max_uses INTEGER, used INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS reviews(id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, rating INTEGER, body TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS wishlist(user_id INTEGER, product_id INTEGER, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS banners(id SERIAL PRIMARY KEY, title TEXT, subtitle TEXT, image TEXT, link TEXT, button TEXT, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS pages(id SERIAL PRIMARY KEY, slug TEXT UNIQUE, title TEXT, body TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS media(id SERIAL PRIMARY KEY, filename TEXT UNIQUE, url TEXT, mime TEXT, size INTEGER, data BYTEA, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY, type TEXT, message TEXT, seen INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts(id SERIAL PRIMARY KEY, ip TEXT, kind TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_prod_cat ON products(category_id); CREATE INDEX IF NOT EXISTS ix_prod_status ON products(status);
CREATE INDEX IF NOT EXISTS ix_prod_sku ON products(sku); CREATE INDEX IF NOT EXISTS ix_var_prod ON variants(product_id);
CREATE INDEX IF NOT EXISTS ix_ord_user ON orders(user_id); CREATE INDEX IF NOT EXISTS ix_ord_status ON orders(status);
CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id); CREATE INDEX IF NOT EXISTS ix_att ON login_attempts(ip, kind, created_at);
`;

const DEFAULT_SETTINGS = {
  store_name: 'GoranShop', tagline: 'Everything you need, delivered to your door', currency: 'IQD', logo: '', favicon: '',
  contact_email: 'hello@goranshop.com', contact_phone: '+964 750 000 0000', address: 'Sulaymaniyah, Iraq', business_hours: 'Sat–Thu, 9:00–21:00',
  hero_title: 'New season, new arrivals', hero_subtitle: 'Fresh picks in store now, with free delivery on larger orders.',
  hero_image: '', hero_button: 'Shop now', hero_link: '#/products', primary_color: '#0a1f44', accent_color: '#f2a900',
  shipping_fee: 5000, free_shipping_over: 100000, min_order: 0, tax_percent: 0,
  payment_methods: [{ id: 'cod', name: 'Cash on delivery', enabled: true }, { id: 'bank', name: 'Bank transfer', enabled: true }, { id: 'online', name: 'Online payment', enabled: false }],
  home_sections: [{ type: 'featured', title: 'Featured products', enabled: true }, { type: 'new', title: 'New arrivals', enabled: true },
    { type: 'best', title: 'Best sellers', enabled: true }, { type: 'sale', title: 'On sale', enabled: true }],
  social_instagram: '', social_facebook: '', social_tiktok: '', social_youtube: '',
  seo_title: 'GoranShop – Online store', seo_desc: 'Shop online at GoranShop with delivery across Iraq.'
};

async function seed(d) {
  if ((await d.one('SELECT COUNT(*) c FROM roles')).c) return;
  const email = process.env.ADMIN_EMAIL || 'admin@goranshop.com', pw = process.env.ADMIN_PASSWORD || 'Admin123!';
  if (PROD && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || pw.length < 8)) {
    const e = new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) in the environment variables, then redeploy.'); e.configHint = true; throw e;
  }
  const R = (n, p) => d.ins('INSERT INTO roles(name,permissions) VALUES(?,?)', n, JSON.stringify(p));
  const superId = await R('Super Admin', ['*']);
  await R('Store Manager', ['products', 'inventory', 'orders', 'customers']); await R('Content Manager', ['content', 'categories']); await R('Order Manager', ['orders', 'customers']);
  await d.ins('INSERT INTO users(name,email,password_hash,role_id) VALUES(?,?,?,?)', 'Store Owner', email.toLowerCase(), bcrypt.hashSync(pw, 12), superId);
  const demo = !PROD; // no demo customer/orders on a live site
  const cust = demo ? await d.ins('INSERT INTO users(name,email,phone,password_hash) VALUES(?,?,?,?)', 'Demo Customer', 'customer@example.com', '07501234567', bcrypt.hashSync('Customer123!', 12)) : null;

  const cat = {}; let i = 0;
  for (const [n, desc] of [['Clothing', 'Shirts, jackets and everyday wear'], ['Shoes', 'Sneakers and casual shoes'], ['Electronics', 'Gadgets and accessories'], ['Home & Kitchen', 'For the home']])
    cat[n] = await d.ins('INSERT INTO categories(name,slug,description,sort) VALUES(?,?,?,?)', n, n.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, ''), desc, i++);
  const brand = {}; for (const b of ['Nike', 'Adidas', 'Sony', 'Anker', 'Tefal']) brand[b] = await d.ins('INSERT INTO brands(name,slug) VALUES(?,?)', b, b.toLowerCase());
  const add = async (n, sd, price, sale, sku, c, b, stock, tags, f, nw, bs, variants) => {
    const id = await d.ins(`INSERT INTO products(name,slug,short_desc,description,price,sale_price,sku,category_id,brand_id,stock,tags,featured,is_new,best_seller) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      n, n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), sd, sd + ' Full description can be edited from the admin panel.', price, sale, sku, cat[c], brand[b], stock, tags, f, nw, bs);
    for (const [sz, col] of variants || []) await d.ins('INSERT INTO variants(product_id,name,options,sku,price,stock) VALUES(?,?,?,?,?,?)', id, `${sz} / ${col}`, JSON.stringify({ Size: sz, Color: col }), `${sku}-${sz[0]}${col[0]}`, null, 3 + Math.floor(Math.random() * 12));
  };
  await add('Nike Shirt', 'Breathable everyday training shirt.', 35000, null, 'NK-SH', 'Clothing', 'Nike', 0, 'shirt,sport', 1, 1, 1, [['Small', 'Black'], ['Medium', 'Black'], ['Large', 'Black'], ['Small', 'White'], ['Medium', 'White'], ['Large', 'White']]);
  await add('Adidas Hoodie', 'Soft fleece hoodie with front pocket.', 65000, 52000, 'AD-HD', 'Clothing', 'Adidas', 0, 'hoodie', 1, 0, 1, [['Medium', 'Grey'], ['Large', 'Grey'], ['Large', 'Navy']]);
  await add('Court Sneakers', 'Low-profile leather sneakers.', 95000, null, 'NK-SN', 'Shoes', 'Nike', 24, 'sneakers', 1, 1, 0);
  await add('Running Shoes', 'Lightweight cushioned trainers.', 120000, 99000, 'AD-RS', 'Shoes', 'Adidas', 3, 'running', 0, 0, 1);
  await add('Wireless Headphones', 'Noise-cancelling over-ear headphones.', 210000, 179000, 'SN-HP', 'Electronics', 'Sony', 15, 'audio', 1, 0, 1);
  await add('Power Bank 20000mAh', 'Fast-charging portable battery.', 45000, null, 'AK-PB', 'Electronics', 'Anker', 40, 'charger', 0, 1, 0);
  await add('Non-stick Pan 28cm', 'Durable ceramic-coated frying pan.', 38000, null, 'TF-PN', 'Home & Kitchen', 'Tefal', 0, 'kitchen', 0, 0, 0);
  await add('Electric Kettle 1.7L', 'Stainless steel, auto shut-off.', 42000, 36000, 'TF-KT', 'Home & Kitchen', 'Tefal', 18, 'kitchen', 1, 1, 0);
  await d.run("INSERT INTO coupons(code,type,value,min_order,max_uses) VALUES('WELCOME10','percent',10,30000,100),('SAVE5000','fixed',5000,50000,NULL)");
  await d.run("INSERT INTO banners(title,subtitle,button,link) VALUES('Summer sale','Up to 30% off selected items','Shop sale','#/products?sale=1')");
  if (demo) for (const [n, [num, st, ago]] of [['GS-000001', 'delivered', 3], ['GS-000002', 'shipped', 2], ['GS-000003', 'pending', 0]].map((x, k) => [k, x])) {
    const id = await d.ins('INSERT INTO orders(number,user_id,customer_name,phone,city,area,address,subtotal,shipping,total,payment_method,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      num, cust, 'Demo Customer', '07501234567', 'Sulaymaniyah', 'Bakrajo', 'Street 12, House 4', 179000 + n * 45000, 5000, 184000 + n * 45000, 'cod', st, new Date(Date.now() - ago * 864e5).toISOString());
    await d.ins('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)', id, 5, 'Wireless Headphones', 179000, 1);
    if (n) await d.ins('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)', id, 6, 'Power Bank 20000mAh', 45000, n);
  }
  for (const [s, t, b] of [['about', 'About us', '<p>Tell your customers about GoranShop.</p>'], ['shipping', 'Shipping policy', '<p>Delivery information.</p>'], ['returns', 'Return policy', '<p>Return information.</p>']])
    await d.run('INSERT INTO pages(slug,title,body) VALUES(?,?,?)', s, t, b);
}

let readyP = null; // runs once per serverless instance; safe if several instances start together (advisory lock)
const ready = () => readyP || (readyP = tx(async d => {
  await d.run('SELECT pg_advisory_xact_lock(727001)');
  await d.run(DDL);
  const ks = Object.keys(DEFAULT_SETTINGS);
  await d.run(`INSERT INTO settings(key,value) VALUES ${ks.map(() => '(?,?)').join(',')} ON CONFLICT (key) DO NOTHING`, ...ks.flatMap(k => [k, JSON.stringify(DEFAULT_SETTINGS[k])]));
  await seed(d);
}).catch(e => { readyP = null; throw e; }));

module.exports = { ...makeDb(pool), tx, ready, hasDb: !!pool, pool, PROD };
