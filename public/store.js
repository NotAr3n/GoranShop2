const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = {}, CATS = [], USER = null, CART = JSON.parse(localStorage.getItem('gs_cart') || '[]');
const fmt = n => Number(n).toLocaleString('en-US') + ' ' + (S.currency || '');
const api = async (url, opt = {}) => {
  let r; try { r = await fetch('/api' + url, { credentials: 'same-origin', ...opt, headers: { 'Content-Type': 'application/json' }, body: opt.body && JSON.stringify(opt.body) }); }
  catch { throw new Error('Network problem. Check your connection and try again.'); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d;
};
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t.h); t.h = setTimeout(() => t.classList.remove('on'), 2500); };
const saveCart = () => { localStorage.setItem('gs_cart', JSON.stringify(CART)); $('#cc').textContent = CART.reduce((s, i) => s + i.qty, 0); };
const seo = (title, desc) => { document.title = title ? `${title} – ${S.store_name}` : S.seo_title || S.store_name; document.querySelector('meta[name=description]').content = desc || S.seo_desc || ''; };
const img = (p, big) => `<div class="ph">${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : esc((p.name || '?')[0])}</div>`;

function card(p) {
  return `<a class="card" href="#/product/${esc(p.slug)}">${p.discount_pct ? `<span class="tag">-${p.discount_pct}%</span>` : ''}${!p.in_stock ? '<span class="tag out">Sold out</span>' : ''}${img(p)}
  <div class="b"><span class="br">${esc(p.brand || p.category || '')}</span><span class="n">${esc(p.name)}</span>
  <span class="price">${p.variants.length && p.variants.some(v => v.price_now !== p.price_now) ? 'From ' : ''}${fmt(p.price_now)}${p.discount_pct ? `<s>${fmt(p.price)}</s>` : ''}</span></div></a>`;
}
const grid = items => items.length ? `<div class="grid">${items.map(card).join('')}</div>` : '<div class="empty"><h3>No products found</h3><p>Try a different search or category.</p></div>';

