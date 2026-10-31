export type BuildInfo = { version: string; channel: "stable" | "main" | null; commit: string | null; built_at?: string | null };
export type LatestInfo = { version: string; commit: string | null; published_at: string | null; zip_url: string; html_url: string | null };

export function describeBuild(b: BuildInfo): string {
  if (!b.channel) return `${b.version} — Development build`;
  if (b.channel === "main") return `${b.version} (main · ${(b.commit ?? "").slice(0, 7)})`;
  return `${b.version} (stable)`;
}

export function statusLabel(status: string, error: string | null): string {
  if (error) return error;
  if (status === "up_to_date") return "Up to date";
  if (status === "update_available") return "Update available";
  return "Unknown";
}

/** Ask Decky Loader to install the zip (Decky shows its own confirmation). Returns an error message or null. */
export async function installViaDecky(url: string, version: string): Promise<string | null> {
  try {
    const call = (window as any).DeckyBackend?.call;
    if (typeof call !== "function") return "Decky's installer isn't available";
    await (window as any).DeckyBackend.call("utilities/install_plugin", url, "Deckyfin", version, null, 0);
    return null;
  } catch (e: any) {
    return e?.message || "Install failed";
  }
}
