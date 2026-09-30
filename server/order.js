export const SHIPPING = { unitKg: 3, priceTwd: 380 };
export const PROXY_FEE_TWD = 0;
export const MAX_QTY_PER_ITEM = 99;

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 由伺服器重算金額，避免前端傳來的數字被竄改。 */
export function computeTotals(items, rateParam) {
  const rate = num(rateParam) ?? 0.22;
  let weightG = 0;
  let goodsJpy = 0;
  let goodsTwd = 0;
  let units = 0;
  let unpricedUnits = 0;

  for (const item of items) {
    const qty = num(item.qty) || 0;
    units += qty;
    weightG += (num(item.weightG) || 0) * qty;
    const yen = num(item.unitYen);
    if (yen == null) {
      unpricedUnits += qty;
      continue;
    }
    goodsJpy += yen * qty;
    goodsTwd += Math.round(yen * rate) * qty;
  }

  const parcels = Math.ceil(weightG / (SHIPPING.unitKg * 1000));
  const shippingTwd = parcels > 0 ? parcels * SHIPPING.priceTwd : 0;

  return {
    count: units,
    weightG,
    billedKg: parcels * SHIPPING.unitKg,
    parcels,
    goodsJpy,
    goodsTwd,
    shippingTwd,
    proxyFeeTwd: PROXY_FEE_TWD,
    totalTwd: goodsTwd + shippingTwd + PROXY_FEE_TWD,
    unpricedUnits,
  };
}

export function validateOrder(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['payload 格式錯誤'];

  const c = payload.customer || {};
  const name = String(c.name || '').trim();
  const phone = String(c.phone || '').trim();
  const address = String(c.address || '').trim();
  const email = String(c.email || '').trim();

  if (name.length < 2) errors.push('姓名未填寫或過短');
  if (name.length > 60) errors.push('姓名過長');

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) errors.push('電話格式不正確');
  if (digits.length > 20) errors.push('電話過長');

  if (address.length < 6) errors.push('收貨地址未填寫或過短');
  if (address.length > 400) errors.push('地址過長');

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email 格式不正確');

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) errors.push('清單是空的');
  if (items.length > 200) errors.push('單筆訂單品項過多');

  items.forEach((it, idx) => {
    const qty = num(it.qty);
    if (qty == null || qty <= 0) errors.push(`第 ${idx + 1} 項數量不正確`);
    if (qty > MAX_QTY_PER_ITEM) errors.push(`第 ${idx + 1} 項數量超過上限`);
    if (!it.id) errors.push(`第 ${idx + 1} 項缺少商品編號`);
  });

  return errors;
}

export function normalizeOrder(payload) {
  const items = (payload.items || []).map((it) => {
    const qty = Math.min(num(it.qty) || 0, MAX_QTY_PER_ITEM);
    const unitYen = num(it.unitYen);
    const rate = num(payload.rate) ?? 0.22;
    return {
      id: String(it.id || ''),
      brand: String(it.brand || ''),
      name: String(it.name || ''),
      nameJa: String(it.nameJa || ''),
      packText: String(it.packText || ''),
      sheets: num(it.sheets),
      qty,
      unitYen,
      unitTwd: unitYen == null ? null : Math.round(unitYen * rate),
      weightG: num(it.weightG) || 0,
    };
  });

  const totals = computeTotals(items, payload.rate);

  return {
    ref: String(payload.ref || '').slice(0, 40) || `JMD-${Date.now()}`,
    submittedAt: payload.submittedAt || new Date().toISOString(),
    lang: payload.lang === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant',
    customer: {
      name: String((payload.customer || {}).name || '').trim().slice(0, 60),
      phone: String((payload.customer || {}).phone || '').trim().slice(0, 30),
      address: String((payload.customer || {}).address || '').trim().slice(0, 400),
      email: String((payload.customer || {}).email || '').trim().slice(0, 120),
      note: String((payload.customer || {}).note || '').trim().slice(0, 1000),
    },
    items,
    totals,
    rate: num(payload.rate) ?? 0.22,
  };
}

const twd = (n) => `NT$${Number(n || 0).toLocaleString('en-US')}`;
const yen = (n) => `¥${Number(n || 0).toLocaleString('en-US')}`;
const weight = (g) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`);

export function buildEmail(order, toAddress) {
  const subject = `【日本嚴選代購】新代購需求 ${order.ref} — ${order.customer.name}（${order.totals.count} 件 / ${weight(
    order.totals.weightG,
  )}）`;

  const rows = order.items
    .map(
      (it, i) => `<tr>
<td style="padding:8px 10px;border-bottom:1px solid #eee">${i + 1}</td>
<td style="padding:8px 10px;border-bottom:1px solid #eee"><b>${esc(it.name)}</b><br><span style="color:#888;font-size:12px">${esc(
        it.brand,
      )} · ${esc(it.packText || (it.sheets ? `${it.sheets} 枚` : '—'))} · ${esc(it.id)}</span></td>
