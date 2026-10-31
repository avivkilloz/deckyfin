import { describe, it, expect } from "vitest";
import { applyHiddenFilter, countHiddenPresent } from "./hiddenGames";

type G = { id: string; name: string };

const games: G[] = [
  { id: "game-a", name: "Game A" },
  { id: "game-b", name: "Game B" },
  { id: "game-c", name: "Game C" },
];

describe("applyHiddenFilter", () => {
  it("returns all games unchanged when no ids are hidden", () => {
    expect(applyHiddenFilter(games, new Set(), false)).toEqual(games);
    expect(applyHiddenFilter(games, new Set(), true)).toEqual(games);
  });

  it("excludes hidden games by default (showHidden=false)", () => {
    const out = applyHiddenFilter(games, new Set(["game-b"]), false);
    expect(out.map((g) => g.id)).toEqual(["game-a", "game-c"]);
  });

  it("keeps hidden games in the list when showHidden=true", () => {
    const out = applyHiddenFilter(games, new Set(["game-b"]), true);
    expect(out.map((g) => g.id)).toEqual(["game-a", "game-b", "game-c"]);
  });

  it("excludes multiple hidden ids", () => {
    const out = applyHiddenFilter(games, new Set(["game-a", "game-c"]), false);
    expect(out.map((g) => g.id)).toEqual(["game-b"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...games];
    applyHiddenFilter(games, new Set(["game-a"]), false);
    expect(games).toEqual(copy);
  });
});

describe("countHiddenPresent", () => {
  it("returns 0 when nothing is hidden", () => {
    expect(countHiddenPresent(games, new Set())).toBe(0);
  });

  it("counts hidden ids that are present in the given games list", () => {
    expect(countHiddenPresent(games, new Set(["game-a", "game-c"]))).toBe(2);
  });

  it("does not count hidden ids for games no longer in the list (e.g. an unmounted source)", () => {
    // "game-z" was hidden while its source was mounted, then the source went away.
    // It must not be dropped from the stored hidden set, but it also must not be
    // counted here since it isn't part of what's currently displayed.
    const out = countHiddenPresent(games, new Set(["game-a", "game-z"]));
    expect(out).toBe(1);
  });

  it("does not double-count a duplicate game id in the list", () => {
    const withDupe: G[] = [...games, { id: "game-a", name: "Game A (dupe)" }];
    expect(countHiddenPresent(withDupe, new Set(["game-a"]))).toBe(1);
  });
});
