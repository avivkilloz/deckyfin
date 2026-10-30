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
