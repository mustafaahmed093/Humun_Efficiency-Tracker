import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { addPlannerDays, enumerateRecurrenceDates, recurrenceIncludesDate, type RecurrenceRule } from "@/lib/planner";
import { query, transaction } from "@/lib/db";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Activity = {
  id: string;
  plan_date: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  category: string;
  priority: string;
  goal_id: string | null;
  milestone_id: string | null;
  status: string;
  data_json: string;
  position: number;
};
type Rule = RecurrenceRule & {
  template: Omit<Activity, "id" | "plan_date" | "status" | "data_json" | "position"> & { data: Record<string, unknown> };
  excludedDates: string[];
};
type RecurrenceRow = { id: string; start_date: string; end_date: string | null; rule_json: string; active: number };

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function karachiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(effectiveServerNow());
}

function parseRule(ruleJson: string): Rule {
  return JSON.parse(ruleJson) as Rule;
}

function activityData(activity: Activity) {
  return JSON.parse(activity.data_json) as Record<string, unknown>;
}

async function insertOccurrence(
  client: { query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> },
  date: string,
  recurrenceId: string,
  rule: Rule,
  now: string,
) {
  const existing = (await client.query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position", [date])).rows;
  const matching = existing.find(activity => activity.title === rule.template.title &&
    activity.start_time === rule.template.start_time && activity.end_time === rule.template.end_time &&
    activity.goal_id === rule.template.goal_id);
  if (matching) {
    const data = activityData(matching);
    await client.query("UPDATE daily_activities SET data_json=$1,updated_at=$2 WHERE id=$3",
      [JSON.stringify({ ...data, recurrenceId }), now, matching.id]);
    return false;
  }
  const position = existing.reduce((max, activity) => Math.max(max, activity.position), -1) + 1;
  await client.query("INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,'recurring','{}',$2,$2) ON CONFLICT(plan_date) DO NOTHING", [date, now]);
  await client.query(`INSERT INTO daily_activities
    (id,plan_date,title,start_time,end_time,category,priority,goal_id,milestone_id,status,data_json,position,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',$10,$11,$12,$12)`,
  [randomUUID(), date, rule.template.title, rule.template.start_time, rule.template.end_time, rule.template.category,
    rule.template.priority, rule.template.goal_id, rule.template.milestone_id,
    JSON.stringify({ ...rule.template.data, recurrenceId, recurrenceEndDate: rule.endDate }), position, now]);
  return true;
}

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date");
  if (!validDate(date)) return NextResponse.json({ error: "A valid plan date is required." }, { status: 400 });
  const rules = (await query<RecurrenceRow>(
    "SELECT * FROM planner_recurrences WHERE active=1 AND start_date<=$1 AND (end_date IS NULL OR end_date>=$1)", [date])).rows;
  const pending: { recurrenceId: string; date: string; title: string; existing: { id: string; title: string }[] }[] = [];
  for (const row of rules) {
    const rule = parseRule(row.rule_json);
    if (!recurrenceIncludesDate(row.start_date, date, rule) || rule.excludedDates.includes(date)) continue;
    const existing = (await query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position", [date])).rows;
    if (existing.some(activity => activityData(activity).recurrenceId === row.id)) continue;
    if (date < karachiToday()) continue;
    if (existing.length) {
      pending.push({ recurrenceId: row.id, date, title: rule.template.title, existing: existing.map(({ id, title }) => ({ id, title })) });
      continue;
    }
    await transaction(client => insertOccurrence(client, date, row.id, rule, effectiveServerNow().toISOString()));
  }
  return NextResponse.json({ pending });
}

export async function POST(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid recurrence request." }, { status: 400 });

  if (body.action === "create") {
    const sourceId = typeof body.activityId === "string" ? body.activityId : "";
    const source = (await query<Activity>("SELECT * FROM daily_activities WHERE id=$1", [sourceId])).rows[0];
    if (!source) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
    if (source.plan_date < karachiToday()) return NextResponse.json({ error: "Recurring schedules can only start today or in the future." }, { status: 400 });
    const frequency = body.frequency;
    if (frequency !== "weekly" && frequency !== "custom") return NextResponse.json({ error: "Choose weekly or custom dates." }, { status: 400 });
    if (body.endDate !== null && body.endDate !== undefined && !validDate(body.endDate)) return NextResponse.json({ error: "Invalid recurrence end date." }, { status: 400 });
    const endDate = typeof body.endDate === "string" ? body.endDate : null;
    if (endDate && endDate < source.plan_date) return NextResponse.json({ error: "The recurrence end date must be on or after the selected date." }, { status: 400 });
    const customDates = Array.isArray(body.customDates) ? [...new Set(body.customDates.filter(validDate))].sort() : [];
    if (frequency === "custom" && !customDates.some(date => date > source.plan_date && (!endDate || date <= endDate))) {
      return NextResponse.json({ error: "Choose at least one future custom date." }, { status: 400 });
    }
    const weekdays = frequency === "weekly" ? [new Date(`${source.plan_date}T00:00:00Z`).getUTCDay()] : [];
    const rule: Rule = {
      frequency,
      weekdays,
      customDates,
      endDate,
      excludedDates: [],
      template: {
        title: source.title,
        start_time: source.start_time,
        end_time: source.end_time,
        category: source.category,
        priority: source.priority,
        goal_id: source.goal_id,
        milestone_id: source.milestone_id,
        data: activityData(source),
      },
    };
    const throughDate = endDate ?? addPlannerDays(source.plan_date, 365);
    if (!throughDate) return NextResponse.json({ error: "Could not calculate recurrence dates." }, { status: 400 });
    const dates = enumerateRecurrenceDates(source.plan_date, rule, throughDate).filter(date => date > source.plan_date);
    const conflictRows = await Promise.all(dates.map(async date => ({
      date,
      activities: (await query<{ id: string; title: string; status: string }>("SELECT id,title,status FROM daily_activities WHERE plan_date=$1", [date])).rows,
    })));
    const conflicts = conflictRows.filter(item => item.activities.length);
    const resolution = body.resolution;
    if (conflicts.length && !["merge", "replace", "cancel"].includes(String(resolution))) {
      return NextResponse.json({ error: "Choose how to handle dates that already have activities.", conflictingDates: conflicts.map(item => ({ date: item.date, activities: item.activities.map(activity => activity.title) })) }, { status: 409 });
    }
    if (resolution === "cancel") return NextResponse.json({ ok: true, cancelled: true });
    if (resolution === "replace" && conflicts.some(item => item.activities.some(activity => activity.status !== "planned"))) {
      return NextResponse.json({ error: "Completed or otherwise executed activities cannot be replaced. Choose merge or cancel." }, { status: 409 });
    }

    const recurrenceId = randomUUID();
    const now = effectiveServerNow().toISOString();
    await transaction(async client => {
      await client.query("INSERT INTO planner_recurrences (id,start_date,end_date,rule_json,active,created_at,updated_at) VALUES ($1,$2,$3,$4,1,$5,$5)",
        [recurrenceId, source.plan_date, endDate, JSON.stringify(rule), now]);
      await client.query("UPDATE daily_activities SET data_json=$1,updated_at=$2 WHERE id=$3",
        [JSON.stringify({ ...activityData(source), recurrenceId, recurrenceEndDate: endDate }), now, source.id]);
      for (const date of dates) {
        const existing = conflictRows.find(item => item.date === date)?.activities ?? [];
        if (resolution === "replace" && existing.length) await client.query("DELETE FROM daily_activities WHERE plan_date=$1 AND status='planned'", [date]);
        await insertOccurrence(client, date, recurrenceId, rule, now);
      }
    });
    return NextResponse.json({ ok: true, recurrenceId, applied: dates.length }, { status: 201 });
  }

  if (body.action === "resolve") {
    const recurrenceId = typeof body.recurrenceId === "string" ? body.recurrenceId : "";
    const date = body.date;
    const resolution = body.resolution;
    if (!validDate(date) || !["merge", "replace", "skip"].includes(String(resolution))) return NextResponse.json({ error: "Choose a valid date and recurrence action." }, { status: 400 });
    const row = (await query<RecurrenceRow>("SELECT * FROM planner_recurrences WHERE id=$1 AND active=1", [recurrenceId])).rows[0];
    if (!row) return NextResponse.json({ error: "Recurring schedule not found." }, { status: 404 });
    const rule = parseRule(row.rule_json);
    if (!recurrenceIncludesDate(row.start_date, date, rule)) return NextResponse.json({ error: "This date is outside the recurring schedule." }, { status: 400 });
    const now = effectiveServerNow().toISOString();
    if (resolution === "skip") {
      rule.excludedDates = [...new Set([...rule.excludedDates, date])];
      await query("UPDATE planner_recurrences SET rule_json=$1,updated_at=$2 WHERE id=$3", [JSON.stringify(rule), now, row.id]);
      return NextResponse.json({ ok: true, skipped: true });
    }
    const existing = (await query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position", [date])).rows;
    if (resolution === "replace" && existing.some(activity => activity.status !== "planned")) {
      return NextResponse.json({ error: "Completed or otherwise executed activities cannot be replaced. Choose merge or skip." }, { status: 409 });
    }
    await transaction(async client => {
      if (resolution === "replace") await client.query("DELETE FROM daily_activities WHERE plan_date=$1 AND status='planned'", [date]);
      await insertOccurrence(client, date, row.id, rule, now);
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "stop") {
    const recurrenceId = typeof body.recurrenceId === "string" ? body.recurrenceId : "";
    const fromDate = body.fromDate;
    if (!validDate(fromDate)) return NextResponse.json({ error: "Choose a valid date to stop the recurrence." }, { status: 400 });
    const row = (await query<RecurrenceRow>("SELECT * FROM planner_recurrences WHERE id=$1 AND active=1", [recurrenceId])).rows[0];
    if (!row) return NextResponse.json({ error: "Recurring schedule not found." }, { status: 404 });
    const now = effectiveServerNow().toISOString();
    await transaction(async client => {
      await client.query("UPDATE planner_recurrences SET active=0,updated_at=$1 WHERE id=$2", [now, row.id]);
      const activities = (await client.query<Activity>("SELECT * FROM daily_activities WHERE plan_date>=$1 AND status='planned'", [fromDate])).rows;
      for (const activity of activities) {
        if (activityData(activity).recurrenceId === row.id) await client.query("DELETE FROM daily_activities WHERE id=$1", [activity.id]);
      }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported recurrence action." }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const body = await request.json().catch(() => null) as { recurrenceId?: string; endDate?: string | null; active?: boolean } | null;
  if (!body || (body.endDate !== undefined && body.endDate !== null && !validDate(body.endDate)) ||
      (body.active !== undefined && typeof body.active !== "boolean") || typeof body.recurrenceId !== "string") {
    return NextResponse.json({ error: "Invalid recurring schedule update." }, { status: 400 });
  }
  const existing = (await query<RecurrenceRow>("SELECT * FROM planner_recurrences WHERE id=$1", [body.recurrenceId])).rows[0];
  if (!existing) return NextResponse.json({ error: "Recurring schedule not found." }, { status: 404 });
  const endDate = body.endDate === undefined ? existing.end_date : body.endDate;
  if (endDate && endDate < existing.start_date) return NextResponse.json({ error: "The end date must not precede the start date." }, { status: 400 });
  const rule = parseRule(existing.rule_json);
  if (body.endDate !== undefined) rule.endDate = body.endDate;
  const now = effectiveServerNow().toISOString();
  await transaction(async client => {
    await client.query("UPDATE planner_recurrences SET end_date=$1,rule_json=$2,active=$3,updated_at=$4 WHERE id=$5",
      [endDate, JSON.stringify(rule), body.active === undefined ? existing.active : body.active ? 1 : 0, now, body.recurrenceId]);
    if (body.endDate !== undefined) {
      const activities = (await client.query<{ id: string; data_json: string }>("SELECT id,data_json FROM daily_activities")).rows;
      for (const activity of activities) {
        const data = JSON.parse(activity.data_json) as Record<string, unknown>;
        if (data.recurrenceId === body.recurrenceId) {
          await client.query("UPDATE daily_activities SET data_json=$1,updated_at=$2 WHERE id=$3",
            [JSON.stringify({ ...data, recurrenceEndDate: endDate }), now, activity.id]);
        }
      }
    }
  });
  return NextResponse.json({ ok: true });
}
