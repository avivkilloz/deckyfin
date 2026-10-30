import type { MergedGame } from "./types";

export type RawApp = {
  appid: number;
  display_name?: string;
  app_type?: number;
  installed?: boolean;
  visible_in_game_list?: boolean;
  per_client_data?: { installed?: boolean }[];
};
export type OwnedApp = { appid: number; name: string; installed: boolean };

const APP_TYPE_GAME = 1;
const TOOL_APPIDS = new Set([228980, 1070560, 1391110, 1628350, 4183110, 1826330, 1161040]);
const BUILTIN_TYPES = new Set(["steam_shortcuts", "steam_library"]);

export function filterOwnedGames(apps: RawApp[]): OwnedApp[] {
  const seen = new Set<number>();
  const out: OwnedApp[] = [];
  for (const a of apps) {
    if (!a || typeof a.appid !== "number" || seen.has(a.appid)) continue;
    if (a.app_type !== APP_TYPE_GAME || a.visible_in_game_list === false || TOOL_APPIDS.has(a.appid)) continue;
    seen.add(a.appid);
    const installed = a.installed ?? (a.per_client_data ?? []).some((c) => !!c?.installed);
    out.push({ appid: a.appid, name: a.display_name ?? String(a.appid), installed: !!installed });
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
    if (!Array.isArray(raw)) return null;
    return filterOwnedGames(raw as RawApp[]);
  } catch {
    return null;
  }
}
