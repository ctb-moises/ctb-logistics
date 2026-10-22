// Calendar days in a shop's time zone (IANA name), with Intl only.

const DAY_MS = 24 * 60 * 60 * 1000;

// Wall-clock time in the zone minus UTC, in ms, at an instant.
function zoneOffset(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const wallClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wallClock - Math.floor(instant.getTime() / 1000) * 1000;
}

// "YYYY-MM-DD" of the instant in the zone.
export function dayKey(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

// Midnight (in the zone) of the day the instant falls on.
export function startOfDay(instant: Date, timeZone: string) {
  const [year, month, day] = dayKey(instant, timeZone).split("-").map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  return new Date(midnightUtc - zoneOffset(new Date(midnightUtc), timeZone));
}

// The last `count` days up to today, oldest first, with short labels.
export function lastDays(count: number, timeZone: string, now = new Date()) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
  });
  return Array.from({ length: count }, (_, index) => {
    const instant = new Date(now.getTime() - (count - 1 - index) * DAY_MS);
    return { key: dayKey(instant, timeZone), label: label.format(instant) };
  });
}
