# Steam Owned Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List owned-but-not-installed Steam games in Deckyfin (behind a Steam Library toggle), install / uninstall / verify them through Steam's own dialogs and calls with download progress, and add "Open in Steam Library" to every game page with a known Steam app id.

**Architecture:** The backend gains one per-source option (`show_uninstalled`). Everything else is frontend: `src/steamOwned.ts` reads the owned library from Steam's in-process stores and merges not-installed games into the backend's merged game list with pure, unit-tested helpers; `src/hooks/useSteamDownloads.ts` maps Steam's download callbacks to per-app progress with a pure, unit-tested mapper. Library cards, the Settings card and the game page consume those. vitest is added for the pure helpers.

**Tech Stack:** Python 3 (pytest), React 18 + TypeScript, `@decky/ui` / `@decky/api`, Rollup, vitest (new).

**Spec:** `docs/superpowers/specs/2026-10-31-steam-owned-games-design.md`

## Global Constraints

- Option key: `show_uninstalled` (bool), only on the `steam_library` source; default `False`.
- Not-installed entries: game id `steam-<appid>`, source entry config `{ name, executable: "", steam_app_id: appid, installed: false }` on the Steam Library source (`source_type: "steam_library"`).
- Merge rule for not-installed apps (same as sub-project 2): skip if a game already has a `steam_library` source with that appid; else attach to a non-built-in game matching `steam_app_id`, else name (case-insensitive) unless that target has a conflicting `steam_app_id`; else new game.
- Owned-app filter: Steam app type game only (`app_type === 1`), not hidden (`visible_in_game_list !== false`), not in tool appids `{228980, 1070560, 1391110, 1628350, 4183110, 1826330, 1161040}`.
- Steam calls: Install `SteamClient.Installs.OpenInstallWizard([appid])`; Uninstall `SteamClient.Installs.OpenUninstallWizard([appid], false)`; Verify `SteamClient.Apps.VerifyApp(appid)`; Open `Navigation.Navigate("/library/app/<appid>")`. Every SteamClient / window store access is guarded (`typeof … === "function"`, try/catch) and degrades to "unavailable".
- Modules unit-tested with vitest must not import `@decky/*` at module level.
- Card art fallback for games with a Steam app id: `https://cdn.cloudflare.steamstatic.com/steam/apps/<appid>/header.jpg`.
- Every focusable picker item keeps `margin: "0 2px"` and `padding: "4px 10px"`.
- Checks: `pytest tests/ -v`, `python -m py_compile main.py`, `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Commit messages end with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `py_modules/deckyfin_sources.py` (modify) | `set_source_option`, `show_uninstalled` default |
| `main.py` (modify) | `set_source_option` callable |
| `tests/test_sources.py` (modify) | option tests |
| `package.json` (modify), `vitest.config.ts` (create) | vitest |
| `src/steamOwned.ts` (create) + `src/steamOwned.test.ts` | owned-app reading/filtering/merging |
| `src/hooks/useSteamDownloads.ts` (create) + `src/downloadStates.ts` (create) + `src/downloadStates.test.ts` | download progress |
| `src/types.ts` (modify) | `Source.show_uninstalled`, `GameConfig.installed`, SteamClient typings |
| `src/components/SettingsPage.tsx` (modify) | toggle + counts |
| `src/components/GameLibrary.tsx`, `src/components/GameCard.tsx` (modify) | merge, badges, progress, filter, art fallback, reload on finish |
| `src/components/GameDetail.tsx` (modify) | not-installed view, Install/Verify/Uninstall/Open |

---

### Task 1: Backend `show_uninstalled` option

**Files:** Modify `py_modules/deckyfin_sources.py`, `main.py`; Test `tests/test_sources.py`.

**Interfaces:**
- Produces: `deckyfin_sources.set_source_option(source_id: str, key: str, value) -> bool`; `list_sources()` gives the `steam_library` record `show_uninstalled` (default `False`); callable `set_source_option(source_id, key, value) -> {"success": bool}`.

- [ ] **Step 1: Failing tests** — append to `tests/test_sources.py`:

```python
def test_steam_library_show_uninstalled_defaults_false(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {})
    mod = _reload_sources(tmp_path, monkeypatch)
    mod.ensure_builtin_sources()
    lib = next(s for s in mod.list_sources() if s["id"] == "steam-library")
    assert lib["show_uninstalled"] is False
    shortcuts = next(s for s in mod.list_sources() if s["id"] == "steam-shortcuts")
    assert "show_uninstalled" not in shortcuts


