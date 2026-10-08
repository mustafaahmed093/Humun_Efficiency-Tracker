import seed from "../../data/schedule.json" with { type: "json" };

export type ScheduleBlock = { id: string; start: string; end: string; name: string; category: string; prayer?: string };
type Raw = [string, string, string, string, string?];

export const planStart = seed.planStart;
export const planEnd = seed.planEnd;
export const categories = seed.categories;

export function getPlanDays(): string[] {
  const [year, month, date] = planStart.split("-").map(Number);
  return Array.from({ length: 15 }, (_, index) => new Date(Date.UTC(year, month - 1, date + index)).toISOString().slice(0, 10));
}

export function planDayForDate(date: Date): string {
  const local = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  if (local.getHours() < 4) local.setDate(local.getDate() - 1);
  const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  return day < planStart ? planStart : day;
}

export function getSchedule(day: string): ScheduleBlock[] {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  let rows: Raw[];
  if (weekday === 2) rows = [...seed.tuesday as Raw[], ...seed.evening as Raw[]];
  else if (weekday === 6) rows = [...seed.saturday as Raw[], ...seed.evening.slice(0, 2) as Raw[], ["21:00", "24:00", "Same, or Meeting, or Badminton", "Family"], ...seed.evening.slice(4) as Raw[]];
  else if (weekday === 4) rows = [...seed.thursday as Raw[], ...seed.evening as Raw[]];
  else rows = seed.typeA as Raw[];
  return rows.map((row, i) => ({ id: `${day}-${i}`, start: row[0], end: row[1], name: row[2], category: row[3], prayer: row[4] }));
}

export function weekdayName(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function formatDay(day: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}
