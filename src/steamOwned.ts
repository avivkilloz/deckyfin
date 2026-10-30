import type { MergedGame } from "./types";

export type RawApp = {
  appid: number;
  display_name?: string;
  app_type?: number;
  installed?: boolean;
  visible_in_game_list?: boolean;
  per_client_data?: RawClientData[];
  local_per_client_data?: RawClientData;
};
type RawClientData = { clientid?: string; installed?: boolean };
export type OwnedApp = { appid: number; name: string; installed: boolean };

const APP_TYPE_GAME = 1;
const TOOL_APPIDS = new Set([228980, 1070560, 1391110, 1628350, 4183110, 1826330, 1161040]);
const BUILTIN_TYPES = new Set(["steam_shortcuts", "steam_library"]);

/** Installed on THIS client: local data first, then the local ("0") client entry, then any client. */
function isInstalledLocally(a: RawApp): boolean {
  const local = a.local_per_client_data?.installed;
  if (typeof local === "boolean") return local;
  const clients = Array.isArray(a.per_client_data) ? a.per_client_data : [];
  const self = clients.find((c) => c?.clientid === "0");
  if (self && typeof self.installed === "boolean") return self.installed;
  if (typeof a.installed === "boolean") return a.installed;
  return clients.some((c) => !!c?.installed);
}

export function filterOwnedGames(apps: RawApp[]): OwnedApp[] {
  const seen = new Set<number>();
  const out: OwnedApp[] = [];
  for (const a of apps) {
    if (!a || typeof a.appid !== "number" || seen.has(a.appid)) continue;
    if (a.app_type !== APP_TYPE_GAME || a.visible_in_game_list === false || TOOL_APPIDS.has(a.appid)) continue;
    seen.add(a.appid);
    out.push({ appid: a.appid, name: a.display_name ?? String(a.appid), installed: isInstalledLocally(a) });
  }
  return out;
}

const appidOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : null;
};

export function mergeOwnedGames(games: MergedGame[], owned: OwnedApp[], source: { id: string; name: string }): MergedGame[] {
  const out = games.map((g) => ({ ...g, sources: [...g.sources] }));
  const isBuiltinOnly = (g: MergedGame) => g.sources.length > 0 && g.sources.every((s) => BUILTIN_TYPES.has(s.source_type));
  const present = new Set<number>();
  for (const g of out) for (const s of g.sources) {
    if (s.source_type === "steam_library") { const id = appidOf(s.config.steam_app_id); if (id !== null) present.add(id); }
  }
  const targets = out.filter((g) => !isBuiltinOnly(g));
  const targetAppids = (g: MergedGame) => g.sources.map((s) => appidOf(s.config.steam_app_id)).filter((x): x is number => x !== null);

  for (const app of owned) {
    if (app.installed || present.has(app.appid)) continue;
    const entry = {
      source_id: source.id, source_name: source.name, source_type: "steam_library" as const,
      config: { name: app.name, executable: "", steam_app_id: app.appid, installed: false },
    };
    let target = targets.find((g) => targetAppids(g).includes(app.appid));
    if (!target) {
      target = targets.find((g) => g.name.toLowerCase() === app.name.toLowerCase()
        && targetAppids(g).every((id) => id === app.appid));
    }
    if (target) target.sources.push(entry);
    else out.push({ id: `steam-${app.appid}`, name: app.name, sources: [entry] });
    present.add(app.appid);
  }
  return out;
}

/** Owned apps from Steam's in-process stores, or null if unavailable. */
export function readOwnedApps(): OwnedApp[] | null {
  try {
    const w = window as any;
    const raw: unknown =
      w.collectionStore?.allGamesCollection?.allApps ??
      w.collectionStore?.allAppsCollection?.allApps ??
      w.appStore?.allApps;
    // An empty list means the stores are not populated yet (e.g. still loading at boot).
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return filterOwnedGames(raw as RawApp[]);
  } catch {
    return null;
  }
}

/**
 * Steam art for an app without any backend call: Steam's own cached landscape image when its
 * store exposes it, then the public CDN header. Layer them (first on top) so a missing
 * cached image falls through to the CDN.
 */
export function steamArtUrls(appid: number): string[] {
  const cdn = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
  try {
    const store = (window as any).appStore;
    if (typeof store?.GetAppOverviewByAppID === "function" && typeof store?.GetCachedLandscapeImageURLForApp === "function") {
      const overview = store.GetAppOverviewByAppID(appid);
      const url = overview ? store.GetCachedLandscapeImageURLForApp(overview) : null;
      if (typeof url === "string" && url && url !== cdn) return [url, cdn];
    }
  } catch { /* store unavailable */ }
  return [cdn];
}

/** CSS `background` value layering the given art URLs over a gradient placeholder. */
export function artBackground(urls: string[]): string {
  return [...urls.map((u) => `center / cover no-repeat url("${u}")`), "linear-gradient(135deg, #667eea, #764ba2)"].join(", ");
}
