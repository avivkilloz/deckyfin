import { describe, it, expect } from "vitest";
import { steamDbUrl, protonDbUrl } from "./externalLinks";

describe("steamDbUrl", () => {
  it("links straight to the app page when an appid is known", () => {
    expect(steamDbUrl("The Witcher 3", 292030)).toBe("https://steamdb.info/app/292030/");
  });

  it("falls back to a search by cleaned-up name without an appid", () => {
    expect(steamDbUrl("Halo", undefined)).toBe("https://steamdb.info/search/?a=all&q=Halo");
  });

  it("strips a trailing parenthetical qualifier from the search query", () => {
    expect(steamDbUrl("Cyberpunk 2077 (GOTY Edition)")).toBe(
      "https://steamdb.info/search/?a=all&q=Cyberpunk%202077"
    );
  });

  it("URL-encodes the search query", () => {
    expect(steamDbUrl("Half-Life: Alyx")).toBe(
      "https://steamdb.info/search/?a=all&q=" + encodeURIComponent("Half-Life: Alyx")
    );
  });
});

describe("protonDbUrl", () => {
  it("links straight to the app page when an appid is known", () => {
    expect(protonDbUrl("The Witcher 3", 292030)).toBe("https://www.protondb.com/app/292030");
  });

  it("falls back to a search by cleaned-up name without an appid", () => {
    expect(protonDbUrl("Halo")).toBe("https://www.protondb.com/search?q=Halo");
  });

  it("strips a trailing parenthetical qualifier from the search query", () => {
    expect(protonDbUrl("Cyberpunk 2077 (GOTY Edition)")).toBe(
      "https://www.protondb.com/search?q=Cyberpunk%202077"
    );
  });
});