// ---------- views ----------
const views = {
  async home() {
    seo('', S.tagline);
    const sections = (S.home_sections || []).filter(s => s.enabled), flag = { featured: 'featured=1', new: 'is_new=1', best: 'best_seller=1', sale: 'sale=1' };
    const data = await Promise.all(sections.map(s => api(`/products?${flag[s.type] || 'featured=1'}&limit=8`)));
    const banners = await api('/banners');
    app.innerHTML = `<section class="hero ${S.hero_image ? 'img' : ''}" style="${S.hero_image ? `background-image:url('${esc(S.hero_image)}')` : ''}"><h1>${esc(S.hero_title)}</h1><p>${esc(S.hero_subtitle)}</p><a class="btn" href="${esc(S.hero_link || '#/products')}">${esc(S.hero_button || 'Shop now')}</a></section>
    ${banners.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${banners.map(b => `<a class="panel" href="${esc(b.link || '#/products')}"><h3 style="margin:0">${esc(b.title)}</h3><p style="margin:4px 0 0;color:var(--muted)">${esc(b.subtitle)}</p></a>`).join('')}</div>` : ''}
    <h2>Shop by category</h2><div class="chips">${CATS.filter(c => !c.parent_id).map(c => `<a class="chip" href="#/products?category=${esc(c.slug)}">${esc(c.name)}</a>`).join('')}</div>
    ${sections.map((s, i) => data[i].items.length ? `<h2>${esc(s.title)}<a href="#/products?${flag[s.type]}">View all</a></h2>${grid(data[i].items)}` : '').join('')}`;
  },
  async products(qs) {
    const p = new URLSearchParams(qs), d = await api('/products?' + p), cat = CATS.find(c => c.slug === qs.category);
    seo(cat?.name || (qs.q ? `Search: ${qs.q}` : 'All products'), cat?.description);
    const link = o => '#/products?' + new URLSearchParams({ ...qs, page: 1, ...o });
    app.innerHTML = `<div class="layout"><aside class="side"><h4>Categories</h4><a href="${link({ category: '' })}" class="${!qs.category ? 'on' : ''}">All products</a>
      ${CATS.filter(c => !c.parent_id).map(c => `<a class="${qs.category === c.slug ? 'on' : ''}" href="${link({ category: c.slug })}">${esc(c.name)}</a>${CATS.filter(x => x.parent_id === c.id).map(x => `<a style="padding-left:14px" class="${qs.category === x.slug ? 'on' : ''}" href="${link({ category: x.slug })}">${esc(x.name)}</a>`).join('')}`).join('')}</aside>
      <div><div class="bar"><h1 style="margin:0;font-size:24px">${esc(cat?.name || (qs.q ? `Results for “${qs.q}”` : 'All products'))} <small style="color:var(--muted);font-weight:400">(${d.total})</small></h1>
      <select id="sort" aria-label="Sort">${[['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name']].map(([v, l]) => `<option value="${v}" ${qs.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${grid(d.items)}${d.pages > 1 ? `<div class="pager">${Array.from({ length: d.pages }, (_, i) => `<a class="btn ${d.page === i + 1 ? 'dark' : 'line'}" href="${link({ page: i + 1 })}">${i + 1}</a>`).join('')}</div>` : ''}</div></div>`;
    $('#sort').onchange = e => location.hash = link({ sort: e.target.value });
  },
  async product(qs, slug) {
    const p = await api('/products/' + encodeURIComponent(slug)); seo(p.seo_title || p.name, p.seo_desc || p.short_desc);
    let vsel = p.variants.length ? null : undefined, qty = 1, shown = 0;
    const cur = () => p.variants.find(v => v.id === vsel), priceNow = () => cur()?.price_now ?? p.price_now, have = () => cur() ? cur().stock : p.variants.length ? 0 : p.stock;
    const draw = () => {
      const canBuy = p.allow_backorder || have() > 0, cap = p.allow_backorder ? 99 : have();
      $('#buy').innerHTML = `<div class="price" style="font-size:26px">${fmt(priceNow())}${p.discount_pct && !cur() ? `<s>${fmt(p.price)}</s>` : ''}</div>
      ${p.variants.length ? `<label>Choose option</label><div class="opts">${p.variants.map(v => `<button class="opt ${v.id === vsel ? 'on' : ''}" data-v="${v.id}" ${v.stock <= 0 && !p.allow_backorder ? 'disabled' : ''}>${esc(v.name)}</button>`).join('')}</div>` : ''}
      <p style="color:${p.in_stock ? 'var(--ok)' : 'var(--danger)'};font-weight:700">${!p.in_stock ? 'Out of stock' : (cur() || !p.variants.length) && have() > 0 && have() <= p.low_stock ? `Only ${have()} left` : 'In stock'}</p>
      <div style="display:flex;gap:12px;align-items:center"><div class="qty"><button id="m" aria-label="Decrease">−</button><span>${qty}</span><button id="pl" aria-label="Increase">+</button></div>
      <button class="btn" id="add" ${!p.in_stock ? 'disabled' : ''}>Add to cart</button></div><div class="msg" id="err"></div>`;
      document.querySelectorAll('.opt').forEach(b => b.onclick = () => { vsel = +b.dataset.v; qty = 1; draw(); });
      $('#m').onclick = () => { qty = Math.max(1, qty - 1); draw(); }; $('#pl').onclick = () => { qty = Math.min(cap || 1, qty + 1); draw(); };
      $('#add').onclick = () => {
        if (p.variants.length && !vsel) return $('#err').textContent = 'Please choose an option first.';
        if (!canBuy) return; addToCart(p, cur(), qty); toast('Added to cart');
      };
    };
    app.innerHTML = `<p style="color:var(--muted)"><a href="#/">Home</a> / ${p.category ? `<a href="#/products?category=${esc(p.category_slug)}">${esc(p.category)}</a> / ` : ''}${esc(p.name)}</p>
    <div class="pdp"><div><div id="main">${img(p)}</div>${p.images.length > 1 ? `<div class="thumbs">${p.images.map((s, i) => `<img src="${esc(s)}" alt="" class="${i ? '' : 'on'}" data-i="${i}">`).join('')}</div>` : ''}</div>
    <div><span style="color:var(--muted)">${esc(p.brand || '')}</span><h1 style="margin:2px 0 8px;font-size:32px;letter-spacing:-.02em">${esc(p.name)}</h1><p>${esc(p.short_desc || '')}</p><div id="buy"></div>
    ${p.sku ? `<p style="color:var(--muted);font-size:14px">SKU: ${esc(p.sku)}</p>` : ''}</div></div>
    <h2>Description</h2><div class="panel" style="white-space:pre-line">${esc(p.description || 'No description yet.')}</div>`;
    document.querySelectorAll('.thumbs img').forEach(t => t.onclick = () => { $('#main img').src = t.src; document.querySelectorAll('.thumbs img').forEach(x => x.classList.toggle('on', x === t)); });
    draw();
  },
  cart() {
    seo('Cart');
    if (!CART.length) return app.innerHTML = '<div class="empty"><h2 style="display:block">Your cart is empty</h2><p>Add something you like and it will show up here.</p><a class="btn" href="#/products">Browse products</a></div>';
    const t = totals();
    app.innerHTML = `<h1>Shopping cart</h1><div class="two"><div class="panel">${CART.map((i, n) => `<div class="row"><div class="ph">${i.image ? `<img src="${esc(i.image)}" alt="">` : esc(i.name[0])}</div>
      <div class="g"><a href="#/product/${esc(i.slug)}"><b>${esc(i.name)}</b></a><div style="color:var(--muted);font-size:14px">${esc(i.vname || '')}</div><div class="price">${fmt(i.price)}</div></div>
      <div class="qty"><button data-d="-1" data-n="${n}" aria-label="Decrease">−</button><span>${i.qty}</span><button data-d="1" data-n="${n}" aria-label="Increase">+</button></div><button class="btn line" data-rm="${n}">Remove</button></div>`).join('')}</div>
      ${summary(t, '<a class="btn full" href="#/checkout">Checkout</a>')}</div>`;
    app.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const i = CART[b.dataset.n]; i.qty = Math.max(1, i.qty + +b.dataset.d); saveCart(); views.cart(); });
    app.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { CART.splice(b.dataset.rm, 1); saveCart(); views.cart(); });
  },
  checkout() {
    seo('Checkout'); if (!CART.length) return location.hash = '#/cart';
    const t = totals(), pms = (S.payment_methods || []).filter(m => m.enabled), u = USER || {};
    app.innerHTML = `<h1>Checkout</h1><form id="co" class="two"><div class="panel"><div class="f">
      <div><label>Full name</label><input name="name" required value="${esc(u.name)}"></div><div><label>Phone</label><input name="phone" required value="${esc(u.phone)}"></div>
      <div class="w"><label>Email (optional)</label><input name="email" type="email" value="${esc(u.email)}"></div>
      <div><label>City</label><input name="city" required></div><div><label>District / area</label><input name="area"></div>
      <div class="w"><label>Delivery address</label><textarea name="address" rows="2" required></textarea></div><div class="w"><label>Notes (optional)</label><input name="notes"></div></div>
      <h3>Payment method</h3>${pms.map((m, i) => `<label class="pay"><input type="radio" name="payment_method" value="${esc(m.id)}" ${i ? '' : 'checked'}> ${esc(m.name)}</label>`).join('') || '<p class="msg">No payment methods are available right now.</p>'}</div>
      ${summary(t, '<button class="btn full" id="place">Place order</button><div class="msg" id="err"></div>')}</form>`;
    $('#co').onsubmit = async e => {
      e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); $('#place').disabled = true; $('#err').textContent = '';
      try { const r = await api('/orders', { method: 'POST', body: { ...b, items: CART.map(i => ({ product_id: i.pid, variant_id: i.vid, qty: i.qty })) } }); CART = []; saveCart(); location.hash = '#/done/' + r.number; }
      catch (er) { $('#err').textContent = er.message; $('#place').disabled = false; }
    };
  },
  done(qs, n) { seo('Order confirmed'); app.innerHTML = `<div class="empty"><h2 style="display:block">Thank you! Your order is placed.</h2><p>Order number <b>${esc(n)}</b>. We will contact you to confirm delivery.</p><a class="btn" href="#/products">Continue shopping</a></div>`; },
  async account() {
    seo('My account');
    if (!USER) {
      app.innerHTML = `<div class="panel" style="max-width:420px;margin:0 auto"><h2 style="margin-top:0" id="ttl">Sign in</h2><form id="af" style="display:grid;gap:12px"><div id="reg" hidden style="display:grid;gap:12px"><input name="name" placeholder="Full name"><input name="phone" placeholder="Phone"></div>
      <input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password (8+ characters)" required><div class="msg" id="err"></div>
      <button class="btn dark full" id="go">Sign in</button></form><p style="text-align:center"><a href="#" id="sw" style="text-decoration:underline">Create an account</a></p></div>`;
      let mode = 'login'; $('#sw').onclick = e => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; $('#reg').hidden = mode === 'login'; $('#ttl').textContent = $('#go').textContent = mode === 'login' ? 'Sign in' : 'Create account'; $('#sw').textContent = mode === 'login' ? 'Create an account' : 'I already have an account'; };
      $('#af').onsubmit = async e => { e.preventDefault(); try { const r = await api('/auth/' + mode, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); setUser(r.user); location.hash = '#/account'; route(); } catch (er) { $('#err').textContent = er.message; } };
      return;
    }
    const orders = await api('/my/orders');
    app.innerHTML = `<div class="bar"><h1 style="margin:0">Hello, ${esc(USER.name)}</h1><div>${USER.role ? '<a class="btn dark" href="/admin">Open admin</a> ' : ''}<button class="btn line" id="lo">Sign out</button></div></div>
    <h2>My orders</h2>${orders.length ? orders.map(o => `<div class="panel" style="margin-bottom:12px"><div class="bar" style="margin:0"><b>${esc(o.number)}</b><span class="st ${esc(o.status)}">${esc(o.status)}</span></div>
    <div style="color:var(--muted);font-size:14px">${esc(o.created_at)} · ${fmt(o.total)} · payment: ${esc(o.payment_status)}</div>${o.items.map(i => `<div>${i.qty} × ${esc(i.name)} ${esc(i.variant_name || '')}</div>`).join('')}</div>`).join('') : '<div class="empty">No orders yet.</div>'}`;
    $('#lo').onclick = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); location.hash = '#/'; };
  },
  notfound() { seo('Page not found'); app.innerHTML = '<div class="empty"><h2 style="display:block">Page not found</h2><p>The page you are looking for does not exist.</p><a class="btn" href="#/">Back to home</a></div>'; }
};

