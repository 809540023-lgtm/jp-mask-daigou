(function () {
  'use strict';

  const SHIPPING = {
    unitKg: 3,
    priceTwd: 380,
  };
  const PROXY_FEE_TWD = 0; // 首批代購原始客戶免代購費
  const CUSTOMER_EMAIL = 'cia8885@gmail.com';
  const PAGE_SIZE = 24;
  const LS_LANG = 'jmd.lang';
  const LS_CART = 'jmd.cart';

  const state = {
    lang: 'zh-Hant',
    meta: { jpyToTwd: 0.22, count: 0, withPrice: 0 },
    products: [],
    byId: new Map(),
    filterCat: '__all__',
    query: '',
    sort: 'discount',
    shown: PAGE_SIZE,
    viewerList: [],
    viewerIndex: 0,
    cart: {},
    sending: false,
    lastOrder: null,
    apiEnabled: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- i18n ---------- */
  const t = (key) => window.I18N.t(state.lang, key);
  const catName = (key) => window.I18N.category(state.lang, key);

  function applyStaticI18n() {
    document.documentElement.lang = state.lang === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant';
    $$('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      const html = t(key);
      if (html.indexOf('<') !== -1) el.innerHTML = html;
      else el.textContent = html;
    });
    $$('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    $$('.lang__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.lang === state.lang));
    const rate = state.meta.jpyToTwd;
    $('#statRate').textContent = `¥1 ≈ NT$${rate.toFixed(2)}`;
  }

  /* ---------- format ---------- */
  const nf = new Intl.NumberFormat('en-US');
  const fmtInt = (n) => nf.format(Math.round(n || 0));
  const fmtTwd = (n) => `NT$ ${fmtInt(n)}`;
  const fmtYen = (n) => `¥${fmtInt(n)}`;

  function fmtWeight(g) {
    if (!g) return `0 ${t('weightUnit')}`;
    if (g >= 1000) return `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2)} kg`;
    return `${fmtInt(g)} ${t('weightUnit')}`;
  }

  const unitYen = (p) => (p.priceYenTaxIn != null ? p.priceYenTaxIn : p.priceYen);
  const unitTwd = (p) => (p.twd != null ? p.twd : unitYen(p) != null ? Math.round(unitYen(p) * state.meta.jpyToTwd) : null);

  function taxLabel(p) {
    const note = p.taxNote || '';
    if (note.includes('併記')) return t('taxBoth');
    if (note.includes('税抜')) return t('taxExcluded');
    if (note.includes('税込')) return t('taxIncluded');
    return t('taxUnknown');
  }

  /* ---------- cart ---------- */
  function saveCart() {
    try { localStorage.setItem(LS_CART, JSON.stringify(state.cart)); } catch (e) { /* ignore */ }
  }
  function loadCart() {
    try {
      const raw = localStorage.getItem(LS_CART);
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.keys(parsed).forEach((id) => {
          const q = Number(parsed[id]);
          if (state.byId.has(id) && q > 0) state.cart[id] = Math.min(q, 99);
        });
      }
    } catch (e) { /* ignore */ }
  }

  function addToCart(id, qty) {
    const q = qty || 1;
    state.lastOrder = null;
    state.cart[id] = Math.min((state.cart[id] || 0) + q, 99);
    saveCart();
    renderCart();
    toast(`${t('addedToast')}：${shortName(state.byId.get(id))}`);
  }
  function setQty(id, qty) {
    const q = Math.max(0, Math.min(qty, 99));
    if (q === 0) delete state.cart[id];
    else state.cart[id] = q;
    saveCart();
    renderCart();
  }

  function cartItems() {
    return Object.keys(state.cart)
      .map((id) => ({ product: state.byId.get(id), qty: state.cart[id] }))
      .filter((x) => x.product);
  }

  function totals() {
    let weightG = 0;
    let goodsJpy = 0;
    let goodsTwd = 0;
    let unpriced = 0;
    let count = 0;
    cartItems().forEach(({ product, qty }) => {
      count += qty;
      weightG += (product.weightG || 0) * qty;
      const yen = unitYen(product);
      if (yen == null) { unpriced += qty; return; }
      goodsJpy += yen * qty;
      goodsTwd += (unitTwd(product) || 0) * qty;
    });

    const units = Math.ceil(weightG / (SHIPPING.unitKg * 1000));
    const shippingTwd = units > 0 ? units * SHIPPING.priceTwd : 0;
    const billedKg = units * SHIPPING.unitKg;
    const proxyFeeTwd = PROXY_FEE_TWD;

    return {
      count,
      weightG,
      units,
      billedKg,
      goodsJpy,
      goodsTwd,
      shippingTwd,
      proxyFeeTwd,
      unpriced,
      totalTwd: goodsTwd + shippingTwd + proxyFeeTwd,
    };
  }

  /* ---------- rendering: catalog ---------- */
  function shortName(p) {
    if (!p) return '';
    return state.lang === 'zh-Hans' ? p.nameZhHans || p.nameZh : p.nameZh;
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    let list = state.products.filter((p) => {
      if (state.filterCat !== '__all__' && p.category !== state.filterCat) return false;
      if (!q) return true;
      const hay = `${p.brand} ${p.nameJa} ${p.nameZh} ${p.nameZhHans} ${p.variant} ${p.id}`.toLowerCase();
      return hay.includes(q);
    });

    const price = (p) => (unitYen(p) == null ? Number.POSITIVE_INFINITY : unitYen(p));
    const sorters = {
      discount: (a, b) => (b.discountPct || 0) - (a.discountPct || 0) || price(a) - price(b),
      priceAsc: (a, b) => price(a) - price(b),
      priceDesc: (a, b) => (b.priceYenTaxIn || 0) - (a.priceYenTaxIn || 0),
      light: (a, b) => (a.weightG || 0) - (b.weightG || 0),
      unit: (a, b) => (a.unitPriceYen || 1e9) - (b.unitPriceYen || 1e9),
    };
    list = list.slice().sort(sorters[state.sort] || sorters.discount);
    return list;
  }

  function renderChips() {
    const cats = ['__all__'];
    state.products.forEach((p) => { if (!cats.includes(p.category)) cats.push(p.category); });
    const chip = (key, label, count) =>
      `<button type="button" class="chip${state.filterCat === key ? ' is-active' : ''}" data-cat="${key}">${label}${count != null ? ` <span style="opacity:.6">${count}</span>` : ''}</button>`;
    $('#chips').innerHTML = cats
      .map((c) => {
        if (c === '__all__') return chip('__all__', t('catAll'), state.products.length);
        const n = state.products.filter((p) => p.category === c).length;
        return chip(c, catName(c), n);
      })
      .join('');
  }

  function photoUrl(p, big) {
    if (!p.photo) return null;
    return `${big ? '/img/p/' : '/img/t/'}${p.photo}.webp`;
  }

  function cardHtml(p) {
    const yen = unitYen(p);
    const twd = unitTwd(p);
    const img = photoUrl(p);
    const tags = [];
    if (p.discountPct) tags.push(`<span class="tag tag--off">${p.discountPct}% OFF</span>`);
    if (p.packText || p.sheets) tags.push(`<span class="tag tag--pack">${p.sheets ? `${p.sheets} 枚` : escapeHtml(p.packText).slice(0, 12)}</span>`);
    if (p.needsReview) tags.push(`<span class="tag tag--review">${t('reviewTag')}</span>`);

    return `
<article class="card-p" data-id="${p.id}" tabindex="0" role="button" aria-label="${escapeHtml(shortName(p))}">
  <div class="card-p__media">
    ${img
      ? `<img src="${img}" alt="${escapeHtml(shortName(p))}" loading="lazy" decoding="async" />`
      : `<div style="height:100%;display:grid;place-items:center;font-size:44px">🌸</div>`}
    <div class="card-p__tags">${tags.join('')}</div>
  </div>
  <div class="card-p__body">
    <span class="card-p__brand">${escapeHtml(p.brand)}</span>
    <h3 class="card-p__name">${escapeHtml(shortName(p))}</h3>
    <p class="card-p__name-ja">${escapeHtml(p.nameJa)}</p>
    <div class="card-p__meta">
      <span>${catName(p.category)}</span>
      <span>≈ ${fmtWeight(p.weightG)}</span>
    </div>
    <div class="card-p__price">
      ${yen != null
        ? `<span class="yen">¥${fmtInt(yen)}<small> ${t('currency')}</small></span>${twd != null ? `<span class="twd">≈ ${fmtTwd(twd)}</span>` : ''}`
        : `<span class="twd">${t('priceNoData')}</span>`}
      ${p.regularPriceYen && p.regularPriceYen > (yen || 0) ? `<span class="was">¥${fmtInt(p.regularPriceYen)}</span>` : ''}
    </div>
    <button type="button" class="card-p__add${state.cart[p.id] ? ' is-added' : ''}" data-add="${p.id}">
      ${state.cart[p.id] ? `✓ ${t('added')} (${state.cart[p.id]})` : t('addToCart')}
    </button>
  </div>
</article>`;
  }

  function renderGrid() {
    const list = filtered();
    const slice = list.slice(0, state.shown);
    const grid = $('#grid');
    grid.innerHTML = slice.length
      ? slice.map(cardHtml).join('')
      : `<div class="empty"><div style="font-size:40px">🔍</div><p>${state.lang === 'zh-Hans' ? '找不到符合的商品，换个关键字试试。' : '找不到符合的商品，換個關鍵字試試。'}</p></div>`;
    $('#loadMore').hidden = list.length <= state.shown;
    $('#catalogCount').textContent = `${fmtInt(list.length)} / ${fmtInt(state.products.length)} ${t('itemsCount')}`;
    // 放大檢視一次只建立目前列表範圍的投影片，避免一次渲染上百張造成手機卡頓
    state.viewerList = slice;
  }

  /* ---------- viewer ---------- */
  function slideHtml(p, idx) {
    const yen = unitYen(p);
    const twd = unitTwd(p);
    const specs = [
      [t('specBrand'), p.brand],
      [t('specCategory'), catName(p.category)],
      [t('specPack'), p.packText || (p.sheets ? `${p.sheets} 枚` : '—')],
      [t('specWeight'), `≈ ${fmtWeight(p.weightG)}`],
      [t('specUnit'), p.unitPriceYen ? `¥${p.unitPriceYen}` : '—'],
      [t('specTax'), taxLabel(p)],
    ];
    const photos = (p.photos || []).map((ph) => `/img/t/${ph}.webp`);

    return `
<section class="slide" data-idx="${idx}">
  <div class="slide__media">
    ${p.photo
      ? `<img class="slide__img" src="/img/p/${p.photo}.webp" alt="${escapeHtml(shortName(p))}" loading="lazy" />`
      : `<div style="height:100%;display:grid;place-items:center;font-size:60px">🌸</div>`}
    ${p.discountPct ? `<span class="slide__discount">${p.discountPct}% OFF</span>` : ''}
    ${photos.length > 1
      ? `<div class="slide__thumbs">${photos
          .map((src, i) => `<button type="button" class="${i === 0 ? 'is-active' : ''}" data-photo="${src.replace('/t/', '/p/')}"><img src="${src}" alt="" loading="lazy" /></button>`)
          .join('')}</div>`
      : ''}
  </div>
  <div class="slide__body">
    <span class="slide__brand">${escapeHtml(p.brand)}</span>
    <h3 class="slide__name">${escapeHtml(shortName(p))}</h3>
    <p class="slide__name-ja">${escapeHtml(p.nameJa)}</p>

    <div class="slide__prices">
      ${yen != null
        ? `<span class="yen">¥${fmtInt(yen)}<small> ${t('currency')}</small></span>
           ${twd != null ? `<span class="twd">≈ ${fmtTwd(twd)}</span>` : ''}
           ${p.regularPriceYen && p.regularPriceYen > yen ? `<span class="was">¥${fmtInt(p.regularPriceYen)}</span>` : ''}`
        : `<span class="twd">${t('priceNoData')}</span>`}
    </div>

    <div class="specs">
      ${specs.map(([k, v]) => `<div class="spec"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v || '—'))}</strong></div>`).join('')}
    </div>

    ${p.variant ? `<div class="slide__section"><h4>${t('specVariant')}</h4><p>${escapeHtml(p.variant)}</p></div>` : ''}
    ${p.note ? `<div class="slide__section"><h4>${t('noteLabel')}</h4><p>${escapeHtml(p.note)}</p></div>` : ''}
    ${p.storeHint ? `<div class="slide__section"><h4>${t('storeLabel')}</h4><p>${escapeHtml(p.storeHint)}</p></div>` : ''}
    <div class="slide__section">
      <p class="muted" style="font-size:11.5px">${p.id} · ${(p.photos || []).length} ${t('photoCount')} · ${t('estimateBadge')}</p>
    </div>

    <div class="slide__qtyrow">
      <div class="qty" data-qty-for="${p.id}">
        <button type="button" data-dec="${p.id}" aria-label="minus">−</button>
        <span>${state.cart[p.id] || 1}</span>
        <button type="button" data-inc="${p.id}" aria-label="plus">＋</button>
      </div>
      <span class="muted">${t('qtyLabel')}・≈ ${fmtWeight((p.weightG || 0) * (state.cart[p.id] || 1))}</span>
    </div>

    <div class="slide__section">
      <p style="font-size:12px;background:rgba(255,176,32,.12);border:1px solid rgba(255,176,32,.3);border-radius:12px;padding:10px 12px;color:#7a5300">
        ${t('shippingRule')}；${t('rateNote')}
      </p>
    </div>

    <div class="slide__actions">
      <div class="slide__actionsinner">
        <button type="button" class="btn btn--primary" data-add-view="${p.id}" data-qty="${state.cart[p.id] || 1}">
          ${state.cart[p.id] ? `✓ ${t('inCart')} · ${t('addToCart')}` : t('addToCart')}
        </button>
      </div>
    </div>
  </div>
</section>`;
  }

  function openViewer(id) {
    const list = state.viewerList.length ? state.viewerList : filtered();
    let idx = list.findIndex((p) => p.id === id);
    if (idx < 0) { idx = 0; }
    state.viewerList = list;
    $('#viewerTrack').innerHTML = list.map((p, i) => slideHtml(p, i)).join('');
    $('#viewer').hidden = false;
    document.body.classList.add('is-locked');
    gotoSlide(idx, true);
  }

  function setActive(idx, opts) {
    const o = opts || {};
    const slides = $$('#viewerTrack .slide');
    if (!slides.length) return;
    const clamped = Math.max(0, Math.min(idx, slides.length - 1));
    state.viewerIndex = clamped;
    slides.forEach((s, i) => s.classList.toggle('is-current', i === clamped));
    if (o.scroll) {
      const track = $('#viewerTrack');
      track.scrollTo({ left: clamped * track.clientWidth, behavior: o.instant ? 'auto' : 'smooth' });
    }
    $('#viewerIndex').textContent = `${clamped + 1} / ${slides.length}`;
  }

  function gotoSlide(idx, instant) {
    const isMobile = window.matchMedia('(max-width: 899px)').matches;
    setActive(idx, { scroll: isMobile && instant !== 'noScroll', instant: !!instant });
  }

  function closeViewer() {
    $('#viewer').hidden = true;
    document.body.classList.remove('is-locked');
    $('#viewerTrack').innerHTML = '';
    renderCart();
  }

  /* ---------- cart drawer / summary ---------- */
  function cartRowHtml(product, qty) {
    const yen = unitYen(product);
    const img = photoUrl(product);
    return `
<div class="ci" data-id="${product.id}">
  ${img ? `<img src="${img}" alt="" loading="lazy" />` : `<div style="width:62px;height:62px;border-radius:12px;background:#eee;display:grid;place-items:center">🌸</div>`}
  <div>
    <div class="ci__name">${escapeHtml(shortName(product))}</div>
    <div class="ci__sub">${escapeHtml(product.brand)} · ≈ ${fmtWeight(product.weightG)}</div>
    <div class="qty" style="margin-top:6px">
      <button type="button" data-dec="${product.id}">−</button>
      <span>${qty}</span>
      <button type="button" data-inc="${product.id}">＋</button>
    </div>
  </div>
  <div class="ci__right">
    <span class="ci__price">${yen != null ? fmtYen(yen * qty) : '—'}</span>
    <span class="ci__sub">${unitTwd(product) != null ? fmtTwd(unitTwd(product) * qty) : t('priceNoData')}</span>
    <button type="button" class="ci__rm" data-rm="${product.id}">${t('remove')}</button>
  </div>
</div>`;
  }

  function totalsHtml(tt, opts) {
    const o = opts || {};
    return `
<dl class="totals">
  <div><dt>${t('goodsLabel')}</dt><dd>${fmtTwd(tt.goodsTwd)}</dd></div>
  <div><dt>${t('weightLabel')}</dt><dd>${fmtWeight(tt.weightG)}</dd></div>
  <div><dt>${t('billedLabel')}</dt><dd>${tt.billedKg ? `${fmtInt(tt.billedKg)} kg` : '0 kg'}</dd></div>
  <div><dt>${t('shippingLabel')}<br /><span class="muted" style="font-size:11px">${t('shippingRule')}</span></dt><dd>${fmtTwd(tt.shippingTwd)}</dd></div>
  <div><dt>${t('proxyFeeLabel')}</dt><dd class="free">${tt.proxyFeeTwd === 0 ? t('free') : fmtTwd(tt.proxyFeeTwd)}</dd></div>
  ${tt.unpriced ? `<div><dt>${t('priceNote')}</dt><dd>${tt.unpriced} ${t('unitItems')}</dd></div>` : ''}
  <div class="tt"><dt>${t('totalLabel')}</dt><dd>${fmtTwd(tt.totalTwd)}</dd></div>
</dl>`;
  }

  function renderCart() {
    const items = cartItems();
    const tt = totals();

    $('#cartCount').textContent = items.length;
    $('#fbCount').textContent = items.length;
    $('#fbWeight').textContent = fmtWeight(tt.weightG);
    const bar = $('#floatingBar');
    bar.hidden = items.length === 0 || !$('#viewer').hidden;

    const body = $('#drawerBody');
    body.innerHTML = items.length
      ? items.map(({ product, qty }) => cartRowHtml(product, qty)).join('')
      : `<div class="cart-empty"><span>🛍️</span><p><strong>${t('cartEmpty')}</strong></p><p>${t('cartEmptyHint')}</p><a class="btn btn--primary" href="#catalog" id="emptyGo">${t('goCatalog')}</a></div>`;

    $('#drawerFoot').innerHTML = items.length
      ? `${totalsHtml(tt)}<button type="button" class="btn btn--primary btn--lg" id="drawerGo">${t('navOrder')} →</button>`
      : '';

    const summaryItems = $('#summaryItems');
    summaryItems.innerHTML = items.length
      ? items
          .map(
            ({ product, qty }) => `
<div class="summary__item">
  ${photoUrl(product) ? `<img src="${photoUrl(product)}" alt="" loading="lazy" />` : '<div style="width:46px;height:46px;border-radius:10px;background:#eee"></div>'}
  <div><b>${escapeHtml(shortName(product))}</b><small>${escapeHtml(product.brand)} · ≈ ${fmtWeight(product.weightG)}</small></div>
  <div class="q">×${qty}</div>
</div>`,
          )
          .join('')
      : `<p class="muted" style="text-align:center;padding:18px 0">${t('cartEmpty')}</p>`;
    $('#summaryTotals').innerHTML = totalsHtml(tt);
    if (state.lastOrder) renderSuccess(state.lastOrder);

    // sync any visible qty widgets / add buttons
    $$('[data-add]').forEach((btn) => {
      const id = btn.dataset.add;
      btn.classList.toggle('is-added', !!state.cart[id]);
      btn.textContent = state.cart[id] ? `✓ ${t('added')} (${state.cart[id]})` : t('addToCart');
    });
    $$('[data-add-view]').forEach((btn) => {
      const id = btn.dataset.addView;
      btn.textContent = state.cart[id] ? `✓ ${t('inCart')} · ${t('addToCart')}` : t('addToCart');
      btn.dataset.qty = String(state.cart[id] || 1);
    });
  }

  function renderSuccess(ref) {
    $('#summaryItems').innerHTML = `
<div class="success">
  <div class="success__icon">🎉</div>
  <h3>${t('successTitle')}</h3>
  <p class="muted">${t('successBody')}</p>
  <p>${t('orderRef')}：<code>${escapeHtml(ref)}</code></p>
  <p style="margin-top:12px"><a class="btn btn--ghost" href="#catalog">${t('successClose')}</a></p>
</div>`;
    $('#summaryTotals').innerHTML = '';
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- helpers ---------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- order submit ---------- */
  function buildOrder() {
    const tt = totals();
    const items = cartItems().map(({ product, qty }) => ({
      id: product.id,
      brand: product.brand,
      name: shortName(product),
      nameJa: product.nameJa,
      packText: product.packText,
      sheets: product.sheets,
      qty,
      unitYen: unitYen(product),
      unitTwd: unitTwd(product),
      weightG: product.weightG,
      subtotalYen: unitYen(product) != null ? unitYen(product) * qty : null,
      subtotalTwd: unitTwd(product) != null ? unitTwd(product) * qty : null,
      photo: product.photo,
    }));

    const ref = `JMD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    return {
      ref,
      lang: state.lang,
      submittedAt: new Date().toISOString(),
      customer: {
        name: $('#fName').value.trim(),
        phone: $('#fPhone').value.trim(),
        address: $('#fAddress').value.trim(),
        email: $('#fEmail').value.trim(),
        note: $('#fNote').value.trim(),
      },
      items,
      totals: {
        count: tt.count,
        weightG: tt.weightG,
        billedKg: tt.billedKg,
        goodsJpy: tt.goodsJpy,
        goodsTwd: tt.goodsTwd,
        shippingTwd: tt.shippingTwd,
        proxyFeeTwd: tt.proxyFeeTwd,
        totalTwd: tt.totalTwd,
        unpricedUnits: tt.unpriced,
      },
      rate: state.meta.jpyToTwd,
      shippingRule: `每 ${SHIPPING.unitKg} 公斤 NT$${SHIPPING.priceTwd}`,
    };
  }

  function validate() {
    let ok = true;
    const mark = (el, bad) => {
      const field = el.closest('.field');
      if (field) field.classList.toggle('has-error', bad);
    };
    const name = $('#fName');
    const phone = $('#fPhone');
    const addr = $('#fAddress');

    [name, phone, addr].forEach((el) => mark(el, false));
    if (!name.value.trim()) { mark(name, true); ok = false; }
    if (!phone.value.trim()) { mark(phone, true); ok = false; }
    if (!addr.value.trim()) { mark(addr, true); ok = false; }
    if (!ok) { toast(t('errRequired')); return false; }

    const digits = phone.value.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length < 8) { mark(phone, true); toast(t('errPhone')); return false; }

    if (!$('#fAgree').checked) { toast(t('errAgree')); return false; }
    if (!cartItems().length) { toast(t('errNoItems')); return false; }
    return true;
  }

  async function postToFormSubmit(order) {
    const res = await fetch(`https://formsubmit.co/ajax/${CUSTOMER_EMAIL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `【日本嚴選代購】新需求 ${order.ref}`,
        _template: 'table',
        _captcha: 'false',
        需求編號: order.ref,
        姓名: order.customer.name,
        電話: order.customer.phone,
        台灣收貨地址: order.customer.address,
        Email: order.customer.email || '（未填）',
        備註: order.customer.note || '—',
        商品明細: order.items
          .map((i) => `${i.name}（${i.id}） x${i.qty}｜${i.unitYen == null ? '待報價' : `¥${i.unitYen}`}｜${i.weightG * i.qty}g`)
          .join('\n'),
        預估總重: `${order.totals.weightG} g（計費 ${order.totals.billedKg} kg）`,
        預估運費: `NT$${order.totals.shippingTwd}`,
        代購服務費: '免費（首批原始客戶）',
        預估總額: `NT$${order.totals.totalTwd}`,
        備註說明: '本頁價格、重量與運費均為系統估算，實際報價以客服最後確認為準。',
      }),
    });
    if (!res.ok) throw new Error(`FormSubmit HTTP ${res.status}`);
    return { ok: true, transport: 'formsubmit-client', ref: order.ref };
  }

  /** 站台若部署了後端（Render Web Service）就走 /api/order，否則由瀏覽器直接送 FormSubmit。 */
  async function detectApi() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('/api/health', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        state.apiEnabled = Boolean(data && data.ok);
      }
    } catch (err) {
      state.apiEnabled = false;
    }
    return state.apiEnabled;
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (state.sending) return;
    if (!validate()) return;

    const order = buildOrder();
    const btn = $('#submitBtn');
    const original = btn.textContent;
    state.sending = true;
    btn.disabled = true;
    btn.textContent = t('sending');

    let result = null;
    try {
      if (state.apiEnabled) {
        const res = await fetch('/api/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        result = data;
      } else {
        result = await postToFormSubmit(order);
      }
    } catch (err) {
      console.warn('api path failed, using client fallback', err);
      try {
        result = await postToFormSubmit(order);
      } catch (err2) {
        console.error(err2);
        toast(`${t('errSend')}：${CUSTOMER_EMAIL}`);
        state.sending = false;
        btn.disabled = false;
        btn.textContent = original;
        return;
      }
    }

    state.sending = false;
    btn.disabled = false;
    btn.textContent = original;

    console.log('order sent', result);
    state.lastOrder = order.ref;
    state.cart = {};
    saveCart();
    renderCart();
    toast(t('successTitle'));
    $('#order').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- events ---------- */
  function bindEvents() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-add],[data-add-view],[data-inc],[data-dec],[data-rm],[data-cat],[data-photo],.card-p,#viewerPrev,#viewerNext,#viewerClose,#cartBtn,#drawerClose,#openCart,#drawerGo,#fbGo,#loadMore,.lang__btn');
      if (!el) return;

      if (el.matches('.lang__btn')) {
        state.lang = el.dataset.lang;
        try { localStorage.setItem(LS_LANG, state.lang); } catch (err) { /* ignore */ }
        applyStaticI18n();
        renderChips();
        renderGrid();
        renderCart();
        if (!$('#viewer').hidden) {
          const idx = state.viewerIndex;
          const list = state.viewerList;
          $('#viewerTrack').innerHTML = list.map((p, i) => slideHtml(p, i)).join('');
          gotoSlide(idx, true);
        }
        return;
      }

      if (el.matches('#loadMore')) { state.shown += PAGE_SIZE; renderGrid(); return; }

      if (el.matches('#cartBtn,#openCart,#fbGo')) {
        if (!cartItems().length && el.matches('#fbGo')) { toast(t('needItemsToast')); }
        $('#drawer').hidden = false;
        document.body.classList.add('is-locked');
        return;
      }
      if (el.matches('#drawerClose')) { $('#drawer').hidden = true; document.body.classList.remove('is-locked'); return; }
      if (el.matches('#drawerGo')) {
        $('#drawer').hidden = true;
        document.body.classList.remove('is-locked');
        $('#order').scrollIntoView({ behavior: 'smooth' });
        return;
      }

      if (el.dataset.cat) {
        state.filterCat = el.dataset.cat;
        state.shown = PAGE_SIZE;
        renderChips();
        renderGrid();
        return;
      }

      if (el.dataset.add) { e.stopPropagation(); addToCart(el.dataset.add, 1); return; }
      if (el.dataset.addView) { addToCart(el.dataset.addView, Number(el.dataset.qty) || 1); return; }

      if (el.dataset.inc || el.dataset.dec) {
        const id = el.dataset.inc || el.dataset.dec;
        const delta = el.dataset.inc ? 1 : -1;
        const current = state.cart[id] || (delta > 0 ? 1 : 0);
        const next = current + delta;
        if (next <= 0) setQty(id, 0);
        else setQty(id, next);
        const slide = el.closest('.slide');
        if (slide) {
          const span = slide.querySelector('.qty span');
          if (span) span.textContent = Math.max(1, state.cart[id] || 1);
        }
        return;
      }
      if (el.dataset.rm) { setQty(el.dataset.rm, 0); return; }

      if (el.dataset.photo) {
        const slide = el.closest('.slide');
        const main = slide.querySelector('.slide__img');
        if (main) main.src = el.dataset.photo;
        slide.querySelectorAll('.slide__thumbs button').forEach((b) => b.classList.toggle('is-active', b === el));
        return;
      }

      if (el.matches('.card-p')) { openViewer(el.dataset.id); return; }
      if (el.matches('#viewerPrev')) { gotoSlide(state.viewerIndex - 1); return; }
      if (el.matches('#viewerNext')) { gotoSlide(state.viewerIndex + 1); return; }
      if (el.matches('#viewerClose')) { closeViewer(); return; }
    });

    $('#viewerTrack').addEventListener('scroll', () => {
      const track = $('#viewerTrack');
      if (!track.clientWidth) return;
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      if (idx !== state.viewerIndex) setActive(idx);
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (!$('#viewer').hidden) {
        if (e.key === 'Escape') closeViewer();
        if (e.key === 'ArrowRight') gotoSlide(state.viewerIndex + 1);
        if (e.key === 'ArrowLeft') gotoSlide(state.viewerIndex - 1);
      } else if (e.key === 'Escape' && !$('#drawer').hidden) {
        $('#drawer').hidden = true;
        document.body.classList.remove('is-locked');
      }
    });

    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = e.target.value;
        state.shown = PAGE_SIZE;
        renderGrid();
      }, 180);
    });
    $('#sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.shown = PAGE_SIZE;
      renderGrid();
    });

    const calc = $('#calcWeight');
    const runCalc = () => {
      const g = Math.max(0, Number(calc.value) || 0);
      const units = Math.ceil(g / (SHIPPING.unitKg * 1000));
      $('#calcWeightOut').textContent = `${fmtInt(g)} g (${(g / 1000).toFixed(2)} kg)`;
      $('#calcBilledOut').textContent = `${units * SHIPPING.unitKg} kg`;
      $('#calcShipOut').textContent = fmtTwd(units * SHIPPING.priceTwd);
    };
    calc.addEventListener('input', runCalc);
    runCalc();

    $('#orderForm').addEventListener('submit', submitOrder);
  }

  /* ---------- boot ---------- */
  async function boot() {
    $('#year').textContent = String(new Date().getFullYear());
    try { state.lang = localStorage.getItem(LS_LANG) || 'zh-Hant'; } catch (e) { /* ignore */ }

    const res = await fetch('/data/products.json');
    const data = await res.json();
    state.meta = data.meta || state.meta;
    state.products = data.products || [];
    state.byId = new Map(state.products.map((p) => [p.id, p]));

    loadCart();
    applyStaticI18n();
    renderChips();
    renderGrid();
    renderCart();
    bindEvents();
    detectApi().then((enabled) => {
      if (!enabled) console.info('[shop] 未偵測到後端 API，將由瀏覽器直接寄送訂單到客服信箱');
    });

    $('#statItems').textContent = fmtInt(state.products.length);
    $('#statPriced').textContent = fmtInt(state.meta.withPrice || state.products.filter((p) => p.priceYenTaxIn != null).length);
    const photoSet = new Set();
    state.products.forEach((p) => (p.photos || []).forEach((ph) => photoSet.add(ph)));
    $('#statPhotos').textContent = fmtInt(photoSet.size);

    document.body.classList.add('is-ready');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
