import assert from "node:assert/strict";
import test from "node:test";
import { getSchedule, planDayForDate } from "../src/lib/schedule.ts";
import { getReviewWindow } from "../src/lib/review-time.ts";
import { calculateScores } from "../src/lib/scoring.ts";

test("selects the fixed schedule for each weekday type", () => {
  assert.match(getSchedule("2026-10-07")[0].name, /Bath/); // Wednesday · A
  assert.match(getSchedule("2026-10-13")[0].name, /Bath \+ Nashta/); // Tuesday
  assert.match(getSchedule("2026-10-08")[0].name, /Nashta \+ get ready/); // Thursday
  assert.ok(getSchedule("2026-10-10").some(block => block.name === "Same, or Meeting, or Badminton")); // Saturday
});

test("assigns 00:00–03:59 Karachi clock times to the previous plan day", () => {
  assert.equal(planDayForDate(new Date("2026-10-07T19:00:00.000Z")), "2026-10-07"); // 00:00 PKT
  assert.equal(planDayForDate(new Date("2026-10-07T22:59:00.000Z")), "2026-10-07"); // 03:59 PKT
  assert.equal(planDayForDate(new Date("2026-10-07T23:00:00.000Z")), "2026-10-08"); // 04:00 PKT
});

test("enforces the nightly review window using Asia/Karachi server time", () => {
  const at = (utc: string, lateEntry = false) => getReviewWindow(new Date(utc), lateEntry);
  assert.equal(at("2026-10-07T19:29:00Z").open, false); // 00:29 PKT
  assert.equal(at("2026-10-07T19:30:00Z").open, true); // 00:30 PKT
  assert.equal(at("2026-10-07T19:59:59Z").open, true); // 00:59:59 PKT
  assert.equal(at("2026-10-07T20:00:00Z").open, false); // 01:00 PKT
  assert.equal(at("2026-10-07T20:01:00Z").open, false); // 01:01 PKT
  assert.equal(at("2026-10-07T21:00:00Z", true).open, true); // 02:00 PKT with late entry on
  assert.equal(at("2026-10-07T22:00:00Z", true).open, false); // 03:00 PKT
  assert.equal(at("2026-10-07T19:30:00Z").targetDay, "2026-10-07");
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
