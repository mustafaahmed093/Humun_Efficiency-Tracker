export const REVIEW_ZONE = "Asia/Karachi";

function parts(date: Date) {
  const result = new Intl.DateTimeFormat("en-CA", {
    timeZone: REVIEW_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(result.map(part => [part.type, part.value]));
}

export function karachiDate(date: Date) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function reviewDayForNow(date: Date) {
  const p = parts(date);
  const previous = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) - 1));
  return previous.toISOString().slice(0, 10);
}

export type ReviewWindow = { open: boolean; late: boolean; targetDay: string; serverNow: string; opensAt: string; closesAt: string };
export function getReviewWindow(now: Date, lateEntryEnabled = false): ReviewWindow {
  const p = parts(now);
  const minute = Number(p.hour) * 60 + Number(p.minute);
  const normal = minute >= 30 && minute < 60;
  const late = !normal && minute >= 60 && minute < 180 && lateEntryEnabled;
  const targetDay = minute >= 60 && (!lateEntryEnabled || minute >= 180)
    ? `${p.year}-${p.month}-${p.day}`
    : reviewDayForNow(now);
  const [targetYear, targetMonth, targetDate] = targetDay.split("-").map(Number);
  const windowDate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDate + 1)).toISOString().slice(0, 10);
  return {
    open: normal || late,
    late,
    targetDay,
    serverNow: now.toISOString(),
    opensAt: `${windowDate}T00:30:00+05:00`,
    closesAt: `${windowDate}T01:00:00+05:00`,
  };
}
