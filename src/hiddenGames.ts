/** Pure helper for the "Hide games from Deckyfin" library filter. No @decky/* imports. */

/**
 * Apply the "Show hidden" library filter.
 *
 * When `showHidden` is false (the default), games whose id is in `hiddenIds`
 * are excluded from the result. When true, all games are kept (callers dim
 * hidden entries and show a "Hidden" badge instead of excluding them).
 */
export function applyHiddenFilter<T extends { id: string }>(
  games: T[],
  hiddenIds: Set<string>,
  showHidden: boolean
): T[] {
  if (showHidden || hiddenIds.size === 0) return games;
  return games.filter((g) => !hiddenIds.has(g.id));
}
