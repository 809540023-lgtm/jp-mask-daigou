import nodemailer from 'nodemailer';

export function smtpConfig(env = process.env) {
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT || 587);
    return {
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    };
  }
  if (env.GMAIL_USER && (env.GMAIL_APP_PASSWORD || env.GMAIL_PASS)) {
    return {
      service: 'gmail',
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD || env.GMAIL_PASS },
    };
  }
  return null;
}

export function mailFrom(env = process.env) {
  if (env.MAIL_FROM) return env.MAIL_FROM;
  const user = env.SMTP_USER || env.GMAIL_USER;
  return user ? `日本嚴選代購 <${user}>` : '日本嚴選代購 <no-reply@localhost>';
}

export function orderTo(env = process.env) {
  return env.ORDER_TO || 'cia8885@gmail.com';
}

export async function sendViaSmtp(mail, env = process.env) {
  const conf = smtpConfig(env);
  if (!conf) throw new Error('SMTP 未設定');
  const transporter = nodemailer.createTransport(conf);
  const info = await transporter.sendMail({
    from: mailFrom(env),
    to: mail.to,
    replyTo: mail.replyTo || undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return { transport: 'smtp', id: info.messageId };
}

export async function sendViaFormSubmit(mail, env = process.env) {
  const endpoint = env.FORMSUBMIT_ENDPOINT || `https://formsubmit.co/ajax/${mail.to}`;
  const body = {
    _subject: mail.subject,
    _template: 'table',
    _captcha: 'false',
    需求內容: mail.text,
    html: mail.html,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`FormSubmit HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { transport: 'formsubmit', id: mail.subject, raw: text.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** 依可用設定依序嘗試：SMTP -> FormSubmit 代理 -> 失敗 */
export async function deliver(mail, env = process.env) {
  const attempts = [];
  if (smtpConfig(env)) {
    try {
      return await sendViaSmtp(mail, env);
    } catch (err) {
      attempts.push({ transport: 'smtp', error: err.message });
    }
  } else {
    attempts.push({ transport: 'smtp', error: '未設定 SMTP 憑證' });
  }

  try {
    const r = await sendViaFormSubmit(mail, env);
    return { ...r, attempts };
  } catch (err) {
    attempts.push({ transport: 'formsubmit', error: err.message });
  }

  const error = new Error(`所有寄信管道皆失敗：${attempts.map((a) => `${a.transport}(${a.error})`).join('; ')}`);
  error.attempts = attempts;
  throw error;
}
