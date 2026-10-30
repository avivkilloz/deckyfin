export type RawDownloadItem = { appid: number; active?: boolean; completed?: boolean; paused?: boolean };
/** Subset of Steam's DownloadOverview. update_state is 'None' | 'Starting' | 'Updating' | 'Stopping'. */
export type RawDownloadOverview = {
  update_appid?: number;
  update_bytes_downloaded?: number;
  update_bytes_to_download?: number;
  update_bytes_processed?: number;
  update_bytes_to_process?: number;
  update_state?: string;
};
export type DownloadState = { status: "downloading" | "queued" | "verifying"; progress: number };

/** Shared label for a download/verify progress badge: "Queued" / "Verifying… N%" / "N%". */
export function formatDownloadLabel(d: DownloadState): string {
  if (d.status === "queued") return "Queued";
  const pct = Math.round(d.progress * 100);
  return d.status === "verifying" ? `Verifying… ${pct}%` : `${pct}%`;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ratio = (done: number, total: number): number => (total > 0 ? Math.max(0, Math.min(1, done / total)) : 0);

/**
 * Map Steam's download list + overview to per-app states.
 * Progress uses download bytes when there is something to download, else processed bytes
 * (a verify downloads nothing; its work is update_bytes_processed / update_bytes_to_process).
 * `verifyingAppids` marks apps the user just asked to verify.
 */
export function toDownloadStates(
  items: RawDownloadItem[],
  overview: RawDownloadOverview | null,
  verifyingAppids?: Set<number>,
): Record<number, DownloadState> {
  const out: Record<number, DownloadState> = {};
  for (const item of items ?? []) {
    if (!item || typeof item.appid !== "number" || item.completed) continue;
    const isOverview = overview?.update_appid === item.appid;
    if (!item.active && !isOverview) { out[item.appid] = { status: "queued", progress: 0 }; continue; }
    const toDownload = isOverview ? num(overview?.update_bytes_to_download) : 0;
    const toProcess = isOverview ? num(overview?.update_bytes_to_process) : 0;
    const progress = toDownload > 0
      ? ratio(num(overview?.update_bytes_downloaded), toDownload)
      : toProcess > 0 ? ratio(num(overview?.update_bytes_processed), toProcess) : 0;
    const verifying = (toDownload === 0 && toProcess > 0) || !!verifyingAppids?.has(item.appid);
    out[item.appid] = { status: verifying ? "verifying" : "downloading", progress };
  }
  return out;
}

/** True when both maps have the same apps, statuses and progress (rounded to 1%). */
export function sameDownloadStates(a: Record<number, DownloadState>, b: Record<number, DownloadState>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const x = a[k as any], y = b[k as any];
    if (!y || x.status !== y.status || Math.round(x.progress * 100) !== Math.round(y.progress * 100)) return false;
  }
  return true;
}
