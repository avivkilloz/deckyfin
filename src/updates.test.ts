import { describe, it, expect } from "vitest";
import { describeBuild, statusLabel } from "./updates";

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
