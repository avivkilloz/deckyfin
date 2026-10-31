/** SteamID64 of the account logged in to Steam's UI, or null if unavailable (guarded). */
export function readActiveSteamId64(): string | null {
  try {
    const id = (window as any).App?.m_CurrentUser?.strSteamID;
    return typeof id === "string" && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
