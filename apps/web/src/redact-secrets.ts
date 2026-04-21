const SMTP_URL_PASSWORD_PATTERN = /\b(smtps?:\/\/)([^/\s:@]+):([^@\s/]*)@/gi;

export function maskSmtpPassword(value: string) {
  return value.replace(
    SMTP_URL_PASSWORD_PATTERN,
    (_match, protocol: string, user: string) => `${protocol}${user}:***@`,
  );
}
