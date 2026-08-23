const CLUB_HOSTS = new Set(["padelmates.se", "www.padelmates.se"]);

export function validateBookingInput(input, now = new Date()) {
  const errors = [];
  const email = String(input?.email ?? "").trim();
  const password = String(input?.password ?? "");
  const date = String(input?.date ?? "");
  const time = String(input?.time ?? "");
  const courtName = String(input?.courtName ?? "").trim().slice(0, 100);
  const duration = Number(input?.duration);
  const pollIntervalSeconds = Number(input?.pollIntervalSeconds);
  const maxWaitMinutes = Number(input?.maxWaitMinutes);
  const observationDelayMs = Number(input?.observationDelayMs ?? 0);
  const mode = input?.mode === "dry-run" ? "dry-run" : "book";
  const headless = input?.headless !== false;
  const browserChannel = ["chrome", "msedge", "bundled"].includes(input?.browserChannel)
    ? input.browserChannel
    : "chrome";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Enter a valid email address.");
  }
  if (!password) errors.push("Password is required.");

  let clubUrl;
  try {
    clubUrl = new URL(String(input?.clubUrl ?? "").trim());
    if (clubUrl.protocol !== "https:" || !CLUB_HOSTS.has(clubUrl.hostname.toLowerCase())) {
      errors.push("Club URL must use https://padelmates.se.");
    }
    if (!/^\/club\/[^/?#]+\/?$/.test(clubUrl.pathname)) {
      errors.push("Use the specific club page URL (for example https://padelmates.se/club/club-name). ");
    }
    clubUrl.hash = "";
    clubUrl.search = "";
  } catch {
    errors.push("Enter a valid Padel Mates club URL.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    errors.push("Enter a valid date.");
  }
  if (!/^([01]\d|2[0-3]):(00|30)$/.test(time)) {
    errors.push("Start time must be on an hour or half-hour.");
  }
  if (!Number.isInteger(duration) || duration < 30 || duration > 240 || duration % 30 !== 0) {
    errors.push("Duration must be between 30 and 240 minutes in 30-minute steps.");
  }
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 2 || pollIntervalSeconds > 120) {
    errors.push("Refresh interval must be between 2 and 120 seconds.");
  }
  if (!Number.isFinite(maxWaitMinutes) || maxWaitMinutes < 1 || maxWaitMinutes > 1440) {
    errors.push("Maximum wait must be between 1 minute and 24 hours.");
  }
  if (!Number.isInteger(observationDelayMs) || observationDelayMs < 0 || observationDelayMs > 3000) {
    errors.push("Observation delay must be between 0 and 3000 milliseconds.");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(`${date}T00:00:00`);
    const daysAway = Math.round((target - today) / 86_400_000);
    if (daysAway < 0) errors.push("The booking date cannot be in the past.");
    if (daysAway > 60) errors.push("Padel Mates currently exposes at most 60 days of availability.");
  }

  if (mode === "book" && input?.authorized !== true) {
    errors.push("Confirm that you authorize the final booking and charge.");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      email,
      password,
      clubUrl: clubUrl.toString(),
      date,
      time,
      courtName,
      duration,
      pollIntervalSeconds,
      maxWaitMinutes,
      observationDelayMs,
      mode,
      headless,
      browserChannel,
      authorized: mode === "book"
    }
  };
}

export function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder ? `${remainder}m` : "00m"}`;
}
