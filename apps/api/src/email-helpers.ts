export function parseSmtpUrl(url: string): {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
} {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'smtps:';
  const port = parsed.port ? Number(parsed.port) : secure ? 465 : 25;
  const user = decodeURIComponent(parsed.username);
  const pass = decodeURIComponent(parsed.password);
  const base = {
    host: parsed.hostname,
    port,
    secure,
  };
  return user || pass ? { ...base, auth: { user, pass } } : base;
}

export function buildEmailHtml(
  homeUrl: string,
  recipientName: string,
  bodyHtml: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#0b1220;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b1220;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:16px;border:1px solid #243247;max-width:520px;width:100%;">
        <tr><td align="center" style="padding:28px 24px 16px;">
          <a href="${homeUrl}" aria-label="Tavi home" style="display:inline-block;padding:10px 14px;border-radius:10px;background-color:#222222;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.02em;line-height:1;text-decoration:none;">
            Tavi
          </a>
        </td></tr>
        <tr><td style="padding:0 32px 8px;color:#e2e8f0;font-size:18px;font-weight:600;">
          Hi ${recipientName},
        </td></tr>
        <tr><td style="padding:0 32px 24px;color:#cbd5e1;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 32px 24px;color:#64748b;font-size:13px;border-top:1px solid #243247;">
          This is an automated message from <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
