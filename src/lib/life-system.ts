export type GoalStatus = "not_started" | "active" | "on_track" | "at_risk" | "behind_schedule" | "paused" | "completed" | "cancelled" | "overdue";
export type HabitOutcome = "avoided" | "urge_resisted" | "slip" | "not_applicable";
export type TimedBlock = { id: string; start_time: string | null; end_time: string | null };

const privateReviewFields = new Set(["mood", "stress", "stressNote", "tension", "happiness", "overthinkingCount", "focusRating", "safetyCheck", "habitCheckins"]);
export function redactPrivateReviewAnswers(answers: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(answers).filter(([key]) => !privateReviewFields.has(key)));
}

function dayNumber(day: string) {
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 86_400_000);
}

export function calculateGoalMetrics(
  goal: { status: string; start_date: string; target_date: string | null; target_value: number | null; current_value: number },
  checkins: { checkin_date: string; hours: number; output_value: number | null; target_met: number | null }[],
  today: string,
) {
  const elapsedDays = Math.max(0, (dayNumber(today) ?? 0) - (dayNumber(goal.start_date) ?? 0) + 1);
  const remainingDays = goal.target_date ? Math.max(0, (dayNumber(goal.target_date) ?? 0) - (dayNumber(today) ?? 0)) : null;
  const outcomeProgress = goal.target_value && goal.target_value > 0
    ? Math.max(0, goal.current_value / goal.target_value * 100)
    : null;
  const eligible = checkins.filter(checkin => checkin.target_met !== null);
  const met = eligible.filter(checkin => checkin.target_met === 1).length;
  const consistency = eligible.length ? Math.round(met / eligible.length * 100) : null;
  const totalHours = checkins.reduce((total, checkin) => total + Math.max(0, checkin.hours || 0), 0);
  const outputs = checkins.filter(checkin => checkin.output_value !== null).sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
  let estimatedCompletionDate: string | null = null;
  if (goal.target_value && goal.target_value > goal.current_value && outputs.length >= 2) {
    const first = outputs[0];
    const last = outputs[outputs.length - 1];
    const daysBetween = (dayNumber(last.checkin_date) ?? 0) - (dayNumber(first.checkin_date) ?? 0);
    const rate = daysBetween > 0 ? (Number(last.output_value) - Number(first.output_value)) / daysBetween : 0;
    if (rate > 0) {
      const neededDays = Math.ceil((goal.target_value - goal.current_value) / rate);
      estimatedCompletionDate = new Date(((dayNumber(today) ?? 0) + neededDays) * 86_400_000).toISOString().slice(0, 10);
    }
  }
  let status: GoalStatus;
  if (goal.status === "paused" || goal.status === "cancelled" || goal.status === "completed") {
    status = goal.status;
  } else if (goal.current_value >= (goal.target_value ?? Number.POSITIVE_INFINITY) && goal.target_value !== null) {
    status = "active";
  } else if (!checkins.length && elapsedDays <= 1) {
    status = "not_started";
  } else if (goal.target_date && today > goal.target_date) {
    status = "overdue";
  } else if (goal.target_date && remainingDays !== null && remainingDays > 0) {
    const totalDays = Math.max(1, (dayNumber(goal.target_date) ?? 0) - (dayNumber(goal.start_date) ?? 0));
    const expectedProgress = Math.min(100, elapsedDays / totalDays * 100);
    status = outcomeProgress !== null && outcomeProgress + 15 < expectedProgress
      ? "behind_schedule"
      : consistency !== null && consistency < 50
        ? "at_risk"
        : "on_track";
  } else {
    status = "active";
  }
  return {
    outcomeProgress: outcomeProgress === null ? null : Math.round(outcomeProgress),
    overachievement: outcomeProgress === null ? 0 : Math.max(0, Math.round(outcomeProgress - 100)),
    executionConsistency: consistency,
    eligibleCommitments: eligible.length,
    totalHours: Math.round(totalHours * 100) / 100,
    remainingTarget: goal.target_value === null ? null : Math.max(0, goal.target_value - goal.current_value),
    remainingDays,
    estimatedCompletionDate,
    status,
  };
}

export function calculateAvoidanceMetrics(checkins: { checkin_date: string; outcome: HabitOutcome; urges: number }[], today: string) {
  const ordered = [...checkins].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
  let currentStreak = 0;
  let longestStreak = 0;
  let lastOccurrence: string | null = null;
  let totalUrgesResisted = 0;
  let avoidedDays = 0;
  let trackedDays = 0;
  let previousDay: number | null = null;
  for (const checkin of ordered) {
    const currentDay = dayNumber(checkin.checkin_date);
    if (currentDay === null) continue;
    trackedDays++;
    const successful = checkin.outcome === "avoided" || checkin.outcome === "urge_resisted";
    if (checkin.outcome === "slip") lastOccurrence = checkin.checkin_date;
    if (checkin.outcome === "urge_resisted") totalUrgesResisted += Math.max(0, checkin.urges || 0);
    if (!successful) {
      currentStreak = 0;
    } else {
      if (previousDay === null || currentDay !== previousDay + 1) currentStreak = 0;
      currentStreak++;
      avoidedDays++;
      longestStreak = Math.max(longestStreak, currentStreak);
    }
    previousDay = currentDay;
  }
  const lastRecorded = ordered.at(-1)?.checkin_date ?? null;
  if (lastRecorded && (dayNumber(today) ?? 0) > (dayNumber(lastRecorded) ?? 0)) currentStreak = 0;
  const daysSinceOccurrence = lastOccurrence
    ? Math.max(0, (dayNumber(today) ?? 0) - (dayNumber(lastOccurrence) ?? 0))
    : null;
  return {
    currentStreak,
    longestStreak,
    trackedDays,
    avoidedDays,
    totalUrgesResisted,
    slips: ordered.filter(checkin => checkin.outcome === "slip").length,
    lastOccurrence,
    daysSinceOccurrence,
    consistency: trackedDays ? Math.round(avoidedDays / trackedDays * 100) : null,
    lastRecorded,
  };
}

function minutes(time: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time !== "24:00") return null;
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

export function findScheduleConflicts<T extends TimedBlock>(blocks: T[]) {
  const valid = blocks.flatMap(block => {
    if (!block.start_time || !block.end_time) return [];
    const start = minutes(block.start_time);
    let end = minutes(block.end_time);
    if (start === null || end === null) return [];
    if (end <= start) end += 1440;
    return [{ block, start, end }];
  });
  const conflicts: { first: string; second: string }[] = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const first = valid[i];
      const second = valid[j];
      if ([-1440, 0, 1440].some(offset => first.start < second.end + offset && second.start + offset < first.end)) {
        conflicts.push({ first: first.block.id, second: second.block.id });
      }
    }
  }
  return conflicts;
}

export function hasGoalDependencyCycle(edges: { goal_id: string; depends_on_goal_id: string }[], nextGoal: string, dependency: string) {
  const graph = new Map<string, string[]>();
  for (const edge of edges) graph.set(edge.goal_id, [...(graph.get(edge.goal_id) ?? []), edge.depends_on_goal_id]);
  const seen = new Set<string>();
  const visit = (goal: string): boolean => {
    if (goal === nextGoal) return true;
    if (seen.has(goal)) return false;
    seen.add(goal);
    return (graph.get(goal) ?? []).some(visit);
  };
  return nextGoal === dependency || visit(dependency);
}
