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

/**
 * Count hidden ids that match a game currently in `games` (e.g. the library's
 * displayed list). Ids hidden while their source was mounted but now absent
 * (an unmounted/offline source) are intentionally not counted here — they stay
 * in the stored hidden set so the game is still hidden if the source returns,
 * but they shouldn't inflate the "N hidden games" count shown in Settings.
 */
export function countHiddenPresent<T extends { id: string }>(
  games: T[],
  hiddenIds: Set<string>
): number {
  if (hiddenIds.size === 0) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const g of games) {
    if (hiddenIds.has(g.id) && !seen.has(g.id)) {
      seen.add(g.id);
      count++;
    }
  }
  return count;
}