// ---------- cart helpers ----------
function addToCart(p, v, qty) {
  const ex = CART.find(i => i.pid === p.id && i.vid === (v?.id || null));
  if (ex) ex.qty += qty; else CART.push({ pid: p.id, vid: v?.id || null, slug: p.slug, name: p.name, vname: v?.name || '', price: v?.price_now ?? p.price_now, image: v?.image || p.images[0] || '', qty });
  saveCart();
}
const totals = () => { const sub = CART.reduce((s, i) => s + i.price * i.qty, 0), ship = sub >= (S.free_shipping_over || Infinity) ? 0 : (S.shipping_fee || 0); return { sub, ship, total: sub + ship }; };
const summary = (t, action) => `<div class="panel sum"><h3 style="margin-top:0">Order summary</h3><div><span>Subtotal</span><span>${fmt(t.sub)}</span></div><div><span>Shipping</span><span>${t.ship ? fmt(t.ship) : 'Free'}</span></div><div class="t"><span>Total</span><span>${fmt(t.total)}</span></div><div style="margin-top:14px">${action}</div></div>`;

// ---------- boot / router ----------
function setUser(u) { USER = u; $('#acct').textContent = u ? u.name.split(' ')[0] : 'Sign in'; }
async function route() {
  const [path, query] = (location.hash.slice(1) || '/').split('?'), parts = path.split('/').filter(Boolean), qs = Object.fromEntries(new URLSearchParams(query));
  const name = parts[0] || 'home', v = views[name] || views.notfound;
  app.innerHTML = '<div class="grid"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'; window.scrollTo(0, 0);
  try { await v(qs, decodeURIComponent(parts[1] || '')); } catch (e) { if (/not found/i.test(e.message)) return views.notfound(); app.innerHTML = `<div class="empty"><h2 style="display:block">We couldn’t load this page</h2><p>${esc(e.message)}</p><button class="btn" onclick="route()">Try again</button></div>`; }
}
async function boot() {
  try {
    [S, CATS] = await Promise.all([api('/settings'), api('/categories')]);
    const r = document.documentElement.style; r.setProperty('--primary', S.primary_color); r.setProperty('--accent', S.accent_color);
    $('#logo').innerHTML = S.logo ? `<img src="${esc(S.logo)}" alt="${esc(S.store_name)}" style="height:38px;width:auto">` : esc(S.store_name); document.title = S.seo_title || S.store_name;
    if (S.favicon) { const l = document.querySelector('link[rel=icon]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' })); l.href = S.favicon; }
    $('#catnav').innerHTML = CATS.filter(c => !c.parent_id).map(c => `<a href="#/products?category=${esc(c.slug)}">${esc(c.name)}</a>`).join('') + '<a href="#/products?sale=1">Sale</a>';
    const soc = ['instagram', 'facebook', 'tiktok', 'youtube'].filter(k => S['social_' + k]).map(k => `<a href="${esc(S['social_' + k])}" target="_blank" rel="noopener">${k[0].toUpperCase() + k.slice(1)}</a>`).join('');
    $('#foot').innerHTML = `<div><h4>${esc(S.store_name)}</h4><p>${esc(S.tagline)}</p></div><div><h4>Contact</h4><a href="tel:${esc(S.contact_phone)}">${esc(S.contact_phone)}</a><a href="mailto:${esc(S.contact_email)}">${esc(S.contact_email)}</a><span>${esc(S.address)}</span><span>${esc(S.business_hours)}</span></div>${soc ? `<div><h4>Follow us</h4>${soc}</div>` : ''}`;
    setUser((await api('/me')).user);
  } catch (e) { app.innerHTML = `<div class="empty"><h2 style="display:block">The store is unavailable</h2><p>${esc(e.message)}</p></div>`; return; }
  saveCart(); route();
}
$('#sf').onsubmit = e => { e.preventDefault(); location.hash = '#/products?q=' + encodeURIComponent($('#q').value.trim()); };
window.addEventListener('hashchange', route); boot();
