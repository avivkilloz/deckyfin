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
