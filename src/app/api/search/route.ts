import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isUnlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchRow = { kind: string; id: string; title: string; detail: string; date: string | null };

export async function GET(request: NextRequest) {
  if (!isUnlocked(request)) return NextResponse.json({ error: "Unlock the local app first." }, { status: 401 });
  const term = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) return NextResponse.json({ results: [] });
  if (term.length > 100) return NextResponse.json({ error: "Search text must be 100 characters or fewer." }, { status: 400 });
  const pattern = `%${term.replace(/[\\%_]/g, character => `\\${character}`)}%`;
  const [goals, milestones, activities, rules, templates, reviews] = await Promise.all([
    query<SearchRow>("SELECT 'Goal' AS kind,id,title,category AS detail,target_date AS date FROM goals WHERE archived_at IS NULL AND (title LIKE $1 ESCAPE '\\' OR category LIKE $1 ESCAPE '\\') ORDER BY updated_at DESC LIMIT 10", [pattern]),
    query<SearchRow>("SELECT 'Milestone' AS kind,m.id,m.title,g.title AS detail,m.due_date AS date FROM goal_milestones m JOIN goals g ON g.id=m.goal_id WHERE m.title LIKE $1 ESCAPE '\\' OR g.title LIKE $1 ESCAPE '\\' ORDER BY m.updated_at DESC LIMIT 10", [pattern]),
    query<SearchRow>("SELECT 'Plan activity' AS kind,id,title,category AS detail,plan_date AS date FROM daily_activities WHERE title LIKE $1 ESCAPE '\\' OR category LIKE $1 ESCAPE '\\' ORDER BY plan_date DESC LIMIT 10", [pattern]),
    query<SearchRow>("SELECT 'Not To Do' AS kind,id,title,category AS detail,start_date AS date FROM not_to_do_rules WHERE archived_at IS NULL AND title LIKE $1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 10", [pattern]),
    query<SearchRow>("SELECT 'Template' AS kind,id,title,COALESCE(description,'Daily template') AS detail,NULL AS date FROM daily_templates WHERE title LIKE $1 ESCAPE '\\' OR COALESCE(description,'') LIKE $1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 10", [pattern]),
    query<SearchRow>("SELECT 'Nightly review' AS kind,plan_day AS id,plan_day AS title,'Saved reflection' AS detail,plan_day AS date FROM nightly_reviews WHERE submitted_at IS NOT NULL AND answers_json LIKE $1 ESCAPE '\\' ORDER BY plan_day DESC LIMIT 10", [pattern]),
  ]);
  return NextResponse.json({ results: [...goals.rows, ...milestones.rows, ...activities.rows, ...rules.rows, ...templates.rows, ...reviews.rows].slice(0, 30) });
}
