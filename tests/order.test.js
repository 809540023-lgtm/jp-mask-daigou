import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, validateOrder, normalizeOrder, buildEmail, SHIPPING } from '../server/order.js';

const samplePayload = {
  ref: 'JMD-TEST-0001',
  lang: 'zh-Hant',
  rate: 0.22,
  customer: { name: '王小明', phone: '0912-345-678', address: '台北市大安區和平東路一段 100 號 106', email: 'a@b.com', note: '' },
  items: [
    { id: 'P0001', brand: 'THE STEM CELL', name: '面膜 30 枚入', nameJa: 'ステムセル', packText: '30枚入', sheets: 30, qty: 2, unitYen: 599, weightG: 680 },
  ],
};

test('運費：每 3 公斤 NT$380，未滿以 3 公斤計', () => {
  assert.equal(SHIPPING.priceTwd, 380);
  assert.equal(SHIPPING.unitKg, 3);

  const one = computeTotals([{ qty: 1, unitYen: 100, weightG: 500 }], 0.22);
  assert.equal(one.weightG, 500);
  assert.equal(one.billedKg, 3);
  assert.equal(one.shippingTwd, 380);

  const exact = computeTotals([{ qty: 1, unitYen: 100, weightG: 3000 }], 0.22);
  assert.equal(exact.shippingTwd, 380);

  const over = computeTotals([{ qty: 1, unitYen: 100, weightG: 3001 }], 0.22);
  assert.equal(over.billedKg, 6);
  assert.equal(over.shippingTwd, 760);

  const heavy = computeTotals([{ qty: 3, unitYen: 100, weightG: 1000 }], 0.22);
  assert.equal(heavy.weightG, 3000);
  assert.equal(heavy.shippingTwd, 380);
});

test('金額：日圓換算台幣並加總，未標價商品列入待報價', () => {
  const tt = computeTotals(
    [
      { qty: 2, unitYen: 599, weightG: 680 },
      { qty: 1, unitYen: null, weightG: 200 },
    ],
    0.22,
  );
  assert.equal(tt.goodsJpy, 1198);
  assert.equal(tt.goodsTwd, Math.round(599 * 0.22) * 2);
  assert.equal(tt.unpricedUnits, 1);
  assert.equal(tt.count, 3);
  assert.equal(tt.totalTwd, tt.goodsTwd + 380);
});

test('首批代購原始客戶免代購費', () => {
  const tt = computeTotals([{ qty: 1, unitYen: 100, weightG: 100 }], 0.22);
  assert.equal(tt.proxyFeeTwd, 0);
});

test('驗證：必填姓名、電話、地址', () => {
  assert.deepEqual(validateOrder(samplePayload), []);
  const errors = validateOrder({ customer: { name: '', phone: '123', address: '' }, items: [] });
  assert.ok(errors.length >= 3);
  assert.ok(errors.some((e) => e.includes('姓名')));
  assert.ok(errors.some((e) => e.includes('電話')));
  assert.ok(errors.some((e) => e.includes('地址')));
  assert.ok(errors.some((e) => e.includes('空')));
});

test('驗證：數量上限與 Email 格式', () => {
  const bad = {
    ...samplePayload,
    customer: { ...samplePayload.customer, email: 'not-an-email' },
    items: [{ id: 'P0001', qty: 500, weightG: 10 }],
  };
  const errors = validateOrder(bad);
  assert.ok(errors.some((e) => e.includes('Email')));
  assert.ok(errors.some((e) => e.includes('上限')));
});

test('正規化：伺服器重算金額，不信任前端傳來的 totals', () => {
  const tampered = {
    ...samplePayload,
    totals: { totalTwd: 1, weightG: 0, shippingTwd: 0 },
  };
  const order = normalizeOrder(tampered);
  assert.equal(order.totals.weightG, 1360);
  assert.equal(order.totals.shippingTwd, 380);
  assert.equal(order.totals.goodsTwd, Math.round(599 * 0.22) * 2);
  assert.ok(order.totals.totalTwd > 1);
});

test('郵件內容包含客戶資料、明細與客服確認但書', () => {
  const order = normalizeOrder(samplePayload);
  const mail = buildEmail(order, 'cia8885@gmail.com');
  assert.equal(mail.to, 'cia8885@gmail.com');
  assert.match(mail.subject, /JMD-TEST-0001/);
  assert.match(mail.html, /王小明/);
  assert.match(mail.html, /台北市大安區和平東路一段 100 號 106/);
  assert.match(mail.text, /預估運費：NT\$380/);
  assert.match(mail.html, /以客服最後確認為準/);
  assert.match(mail.text, /免費（首批原始客戶）/);
});
