import assert from "node:assert/strict";
import test from "node:test";
import { getSchedule, planDayForDate } from "../src/lib/schedule.ts";
import { getReviewWindow } from "../src/lib/review-time.ts";
import { calculateScores } from "../src/lib/scoring.ts";
import {
  calculateAvoidanceMetrics,
  calculateGoalMetrics,
  findScheduleConflicts,
  hasGoalDependencyCycle,
} from "../src/lib/life-system.ts";

test("selects the fixed schedule for each weekday type", () => {
  assert.match(getSchedule("2026-10-09")[0].name, /Bath/); // Friday · A
  assert.match(getSchedule("2026-10-13")[0].name, /Bath \+ Nashta/); // Tuesday
  assert.match(getSchedule("2026-10-15")[0].name, /Nashta \+ get ready/); // Thursday
  assert.ok(getSchedule("2026-10-17").some(block => block.name === "Same, or Meeting, or Badminton")); // Saturday
});

test("assigns 00:00–03:59 Karachi clock times to the previous plan day", () => {
  assert.equal(planDayForDate(new Date("2026-10-09T19:00:00.000Z")), "2026-10-09"); // 00:00 PKT, first plan day
  assert.equal(planDayForDate(new Date("2026-10-09T22:59:00.000Z")), "2026-10-09"); // 03:59 PKT
  assert.equal(planDayForDate(new Date("2026-10-09T23:00:00.000Z")), "2026-10-10"); // 04:00 PKT
  assert.equal(planDayForDate(new Date("2026-11-11T12:00:00.000Z")), "2026-10-23"); // After the plan ends
});

test("enforces the nightly review window using Asia/Karachi server time", () => {
  const at = (utc: string, lateEntry = false) => getReviewWindow(new Date(utc), lateEntry);
  assert.equal(at("2026-10-09T19:29:00Z").open, false); // 00:29 PKT
  assert.equal(at("2026-10-09T19:30:00Z").open, true); // 00:30 PKT
  assert.equal(at("2026-10-09T19:59:59Z").open, true); // 00:59:59 PKT
  assert.equal(at("2026-10-09T20:00:00Z").open, false); // 01:00 PKT
  assert.equal(at("2026-10-09T20:01:00Z").open, false); // 01:01 PKT
  assert.equal(at("2026-10-09T21:00:00Z", true).open, true); // 02:00 PKT with late entry on
  assert.equal(at("2026-10-09T22:00:00Z", true).open, false); // 03:00 PKT
  assert.equal(at("2026-10-09T19:30:00Z").targetDay, "2026-10-09");
});

test("scores a fully completed day at 100 across all six dimensions", () => {
  const blocks = [
    { category: "Business", name: "Medspa agency outreach", status: "done" as const },
    { category: "Startup", name: "Startup work", status: "done" as const },
    { category: "Health", name: "Exercise", status: "done" as const },
    { category: "Health", name: "Meditation / Walk", status: "done" as const },
    { category: "Religious", name: "Fajr: Namaz + Surah Yaseen", status: "done" as const },
    { category: "Religious", name: "Dr Nauman Ali Khan lecture", status: "done" as const },
  ];
  const answers = {
    prayers: { Fajr: true, Zohr: true, Asr: true, Maghrib: true, Isha: true }, dailyLecture: true,
    outboundLeads: 20, medspaLeads: 37, linkedinSent: 15,
    exerciseDone: true, walkDone: true, sleepHours: 8, meals: ["Breakfast", "Lunch", "Dinner"],
    mood: "Productive" as const, stress: "Nahi" as const, overthinkingCount: 0, focusRating: 10,
  };
  assert.deepEqual(calculateScores(answers, blocks), { business: 100, health: 100, mental: 100, focus: 100, religious: 100, overall: 100 });
});

test("caps the overthinking score at zero after five entries", () => {
  const scores = calculateScores({ mood: "Productive", stress: "Nahi", overthinkingCount: 8 }, []);
  assert.equal(scores.mental, 67);
});

test("goal metrics count only recorded commitments and calculate progress", () => {
  const metrics = calculateGoalMetrics(
    { status: "active", start_date: "2026-01-01", target_date: "2026-01-11", target_value: 100, current_value: 40 },
    [
      { checkin_date: "2026-01-02", hours: 1.5, output_value: 20, target_met: 1 },
      { checkin_date: "2026-01-05", hours: 2, output_value: 40, target_met: 0 },
      { checkin_date: "2026-01-06", hours: 0.5, output_value: null, target_met: null },
    ],
    "2026-01-06",
  );
  assert.equal(metrics.outcomeProgress, 40);
  assert.equal(metrics.executionConsistency, 50);
  assert.equal(metrics.eligibleCommitments, 2);
  assert.equal(metrics.totalHours, 4);
  assert.equal(metrics.remainingDays, 5);
  assert.equal(metrics.estimatedCompletionDate, "2026-01-15");
});

test("avoidance metrics break streaks at slips and untracked gaps", () => {
  const metrics = calculateAvoidanceMetrics([
    { checkin_date: "2026-01-01", outcome: "avoided", urges: 0 },
    { checkin_date: "2026-01-02", outcome: "urge_resisted", urges: 2 },
    { checkin_date: "2026-01-03", outcome: "slip", urges: 0 },
    { checkin_date: "2026-01-05", outcome: "avoided", urges: 0 },
  ], "2026-01-05");
  assert.equal(metrics.currentStreak, 1);
  assert.equal(metrics.longestStreak, 2);
  assert.equal(metrics.trackedDays, 4);
  assert.equal(metrics.consistency, 75);
  assert.equal(metrics.totalUrgesResisted, 2);
  assert.equal(metrics.lastOccurrence, "2026-01-03");
  assert.equal(metrics.daysSinceOccurrence, 2);
  assert.equal(calculateAvoidanceMetrics([
    { checkin_date: "2026-01-04", outcome: "avoided", urges: 0 },
  ], "2026-01-05").currentStreak, 0);
  assert.equal(calculateAvoidanceMetrics([
    { checkin_date: "2026-01-03", outcome: "slip", urges: 0 },
  ], "2026-01-05").daysSinceOccurrence, 2);
});

test("detects same-day and overnight schedule overlaps", () => {
  const conflicts = findScheduleConflicts([
    { id: "overnight", start_time: "23:00", end_time: "01:00" },
    { id: "early", start_time: "00:30", end_time: "02:00" },
    { id: "separate", start_time: "09:00", end_time: "10:00" },
    { id: "overlap", start_time: "09:30", end_time: "10:30" },
  ]);
  assert.deepEqual(conflicts, [
    { first: "overnight", second: "early" },
    { first: "separate", second: "overlap" },
  ]);
});

test("detects dependency cycles without rejecting unrelated dependencies", () => {
  const edges = [
    { goal_id: "a", depends_on_goal_id: "b" },
    { goal_id: "b", depends_on_goal_id: "c" },
  ];
  assert.equal(hasGoalDependencyCycle(edges, "c", "a"), true);
  assert.equal(hasGoalDependencyCycle(edges, "a", "c"), false);
  assert.equal(hasGoalDependencyCycle(edges, "a", "a"), true);
});
