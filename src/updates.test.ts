import { describe, it, expect, afterEach } from "vitest";
import { describeBuild, statusLabel, installViaDecky } from "./updates";

describe("describeBuild", () => {
  it("formats stable, main and development builds", () => {
    expect(describeBuild({ version: "0.1.9", channel: "stable", commit: "abcdef1234" })).toBe("0.1.9 (stable)");
    expect(describeBuild({ version: "0.1.8+main.abc1234", channel: "main", commit: "abc1234ffff" })).toBe("0.1.8+main.abc1234 (main · abc1234)");
    expect(describeBuild({ version: "0.1.0", channel: null, commit: null })).toBe("0.1.0 — Development build");
  });
});

describe("statusLabel", () => {
  it("maps statuses and prefers errors", () => {
    expect(statusLabel("up_to_date", null)).toBe("Up to date");
    expect(statusLabel("update_available", null)).toBe("Update available");
    expect(statusLabel("unknown", "Couldn't reach GitHub: offline")).toBe("Couldn't reach GitHub: offline");
    expect(statusLabel("unknown", null)).toBe("Unknown");
  });
});

describe("installViaDecky", () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("calls Decky's installer with install_type UPDATE (2), not INSTALL (0)", async () => {
    const calls: any[] = [];
    (globalThis as any).window = {
      DeckyBackend: { call: async (...args: any[]) => { calls.push(args); } },
    };

    const err = await installViaDecky("https://example.com/deckyfin.zip", "0.1.9");

    expect(err).toBeNull();
    expect(calls).toEqual([
      ["utilities/install_plugin", "https://example.com/deckyfin.zip", "Deckyfin", "0.1.9", null, 2],
    ]);
  });

  it("returns a guard message when window.DeckyBackend isn't available", async () => {
    (globalThis as any).window = {};
    const err = await installViaDecky("https://example.com/deckyfin.zip", "0.1.9");
    expect(err).toBe("Decky's installer isn't available");
  });

  it("returns the thrown error's message when the call rejects", async () => {
    (globalThis as any).window = {
      DeckyBackend: { call: async () => { throw new Error("boom"); } },
    };
    const err = await installViaDecky("https://example.com/deckyfin.zip", "0.1.9");
    expect(err).toBe("boom");
  });
});
