export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function getLocalTimeZoneLabel() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZoneName = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;

  if (timeZone && timeZoneName && timeZone !== timeZoneName) {
    return `${timeZone} · ${timeZoneName}`;
  }

  return timeZone ?? timeZoneName ?? "local time";
}

export function utcTimeToLocalTime(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  const date = new Date();

  date.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);

  return toTimeInputValue(date.getHours(), date.getMinutes());
}

export function localTimeToUtcTime(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  const date = new Date();

  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);

  return toTimeInputValue(date.getUTCHours(), date.getUTCMinutes());
}

function toTimeInputValue(hours: number, minutes: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
