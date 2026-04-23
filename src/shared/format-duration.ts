/**
 * Formate une durée exprimée en millisecondes en « m:ss » (minutes sur une échelle ouverte).
 */
export function formatDurationMmSsFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
