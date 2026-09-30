import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(root, 'data/source/thumbs');
const OUT_CARD = path.join(root, 'public/img/t');
const OUT_DETAIL = path.join(root, 'public/img/p');

const CARD_WIDTH = 480;
const DETAIL_WIDTH = 1100;

const products = JSON.parse(fs.readFileSync(path.join(root, 'public/data/products.json'), 'utf8')).products;
const ids = [...new Set(products.flatMap((p) => p.photos))].sort();

fs.mkdirSync(OUT_CARD, { recursive: true });
fs.mkdirSync(OUT_DETAIL, { recursive: true });

const jobs = [];
for (const id of ids) {
  const input = path.join(SRC_DIR, `${id}.jpg`);
  if (!fs.existsSync(input)) {
    console.warn(`[build-images] 缺少原圖：${id}.jpg`);
    continue;
  }
  jobs.push({ id, input, out: path.join(OUT_CARD, `${id}.webp`), width: CARD_WIDTH, quality: 72 });
  jobs.push({ id, input, out: path.join(OUT_DETAIL, `${id}.webp`), width: DETAIL_WIDTH, quality: 74 });
}

const fresh = (job) =>
  fs.existsSync(job.out) && fs.statSync(job.out).mtimeMs >= fs.statSync(job.input).mtimeMs;

async function run(job) {
  if (fresh(job)) return 'skip';
  await exec('cwebp', ['-quiet', '-q', String(job.quality), '-resize', String(job.width), '0', '-mt', '-o', job.out, job.input]);
  return 'built';
}

const CONCURRENCY = 6;
let cursor = 0;
const results = { built: 0, skip: 0 };
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      try {
        const r = await run(job);
        results[r] += 1;
      } catch (err) {
        console.error(`[build-images] 失敗 ${job.id}: ${err.message}`);
      }
    }
  }),
);

console.log(`[build-images] 照片 ${ids.length} 張，轉檔 ${results.built}、略過 ${results.skip}`);
