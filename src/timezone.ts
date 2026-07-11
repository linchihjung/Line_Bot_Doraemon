const LOCAL_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseTimezone(input: string | undefined, fallback: string): string {
  const timezone = input?.trim() || fallback;

  if (!isSupportedTimezone(timezone)) {
    throw new Error(`Unsupported timezone: ${timezone}`);
  }

  return timezone;
}

export function toUtcIso(localDateTime: string, timezone: string): string {
  parseTimezone(timezone, timezone);
  const match = LOCAL_DATETIME_PATTERN.exec(localDateTime);

  if (!match) {
    throw new Error(`Invalid local datetime: ${localDateTime}`);
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const requested = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };

  if (!areLocalComponentsInRange(requested)) {
    throw new Error(`Invalid local datetime: ${localDateTime}`);
  }

  const utcGuess = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
    requested.second,
  );
  const firstPass = utcGuess - getTimezoneOffsetMs(new Date(utcGuess), timezone);
  const secondPass = utcGuess - getTimezoneOffsetMs(new Date(firstPass), timezone);
  const resolved = getLocalDateTimeParts(new Date(secondPass), timezone);

  if (!areSameLocalComponents(requested, resolved)) {
    throw new Error(`Invalid local datetime: ${localDateTime}`);
  }

  return new Date(secondPass).toISOString();
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function isSupportedTimezone(timezone: string): boolean {
  if (timezone === "UTC") {
    return true;
  }

  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone").includes(timezone);
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const offsetName = formatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!offsetName || offsetName === "GMT") {
    return 0;
  }

  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName);
  if (!match) {
    throw new Error(`Could not determine timezone offset for ${timezone}`);
  }

  const [, sign, hours, minutes = "00"] = match;
  const offsetMs = (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
  return sign === "+" ? offsetMs : -offsetMs;
}

function areLocalComponentsInRange(parts: LocalDateTimeParts): boolean {
  return (
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= 31 &&
    parts.hour >= 0 &&
    parts.hour <= 23 &&
    parts.minute >= 0 &&
    parts.minute <= 59 &&
    parts.second >= 0 &&
    parts.second <= 59
  );
}

function getLocalDateTimeParts(date: Date, timezone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function areSameLocalComponents(
  expected: LocalDateTimeParts,
  actual: LocalDateTimeParts,
): boolean {
  return (
    expected.year === actual.year &&
    expected.month === actual.month &&
    expected.day === actual.day &&
    expected.hour === actual.hour &&
    expected.minute === actual.minute &&
    expected.second === actual.second
  );
}
