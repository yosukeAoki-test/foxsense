import nodemailer from 'nodemailer';
import config from '../config/index.js';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (!config.email.host || !config.email.user) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  return transporter;
};

export const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  const t = getTransporter();

  if (!t) {
    // SMTP未設定時は開発用にコンソール出力
    console.warn('[Email] SMTP not configured. Password reset URL:', resetUrl);
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#4ade80,#16a34a);padding:32px 40px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">🦊 FoxSense</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">農業環境モニタリング</p>
    </div>
    <div style="padding:40px;">
      <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937;font-weight:700;">パスワードリセット</h2>
      <p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.7;">
        パスワードリセットのリクエストを受け付けました。<br>
        下のボタンをクリックして、新しいパスワードを設定してください。
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#4ade80,#16a34a);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:0.3px;">
          パスワードをリセット
        </a>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:24px 0 0;">
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
          ⏱ このリンクは <strong>1時間</strong> 有効です。<br>
          🔒 このリクエストに心当たりがない場合は、メールを無視してください。<br>
          📎 ボタンが機能しない場合は以下のURLをブラウザにコピーしてください：<br>
          <span style="color:#4b5563;word-break:break-all;font-size:12px;">${resetUrl}</span>
        </p>
      </div>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">© 2025 FoxSense. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  await t.sendMail({
    from: `"FoxSense" <${config.email.from}>`,
    to,
    subject: '【FoxSense】パスワードリセットのご案内',
    html,
  });
};
