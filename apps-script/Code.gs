/**
 * 日本嚴選代購 — 訂單收件 Apps Script
 *
 * 功能：
 *   1. 把每一筆訂單寫進 Google 試算表（首批代購原始客戶名單 / 永久紀錄）
 *   2. 用你自己的 Gmail 把訂單寄到 RECIPIENT 指定的信箱
 *
 * 不需要任何 API key、密碼或第三方服務。
 *
 * 設定方式請見同資料夾的 README.md。
 */

const RECIPIENT = 'cia8885@gmail.com'; // 訂單收件信箱
const SHEET_NAME = '代購訂單';
const SENDER_NAME = '日本嚴選代購';

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: '系統忙碌，請稍後再試' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: '沒有收到資料' });
    }

    const order = JSON.parse(e.postData.contents);
    if (!order || !order.customer) {
      return json({ ok: false, error: '資料格式不正確' });
    }

    logToSheet_(order);

    const subject =
      order.emailSubject ||
      '【日本嚴選代購】新代購需求 ' + (order.ref || '') + ' — ' + (order.customer.name || '');

    MailApp.sendEmail({
      to: RECIPIENT,
      subject: subject,
      body: order.plainText || JSON.stringify(order, null, 2),
      htmlBody: order.htmlBody || undefined,
      name: SENDER_NAME,
      replyTo: order.customer.email || RECIPIENT,
    });

    return json({ ok: true, ref: order.ref || '' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json({ ok: true, message: '日本嚴選代購訂單端點運作中', recipient: RECIPIENT });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function logToSheet_(order) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      '時間',
      '需求編號',
      '姓名',
      '電話',
      '台灣收貨地址',
      'Email',
      '商品明細',
      '件數',
      '預估總重(g)',
      '計費重量(kg)',
      '預估運費',
      '代購服務費',
      '預估總額',
      '備註',
    ]);
    sheet.getRange('A1:N1').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const c = order.customer || {};
  const t = order.totals || {};
  const items = (order.items || [])
    .map(function (i) {
      return (
        i.name + '（' + i.id + '） x' + i.qty + '　' +
        (i.unitYen == null ? '待報價' : '¥' + i.unitYen) + '　' + i.weightG * i.qty + 'g'
      );
    })
    .join('\n');

  sheet.appendRow([
    new Date(),
    order.ref || '',
    c.name || '',
    c.phone || '',
    c.address || '',
    c.email || '',
    items,
    t.count || 0,
    t.weightG || 0,
    t.billedKg || 0,
    'NT$' + (t.shippingTwd || 0),
    '免費（首批原始客戶）',
    'NT$' + (t.totalTwd || 0),
    c.note || '',
  ]);
}
