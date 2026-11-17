export type RecurrenceRule = {
  frequency: "weekly" | "custom";
  weekdays: number[];
  customDates: string[];
  endDate: string | null;
};

export function getPlannerDurationMinutes(startDate: string, startTime: string | null, endDate: string, endTime: string | null) {
  if (!startTime || !endTime) return 0;
  const startDay = dayNumber(startDate);
  const finishDay = dayNumber(endDate);
  if (startDay === null || finishDay === null || finishDay < startDay) return null;
  const start = startTime === "24:00" ? 1440 : Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const end = endTime === "24:00" ? 1440 : Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
  let minutes = (finishDay - startDay) * 1440 + end - start;
  if (finishDay === startDay && minutes <= 0) minutes += 1440;
  return minutes > 0 && minutes <= 1440 ? minutes : null;
}

function dayNumber(date: string) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 86_400_000);
}

function fromDayNumber(day: number) {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addPlannerDays(date: string, days: number) {
  const day = dayNumber(date);
  return day === null ? null : fromDayNumber(day + days);
}

export function plannerWeekday(date: string) {
  const day = dayNumber(date);
  return day === null ? null : new Date(day * 86_400_000).getUTCDay();
}

export function getPlannerWeekDates(date: string, weekStartsOn = 1) {
  const weekday = plannerWeekday(date);
  if (weekday === null) return [];
  const offset = (weekday - weekStartsOn + 7) % 7;
  const start = addPlannerDays(date, -offset);
  if (!start) return [];
  return Array.from({ length: 7 }, (_, index) => addPlannerDays(start, index)).filter((day): day is string => day !== null);
}

export function recurrenceIncludesDate(startDate: string, date: string, rule: RecurrenceRule) {
  if (date < startDate || (rule.endDate && date > rule.endDate)) return false;
  if (rule.frequency === "custom") return rule.customDates.includes(date);
  const weekday = plannerWeekday(date);
  return weekday !== null && rule.weekdays.includes(weekday);
}

export function enumerateRecurrenceDates(startDate: string, rule: RecurrenceRule, throughDate: string) {
  if (startDate > throughDate) return [];
  const endDate = rule.endDate && rule.endDate < throughDate ? rule.endDate : throughDate;
  if (rule.frequency === "custom") {
    return [...new Set(rule.customDates)]
      .filter(date => date >= startDate && date <= endDate)
      .sort();
  }
  const dates: string[] = [];
  for (let day = dayNumber(startDate), end = dayNumber(endDate); day !== null && end !== null && day <= end; day++) {
    const date = fromDayNumber(day);
    if (recurrenceIncludesDate(startDate, date, rule)) dates.push(date);
  }
  return dates;
}
