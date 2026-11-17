import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { findScheduleConflicts } from "@/lib/life-system";
import { effectiveServerNow } from "@/lib/server-time";
import { randomUUID } from "node:crypto";
import { isUnlocked } from "@/lib/auth";
import { getPlannerDurationMinutes } from "@/lib/planner";

export const runtime = "nodejs";
const categories = ["Business", "Work", "Study", "Health", "Fitness", "Religious", "Family", "Personal", "Sleep", "Other"];
const statuses = ["planned", "completed", "partial", "missed", "rescheduled"];
type Context = { params: Promise<{ id: string }> };
type Activity = { id: string; title: string; start_time: string | null; end_time: string | null; category: string; priority: string; goal_id: string | null; milestone_id: string | null; status: string; data_json: string; position: number };

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function karachiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(effectiveServerNow());
}

async function syncGoalExecution(goalId: string, date: string, now: string) {
  const activities = (await query<{ id: string; start_time: string | null; end_time: string | null; actual_duration: number | null }>(
    "SELECT id,start_time,end_time,actual_duration FROM daily_activities WHERE goal_id=$1 AND plan_date=$2 AND status IN ('completed','partial')", [goalId, date])).rows;
  const plannerMinutes = activities.reduce((sum, item) => {
    if (item.actual_duration !== null) return sum + Math.max(0, Number(item.actual_duration));
    if (!item.start_time || !item.end_time) return sum;
    const toMinutes = (value: string) => value === "24:00" ? 1440 : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = toMinutes(item.start_time);
    let end = toMinutes(item.end_time);
    if (end <= start) end += 1440;
    return sum + Math.max(0, end - start);
  }, 0);
  await transaction(async client => {
    const existing = (await client.query<{ id: string; worked: number; hours: number; output_value: number | null; target_met: number | null; data_json: string }>(
      "SELECT id,worked,hours,output_value,target_met,data_json FROM goal_checkins WHERE goal_id=$1 AND checkin_date=$2", [goalId, date])).rows[0];
    const previousData = existing ? JSON.parse(existing.data_json) as Record<string, unknown> : {};
    const oldPlannerHours = Number(previousData.plannerHours ?? 0);
    const manualOverride = previousData.manualOverride === true;
    const manualHours = manualOverride
      ? Math.max(0, Number(previousData.manualHours ?? existing?.hours ?? 0))
      : existing && previousData.plannerOnly !== true ? Math.max(0, Number(existing.hours) - oldPlannerHours) : 0;
    if (!existing && !activities.length) return;
    if (!activities.length && previousData.plannerOnly === true) {
      await client.query("INSERT INTO goal_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4)", [randomUUID(), existing.id, JSON.stringify(existing), now]);
      await client.query("UPDATE goal_checkins SET worked=0,hours=0,output_value=NULL,target_met=NULL,data_json=$1,updated_at=$2 WHERE id=$3", [JSON.stringify({ ...previousData, plannerActivityIds: [], plannerHours: 0, plannerOnly: true }), now, existing.id]);
      return;
    }
    const nextData = { ...previousData, plannerActivityIds: activities.map(item => item.id), plannerHours: Math.round(plannerMinutes / 60 * 100) / 100, plannerOnly: existing ? previousData.plannerOnly === true : true };
    const nextHours = manualOverride ? manualHours : manualHours + plannerMinutes / 60;
    if (existing) {
      await client.query("INSERT INTO goal_checkin_history (id,checkin_id,previous_json,changed_at) VALUES ($1,$2,$3,$4)", [randomUUID(), existing.id, JSON.stringify(existing), now]);
    }
    const id = existing?.id ?? randomUUID();
    await client.query(`INSERT INTO goal_checkins (id,goal_id,checkin_date,worked,hours,output_value,target_met,data_json,created_at,updated_at)
      VALUES ($1,$2,$3,1,$4,NULL,NULL,$5,$6,$6)
      ON CONFLICT(goal_id,checkin_date) DO UPDATE SET worked=1,hours=excluded.hours,data_json=excluded.data_json,updated_at=excluded.updated_at`,
    [id, goalId, date, nextHours, JSON.stringify(nextData), now]);
  });
}

