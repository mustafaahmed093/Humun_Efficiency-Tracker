import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { hasGoalDependencyCycle } from "@/lib/life-system";
import { effectiveServerNow } from "@/lib/server-time";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const dependencies = await query("SELECT d.depends_on_goal_id,g.title,g.status FROM goal_dependencies d JOIN goals g ON g.id=d.depends_on_goal_id WHERE d.goal_id=$1", [id]);
  return NextResponse.json({ dependencies: dependencies.rows });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id: goalId } = await context.params;
  const body = await request.json().catch(() => null) as { dependsOnGoalId?: string } | null;
  if (!body?.dependsOnGoalId) return NextResponse.json({ error: "Dependency goal id is required." }, { status: 400 });
  const edges = (await query<{ goal_id: string; depends_on_goal_id: string }>("SELECT goal_id,depends_on_goal_id FROM goal_dependencies")).rows;
  if (hasGoalDependencyCycle(edges, goalId, body.dependsOnGoalId)) return NextResponse.json({ error: "This dependency would create a cycle." }, { status: 400 });
  const now = effectiveServerNow().toISOString();
  await transaction(async client => {
    const active = await client.query("SELECT id FROM goals WHERE id=$1 AND archived_at IS NULL", [goalId]);
    const dependency = await client.query("SELECT id FROM goals WHERE id=$1 AND archived_at IS NULL", [body.dependsOnGoalId]);
    if (!active.rows.length || !dependency.rows.length) throw new Error("Both goals must exist and be active.");
    await client.query("INSERT INTO goal_dependencies (goal_id,depends_on_goal_id,created_at) VALUES ($1,$2,$3) ON CONFLICT(goal_id,depends_on_goal_id) DO NOTHING", [goalId, body.dependsOnGoalId, now]);
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const { id } = await context.params;
  const dependency = request.nextUrl.searchParams.get("goalId");
  if (!dependency) return NextResponse.json({ error: "Dependency goal id is required." }, { status: 400 });
  await query("DELETE FROM goal_dependencies WHERE goal_id=$1 AND depends_on_goal_id=$2", [id, dependency]);
  return NextResponse.json({ ok: true });
}
