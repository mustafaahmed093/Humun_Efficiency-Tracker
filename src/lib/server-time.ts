import { planDayForDate } from "@/lib/schedule";

const clockState = globalThis as typeof globalThis & { commandSimulatedNow?: Date | null };
export function devToolsEnabled() {
  return process.env.NODE_ENV === "development" || process.env.DEV_TOOLS === "true";
}
export function setSimulatedNow(value: string | null) {
  clockState.commandSimulatedNow = value ? new Date(value) : null;
}
export function effectiveServerNow() {
  if (devToolsEnabled() && clockState.commandSimulatedNow && !Number.isNaN(clockState.commandSimulatedNow.getTime())) return clockState.commandSimulatedNow;
  return new Date();
}
export function effectivePlanDay() {
  return planDayForDate(effectiveServerNow());
}
