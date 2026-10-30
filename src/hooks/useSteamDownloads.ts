import { useCallback, useEffect, useRef, useState } from "react";
import {
  toDownloadStates, sameDownloadStates, DownloadState, RawDownloadItem, RawDownloadOverview,
} from "../downloadStates";

export type SteamDownloads = {
  /** Live per-app download/verify state from Steam (empty when the API is unavailable). */
  downloads: Record<number, DownloadState>;
  /** Mark an app the user just asked Steam to verify; cleared once it leaves the download list. */
  markVerifying: (appid: number) => void;
};

/** One subscription to Steam's download list/overview. Mount once and pass the result down. */
export function useSteamDownloads(): SteamDownloads {
  const [downloads, setDownloads] = useState<Record<number, DownloadState>>({});
  const itemsRef = useRef<RawDownloadItem[]>([]);
  const overviewRef = useRef<RawDownloadOverview | null>(null);
  // appid -> whether it has appeared in the download list since it was marked
  const verifyingRef = useRef<Map<number, boolean>>(new Map());

  const update = useCallback(() => {
    const items = itemsRef.current;
    const listed = new Set(items.filter((i) => i && !i.completed).map((i) => i.appid));
    for (const [appid, seen] of [...verifyingRef.current]) {
      if (listed.has(appid)) verifyingRef.current.set(appid, true);
      else if (seen) verifyingRef.current.delete(appid);
    }
    const next = toDownloadStates(items, overviewRef.current, new Set(verifyingRef.current.keys()));
    // Steam reports progress many times per second; only re-render on a visible change.
    setDownloads((prev) => (sameDownloadStates(prev, next) ? prev : next));
  }, []);

  const markVerifying = useCallback((appid: number) => {
    verifyingRef.current.set(appid, false);
    update();
    // If Steam never queues it (call failed / ignored), forget the mark so a later update isn't mislabelled.
    setTimeout(() => {
      if (verifyingRef.current.get(appid) === false) { verifyingRef.current.delete(appid); update(); }
    }, 60_000);
  }, [update]);

  useEffect(() => {
    const regs: { unregister?: () => void }[] = [];
    try {
      const d = (window as any).SteamClient?.Downloads;
      if (typeof d?.RegisterForDownloadItems === "function") {
        regs.push(d.RegisterForDownloadItems((_isDownloading: boolean, list: RawDownloadItem[]) => {
          itemsRef.current = Array.isArray(list) ? list : [];
          update();
        }));
      }
      if (typeof d?.RegisterForDownloadOverview === "function") {
        regs.push(d.RegisterForDownloadOverview((o: RawDownloadOverview) => { overviewRef.current = o ?? null; update(); }));
      }
    } catch { /* API unavailable */ }
    return () => { for (const r of regs) { try { r?.unregister?.(); } catch { /* ignore */ } } };
  }, [update]);

  return { downloads, markVerifying };
}
