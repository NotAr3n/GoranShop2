const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ME, CUR = 'IQD', CATS = [];
const fmt = n => Number(n || 0).toLocaleString('en-US') + ' ' + CUR;
const api = async (url, opt = {}) => {
  let r; try { r = await fetch('/api' + url, { credentials: 'same-origin', ...opt, headers: opt.form ? {} : { 'Content-Type': 'application/json' }, body: opt.form || (opt.body && JSON.stringify(opt.body)) }); }
  catch { throw new Error('Network problem. Check your connection and try again.'); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d;
};
const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'on' + (err ? ' err' : ''); clearTimeout(t.h); t.h = setTimeout(() => t.className = '', 2800); };
const can = p => ME.perms.includes('*') || ME.perms.includes(p);
const pill = s => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
const closeModal = () => $('#modal').classList.remove('on');
const modal = (title, html) => { $('#mbox').innerHTML = `<div class="mh"><h3>${esc(title)}</h3><button class="btn sec sm" id="mx" aria-label="Close">✕</button></div>${html}`; $('#modal').classList.add('on'); $('#mx').onclick = closeModal; };
$('#modal').onmousedown = e => { if (e.target.id === 'modal') closeModal(); }; document.addEventListener('keydown', e => e.key === 'Escape' && closeModal());
const ask = (msg, label = 'Delete') => new Promise(res => { modal('Please confirm', `<p>${esc(msg)}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="no">Cancel</button><button class="btn red" id="yes">${label}</button></div>`); $('#no').onclick = () => { closeModal(); res(false); }; $('#yes').onclick = () => { closeModal(); res(true); }; });
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const shrink = (file, max = 1600) => new Promise(res => { // resize big photos in the browser (faster upload, smaller pages)
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 300e3) return res(file);
  const i = new Image(); i.onload = () => { const s = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * s); c.height = Math.round(i.height * s);
    c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(i.src); c.toBlob(b => res(b && b.size < file.size ? new File([b], 'image.webp', { type: 'image/webp' }) : file), 'image/webp', 0.85); };
  i.onerror = () => res(file); i.src = URL.createObjectURL(file); });
const upload = async file => { const f = new FormData(); f.append('file', await shrink(file)); return (await api('/admin/upload', { method: 'POST', form: f })).url; };
// pick the two main brand colors out of a logo image (darker one -> primary, lighter -> accent)
const logoColors = url => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onerror = () => no(new Error('Could not read the logo image'));
  i.onload = () => { try { const n = 80, c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'); x.drawImage(i, 0, 0, n, n); const d = x.getImageData(0, 0, n, n).data, bk = {};
    for (let k = 0; k < d.length; k += 4) { const r = d[k], g = d[k + 1], b = d[k + 2]; if (d[k + 3] < 200 || Math.max(r, g, b) - Math.min(r, g, b) < 28) continue; const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4), o = bk[key] = bk[key] || { n: 0, r: 0, g: 0, b: 0 }; o.n++; o.r += r; o.g += g; o.b += b; }
    const list = Object.values(bk).sort((a, b) => b.n - a.n).map(o => [o.r / o.n, o.g / o.n, o.b / o.n].map(Math.round)); if (!list.length) return no(new Error('No distinct colors found in this logo. Pick the colors by hand instead.'));
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), lum = c => .299 * c[0] + .587 * c[1] + .114 * c[2], p = list[0], s = list.find(c => dist(c, p) > 90) || p;
    const [dark, light] = [p, s].sort((a, b) => lum(a) - lum(b)), hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); ok([hex(dark), hex(light)]); } catch (e) { no(new Error('Could not read colors from this logo')); } };
  i.src = url; });
const catOptions = (sel, skip) => '<option value="">— None —</option>' + CATS.filter(c => c.id !== skip).map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${c.parent_id ? '↳ ' : ''}${esc(c.name)}</option>`).join('');
const pager = (page, pages) => pages > 1 ? `<div class="tools" style="justify-content:center;margin-top:12px">${Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i + 1 === page ? '' : 'sec'}" data-pg="${i + 1}">${i + 1}</button>`).join('')}</div>` : '';

