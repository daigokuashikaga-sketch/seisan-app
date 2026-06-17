import nodemailer from "nodemailer"

export function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  const from = process.env.SMTP_FROM ?? `精算アプリ <${process.env.SMTP_USER}>`
  const transporter = createTransporter()
  await transporter.sendMail({
    from,
    to,
    subject: "【精算アプリ】パスワードリセット",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#6366F1">パスワードリセット</h2>
        <p>${name} さん、こんにちは。</p>
        <p>パスワードリセットのリクエストを受け付けました。<br>以下のボタンをクリックしてパスワードを再設定してください。</p>
        <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#6366F1;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
          パスワードをリセット
        </a>
        <p style="color:#64748B;font-size:13px;">このリンクは1時間で無効になります。<br>心当たりがない場合は無視してください。</p>
      </div>
    `,
  })
}
