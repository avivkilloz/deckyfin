import { describe, it, expect } from "vitest";
import { toDownloadStates, formatDownloadLabel, sameDownloadStates } from "./downloadStates";

const ov = (o: Record<string, unknown>) => ({
  update_appid: 0, update_bytes_downloaded: 0, update_bytes_to_download: 0,
  update_bytes_processed: 0, update_bytes_to_process: 0, update_state: "Updating", ...o,
});

describe("toDownloadStates", () => {
  it("maps the active item with download progress and the rest as queued", () => {
    const out = toDownloadStates(
      [
        { appid: 10, active: true, completed: false },
        { appid: 11, active: false, completed: false },
        { appid: 12, active: false, completed: true },
        { appid: 13, active: false, completed: false, paused: true },
      ],
      ov({ update_appid: 10, update_bytes_downloaded: 25, update_bytes_to_download: 100,
        update_bytes_processed: 10, update_bytes_to_process: 100 }),
    );
    expect(out).toEqual({
      10: { status: "downloading", progress: 0.25 },
      11: { status: "queued", progress: 0 },
      13: { status: "queued", progress: 0 },
    });
  });

  it("reports verifying from processed bytes when nothing is downloaded", () => {
    const out = toDownloadStates(
      [{ appid: 5, active: true, completed: false }],
      ov({ update_appid: 5, update_bytes_processed: 30, update_bytes_to_process: 120 }),
    );
    expect(out).toEqual({ 5: { status: "verifying", progress: 0.25 } });
  });

  it("reports verifying for appids the user asked to verify, with download bytes when present", () => {
    const out = toDownloadStates(
      [{ appid: 5, active: true, completed: false }, { appid: 6, active: false, completed: false }],
      ov({ update_appid: 5, update_bytes_downloaded: 50, update_bytes_to_download: 100 }),
      new Set([5, 6]),
    );
    expect(out).toEqual({ 5: { status: "verifying", progress: 0.5 }, 6: { status: "queued", progress: 0 } });
  });

  it("handles zero totals and a missing overview", () => {
    expect(toDownloadStates([{ appid: 5, active: true, completed: false }], ov({ update_appid: 5 })))
      .toEqual({ 5: { status: "downloading", progress: 0 } });
    expect(toDownloadStates([{ appid: 1, active: true, completed: false }], null)).toEqual({ 1: { status: "downloading", progress: 0 } });
  });
});

describe("sameDownloadStates", () => {
  it("compares keys, status and progress rounded to 1%", () => {
    const a = { 1: { status: "downloading" as const, progress: 0.501 } };
    expect(sameDownloadStates(a, { 1: { status: "downloading", progress: 0.503 } })).toBe(true);
    expect(sameDownloadStates(a, { 1: { status: "downloading", progress: 0.52 } })).toBe(false);
    expect(sameDownloadStates(a, { 1: { status: "verifying", progress: 0.501 } })).toBe(false);
    expect(sameDownloadStates(a, { 2: { status: "downloading", progress: 0.501 } })).toBe(false);
    expect(sameDownloadStates(a, {})).toBe(false);
    expect(sameDownloadStates({}, {})).toBe(true);
  });
});

describe("formatDownloadLabel", () => {
  it("labels queued, verifying and downloading states", () => {
    expect(formatDownloadLabel({ status: "queued", progress: 0 })).toBe("Queued");
    expect(formatDownloadLabel({ status: "verifying", progress: 0.5 })).toBe("Verifying… 50%");
    expect(formatDownloadLabel({ status: "downloading", progress: 0.333 })).toBe("33%");
  });
});