def test_set_source_option_persists_show_uninstalled(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {})
    mod = _reload_sources(tmp_path, monkeypatch)
    mod.ensure_builtin_sources()
    assert mod.set_source_option("steam-library", "show_uninstalled", True) is True
    lib = next(s for s in mod.list_sources() if s["id"] == "steam-library")
    assert lib["show_uninstalled"] is True


def test_set_source_option_rejects_invalid(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {})
    mod = _reload_sources(tmp_path, monkeypatch)
    mod.ensure_builtin_sources()
    local = mod.add_source("Games", "local", str(tmp_path), None)
    assert mod.set_source_option("nope", "show_uninstalled", True) is False
    assert mod.set_source_option("steam-library", "other", True) is False
    assert mod.set_source_option("steam-library", "show_uninstalled", "yes") is False
    assert mod.set_source_option("steam-shortcuts", "show_uninstalled", True) is False
    assert mod.set_source_option(local["id"], "show_uninstalled", True) is False
```

- [ ] **Step 2:** `pytest tests/test_sources.py -v` → new tests FAIL (`AttributeError: set_source_option`, missing key).

- [ ] **Step 3: Implement** in `py_modules/deckyfin_sources.py`:

```python
# Per-source options that the frontend may change, by source type → {key: type}
_SOURCE_OPTIONS = {STEAM_LIBRARY_SOURCE_TYPE: {"show_uninstalled": bool}}


def set_source_option(source_id: str, key: str, value) -> bool:
    """Set an allowed option on a source. Returns False for unknown source/key or wrong type."""
    sources = list_sources()
    for s in sources:
        if s["id"] != source_id:
            continue
        expected = _SOURCE_OPTIONS.get(s.get("type"), {}).get(key)
        if expected is None or not isinstance(value, expected):
            return False
        s[key] = value
        set_app_config({"sources": sources})
        return True
    return False
```

and in `list_sources()` add the default for the Store source:

```python
def list_sources() -> list:
    """Return all configured sources, normalizing missing enabled/builtin fields."""
    sources = get_app_config().get("sources", [])
    out = []
    for s in sources:
        s = {**s, "enabled": s.get("enabled", True), "builtin": s.get("builtin", False)}
        if s.get("type") == STEAM_LIBRARY_SOURCE_TYPE:
            s["show_uninstalled"] = s.get("show_uninstalled", False)
        out.append(s)
    return out
```

In `main.py`, import `set_source_option as _set_source_option` from `deckyfin_sources` and add next to `set_source_enabled`:

```python
    async def set_source_option(self, source_id: str, key: str, value) -> dict:
        return {"success": _set_source_option(source_id, key, value)}
```

- [ ] **Step 4:** `pytest tests/ -v` all PASS; `python -m py_compile main.py`.
- [ ] **Step 5:** Commit `feat: show_uninstalled option for the Steam Library source`.

---

### Task 2: vitest + owned-app helpers (`src/steamOwned.ts`)

**Files:** Modify `package.json`; Create `vitest.config.ts`, `src/steamOwned.ts`, `src/steamOwned.test.ts`; Modify `src/types.ts`.

**Interfaces:**
- Produces:
  - `type RawApp = { appid: number; display_name?: string; app_type?: number; installed?: boolean; visible_in_game_list?: boolean; per_client_data?: { installed?: boolean }[] }`
  - `type OwnedApp = { appid: number; name: string; installed: boolean }`
  - `filterOwnedGames(apps: RawApp[]): OwnedApp[]`
  - `mergeOwnedGames(games: MergedGame[], owned: OwnedApp[], source: { id: string; name: string }): MergedGame[]`
  - `readOwnedApps(): OwnedApp[] | null` (null = Steam store unavailable)
  - `GameConfig.installed?: boolean`

- [ ] **Step 1: vitest** — `npm install --save-dev vitest` (pin whatever version installs; record it). In `package.json` set `"test": "vitest run"`. Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

Make sure `tsconfig.json`'s `include: ["src/**/*"]` doesn't break `tsc --noEmit` on test files (vitest globals are imported explicitly, so no type changes are needed). Confirm `npm run build` (Rollup) does not bundle `*.test.ts` (it builds from `src/index.tsx`, so it shouldn't).

- [ ] **Step 2: Failing tests** — `src/steamOwned.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterOwnedGames, mergeOwnedGames } from "./steamOwned";
import type { MergedGame } from "./types";

