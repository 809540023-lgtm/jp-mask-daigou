import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseCsv } from './lib/csv.mjs';
import { estimateWeightG, detectSheetCount, CATEGORY_BASE_G, PER_SHEET_G } from './weight-model.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = path.join(root, 'data/source/products.csv');
const OUT_JSON = path.join(root, 'public/data/products.json');
const OUT_XLSX = path.join(root, 'data/商品重量表.xlsx');

// 日圓 -> 新台幣 匯率（可在 public/js/config.js 或這裡調整）
const JPY_TO_TWD = Number(process.env.JPY_TO_TWD || 0.22);
const TAX_RATE = 0.1;

let OpenCC = null;
try {
  const mod = require('opencc-js');
  const converter = (mod.Converter || mod.default.Converter)({ from: 'tw', to: 'cn' });
  OpenCC = (s) => (s ? converter(s) : s);
} catch {
  OpenCC = (s) => s;
}

const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const clean = (v) => (v == null ? '' : String(v).trim());

const rows = parseCsv(fs.readFileSync(SOURCE, 'utf8'));

const products = rows.map((row) => {
  const sheets = detectSheetCount(row);
  const priceYen = num(row['特價(日圓)']);
  const regularPriceYen = num(row['原價(日圓)']);
  const taxNote = clean(row['稅別']) || '不明';
  const taxExcludedOnly = taxNote.includes('税抜') && !taxNote.includes('併記');
  const priceYenTaxIn = priceYen == null ? null : taxExcludedOnly ? Math.round(priceYen * (1 + TAX_RATE)) : priceYen;

  const priceMin = num(row['最低價']);
  const priceMax = num(row['最高價']);
  const weightG = estimateWeightG(row, sheets);

  const photos = clean(row['來源照片檔名'])
    .split('|')
    .map((s) => clean(s).replace(/\.[a-zA-Z0-9]+$/, ''))
    .filter(Boolean);

  const nameZhHant = clean(row['中文品名']);
  const nameJa = clean(row['日文品名']);

  const note = clean(row['備註']).replace(/\s*\|\s*/g, '｜').slice(0, 260);
  const confidence = num(row['辨識信心']);

  return {
    id: clean(row['商品編號']),
    brand: clean(row['品牌']) || '—',
    nameJa: nameJa || nameZhHant || clean(row['品牌']),
    nameZh: nameZhHant || nameJa,
    nameZhHans: OpenCC(nameZhHant || nameJa),
    category: clean(row['分類']) || '其他',
    variant: clean(row['規格／款式']),
    packText: clean(row['入數標示']),
    sheets,
    discountText: clean(row['折扣標示(原文)']),
    discountPct: num(row['折扣%']),
    priceYen,
    priceYenTaxIn,
    regularPriceYen,
    priceMin,
    priceMax,
    taxNote,
    priceTagStyle: clean(row['價標樣式']),
    storeHint: clean(row['店面線索']),
    photoCount: num(row['照片張數']) || photos.length,
    confidence,
    weightG,
    unitPriceYen: priceYenTaxIn && sheets ? Math.round((priceYenTaxIn / sheets) * 10) / 10 : null,
    twd: priceYenTaxIn == null ? null : Math.round(priceYenTaxIn * JPY_TO_TWD),
    photos,
    photo: photos[0] || null,
    note,
    needsReview: clean(row['相似商品(待複核)']) !== '' || (confidence != null && confidence < 0.6),
  };
});

const meta = {
  generatedAt: new Date().toISOString(),
  count: products.length,
  withPrice: products.filter((p) => p.priceYenTaxIn != null).length,
  jpyToTwd: JPY_TO_TWD,
  sources: fs.existsSync(path.join(root, 'data/source')) ? 'Google 雲端硬碟 日本面膜_商品資料庫_2026-09-30' : '未知',
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify({ meta, products }), 'utf8');

const categories = [...new Set(products.map((p) => p.category))];
console.log(`[build-data] ${products.length} 項商品 -> ${path.relative(root, OUT_JSON)}`);
console.log(`[build-data] 分類：${categories.join('、')}`);

// ---- Excel 重量表（可用 Excel 直接調整係數重算）----
try {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'jp-mask-daigou';

  const ws = wb.addWorksheet('商品重量表');
  ws.columns = [
    { header: '商品編號', key: 'id', width: 10 },
    { header: '分類', key: 'category', width: 10 },
    { header: '品牌', key: 'brand', width: 18 },
    { header: '日文品名', key: 'nameJa', width: 40 },
    { header: '中文品名', key: 'nameZh', width: 30 },
    { header: '入數(枚)', key: 'sheets', width: 10 },
    { header: '每片重量(g)', key: 'perSheet', width: 13 },
    { header: '包裝基準(g)', key: 'base', width: 12 },
    { header: '預估重量(g)', key: 'weightG', width: 13 },
    { header: '特價(日圓)', key: 'priceYen', width: 12 },
    { header: '含稅價(日圓)', key: 'priceYenTaxIn', width: 14 },
    { header: '估算台幣', key: 'twd', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };

  products.forEach((p, i) => {
    const rowIdx = i + 2;
    const base = CATEGORY_BASE_G[p.category] ?? 200;
    const perSheet = PER_SHEET_G[p.category] ?? 0;
    ws.addRow({
      ...p,
      perSheet,
      base,
      sheets: p.sheets ?? '',
    });
    // 預估重量用公式，改係數即可自動重算
    ws.getCell(`I${rowIdx}`).value = {
      formula: `=MAX(30,ROUND(($F${rowIdx}*$G${rowIdx}+$H${rowIdx})/5,0)*5)`,
      result: p.weightG,
    };
  });

  ws.addRow([]);
  const refRow = ws.rowCount + 1;
  ws.getCell(`A${refRow}`).value = '分類基準值(g)';
  Object.entries(CATEGORY_BASE_G).forEach(([k, v], idx) => {
    ws.getCell(refRow + 1 + idx, 1).value = k;
    ws.getCell(refRow + 1 + idx, 2).value = v;
    ws.getCell(refRow + 1 + idx, 3).value = `每片 ${PER_SHEET_G[k] ?? 0} g`;
  });

  const info = wb.addWorksheet('說明');
  info.columns = [
    { header: '項目', key: 'k', width: 22 },
    { header: '說明', key: 'v', width: 90 },
  ];
  info.getRow(1).font = { bold: true };
  [
    ['用途', '本表由 products.csv 產生，用來估算「每一包」的預估重量，網站會自動加總總重並試算運費。'],
    ['預估重量公式', '預估重量(g) = ROUND((入數 x 每片重量 + 包裝基準) / 5) x 5，未滿 30g 以 30g 計。'],
    ['修改方式', '直接改「每片重量(g)」或「包裝基準(g)」欄位即可；若要知道實際影響，把數值貼回 scripts/weight-model.mjs 後執行 npm run build:data。'],
    ['注意', '此重量為估算值，非實秤重量；實際運費與報價一律以客服最後確認為準。'],
    ['匯率', `日圓 -> 新台幣 採用 ${JPY_TO_TWD}（可用環境變數 JPY_TO_TWD 覆寫）。`],
  ].forEach(([k, v]) => info.addRow({ k, v }));

  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true });
  await wb.xlsx.writeFile(OUT_XLSX);
  console.log(`[build-data] Excel 重量表 -> ${path.relative(root, OUT_XLSX)}`);
} catch (err) {
  console.warn('[build-data] 略過 Excel 產生：', err.message);
}
