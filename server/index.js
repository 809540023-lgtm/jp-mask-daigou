import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildEmail, normalizeOrder, validateOrder, SHIPPING } from './order.js';
import { deliver, orderTo, smtpConfig } from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(root, 'public');
const ORDER_LOG_DIR = process.env.ORDER_LOG_DIR || path.join(root, 'data');
const ORDER_LOG = path.join(ORDER_LOG_DIR, 'orders.jsonl');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '512kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self' https://formsubmit.co",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  );
  next();
});

/* ---- 簡易流量限制（每個 IP 每 10 分鐘 20 筆）---- */
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 20;
function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((ts) => now - ts < WINDOW_MS);
  if (list.length >= MAX_HITS) {
    return res.status(429).json({ ok: false, error: '送出過於頻繁，請稍後再試或直接來信客服信箱。' });
  }
  list.push(now);
  hits.set(ip, list);
  return next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    const kept = list.filter((ts) => now - ts < WINDOW_MS);
    if (kept.length) hits.set(ip, kept);
    else hits.delete(ip);
  }
}, WINDOW_MS).unref();

/* ---- 訂單紀錄（Render 免費方案為暫時性檔案，僅供除錯）---- */
function appendOrder(order, result) {
  try {
    fs.mkdirSync(ORDER_LOG_DIR, { recursive: true });
    fs.appendFileSync(
      ORDER_LOG,
      `${JSON.stringify({ at: new Date().toISOString(), transport: result && result.transport, order })}\n`,
      'utf8',
    );
  } catch (err) {
    console.error('[order] 無法寫入訂單紀錄：', err.message);
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    smtp: Boolean(smtpConfig()),
    orderTo: orderTo(),
    shipping: SHIPPING,
    uptime: Math.round(process.uptime()),
  });
});

app.post('/api/order', rateLimit, async (req, res) => {
  const errors = validateOrder(req.body);
  if (errors.length) {
    return res.status(400).json({ ok: false, error: errors.join('；'), errors });
  }

  const order = normalizeOrder(req.body);
  const mail = buildEmail(order, orderTo());
  if (order.customer.email) mail.replyTo = order.customer.email;

  try {
    const result = await deliver(mail);
    appendOrder(order, result);
    console.log(`[order] ${order.ref} 已送出（${result.transport}）${order.customer.name} / ${order.items.length} 項`);
    return res.json({ ok: true, ref: order.ref, transport: result.transport, totals: order.totals });
  } catch (err) {
    console.error(`[order] ${order.ref} 寄送失敗：`, err.message);
    appendOrder(order, { transport: 'failed', error: err.message });
    return res.status(502).json({
      ok: false,
      error: '客服信箱暫時無法寄送，請稍後再試或直接來信 cia8885@gmail.com。',
      details: err.message,
    });
  }
});

/* ---- 靜態網站 ---- */
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\/data\/products\.json$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=300');
      } else if (/\/img\//.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    },
  }),
);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not found' });
  return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err) res.type('text/plain').send('404 Not Found');
  });
});

const server = app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] 訂單收件信箱：${orderTo()}`);
  console.log(`[server] SMTP：${smtpConfig() ? '已設定' : '未設定（將使用 FormSubmit 代理寄送）'}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[server] ${sig} -> 關閉中`);
    server.close(() => process.exit(0));
  });
}
