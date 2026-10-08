import { writeDailyBackup } from "@/lib/backup";

export function startBackupScheduler() {
  const timer = setInterval(() => {
    void writeDailyBackup().catch(error => console.error("Command Center backup failed", error));
  }, 60 * 60 * 1000);
  timer.unref();
}
