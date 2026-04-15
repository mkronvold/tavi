const TAVI_LOGO_SVG_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMjAwIDIwMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIHJ4PSI0MCIgcnk9IjQwIiBmaWxsPSIjMjIyMjIyIi8+PGcgZmlsbD0iI0ZGRkZGRiIgZm9udC1mYW1pbHk9InN5c3RlbS11aSwgLWFwcGxlLXN5c3RlbSwgQmxpbmtNYWNTeXN0ZW1Gb250LCAnU2Vnb2UgVUknLCBzYW5zLXNlcmlmIiBmb250LXdlaWdodD0iNzAwIj48dGV4dCB4PSIyOCIgeT0iOTQiIGZvbnQtc2l6ZT0iODgiPlQ8L3RleHQ+PHRleHQgeD0iODQiIHk9Ijk0IiBmb250LXNpemU9IjcyIj7ktIA8L3RleHQ+PHRleHQgeD0iMTQ4IiB5PSI5NCIgZm9udC1zaXplPSI3MiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+LjwvdGV4dD48dGV4dCB4PSI4NCIgeT0iMTU0IiBmb250LXNpemU9IjcyIj7htKA8L3RleHQ+PHRleHQgeD0iMTQ4IiB5PSIxNTQiIGZvbnQtc2l6ZT0iNzIiIHRleHQtYW5jaG9yPSJtaWRkbGUiPsmoPC90ZXh0PjwvZz48L3N2Zz4=';

export function parseSmtpUrl(url: string): {
  host: string;
  port: number;
  secure: boolean;
} {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'smtps:';
  const port = parsed.port ? Number(parsed.port) : secure ? 465 : 25;
  return { host: parsed.hostname, port, secure };
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
          <a href="${homeUrl}" style="text-decoration:none;">
            <img src="data:image/svg+xml;base64,${TAVI_LOGO_SVG_BASE64}" alt="Tavi" width="48" height="48" style="border-radius:10px;" />
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
