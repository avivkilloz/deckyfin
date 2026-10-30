import { useEffect, useState } from "react";
import { toDownloadStates, DownloadState, RawDownloadItem, RawDownloadOverview } from "../downloadStates";

/** Live per-app download/verify state from Steam (empty when the API is unavailable). */
export function useSteamDownloads(): Record<number, DownloadState> {
  const [states, setStates] = useState<Record<number, DownloadState>>({});
  useEffect(() => {
    let items: RawDownloadItem[] = [];
    let overview: RawDownloadOverview | null = null;
    const update = () => setStates(toDownloadStates(items, overview));
    const regs: { unregister?: () => void }[] = [];
    try {
      const d = (window as any).SteamClient?.Downloads;
      if (typeof d?.RegisterForDownloadItems === "function") {
        regs.push(d.RegisterForDownloadItems((_isDownloading: boolean, list: RawDownloadItem[]) => { items = list ?? []; update(); }));
      }
      if (typeof d?.RegisterForDownloadOverview === "function") {
        regs.push(d.RegisterForDownloadOverview((o: RawDownloadOverview) => { overview = o ?? null; update(); }));
      }
    } catch { /* API unavailable */ }
    return () => { for (const r of regs) { try { r?.unregister?.(); } catch { /* ignore */ } } };
  }, []);
  return states;
}
