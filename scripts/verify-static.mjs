/**
 * Render 靜態站台建置時執行：
 * 1. 確認靜態檔案與商品資料都在
 * 2. 重新產生 products.json（圖片已在版控中，不重新轉檔）
 * 3. 基本檢查：商品數、預估重量、圖片檔存在
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['public/index.html', 'public/css/style.css', 'public/js/app.js', 'public/js/i18n.js', 'data/source/products.csv'];

const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.error(`[verify-static] 缺少必要檔案：${missing.join(', ')}`);
  process.exit(1);
}

execFileSync(process.execPath, [path.join(root, 'scripts/build-data.mjs')], { stdio: 'inherit' });

const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/products.json'), 'utf8'));
const products = data.products || [];
if (products.length < 100) {
  console.error(`[verify-static] 商品數量異常：${products.length}`);
  process.exit(1);
}

const withoutPhoto = products.filter((p) => !p.photo || !fs.existsSync(path.join(root, 'public/img/t', `${p.photo}.webp`)));
if (withoutPhoto.length > products.length * 0.1) {
  console.error(`[verify-static] 圖片缺漏過多：${withoutPhoto.length} 件商品沒有對應圖片`);
  process.exit(1);
}

const totalWeight = products.reduce((sum, p) => sum + (p.weightG || 0), 0);
console.log(
  `[verify-static] OK：${products.length} 項商品、有標價 ${products.filter((p) => p.priceYenTaxIn != null).length} 項、` +
    `平均預估重量 ${Math.round(totalWeight / products.length)} g、缺圖 ${withoutPhoto.length} 項`,
);
