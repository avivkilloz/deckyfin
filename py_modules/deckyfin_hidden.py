"""Hidden games — list of merged game ids hidden from the Deckyfin library.

Persisted in the plugin app config (~/.config/deckyfin/config.json) under the
`hidden_games` key, as a plain list of MergedGame.id strings. Hidden state is
deliberately stored centrally rather than in per-source game configs so it
survives rescans and applies uniformly across sources.
"""

import logging
from typing import Any, Dict, List, Set, Tuple

from deckyfin_config import get_app_config, set_app_config, slugify
from deckyfin_consts import LOGGER_CONFIG

logger = logging.getLogger(LOGGER_CONFIG)

HIDDEN_GAMES_KEY = "hidden_games"


def get_hidden_games() -> List[str]:
    """Return the list of hidden merged game ids (deduped, strings only)."""
    hidden = get_app_config().get(HIDDEN_GAMES_KEY, [])
    if not isinstance(hidden, list):
        return []
    seen: List[str] = []
    for h in hidden:
        if isinstance(h, str) and h not in seen:
            seen.append(h)
    return seen


def set_game_hidden(game_id: str, hidden: bool) -> List[str]:
    """Add or remove `game_id` from the hidden list. Idempotent and deduping.

    Invalid `game_id` (not a non-empty string) is rejected as a no-op: the
    current list is returned unchanged.
    """
    current = get_hidden_games()
    if not isinstance(game_id, str) or not game_id:
        logger.warning("set_game_hidden: rejected invalid game_id=%r", game_id)
        return current

    if hidden:
        if game_id not in current:
            current.append(game_id)
    else:
        current = [g for g in current if g != game_id]

    set_app_config({HIDDEN_GAMES_KEY: current})
    logger.info("set_game_hidden id=%s hidden=%s", game_id, hidden)
    return current


def filter_hidden(games: List[Dict[str, Any]], hidden_ids: Set[str]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Split `games` into (visible, skipped_names) based on `hidden_ids`.

    Derives each game's id the same way main.get_games does: `game.get("id")`,
    falling back to `slugify(path or name)` for entries written before ids
    were stored. Pure function — no I/O.
    """
    hidden_set = set(hidden_ids)
    visible: List[Dict[str, Any]] = []
    skipped: List[str] = []
    for game in games:
        game_id = game.get("id") or slugify(game.get("path") or game.get("name") or "")
        if game_id in hidden_set:
            skipped.append(game.get("name", ""))
        else:
            visible.append(game)
    return visible, skipped
