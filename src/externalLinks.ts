/** Pure URL builders for the SteamDB/ProtonDB lookup links shown in GameDetail. No @decky/* imports. */

/** Drop a trailing "(...)" qualifier (e.g. "(GOTY Edition)") before searching by name. */
function cleanName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*$/, "").trim();
}

/** SteamDB page for `appid`, or a SteamDB search for `name` when the appid isn't known. */
export function steamDbUrl(name: string, appid?: number | null): string {
  if (appid) return `https://steamdb.info/app/${appid}/`;
  return `https://steamdb.info/search/?a=all&q=${encodeURIComponent(cleanName(name))}`;
}

/** ProtonDB page for `appid`, or a ProtonDB search for `name` when the appid isn't known. */
export function protonDbUrl(name: string, appid?: number | null): string {
  if (appid) return `https://www.protondb.com/app/${appid}`;
  return `https://www.protondb.com/search?q=${encodeURIComponent(cleanName(name))}`;
}