function validTime(value: unknown, end = false) {
  return value === null || value === undefined || value === "" ||
    (typeof value === "string" && (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || (end && value === "24:00")));
}

function timeOrder(start: string | null, end: string | null) {
  if (!start || !end) return true;
  const toMinutes = (time: string) => time === "24:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const first = toMinutes(start);
  let last = toMinutes(end);
  if (last <= first) last += 1440;
  return last - first <= 1440;
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid activity update." }, { status: 400 });
  const current = (await query<{ plan_date: string; goal_id: string | null; start_time: string | null; end_time: string | null; data_json: string }>(
    "SELECT plan_date,goal_id,start_time,end_time,data_json FROM daily_activities WHERE id=$1", [id])).rows[0];
  if (!current) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  const nextDate = body.date === undefined ? current.plan_date : body.date;
  if (!validDate(nextDate)) return NextResponse.json({ error: "Invalid activity date." }, { status: 400 });
  if ((body.recurrenceScope === "following" || body.recurrenceScope === "all") && nextDate < karachiToday()) {
    return NextResponse.json({ error: "Recurring schedules cannot be changed through historical dates." }, { status: 400 });
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (key: string, value: unknown) => { values.push(value); fields.push(`${key}=$${values.length}`); };
  if (body.date !== undefined) set("plan_date", nextDate);
  if (typeof body.title === "string" && body.title.trim()) set("title", body.title.trim().slice(0, 200));
  if (typeof body.startTime === "string" || body.startTime === null) {
    if (!validTime(body.startTime)) return NextResponse.json({ error: "Invalid start time." }, { status: 400 });
    set("start_time", body.startTime || null);
  }
  if (typeof body.endTime === "string" || body.endTime === null) {
    if (!validTime(body.endTime, true)) return NextResponse.json({ error: "Invalid end time." }, { status: 400 });
    set("end_time", body.endTime || null);
  }
  const nextStart = body.startTime === undefined ? current.start_time : body.startTime as string | null;
  const nextEnd = body.endTime === undefined ? current.end_time : body.endTime as string | null;
  if (!timeOrder(nextStart, nextEnd)) return NextResponse.json({ error: "An activity cannot exceed 24 hours." }, { status: 400 });
  const currentData = JSON.parse(current.data_json) as Record<string, unknown>;
  const nextData = body.data && typeof body.data === "object" && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : currentData;
  const endDate = nextData.endDate === undefined ? nextDate : nextData.endDate;
  if (!validDate(endDate) || (nextStart && nextEnd && getPlannerDurationMinutes(nextDate, nextStart, endDate, nextEnd) === null)) {
    return NextResponse.json({ error: "Activity end date and time must define a duration of no more than 24 hours." }, { status: 400 });
  }
  if (typeof body.category === "string" && categories.includes(body.category)) set("category", body.category);
  if (typeof body.priority === "string" && ["critical", "high", "medium", "low"].includes(body.priority)) set("priority", body.priority);
  if (typeof body.status === "string" && statuses.includes(body.status)) set("status", body.status);
  if (typeof body.actualStart === "string" || body.actualStart === null) set("actual_start", body.actualStart);
  if (typeof body.actualEnd === "string" || body.actualEnd === null) set("actual_end", body.actualEnd);
  if (body.actualDuration === null) set("actual_duration", null);
  else if (typeof body.actualDuration === "number" && Number.isFinite(body.actualDuration) && body.actualDuration >= 0) set("actual_duration", body.actualDuration);
  if (typeof body.goalId === "string" || body.goalId === null) set("goal_id", body.goalId);
  if (typeof body.milestoneId === "string" || body.milestoneId === null) set("milestone_id", body.milestoneId);
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) set("data_json", JSON.stringify(body.data));
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) set("position", body.position);
  set("updated_at", effectiveServerNow().toISOString());
  values.push(id);
  const result = await query(`UPDATE daily_activities SET ${fields.join(",")} WHERE id=$${values.length}`, values);
  if (!result.rowCount) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  const updatedActivity = (await query<Activity>("SELECT * FROM daily_activities WHERE id=$1", [id])).rows[0];
  const updatedData = JSON.parse(updatedActivity.data_json) as Record<string, unknown>;
  const recurrenceId = currentData.recurrenceId;
  let savedRecurrenceId = typeof recurrenceId === "string" ? recurrenceId : null;
  const recurrenceScope = body.recurrenceScope;
  if (typeof recurrenceId === "string" && ["only", "following", "all"].includes(String(recurrenceScope))) {
    const recurrence = (await query<{ id: string; start_date: string; end_date: string | null; rule_json: string }>(
      "SELECT id,start_date,end_date,rule_json FROM planner_recurrences WHERE id=$1 AND active=1", [recurrenceId])).rows[0];
    if (recurrence) {
      const rule = JSON.parse(recurrence.rule_json) as {
        template: Record<string, unknown>;
        frequency: "weekly" | "custom";
        customDates?: string[];
        excludedDates?: string[];
      };
      const templateData = { ...updatedData };
      delete templateData.recurrenceId;
      const template = {
        title: updatedActivity.title,
        start_time: updatedActivity.start_time,
        end_time: updatedActivity.end_time,
        category: updatedActivity.category,
        priority: updatedActivity.priority,
        goal_id: updatedActivity.goal_id,
        milestone_id: updatedActivity.milestone_id,
        data: templateData,
      };
      if (recurrenceScope === "only") {
        const detachedData = { ...updatedData };
        delete detachedData.recurrenceId;
        const excludedDates = [...new Set([...(rule.excludedDates ?? []), nextDate])];
        rule.excludedDates = excludedDates;
        await query("UPDATE daily_activities SET data_json=$1 WHERE id=$2", [JSON.stringify(detachedData), id]);
        await query("UPDATE planner_recurrences SET rule_json=$1,updated_at=$2 WHERE id=$3",
          [JSON.stringify(rule), effectiveServerNow().toISOString(), recurrenceId]);
      } else {
        let nextRecurrenceId = recurrenceId;
        if (recurrenceScope === "following") {
          const previousDate = new Date(Date.parse(`${nextDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
          const newRule = { ...rule, template };
          if (newRule.frequency === "custom") newRule.customDates = (newRule.customDates ?? []).filter(date => date >= nextDate);
          const now = effectiveServerNow().toISOString();
          nextRecurrenceId = randomUUID();
          savedRecurrenceId = nextRecurrenceId;
          await transaction(async client => {
            await client.query("UPDATE planner_recurrences SET end_date=$1,updated_at=$2 WHERE id=$3", [previousDate, now, recurrenceId]);
            await client.query("INSERT INTO planner_recurrences (id,start_date,end_date,rule_json,active,created_at,updated_at) VALUES ($1,$2,$3,$4,1,$5,$5)",
              [nextRecurrenceId, nextDate, recurrence.end_date, JSON.stringify(newRule), now]);
            const siblings = (await client.query<{ id: string; data_json: string }>(
              "SELECT id,data_json FROM daily_activities WHERE plan_date>=$1 AND status='planned'", [nextDate])).rows;
            for (const sibling of siblings) {
              const siblingData = JSON.parse(sibling.data_json) as Record<string, unknown>;
              if (siblingData.recurrenceId !== recurrenceId) continue;
              await client.query(`UPDATE daily_activities SET title=$1,start_time=$2,end_time=$3,category=$4,priority=$5,
                goal_id=$6,milestone_id=$7,data_json=$8,updated_at=$9 WHERE id=$10`,
              [updatedActivity.title, updatedActivity.start_time, updatedActivity.end_time, updatedActivity.category,
                updatedActivity.priority, updatedActivity.goal_id, updatedActivity.milestone_id,
                JSON.stringify({ ...templateData, recurrenceId: nextRecurrenceId }), now, sibling.id]);
            }
          });
        } else {
          rule.template = template;
          const now = effectiveServerNow().toISOString();
          await transaction(async client => {
            await client.query("UPDATE planner_recurrences SET rule_json=$1,updated_at=$2 WHERE id=$3", [JSON.stringify(rule), now, recurrenceId]);
            const siblings = (await client.query<{ id: string; data_json: string }>(
              "SELECT id,data_json FROM daily_activities WHERE plan_date>=$1 AND status='planned'", [karachiToday()])).rows;
            for (const sibling of siblings) {
              const siblingData = JSON.parse(sibling.data_json) as Record<string, unknown>;
              if (siblingData.recurrenceId !== recurrenceId || sibling.id === id) continue;
              await client.query(`UPDATE daily_activities SET title=$1,start_time=$2,end_time=$3,category=$4,priority=$5,
                goal_id=$6,milestone_id=$7,data_json=$8,updated_at=$9 WHERE id=$10`,
              [updatedActivity.title, updatedActivity.start_time, updatedActivity.end_time, updatedActivity.category,
                updatedActivity.priority, updatedActivity.goal_id, updatedActivity.milestone_id,
                JSON.stringify({ ...templateData, recurrenceId }), now, sibling.id]);
            }
          });
        }
      }
    }
  }
  if (nextDate !== current.plan_date) {
    const now = effectiveServerNow().toISOString();
    await query("INSERT INTO daily_plans (plan_date,source,data_json,created_at,updated_at) VALUES ($1,'custom','{}',$2,$2) ON CONFLICT(plan_date) DO NOTHING", [nextDate, now]);
    await query("UPDATE daily_plans SET updated_at=$1 WHERE plan_date IN ($2,$3)", [now, current.plan_date, nextDate]);
  }
  const changedGoalId = typeof body.goalId === "string" ? body.goalId : body.goalId === null ? null : current.goal_id;
  const timestamp = effectiveServerNow().toISOString();
  for (const date of new Set([current.plan_date, nextDate])) {
    for (const goalId of new Set([current.goal_id, changedGoalId].filter((value): value is string => Boolean(value)))) {
      await syncGoalExecution(goalId, date, timestamp);
    }
  }
  const activities = (await query<Activity>("SELECT * FROM daily_activities WHERE plan_date=$1 ORDER BY position,start_time", [nextDate])).rows;
  return NextResponse.json({ ok: true, recurrenceId: savedRecurrenceId, conflicts: findScheduleConflicts(activities) });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const current = (await query<{ plan_date: string; goal_id: string | null; data_json: string }>("SELECT plan_date,goal_id,data_json FROM daily_activities WHERE id=$1", [id])).rows[0];
  if (current) {
    const data = JSON.parse(current.data_json) as Record<string, unknown>;
    if (typeof data.recurrenceId === "string") {
      const recurrence = (await query<{ rule_json: string }>("SELECT rule_json FROM planner_recurrences WHERE id=$1", [data.recurrenceId])).rows[0];
      if (recurrence) {
        const rule = JSON.parse(recurrence.rule_json) as { excludedDates?: string[] };
        rule.excludedDates = [...new Set([...(rule.excludedDates ?? []), current.plan_date])];
        await query("UPDATE planner_recurrences SET rule_json=$1,updated_at=$2 WHERE id=$3",
          [JSON.stringify(rule), effectiveServerNow().toISOString(), data.recurrenceId]);
      }
    }
  }
  const result = await query("DELETE FROM daily_activities WHERE id=$1", [id]);
  if (!result.rowCount) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  if (current?.goal_id) await syncGoalExecution(current.goal_id, current.plan_date, effectiveServerNow().toISOString());
  return NextResponse.json({ ok: true });
}
