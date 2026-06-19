"""Central store for ephemeral per-game-per-source runtime state.

Permanent game config (executable, proton version, etc.) lives in each
source's .deckyfin/config.json so it stays portable and shareable.
Ephemeral state (restart flags, steam snapshot, processing state, dep
snapshots) lives here in ~/.config/deckyfin/game_states.json so source
configs don't get polluted with transient data.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger("deckyfin")

STATE_FIELDS = frozenset({
    "needs_restart",
    "needs_restart_after_add",
    "steam_snapshot",
    "processing_state",
    "deps_snapshot",
})


def _state_file() -> Path:
    from deckyfin_config import get_app_config_path
    return get_app_config_path() / "game_states.json"


def _load() -> dict:
    p = _state_file()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save(store: dict) -> None:
    p = _state_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(store, indent=2), encoding="utf-8")


def get_game_state(source_id: str, game_name: str) -> dict:
    """Return the ephemeral state dict for a game, or {} if none stored."""
    return dict(_load().get(source_id, {}).get(game_name, {}))


def update_game_state(source_id: str, game_name: str, updates: dict) -> None:
    """Merge *updates* into the game's state. Setting a key to None removes it."""
    store = _load()
    source_store = store.setdefault(source_id, {})
    game_store = source_store.setdefault(game_name, {})
    for k, v in updates.items():
        if v is None:
            game_store.pop(k, None)
        else:
            game_store[k] = v
    _save(store)


def clear_all_restart_flags() -> None:
    """Clear needs_restart / needs_restart_after_add for every game in every source."""
    store = _load()
    changed = False
    for source_data in store.values():
        for game_data in source_data.values():
            for flag in ("needs_restart", "needs_restart_after_add"):
                if flag in game_data:
                    del game_data[flag]
                    changed = True
    if changed:
        _save(store)
