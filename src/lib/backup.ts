import { collect } from "@/app/api/export/route";
import { planDayForDate, planEnd, planStart } from "@/lib/schedule";
import { query } from "@/lib/db";

export async function writeDailyBackup() {
  const today = planDayForDate(new Date());
  const data = await collect(planStart, planEnd, true);
  await query("INSERT INTO backup_snapshots(plan_day,created_at,data_json) VALUES($1,$2,$3) ON CONFLICT(plan_day) DO UPDATE SET created_at=excluded.created_at,data_json=excluded.data_json", [today, new Date().toISOString(), JSON.stringify(data)]);
  await query("DELETE FROM backup_snapshots WHERE plan_day NOT IN (SELECT plan_day FROM backup_snapshots ORDER BY plan_day DESC LIMIT 14)");
  const count = (await query<{ count: string }>("SELECT count(*) FROM backup_snapshots")).rows[0]?.count ?? "0";
  return { saved: `command-center-${today}.json`, retained: Number(count) };
}

export async function tryWriteDailyBackup() {
  try { return await writeDailyBackup(); }
  catch (error) {
    console.error("Command Center backup failed", error);
    return null;
  }
}