// ---------- views ----------
const NAV = [['dashboard', 'Dashboard', 'orders'], ['products', 'Products', 'products'], ['categories', 'Categories', 'categories'], ['inventory', 'Inventory', 'inventory'], ['orders', 'Orders', 'orders'], ['customers', 'Customers', 'customers'], ['settings', 'Settings', 'settings']];
const V = {};
V.dashboard = async m => {
  const s = await api('/admin/stats'), max = Math.max(...s.daily.map(d => d.sales), 1);
  m.innerHTML = `<h2>Dashboard</h2><div class="stats">${[['Total sales', fmt(s.sales.total)], ['Today', fmt(s.sales.today)], ['Last 7 days', fmt(s.sales.week)], ['Last 30 days', fmt(s.sales.month)], ['Orders', s.orders.total], ['Pending orders', s.orders.pending], ['Completed', s.orders.completed], ['Customers', s.customers], ['Products', s.products], ['Low stock', s.low], ['Out of stock', s.out]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
  <div class="card"><b>Sales, last 14 days</b>${s.daily.length ? `<div class="bars" style="margin:14px 0 26px">${s.daily.map(d => `<div style="height:${d.sales / max * 100}%" title="${esc(d.d)}: ${fmt(d.sales)} (${d.orders} orders)"><small>${esc(d.d.slice(5))}</small></div>`).join('')}</div>` : '<div class="empty">No sales yet.</div>'}</div>
  <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><b>Recent orders</b>${s.recent.map(o => `<div class="tools" style="margin:8px 0 0;justify-content:space-between"><span>${esc(o.number)} · ${esc(o.customer_name)}</span><span>${fmt(o.total)} ${pill(o.status)}</span></div>`).join('') || '<div class="empty">No orders yet.</div>'}</div>
  <div class="card"><b>Best sellers</b>${s.top.map(t => `<div class="tools" style="margin:8px 0 0;justify-content:space-between"><span>${esc(t.name)}</span><span>${t.sold} sold</span></div>`).join('') || '<div class="empty">Nothing sold yet.</div>'}</div>
  <div class="card"><b>Notifications</b>${s.notifications.map(n => `<div style="margin-top:8px">${esc(n.message)}<br><small class="muted">${esc(n.created_at)}</small></div>`).join('') || '<div class="empty">All quiet.</div>'}</div></div>`;
};

