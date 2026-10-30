export type RawDownloadItem = { appid: number; active?: boolean; completed?: boolean; paused?: boolean };
export type RawDownloadOverview = {
  update_appid?: number;
  update_bytes_downloaded?: number;
  update_bytes_to_download?: number;
  update_state?: string;
};
export type DownloadState = { status: "downloading" | "queued" | "verifying"; progress: number };

/** Shared label for a download/verify progress badge: "Queued" / "Verifying… N%" / "N%". */
export function formatDownloadLabel(d: DownloadState): string {
  if (d.status === "queued") return "Queued";
  const pct = Math.round(d.progress * 100);
  return d.status === "verifying" ? `Verifying… ${pct}%` : `${pct}%`;
}

export function toDownloadStates(items: RawDownloadItem[], overview: RawDownloadOverview | null): Record<number, DownloadState> {
  const out: Record<number, DownloadState> = {};
  for (const item of items ?? []) {
    if (!item || typeof item.appid !== "number" || item.completed) continue;
    const isActive = !!item.active || overview?.update_appid === item.appid;
    if (!isActive) { out[item.appid] = { status: "queued", progress: 0 }; continue; }
    const total = overview?.update_appid === item.appid ? overview.update_bytes_to_download ?? 0 : 0;
    const done = overview?.update_appid === item.appid ? overview.update_bytes_downloaded ?? 0 : 0;
    const verifying = /verif/i.test(overview?.update_state ?? "");
    out[item.appid] = { status: verifying ? "verifying" : "downloading", progress: total > 0 ? Math.min(1, done / total) : 0 };
  }
  return out;
}