const lib = { id: "steam-library", name: "Steam Library" };

const g = (id: string, name: string, type: string, config: Record<string, unknown> = {}): MergedGame => ({
  id, name,
  sources: [{ source_id: type, source_name: type, source_type: type as any, config: { name, executable: "", ...config } }],
});

describe("filterOwnedGames", () => {
  it("keeps visible games and reads installed state", () => {
    const out = filterOwnedGames([
      { appid: 10, display_name: "Halo", app_type: 1, installed: false },
      { appid: 11, display_name: "Doom", app_type: 1, per_client_data: [{ installed: true }] },
      { appid: 12, display_name: "OST", app_type: 4 },
      { appid: 13, display_name: "Hidden", app_type: 1, visible_in_game_list: false },
      { appid: 228980, display_name: "Steamworks Common Redistributables", app_type: 1 },
      { appid: 10, display_name: "Halo dup", app_type: 1 },
    ]);
    expect(out).toEqual([
      { appid: 10, name: "Halo", installed: false },
      { appid: 11, name: "Doom", installed: true },
    ]);
  });
});

describe("mergeOwnedGames", () => {
  it("adds a new entry for an unmatched not-installed game", () => {
    const out = mergeOwnedGames([], [{ appid: 7, name: "Bloodborne", installed: false }], lib);
    expect(out).toEqual([{
      id: "steam-7", name: "Bloodborne",
      sources: [{ source_id: "steam-library", source_name: "Steam Library", source_type: "steam_library",
        config: { name: "Bloodborne", executable: "", steam_app_id: 7, installed: false } }],
    }]);
  });

  it("ignores installed apps and apps already present as Store games", () => {
    const games = [g("steam-5", "Witcher", "steam_library", { steam_app_id: 5 })];
    const out = mergeOwnedGames(games, [
      { appid: 5, name: "Witcher", installed: false },
      { appid: 6, name: "Doom", installed: true },
    ], lib);
    expect(out).toEqual(games);
  });

  it("attaches to a source game by steam_app_id, else by name", () => {
    const byId = g("cp", "Cyberpunk Repack", "local", { steam_app_id: "1091500" });
    const byName = g("w3", "The Witcher 3", "mount");
    const out = mergeOwnedGames([byId, byName], [
      { appid: 1091500, name: "Cyberpunk 2077", installed: false },
      { appid: 292030, name: "the witcher 3", installed: false },
    ], lib);
    expect(out.map((x) => x.id)).toEqual(["cp", "w3"]);
    expect(out[0].sources.map((s) => s.source_type)).toEqual(["local", "steam_library"]);
    expect(out[1].sources.map((s) => s.source_type)).toEqual(["mount", "steam_library"]);
  });

  it("skips a name match whose steam_app_id conflicts, and never attaches to built-in-only games", () => {
    const conflicting = g("h", "Halo", "local", { steam_app_id: 999 });
    const orphan = g("shortcut-1", "Doom", "steam_shortcuts");
    const out = mergeOwnedGames([conflicting, orphan], [
      { appid: 10, name: "Halo", installed: false },
      { appid: 11, name: "Doom", installed: false },
    ], lib);
    expect(out.map((x) => x.id)).toEqual(["h", "shortcut-1", "steam-10", "steam-11"]);
  });

  it("does not mutate the input games", () => {
    const target = g("w3", "The Witcher 3", "mount");
    mergeOwnedGames([target], [{ appid: 292030, name: "The Witcher 3", installed: false }], lib);
    expect(target.sources).toHaveLength(1);
  });
});
```

- [ ] **Step 3:** `npm test` → FAIL (module missing).

- [ ] **Step 4: Implement** `src/steamOwned.ts` (no `@decky/*` imports):

```ts
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
```

Note: `GameSource.config` is typed `GameConfig`; add `installed?: boolean` to `GameConfig` in `src/types.ts` (with a short doc comment "Steam Library entries: false for owned-but-not-installed games"). If the `steam_app_id` type in `GameConfig` is `number`, the `"1091500"` test fixture needs a cast (`as any`) — keep the runtime check in `appidOf`.

- [ ] **Step 5:** `npm test` PASS; `npx tsc --noEmit -p .`; `npm run build`.
- [ ] **Step 6:** Commit `feat: owned Steam games helpers with vitest`.

---

### Task 3: Download progress (`downloadStates` + `useSteamDownloads`) and SteamClient typings

**Files:** Create `src/downloadStates.ts`, `src/downloadStates.test.ts`, `src/hooks/useSteamDownloads.ts`; Modify `src/types.ts`.

**Interfaces:**
- Produces:
  - `type DownloadState = { status: "downloading" | "queued" | "verifying"; progress: number }`
  - `toDownloadStates(items: RawDownloadItem[], overview: RawDownloadOverview | null): Record<number, DownloadState>`
  - `useSteamDownloads(): Record<number, DownloadState>`
  - Typings on the global `SteamClient`: `Installs.OpenInstallWizard(appIds: number[])`, `Installs.OpenUninstallWizard(appIds: number[], dontPrompt: boolean)`, `Apps.VerifyApp(appId: number)`, `Downloads.RegisterForDownloadItems(cb: (isDownloading: boolean, items: RawDownloadItem[]) => void): { unregister(): void }`, `Downloads.RegisterForDownloadOverview(cb: (overview: RawDownloadOverview) => void): { unregister(): void }` — all optional members (`?`) because they may not exist.

- [ ] **Step 1: Failing tests** — `src/downloadStates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toDownloadStates } from "./downloadStates";

describe("toDownloadStates", () => {
  it("maps the active item with progress and the rest as queued", () => {
    const out = toDownloadStates(
      [
        { appid: 10, active: true, completed: false },
        { appid: 11, active: false, completed: false },
        { appid: 12, active: false, completed: true },
      ],
      { update_appid: 10, update_bytes_downloaded: 25, update_bytes_to_download: 100, update_state: "Downloading" },
    );
    expect(out).toEqual({
      10: { status: "downloading", progress: 0.25 },
      11: { status: "queued", progress: 0 },
    });
  });

  it("reports verifying from the overview state and handles zero totals", () => {
    const out = toDownloadStates(
      [{ appid: 5, active: true, completed: false }],
      { update_appid: 5, update_bytes_downloaded: 0, update_bytes_to_download: 0, update_state: "Verifying" },
    );
    expect(out).toEqual({ 5: { status: "verifying", progress: 0 } });
  });

  it("works without an overview", () => {
    expect(toDownloadStates([{ appid: 1, active: true, completed: false }], null)).toEqual({ 1: { status: "downloading", progress: 0 } });
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL.

- [ ] **Step 3: Implement** `src/downloadStates.ts` (no `@decky/*` imports):

```ts
export type RawDownloadItem = { appid: number; active?: boolean; completed?: boolean; paused?: boolean };
export type RawDownloadOverview = {
  update_appid?: number;
  update_bytes_downloaded?: number;
  update_bytes_to_download?: number;
  update_state?: string;
};
export type DownloadState = { status: "downloading" | "queued" | "verifying"; progress: number };

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
```

`src/hooks/useSteamDownloads.ts`:

```ts
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
```

Add the SteamClient typings listed under Interfaces to `src/types.ts` (as optional members on the existing global `SteamClient` declaration; add `Installs` / `Downloads` interfaces).

- [ ] **Step 4:** `npm test` PASS; `npx tsc --noEmit -p .`; `npm run build`.
- [ ] **Step 5:** Commit `feat: Steam download progress hook and client typings`.

---

### Task 4: Settings card toggle and counts

**Files:** Modify `src/types.ts` (`Source.show_uninstalled?: boolean`), `src/components/SettingsPage.tsx`.

**Interfaces:** Consumes `set_source_option` (Task 1), `readOwnedApps` (Task 2).

- [ ] **Step 1:** Add `show_uninstalled?: boolean` to `Source` in `src/types.ts`.
- [ ] **Step 2:** In `SettingsPage.tsx` add `const setSourceOption = callable<[source_id: string, key: string, value: boolean], { success: boolean }>("set_source_option");`. On the Steam Library card (built-in source with `type === "steam_library"`), add a third button after Enable/Disable, styled like the other card buttons (`srcBtn`): label `Show not-installed` when off, `Hide not-installed` when on; on activate call `setSourceOption(src.id, "show_uninstalled", !src.show_uninstalled)` then reload sources (same pattern as `handleToggleSource`, including the in-flight guard). Hide it when the source is disabled.
- [ ] **Step 3:** Count line for Steam Library: `${installed} installed` (existing count from `get_builtin_source_summary`) plus, when `src.show_uninstalled` is on, ` · ${m} not installed` where `m = readOwnedApps()?.filter(a => !a.installed).length`, or ` · owned library unavailable` when `readOwnedApps()` returns `null`. Compute it in render (cheap) or memoize per sources change.
- [ ] **Step 4:** `npx tsc --noEmit -p .`; `npm run build`.
- [ ] **Step 5:** Commit `feat: Steam Library card toggle for not-installed games`.

---

### Task 5: Library — merge, badges, progress, filter, art fallback, reload on finish

**Files:** Modify `src/components/GameLibrary.tsx`, `src/components/GameCard.tsx`.

**Interfaces:** Consumes `readOwnedApps`, `mergeOwnedGames` (Task 2), `useSteamDownloads` (Task 3), `Source.show_uninstalled` (Task 4).

Read `GameLibrary.tsx` first: `loadData` (calls `getGames` then `setGames`), the `xferSources` list (the user's sources incl. built-ins, with `enabled` / `show_uninstalled`), `filteredGames`, the filter panel (`filterSteamStatus`), the three view modes (card/art/list) and how the selected game is opened (`openGame`) and kept while the detail page is shown.

- [ ] **Step 1: Merge.** Derive the displayed list:

```ts
const steamLibrarySource = xferSources.find((s) => s.type === "steam_library");
const showOwned = !!steamLibrarySource && steamLibrarySource.enabled !== false && !!steamLibrarySource.show_uninstalled;
const ownedApps = useMemo(() => (showOwned ? readOwnedApps() : null), [showOwned, games]);
const displayGames = useMemo(
  () => (showOwned && ownedApps && steamLibrarySource ? mergeOwnedGames(games, ownedApps, steamLibrarySource) : games),
  [games, ownedApps, showOwned, steamLibrarySource?.id],
);
```

and make `filteredGames` (and anything else that iterates the visible list) use `displayGames` instead of `games`. Keep `games` for logic that must only see backend games (e.g. batch actions), reading each use to decide.

- [ ] **Step 2: Not-installed helper.** `const isNotInstalled = (g: MergedGame) => g.sources.length > 0 && g.sources.every((s) => s.source_type === "steam_library" && s.config.installed === false);`

- [ ] **Step 3: Filter.** Add `type InstallFilter = "all" | "installed" | "not-installed"` state and a chip row "Installed / Not installed" in the filter panel (same style as the Steam status chips), shown only when `showOwned`; include it in the active-filter count and the clear-filters reset; apply it in `filteredGames` with `isNotInstalled`.

- [ ] **Step 4: Progress + reload.** `const downloads = useSteamDownloads();`. Keep a ref of the previous key set; when an appid present before is gone now, call `loadData()` (the backend then reports the newly installed game). After the reload, if a game detail page is open, replace the open game with the refreshed entry that has the same `id` (or whose sources include a `steam_library` source with that appid) so the page switches to the installed view.

- [ ] **Step 5: Cards.** Pass to `GameCard` (all view modes where cards/rows render): `notInstalled={isNotInstalled(game)}`, `download={downloads[appidOf(game)]}`, `steamAppId={appidOf(game)}` where `appidOf` returns the first `steam_app_id` among the game's sources (number) or `undefined`. In `GameCard.tsx`:
  - new optional props `notInstalled?: boolean`, `download?: DownloadState`, `steamAppId?: number`;
  - art fallback: when the backend returns no art and `steamAppId` is set, use `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
  - when `notInstalled`: card opacity 0.55 and a small "Not installed" badge (top-left of the art, same badge styling the card already uses for other badges);
  - when `download`: a 4px progress bar at the bottom of the art (`width: progress*100%`, Steam blue) and a label `"Queued"` / `"Verifying… N%"` / `"N%"`.
  If list/art view modes render rows without `GameCard`, apply the same badge/progress in those rows minimally (text badge + percentage).

- [ ] **Step 6:** `npm test`; `npx tsc --noEmit -p .`; `npm run build`.
- [ ] **Step 7:** Commit `feat: owned not-installed Steam games in the library with download progress`.

---

### Task 6: Game page — not-installed view, Install / Verify / Uninstall / Open in Steam Library

**Files:** Modify `src/components/GameDetail.tsx`.

**Interfaces:** Consumes `useSteamDownloads`, `DownloadState` (Task 3), SteamClient typings (Task 3), `GameConfig.installed` (Task 2).

Read the file's Store-game mode first (`isLibrarySource`, `isBuiltinSource`, `hasPrefix`, `steamInfo` effect, Steam Actions section, `handleApplyToSteamLibrary`).

- [ ] **Step 1: Flags.**

```ts
const isNotInstalled = isLibrarySource && currentConfig.installed === false;
const downloads = useSteamDownloads();
const appidForSteam = steamInfo?.unsigned_appid ?? (Number(currentConfig.steam_app_id) || undefined);
const download = appidForSteam ? downloads[appidForSteam] : undefined;
```

(`steamInfo` for not-installed Store games is already synthesized from `steam_app_id` by the existing effect.)

- [ ] **Step 2: Guarded Steam calls** (module-level helpers in this file):

```ts
const steamCall = (fn: () => void): string | null => {
  try { fn(); return null; } catch (e: any) { return e?.message || "Steam call failed"; }
};
const openInstall = (appid: number) => steamCall(() => {
  const f = (window as any).SteamClient?.Installs?.OpenInstallWizard;
  if (typeof f !== "function") throw new Error("Install isn't available in this Steam version");
  f([appid]);
});
const openUninstall = (appid: number) => steamCall(() => {
  const f = (window as any).SteamClient?.Installs?.OpenUninstallWizard;
  if (typeof f !== "function") throw new Error("Uninstall isn't available in this Steam version");
  f([appid], false);
});
const verifyApp = (appid: number) => steamCall(() => {
  const f = (window as any).SteamClient?.Apps?.VerifyApp;
  if (typeof f !== "function") throw new Error("Verify isn't available in this Steam version");
  f(appid);
});
```

Show a returned error with the existing `setFeedback({ ok: false, msg })`.

- [ ] **Step 3: Not-installed view.** When `isNotInstalled`, render (after the art header / Metadata) a section with:
  - a short line: "Not installed — install it through Steam."
  - if `download`: a progress bar (same style as the transfer progress bar used elsewhere in this file) with `Queued` / `Downloading in Steam… N%` / `Verifying… N%`;
  - else a primary green button "⬇ Install" → `openInstall(appidForSteam)`;
  - the SteamDB / ProtonDB links (reuse the existing link markup/URLs);
  and hide every other section that needs installed files: Game Settings, Launch Options, Collections, Proton Version, Dependencies, Save Paths, Steam Actions, Prefix Actions, Art Actions, Transfer Actions, Save Actions, Danger Zone. Implement as one `isNotInstalled` early branch where practical (e.g. wrap the existing sections in `{!isNotInstalled && (<>…</>)}`) rather than editing every condition.

- [ ] **Step 4: Installed Store game actions.** In Steam Actions when `isLibrarySource && !isNotInstalled`, add buttons below "Apply to Steam": "Verify files" → `verifyApp(appid)` (shows `download` progress when status is `verifying`), and "Uninstall…" → `openUninstall(appid)` (red text like other destructive buttons).

- [ ] **Step 5: Open in Steam Library (all games with an appid).** In Steam Actions (for every source type), when `appidForSteam` is known and the game is installed (`!isNotInstalled`), add a button "Open in Steam Library" → `Navigation.Navigate(\`/library/app/${appidForSteam}\`)`. For non-Steam shortcuts `steamInfo.unsigned_appid` is the shortcut's unsigned appid; for Store games it's the Store appid. Hidden when unknown.

- [ ] **Step 6:** `npm test`; `npx tsc --noEmit -p .`; `npm run build`.
- [ ] **Step 7:** Commit `feat: install, verify, uninstall and open-in-Steam on the game page`.

---

### Task 7: Verification

- [ ] **Step 1:** `pytest tests/ -v`; `python -m py_compile main.py`; `npm test`; `npx tsc --noEmit -p .`; `npm run build` — all clean.
- [ ] **Step 2 (manual, user on Deck/Big Picture):** enable Steam Library → "Show not-installed" → not-installed games appear dimmed with Steam art and a filter → Install opens Steam's dialog → progress on card and page → finished game becomes installed → Verify shows progress → Uninstall opens Steam's confirmation → "Open in Steam Library" works from a Store game, an orphan and a source game already in Steam. If no owned games appear, check the Settings card for "owned library unavailable" and report it (the store accessor in `readOwnedApps` may need adjusting).
