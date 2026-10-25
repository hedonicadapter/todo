// Recurrence rules: RRULE subset stored as text, e.g. "FREQ=DAILY;INTERVAL=2".
// All date math is on calendar days (YYYY-MM-DD) in UTC; due has no time of day.

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export interface Rule {
  freq: Freq;
  interval: number;
  byday?: number[]; // 0=Sun … 6=Sat, WEEKLY only
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseRule(s: string | undefined | null): Rule | null {
  if (!s) return null;
  const kv = new Map<string, string>();
  for (const part of s.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) kv.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = kv.get("FREQ") as Freq | undefined;
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = Math.max(1, Math.floor(Number(kv.get("INTERVAL") ?? 1)) || 1);
  const rule: Rule = { freq, interval };
  const byday = kv.get("BYDAY");
  if (freq === "WEEKLY" && byday) {
    const days = byday
      .split(",")
      .map((d) => DAYS.indexOf(d))
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);
    if (days.length) rule.byday = days;
  }
  return rule;
}

export function formatRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.map((d) => DAYS[d]).join(",")}`);
  return parts.join(";");
}

// Presets shown in the UI. value = stored string.
export const PRESETS: { value: string; label: string }[] = [
  { value: "", label: "no repeat" },
  { value: "FREQ=DAILY", label: "daily" },
  { value: "FREQ=DAILY;INTERVAL=2", label: "every other day" },
  { value: "FREQ=DAILY;INTERVAL=3", label: "every 3 days" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "weekdays" },
  { value: "FREQ=WEEKLY", label: "weekly" },
  { value: "FREQ=WEEKLY;INTERVAL=2", label: "every 2 weeks" },
  { value: "FREQ=MONTHLY", label: "monthly" },
  { value: "FREQ=MONTHLY;INTERVAL=3", label: "every 3 months" },
  { value: "FREQ=YEARLY", label: "yearly" },
];

export function describeRule(s: string): string {
  const preset = PRESETS.find((p) => p.value === s);
  if (preset) return preset.label;
  const r = parseRule(s);
  if (!r) return "";
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[r.freq];
  const every = r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`;
  return r.byday ? `${every} on ${r.byday.map((d) => DAYS[d]!.toLowerCase()).join(",")}` : every;
}

// --- day arithmetic (UTC) ---

export function parseDay(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return formatDay(new Date());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

// Add months, clamping day-of-month (Jan 31 + 1 → Feb 28/29).
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

// Days between two YYYY-MM-DD (b - a).
export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

// Next occurrence strictly after `from` (YYYY-MM-DD or PB datetime).
export function nextOccurrence(from: string, rule: Rule): string {
  const d = parseDay(from);
  switch (rule.freq) {
    case "DAILY":
      return formatDay(addDays(d, rule.interval));
    case "WEEKLY": {
      if (!rule.byday) return formatDay(addDays(d, 7 * rule.interval));
      // Next listed weekday after d; crossing a week boundary skips (interval-1) weeks.
      const dow = d.getUTCDay();
      const later = rule.byday.find((x) => x > dow);
      if (later !== undefined) return formatDay(addDays(d, later - dow));
      const first = rule.byday[0]!;
      return formatDay(addDays(d, 7 * rule.interval - dow + first));
    }
    case "MONTHLY":
      return formatDay(addMonths(d, rule.interval));
    case "YEARLY":
      return formatDay(addMonths(d, 12 * rule.interval));
  }
}

// Human label for how late a due date is. "" when not late.
export function lateLabel(due: string, now = today()): string {
  if (!due) return "";
  const n = diffDays(due.slice(0, 10), now);
  if (n <= 0) return "";
  if (n === 1) return "1 day late";
  if (n < 14) return `${n} days late`;
  if (n < 60) return `${Math.floor(n / 7)} weeks late`;
  return `${Math.floor(n / 30)} months late`;
}