const PS = { q: '', category: '', status: '', stock: '', flag: '', brand: '', min: '', max: '', sort: 'newest', page: 1 }, SEL = new Set();
V.products = async m => {
  const p = new URLSearchParams(); for (const [k, v] of Object.entries(PS)) if (v) k === 'flag' ? p.set(v, 1) : p.set(k, v);
  const d = await api('/admin/products?' + p + '&limit=15');
  m.innerHTML = `<div class="tools"><h2 style="margin:0;flex:1">Products <small class="muted">(${d.total})</small></h2><a class="btn sec" href="/api/admin/products-export.csv">Export CSV</a><button class="btn" id="add">+ Add product</button></div>
  <div class="card"><div class="tools"><input type="search" id="fq" placeholder="Search name, SKU, brand, tag…" value="${esc(PS.q)}">
  <select id="fc">${catOptions(PS.category).replace('— None —', 'All categories')}</select>
  <select id="fs"><option value="">Any status</option><option ${PS.status === 'published' ? 'selected' : ''} value="published">Published</option><option ${PS.status === 'draft' ? 'selected' : ''} value="draft">Draft</option></select>
  <select id="fk"><option value="">Any stock</option><option value="low" ${PS.stock === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${PS.stock === 'out' ? 'selected' : ''}>Out of stock</option></select>
  <select id="ff">${[['', 'All products'], ['featured', 'Featured'], ['sale', 'On sale'], ['is_new', 'New arrivals'], ['best_seller', 'Best sellers']].map(([v, l]) => `<option value="${v}" ${PS.flag === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <input id="fb" placeholder="Brand" value="${esc(PS.brand)}" style="width:100px"><input id="fmin" type="number" placeholder="Min price" value="${esc(PS.min)}" style="width:100px"><input id="fmax" type="number" placeholder="Max price" value="${esc(PS.max)}" style="width:100px">
  <select id="fo">${[['newest', 'Newest'], ['name', 'Name'], ['price_asc', 'Price ↑'], ['price_desc', 'Price ↓'], ['stock', 'Stock ↑']].map(([v, l]) => `<option value="${v}" ${PS.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  ${SEL.size ? `<div class="tools"><b>${SEL.size} selected</b><button class="btn sm sec" data-b="publish">Publish</button><button class="btn sm sec" data-b="unpublish">Unpublish</button><button class="btn sm sec" data-b="price_percent">Change price %</button><button class="btn sm sec" data-b="set_stock">Set stock</button><button class="btn sm red" data-b="delete">Delete</button></div>` : ''}
  <div class="tw">${d.items.length ? `<table><tr><th><input type="checkbox" id="all"></th><th></th><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr>${d.items.map(p => `<tr><td><input type="checkbox" class="sel" value="${p.id}" ${SEL.has(p.id) ? 'checked' : ''}></td>
  <td>${p.images[0] ? `<img class="thumb" src="${esc(p.images[0])}" alt="">` : '<div class="thumb"></div>'}</td><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.category || 'Uncategorised')}${p.variants.length ? ` · ${p.variants.length} variants` : ''}</small></td><td>${esc(p.sku || '')}</td>
  <td>${fmt(p.price_now)}${p.discount_pct ? `<br><small class="muted"><s>${fmt(p.price)}</s> -${p.discount_pct}%</small>` : ''}</td><td>${p.available}</td><td>${pill(p.status)}</td>
  <td style="white-space:nowrap"><button class="btn sm sec" data-e="${p.id}">Edit</button> <button class="btn sm sec" data-dup="${p.id}">Duplicate</button> <button class="btn sm sec" data-tg="${p.id}" data-st="${p.status}">${p.status === 'published' ? 'Hide' : 'Publish'}</button> <button class="btn sm red" data-del="${p.id}" data-n="${esc(p.name)}">Delete</button></td></tr>`).join('')}</table>` : '<div class="empty">No products match. Try clearing the filters or add a new product.</div>'}</div>${pager(d.page, d.pages)}</div>`;
  const re = () => V.products(m), set = (k, v) => { PS[k] = v; PS.page = 1; SEL.clear(); re(); };
  $('#fq').onchange = e => set('q', e.target.value); $('#fc').onchange = e => set('category', e.target.value); $('#fs').onchange = e => set('status', e.target.value); $('#fk').onchange = e => set('stock', e.target.value);
  $('#ff').onchange = e => set('flag', e.target.value); $('#fb').onchange = e => set('brand', e.target.value); $('#fmin').onchange = e => set('min', e.target.value); $('#fmax').onchange = e => set('max', e.target.value); $('#fo').onchange = e => set('sort', e.target.value);
  m.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { PS.page = +b.dataset.pg; re(); });
  $('#all') && ($('#all').onchange = e => { m.querySelectorAll('.sel').forEach(c => { c.checked = e.target.checked; e.target.checked ? SEL.add(+c.value) : SEL.delete(+c.value); }); re(); });
  m.querySelectorAll('.sel').forEach(c => c.onchange = () => { c.checked ? SEL.add(+c.value) : SEL.delete(+c.value); re(); });
  $('#add').onclick = () => productForm(null, re);
  m.querySelectorAll('[data-e]').forEach(b => b.onclick = guard(async () => productForm(await api('/admin/products/' + b.dataset.e), re)));
  m.querySelectorAll('[data-dup]').forEach(b => b.onclick = guard(async () => { await api(`/admin/products/${b.dataset.dup}/duplicate`, { method: 'POST' }); toast('Duplicated as draft'); re(); }));
  m.querySelectorAll('[data-tg]').forEach(b => b.onclick = guard(async () => { await api('/admin/products/bulk', { method: 'POST', body: { ids: [+b.dataset.tg], action: b.dataset.st === 'published' ? 'unpublish' : 'publish' } }); toast('Updated'); re(); }));
  m.querySelectorAll('[data-del]').forEach(b => b.onclick = guard(async () => { if (await ask(`Delete “${b.dataset.n}”? This removes it from the store and cannot be undone.`)) { await api('/admin/products/' + b.dataset.del, { method: 'DELETE' }); toast('Product deleted'); re(); } }));
  m.querySelectorAll('[data-b]').forEach(b => b.onclick = guard(async () => {
    const a = b.dataset.b, ids = [...SEL]; let value;
    if (a === 'delete' && !(await ask(`Delete ${ids.length} products? This cannot be undone.`))) return;
    if (a === 'price_percent') { value = prompt('Change prices by what percent? (e.g. 10 raises by 10%, -10 lowers by 10%)'); if (value === null) return; }
    if (a === 'set_stock') { value = prompt('Set stock to how many units? (products without variants only)'); if (value === null) return; }
    await api('/admin/products/bulk', { method: 'POST', body: { ids, action: a, value } }); SEL.clear(); toast('Bulk update applied'); re();
  }));
};

function productForm(p, done) {
  p = p || { name: '', price: '', stock: 0, low_stock: 5, status: 'published', images: [], variants: [] };
  let images = [...p.images], variants = p.variants.map(v => ({ ...v }));
  const F = (k, l, t = 'text', x = '') => `<div><label>${l}</label><input name="${k}" type="${t}" value="${esc(p[k] ?? '')}" ${x}></div>`;
  modal(p.id ? 'Edit product' : 'Add product', `<form id="pf" class="form"><div class="w"><label>Product name *</label><input name="name" required value="${esc(p.name)}"></div>
  ${F('brand', 'Brand')}<div><label>Category</label><select name="category_id">${catOptions(p.category_id)}</select></div>${F('slug', 'URL slug (auto if empty)')}
  <div class="w"><label>Short description</label><input name="short_desc" value="${esc(p.short_desc || '')}"></div><div class="w"><label>Description</label><textarea name="description" rows="4">${esc(p.description || '')}</textarea></div>
  ${F('price', 'Price *', 'number', 'min=0 step=any required')}${F('sale_price', 'Sale price', 'number', 'min=0 step=any')}${F('sku', 'SKU')}${F('barcode', 'Barcode')}
  ${F('stock', 'Stock (if no variants)', 'number')}${F('low_stock', 'Low-stock threshold', 'number')}${F('weight', 'Weight (kg)', 'number', 'step=any')}${F('dimensions', 'Dimensions')}${F('tags', 'Tags (comma separated)')}${F('video', 'Video URL')}
  <div><label>Status</label><select name="status"><option value="published" ${p.status === 'published' ? 'selected' : ''}>Published</option><option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft (hidden)</option></select></div>
  <div class="w" style="display:flex;gap:18px;flex-wrap:wrap">${[['featured', 'Featured'], ['is_new', 'New arrival'], ['best_seller', 'Best seller'], ['allow_backorder', 'Allow backorders']].map(([k, l]) => `<label class="chk"><input type="checkbox" name="${k}" ${p[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
  <div class="w"><label>Images (first is the main image)</label><div class="imgs" id="imgs"></div><input type="file" id="fu" accept="image/jpeg,image/png,image/webp" multiple></div>
  <div class="w"><label>Variants (each with its own price, stock, SKU; leave price empty to use the product price)</label><div class="tw"><table id="vt" style="min-width:520px"></table></div><button type="button" class="btn sec sm" id="av">+ Add variant</button></div>
  <div class="w">${F('seo_title', 'SEO title')}${F('seo_desc', 'SEO description')}</div><div class="w msg" id="perr"></div>
  <div class="w" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn sec" id="cx">Cancel</button><button class="btn">Save product</button></div></form>`);
  const drawI = () => { $('#imgs').innerHTML = images.map((u, i) => `<div><img src="${esc(u)}" alt=""><button type="button" data-ri="${i}" aria-label="Remove image">×</button></div>`).join(''); document.querySelectorAll('[data-ri]').forEach(b => b.onclick = () => { images.splice(b.dataset.ri, 1); drawI(); }); };
  const drawV = () => { $('#vt').innerHTML = variants.length ? '<tr><th>Name</th><th>SKU</th><th>Price</th><th>Stock</th><th></th></tr>' + variants.map((v, i) => `<tr>${['name', 'sku', 'price', 'stock'].map(k => `<td><input data-vi="${i}" data-k="${k}" value="${esc(v[k] ?? '')}" ${k === 'price' || k === 'stock' ? 'type=number step=any' : ''} placeholder="${k === 'name' ? 'e.g. Large / Black' : ''}" style="width:100%"></td>`).join('')}<td><button type="button" class="btn red sm" data-rv="${i}">×</button></td></tr>`).join('') : ''; document.querySelectorAll('[data-vi]').forEach(i => i.oninput = () => variants[i.dataset.vi][i.dataset.k] = i.value); document.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => { variants.splice(b.dataset.rv, 1); drawV(); }); };
  drawI(); drawV();
  $('#av').onclick = () => { variants.push({ name: '', sku: '', price: '', stock: 0 }); drawV(); };
  $('#cx').onclick = closeModal;
  $('#fu').onchange = guard(async e => { for (const f of e.target.files) images.push(await upload(f)); drawI(); });
  $('#pf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), b = Object.fromEntries(f); for (const k of ['featured', 'is_new', 'best_seller', 'allow_backorder']) b[k] = f.has(k);
    b.images = images; b.variants = variants;
    try { await api(p.id ? '/admin/products/' + p.id : '/admin/products', { method: p.id ? 'PUT' : 'POST', body: b }); closeModal(); toast(p.id ? 'Product saved' : 'Product created – it is now live in the store'); done(); }
    catch (er) { $('#perr').textContent = er.message; }
  };
}

V.categories = async m => {
  CATS = await api('/admin/categories');
  m.innerHTML = `<div class="tools"><h2 style="margin:0;flex:1">Categories</h2><button class="btn" id="add">+ Add category</button></div><div class="card tw">${CATS.length ? `<table><tr><th>Name</th><th>Parent</th><th>Products</th><th>Order</th><th>Status</th><th></th></tr>${CATS.map(c => `<tr><td><b>${c.parent_id ? '↳ ' : ''}${esc(c.name)}</b><br><small class="muted">/${esc(c.slug)}</small></td><td>${esc(CATS.find(x => x.id === c.parent_id)?.name || '')}</td><td>${c.products}</td><td>${c.sort}</td><td>${pill(c.active ? 'published' : 'draft').replace('published', 'enabled').replace('draft', 'disabled')}</td>
  <td style="white-space:nowrap"><button class="btn sm sec" data-e="${c.id}">Edit</button> <button class="btn sm red" data-d="${c.id}">Delete</button></td></tr>`).join('')}</table>` : '<div class="empty">No categories yet.</div>'}</div>`;
  const form = c => { c = c || { name: '', active: 1, sort: CATS.length }; modal(c.id ? 'Edit category' : 'Add category', `<form id="cf" class="form"><div class="w"><label>Name *</label><input name="name" required value="${esc(c.name)}"></div><div><label>Parent category</label><select name="parent_id">${catOptions(c.parent_id, c.id)}</select></div><div><label>Sort order</label><input name="sort" type="number" value="${c.sort}"></div>
    <div class="w"><label>Description</label><input name="description" value="${esc(c.description || '')}"></div><div class="w"><label>Image</label><input name="image" id="ci" value="${esc(c.image || '')}" placeholder="Image URL"><input type="file" id="cu" accept="image/*"></div>
    <label class="chk"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Enabled (shown in store)</label><div class="w msg" id="cerr"></div><div class="w" style="text-align:right"><button class="btn">Save category</button></div></form>`);
    $('#cu').onchange = guard(async e => $('#ci').value = await upload(e.target.files[0]));
    $('#cf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), b = Object.fromEntries(f); b.active = f.has('active'); try { await api(c.id ? '/admin/categories/' + c.id : '/admin/categories', { method: c.id ? 'PUT' : 'POST', body: b }); closeModal(); toast('Category saved'); V.categories(m); } catch (er) { $('#cerr').textContent = er.message; } }; };
  $('#add').onclick = () => form();
  m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(CATS.find(c => c.id == b.dataset.e)));
  m.querySelectorAll('[data-d]').forEach(b => b.onclick = guard(async () => { const c = CATS.find(x => x.id == b.dataset.d); if (await ask(`Delete “${c.name}”? Its ${c.products} products will become uncategorised.`)) { await api('/admin/categories/' + c.id, { method: 'DELETE' }); toast('Category deleted'); V.categories(m); } }));
};

V.inventory = async m => {
  const st = V.inventory.s = V.inventory.s || { q: '', filter: '' }, d = await api(`/admin/inventory?q=${encodeURIComponent(st.q)}&filter=${st.filter}`), s = d.summary;
  m.innerHTML = `<h2>Inventory</h2><div class="stats">${[['Products', s.total_products], ['Units in stock', s.total_units], ['Low stock', s.low], ['Out of stock', s.out], ['Inventory value', fmt(s.value)]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
  <div class="card"><div class="tools"><input type="search" id="iq" placeholder="Search…" value="${esc(st.q)}"><select id="if"><option value="">All</option><option value="low" ${st.filter === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${st.filter === 'out' ? 'selected' : ''}>Out of stock</option></select></div>
  <div class="tw"><table><tr><th>Item</th><th>SKU</th><th>Stock</th><th>Adjust</th></tr>${d.items.map(r => `<tr><td>${esc(r.name)}${r.variant ? ` <small class="muted">${esc(r.variant)}</small>` : ''}</td><td>${esc(r.sku || '')}</td><td><b style="color:${r.stock <= 0 ? 'var(--danger)' : r.stock <= r.low_stock ? '#b26a00' : 'inherit'}">${r.stock}</b></td>
  <td style="white-space:nowrap"><input type="number" style="width:80px" data-in="${r.product_id}:${r.variant_id || ''}" placeholder="+/−"> <button class="btn sm sec" data-a="delta" data-k="${r.product_id}:${r.variant_id || ''}">Add/remove</button> <button class="btn sm sec" data-a="set" data-k="${r.product_id}:${r.variant_id || ''}">Set to</button></td></tr>`).join('') || '<tr><td colspan=4 class="empty">Nothing found.</td></tr>'}</table></div></div>
  <div class="card"><b>Recent changes</b><div class="tw"><table><tr><th>When</th><th>Item</th><th>Change</th><th>After</th><th>Reason</th></tr>${d.history.map(h => `<tr><td>${esc(h.created_at)}</td><td>${esc(h.product_name)}</td><td>${h.change > 0 ? '+' : ''}${h.change}</td><td>${h.stock_after}</td><td>${esc(h.reason)}</td></tr>`).join('')}</table></div></div>`;
  $('#iq').onchange = e => { st.q = e.target.value; V.inventory(m); }; $('#if').onchange = e => { st.filter = e.target.value; V.inventory(m); };
  m.querySelectorAll('[data-a]').forEach(b => b.onclick = guard(async () => {
    const [pid, vid] = b.dataset.k.split(':'), v = m.querySelector(`[data-in="${b.dataset.k}"]`).value; if (v === '') return toast('Enter a number first', true);
    await api('/admin/inventory/adjust', { method: 'POST', body: { product_id: +pid, variant_id: vid ? +vid : null, [b.dataset.a]: v } }); toast('Stock updated'); V.inventory(m);
  }));
};

const OS = { q: '', status: '', payment_status: '', page: 1 }, STATUSES = ['pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled', 'returned'];
V.orders = async m => {
  const d = await api('/admin/orders?' + new URLSearchParams(Object.fromEntries(Object.entries(OS).filter(([, v]) => v))));
  m.innerHTML = `<h2>Orders <small class="muted">(${d.total})</small></h2><div class="card"><div class="tools"><input type="search" id="oq" placeholder="Order no., name or phone" value="${esc(OS.q)}"><select id="os"><option value="">Any status</option>${STATUSES.map(s => `<option ${OS.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><select id="op"><option value="">Any payment</option>${['unpaid', 'paid', 'refunded'].map(s => `<option ${OS.payment_status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <div class="tw">${d.items.length ? `<table><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th></tr>${d.items.map(o => `<tr class="click" data-o="${o.id}"><td><b>${esc(o.number)}</b></td><td>${esc(o.customer_name)}<br><small class="muted">${esc(o.phone)}</small></td><td>${esc(o.created_at)}</td><td>${fmt(o.total)}</td><td>${esc(o.payment_method)} ${pill(o.payment_status)}</td><td>${pill(o.status)}</td></tr>`).join('')}</table>` : '<div class="empty">No orders found.</div>'}</div>${pager(d.page, Math.ceil(d.total / 20))}</div>`;
  const re = () => V.orders(m); $('#oq').onchange = e => { OS.q = e.target.value; OS.page = 1; re(); }; $('#os').onchange = e => { OS.status = e.target.value; OS.page = 1; re(); }; $('#op').onchange = e => { OS.payment_status = e.target.value; OS.page = 1; re(); };
  m.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { OS.page = +b.dataset.pg; re(); });
  m.querySelectorAll('[data-o]').forEach(r => r.onclick = guard(async () => {
    const o = await api('/admin/orders/' + r.dataset.o);
    modal('Order ' + o.number, `<div class="form"><div><b>Customer</b><br>${esc(o.customer_name)}<br>${esc(o.phone)} ${esc(o.email || '')}</div><div><b>Delivery</b><br>${esc(o.city)} ${esc(o.area || '')}<br>${esc(o.address)}</div><div><b>Placed</b><br>${esc(o.created_at)}<br>${esc(o.payment_method)}</div></div>
    ${o.notes ? `<p><b>Notes:</b> ${esc(o.notes)}</p>` : ''}<div class="tw"><table><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th></tr>${o.items.map(i => `<tr><td>${esc(i.name)} ${esc(i.variant_name || '')}<br><small class="muted">${esc(i.sku || '')}</small></td><td>${fmt(i.price)}</td><td>${i.qty}</td><td>${fmt(i.price * i.qty)}</td></tr>`).join('')}</table></div>
    <p style="text-align:right">Subtotal ${fmt(o.subtotal)}<br>Shipping ${fmt(o.shipping)}<br><b>Total ${fmt(o.total)}</b></p><div class="form"><div><label>Order status</label><select id="ost">${STATUSES.map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div><label>Payment status</label><select id="ops">${['unpaid', 'paid', 'refunded'].map(s => `<option ${o.payment_status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
    <p class="muted">Cancelling or returning an order puts its items back in stock.</p><div style="text-align:right"><button class="btn" id="osv">Save changes</button></div>`);
    $('#osv').onclick = guard(async () => { await api('/admin/orders/' + o.id, { method: 'PUT', body: { status: $('#ost').value, payment_status: $('#ops').value } }); closeModal(); toast('Order updated'); re(); });
  }));
};

V.customers = async m => {
  const st = V.customers.q || '', list = await api('/admin/customers?q=' + encodeURIComponent(st));
  m.innerHTML = `<h2>Customers <small class="muted">(${list.length})</small></h2><div class="card"><div class="tools"><input type="search" id="cq" placeholder="Search name, email, phone" value="${esc(st)}"></div><div class="tw">${list.length ? `<table><tr><th>Name</th><th>Contact</th><th>Orders</th><th>Spent</th><th>Joined</th><th>Account</th></tr>${list.map(c => `<tr class="click" data-c="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.email)}<br><small class="muted">${esc(c.phone || '')}</small></td><td>${c.orders}</td><td>${fmt(c.spent)}</td><td>${esc(c.created_at.slice(0, 10))}</td><td>${pill(c.active ? 'published' : 'draft').replace('published', 'active').replace('draft', 'disabled')}</td></tr>`).join('')}</table>` : '<div class="empty">No customers found.</div>'}</div></div>`;
  $('#cq').onchange = e => { V.customers.q = e.target.value; V.customers(m); };
  m.querySelectorAll('[data-c]').forEach(r => r.onclick = guard(async () => {
    const c = await api('/admin/customers/' + r.dataset.c);
    modal(c.name, `<form id="cf" class="form"><div><label>Name</label><input name="name" value="${esc(c.name)}"></div><div><label>Phone</label><input name="phone" value="${esc(c.phone || '')}"></div><label class="chk"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Account enabled</label><div class="w"><button class="btn">Save</button></div></form>
    <h4>Orders (${c.orders.length})</h4>${c.orders.map(o => `<div class="tools" style="justify-content:space-between"><span>${esc(o.number)} · ${esc(o.created_at)}</span><span>${fmt(o.total)} ${pill(o.status)}</span></div>`).join('') || '<p class="muted">No orders yet.</p>'}`);
    $('#cf').onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target); await api('/admin/customers/' + c.id, { method: 'PUT', body: { name: f.get('name'), phone: f.get('phone'), active: f.has('active') } }); closeModal(); toast('Customer saved'); V.customers(m); });
  }));
};

const SET = [['General', [['store_name', 'Store name'], ['tagline', 'Tagline'], ['contact_email', 'Contact email'], ['contact_phone', 'Phone'], ['logo', 'Logo (shown in the store header)', 'img'], ['favicon', 'Favicon (small browser-tab icon)', 'img'], ['address', 'Address'], ['business_hours', 'Business hours']]],
  ['Appearance & homepage', [['primary_color', 'Primary color', 'color'], ['accent_color', 'Accent color', 'color'], ['hero_title', 'Hero title'], ['hero_subtitle', 'Hero text'], ['hero_button', 'Hero button label'], ['hero_link', 'Hero button link'], ['hero_image', 'Hero image', 'img']]],
  ['Store', [['currency', 'Currency label'], ['shipping_fee', 'Shipping fee', 'number'], ['free_shipping_over', 'Free shipping over', 'number'], ['min_order', 'Minimum order', 'number'], ['tax_percent', 'Tax %', 'number']]],
  ['Social media', [['social_instagram', 'Instagram URL'], ['social_facebook', 'Facebook URL'], ['social_tiktok', 'TikTok URL'], ['social_youtube', 'YouTube URL']]], ['SEO', [['seo_title', 'Website title'], ['seo_desc', 'Meta description']]]];
V.settings = async m => {
  const s = await api('/admin/settings'), pms = s.payment_methods.map(x => ({ ...x })), secs = s.home_sections.map(x => ({ ...x }));
  m.innerHTML = `<h2>Settings</h2><form id="sf">${SET.map(([t, f]) => `<div class="card"><h3 style="margin-top:0">${t}</h3><div class="form">${f.map(([k, l, ty]) => `<div><label>${l}</label><input name="${k}" type="${ty === 'img' ? 'text' : ty || 'text'}" value="${esc(s[k] ?? '')}" ${ty === 'number' ? 'step=any' : ''}>${ty === 'img' ? `<input type="file" data-up="${k}" accept="image/*">` : ''}</div>`).join('')}</div>${t.startsWith('Appearance') ? '<p><button type="button" class="btn sec" id="lc">Use colors from my logo</button> <small class="muted">Upload your logo in General first, then click this and Save settings.</small></p><h4>Homepage sections</h4><div id="hs"></div>' : ''}${t === 'Store' ? '<h4>Payment methods</h4><div id="pm"></div>' : ''}</div>`).join('')}<div class="tools"><button class="btn">Save settings</button></div></form>`;
  const dHS = () => { $('#hs').innerHTML = secs.map((x, i) => `<div class="tools"><label class="chk"><input type="checkbox" data-se="${i}" ${x.enabled ? 'checked' : ''}> Show</label><input data-st="${i}" value="${esc(x.title)}"><small class="muted">(${esc(x.type)})</small><button type="button" class="btn sm sec" data-mv="${i}:-1">↑</button><button type="button" class="btn sm sec" data-mv="${i}:1">↓</button></div>`).join('');
    document.querySelectorAll('[data-se]').forEach(c => c.onchange = () => secs[c.dataset.se].enabled = c.checked); document.querySelectorAll('[data-st]').forEach(c => c.oninput = () => secs[c.dataset.st].title = c.value);
    document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split(':').map(Number), j = i + d; if (j < 0 || j >= secs.length) return; [secs[i], secs[j]] = [secs[j], secs[i]]; dHS(); }); };
  dHS(); $('#pm').innerHTML = pms.map((x, i) => `<label class="chk"><input type="checkbox" data-pe="${i}" ${x.enabled ? 'checked' : ''}> ${esc(x.name)}</label>`).join(''); document.querySelectorAll('[data-pe]').forEach(c => c.onchange = () => pms[c.dataset.pe].enabled = c.checked);
  document.querySelectorAll('[data-up]').forEach(i => i.onchange = guard(async e => { m.querySelector(`[name=${i.dataset.up}]`).value = await upload(e.target.files[0]); toast('Image uploaded – save settings to apply'); }));
  $('#lc').onclick = guard(async () => { const u = m.querySelector('[name=logo]').value; if (!u) throw new Error('Upload your logo first (General section)'); const [p, a] = await logoColors(u); m.querySelector('[name=primary_color]').value = p; m.querySelector('[name=accent_color]').value = a; toast('Colors taken from your logo – click Save settings'); });
  $('#sf').onsubmit = guard(async e => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); for (const [, f] of SET) for (const [k, , t] of f) if (t === 'number') b[k] = Number(b[k] || 0);
    b.payment_methods = pms; b.home_sections = secs; await api('/admin/settings', { method: 'PUT', body: b }); CUR = b.currency; toast('Settings saved – the store is updated'); });
};

// ---------- boot ----------
function nav(name) {
  const av = NAV.filter(n => can(n[2])); name = av.find(n => n[0] === name) ? name : av[0]?.[0];
  $('#nav').innerHTML = av.map(n => `<a href="#${n[0]}" class="${n[0] === name ? 'on' : ''}">${n[1]}</a>`).join(''); $('#side').classList.remove('open');
  const m = $('#main'); m.innerHTML = '<div class="empty">Loading…</div>';
  Promise.resolve(V[name](m)).catch(e => m.innerHTML = `<div class="card empty"><h3>This page could not load</h3><p>${esc(e.message)}</p><button class="btn" onclick="route()">Try again</button></div>`);
}
const route = () => nav(location.hash.slice(1) || 'dashboard');
async function start() {
  const { user } = await api('/me').catch(() => ({}));
  if (!user || !user.role) { $('#shell').hidden = true; $('#login').hidden = false; if (user) $('#lerr').textContent = 'This account does not have admin access.'; return; }
  ME = user; $('#login').hidden = true; $('#shell').hidden = false;
  const s = await api('/settings'); CUR = s.currency; $('#brand').textContent = s.store_name + ' admin'; document.title = s.store_name + ' admin'; CATS = await api(can('categories') ? '/admin/categories' : '/categories').catch(() => []);
  window.addEventListener('hashchange', route); route();
}
$('#lf').onsubmit = async e => { e.preventDefault(); try { await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.reload(); } catch (er) { $('#lerr').textContent = er.message; } };
$('#out').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
$('#burger').onclick = () => $('#side').classList.toggle('open');
start();
