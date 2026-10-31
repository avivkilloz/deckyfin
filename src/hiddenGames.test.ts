import { describe, it, expect } from "vitest";
import { applyHiddenFilter } from "./hiddenGames";

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