<td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center">${it.qty}</td>
<td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${it.unitYen == null ? '—' : yen(it.unitYen)}</td>
<td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${it.unitYen == null ? '待報價' : yen(it.unitYen * it.qty)}</td>
<td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${it.unitTwd == null ? '—' : twd(it.unitTwd * it.qty)}</td>
<td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${weight(it.weightG * it.qty)}</td>
</tr>`,
    )
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f5f4fa;font-family:'Helvetica Neue',Arial,'PingFang TC','Microsoft JhengHei',sans-serif;color:#16142c">
<div style="max-width:760px;margin:0 auto;padding:24px 16px">
  <div style="background:linear-gradient(120deg,#6b4eff,#ff5c8a);color:#fff;border-radius:18px 18px 0 0;padding:22px 24px">
    <div style="font-size:12px;letter-spacing:.16em;opacity:.85">日本嚴選代購 · 新需求通知</div>
    <h1 style="margin:8px 0 4px;font-size:22px">${esc(order.customer.name)} 的代購需求</h1>
    <div style="font-size:13px;opacity:.9">需求編號 <b>${esc(order.ref)}</b> · ${esc(order.submittedAt)} · 語系 ${esc(order.lang)}</div>
  </div>
  <div style="background:#fff;border-radius:0 0 18px 18px;padding:22px 24px">
    <h2 style="font-size:16px;margin:0 0 10px">客戶資料</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;width:110px;color:#666">姓名</td><td style="padding:6px 0"><b>${esc(order.customer.name)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">電話</td><td style="padding:6px 0"><a href="tel:${esc(order.customer.phone)}">${esc(order.customer.phone)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#666">台灣收貨地址</td><td style="padding:6px 0"><b>${esc(order.customer.address)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0">${esc(order.customer.email) || '—'}</td></tr>
      <tr><td style="padding:6px 0;color:#666">備註</td><td style="padding:6px 0">${esc(order.customer.note) || '—'}</td></tr>
    </table>

    <h2 style="font-size:16px;margin:22px 0 10px">商品清單</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f2f0fb">
        <th style="padding:8px 10px;text-align:left">#</th>
        <th style="padding:8px 10px;text-align:left">商品</th>
        <th style="padding:8px 10px">數量</th>
        <th style="padding:8px 10px;text-align:right">日圓單價</th>
        <th style="padding:8px 10px;text-align:right">小計(¥)</th>
        <th style="padding:8px 10px;text-align:right">小計(NT$)</th>
        <th style="padding:8px 10px;text-align:right">預估重量</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="font-size:16px;margin:22px 0 10px">費用試算（系統估算）</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#666">商品小計（現場價換算）</td><td style="padding:6px 0;text-align:right"><b>${twd(order.totals.goodsTwd)}</b>（日圓合計 ${yen(order.totals.goodsJpy)}）</td></tr>
      <tr><td style="padding:6px 0;color:#666">預估總重量</td><td style="padding:6px 0;text-align:right"><b>${weight(order.totals.weightG)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">計費重量（每 ${SHIPPING.unitKg} 公斤 NT$${SHIPPING.priceTwd}，未滿以 ${SHIPPING.unitKg} 公斤計）</td><td style="padding:6px 0;text-align:right"><b>${order.totals.billedKg || 0} kg</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">預估運費</td><td style="padding:6px 0;text-align:right"><b>${twd(order.totals.shippingTwd)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">代購服務費（首批原始客戶）</td><td style="padding:6px 0;text-align:right;color:#0a8f5f"><b>免費</b></td></tr>
      <tr><td style="padding:10px 0;border-top:1px solid #eee;font-weight:700">預估總額</td><td style="padding:10px 0;border-top:1px solid #eee;text-align:right;font-weight:900;font-size:18px;color:#4a2fd6">${twd(order.totals.totalTwd)}</td></tr>
    </table>

    ${order.totals.unpricedUnits ? `<p style="background:#fff6e5;border:1px solid #ffd489;border-radius:12px;padding:10px 12px;font-size:13px;color:#7a5300">清單中有 ${order.totals.unpricedUnits} 件現場未標價商品，請人工確認後補上報價。</p>` : ''}

    <p style="background:#f3f1ff;border-radius:12px;padding:12px 14px;font-size:12.5px;color:#5a5678;margin-top:18px">
      ※ 以上價格、重量與運費均為系統估算，實際報價、實際重量與最終運費以客服最後確認為準。
    </p>
    <p style="font-size:12px;color:#999;margin-top:16px">來自 jp-mask-daigou 一頁式代購網站 · 回覆此信即可直接聯繫客戶${order.customer.email ? '' : '（客戶未留 Email，請以電話聯繫）'}</p>
  </div>
</div></body></html>`;

  const text = [
    `【日本嚴選代購】新代購需求 ${order.ref}`,
    ``,
    `姓名：${order.customer.name}`,
    `電話：${order.customer.phone}`,
    `台灣收貨地址：${order.customer.address}`,
    `Email：${order.customer.email || '—'}`,
    `備註：${order.customer.note || '—'}`,
    ``,
    `商品清單：`,
    ...order.items.map(
      (it, i) =>
        `${i + 1}. ${it.name}（${it.brand}｜${it.packText || (it.sheets ? `${it.sheets} 枚` : '—')}｜${it.id}） x${it.qty} ` +
        `單價 ${it.unitYen == null ? '待報價' : yen(it.unitYen)}｜預估重量 ${weight(it.weightG * it.qty)}`,
    ),
    ``,
    `商品小計（現場價換算）：${twd(order.totals.goodsTwd)}（日圓合計 ${yen(order.totals.goodsJpy)}）`,
    `預估總重量：${weight(order.totals.weightG)}`,
    `計費重量：${order.totals.billedKg || 0} kg（每 ${SHIPPING.unitKg} 公斤 NT$${SHIPPING.priceTwd}，未滿以 ${SHIPPING.unitKg} 公斤計）`,
    `預估運費：${twd(order.totals.shippingTwd)}`,
    `代購服務費：免費（首批原始客戶）`,
    `預估總額：${twd(order.totals.totalTwd)}`,
    ``,
    `※ 以上為系統估算，實際報價以客服最後確認為準。`,
  ].join('\n');

  return { subject, html, text, to: toAddress };
}
