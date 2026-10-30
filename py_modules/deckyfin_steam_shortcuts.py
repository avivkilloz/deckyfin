"""Steam Shortcuts built-in source — non-Steam shortcuts that no Deckyfin source owns."""

import os
from typing import Callable

from steam_games import list_nonsteam_games

LoadGames = Callable[[dict], list]


def _is_under(path: str, root: str) -> bool:
    p = os.path.normpath(path)
    r = os.path.normpath(root)
    return p == r or p.startswith(r.rstrip("/") + "/")


def build_ownership(sources: list, load_games: LoadGames) -> tuple:
    """Return (lower-cased owned names, owned source paths) across all non-builtin sources.

    Disabled sources count as owners. A source whose games can't be read still
    owns everything under its path.
    """
    names: set = set()
    paths: list = []
    for source in sources:
        if source.get("builtin"):
            continue
        if source.get("path"):
            paths.append(os.path.normpath(source["path"]))
        try:
            games = load_games(source) or []
        except Exception:
            games = []
        names.update(g["name"].lower() for g in games if g.get("name"))
    return names, paths


def find_orphans(shortcuts: list, owned_names: set, owned_paths: list) -> list:
    """Shortcuts whose name isn't owned and whose exe isn't under any owned path."""
    orphans = []
    for sc in shortcuts:
        if (sc.get("name") or "").lower() in owned_names:
            continue
        exe = sc.get("exe") or ""
        if exe and any(_is_under(exe, root) for root in owned_paths):
            continue
        orphans.append(sc)
    return orphans


def list_orphan_shortcuts(sources: list, load_games: LoadGames) -> list:
    """Orphan shortcuts for the current Steam user ([] if shortcuts.vdf is unavailable)."""
    shortcuts = list_nonsteam_games()
    if not shortcuts:
        return []
    names, paths = build_ownership(sources, load_games)
    return find_orphans(shortcuts, names, paths)
