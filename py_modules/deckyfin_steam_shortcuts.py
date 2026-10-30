"""Steam Shortcuts built-in source — non-Steam shortcuts that no Deckyfin source owns."""

import json
import os
from pathlib import Path
from typing import Callable

from deckyfin_config import get_app_config_path, get_games_config, get_games_config_file, save_games_config
from deckyfin_consts import STEAM_SHORTCUTS_SOURCE_TYPE
from steam_games import list_nonsteam_games

LoadGames = Callable[[dict], list]


def _is_under(path: str, root: str) -> bool:
    p = os.path.normpath(path)
    r = os.path.normpath(root)
    return p == r or p.startswith(r.rstrip("/") + "/")


def _config_exists(source_path: str) -> bool:
    try:
        return get_games_config_file(Path(source_path)).is_file()
    except Exception:
        return False


def build_ownership(sources: list, load_games: LoadGames) -> tuple:
    """Return (lower-cased owned names, owned source paths) across all non-builtin sources.

    A source whose game list is known (enabled, config file present and loadable)
    owns only the games listed in it — so a game removed from the source but left
    in Steam becomes an orphan. When the list is unknown (disabled, offline mount,
    unreadable config) the source falls back to owning everything under its path.
    Only local sources take part: mount and agent sources can't add games to Steam,
    so a same-named game there must not hide an orphan.
    """
    names: set = set()
    paths: list = []
    for source in sources:
        if source.get("builtin") or source.get("type") != "local":
            continue
        path = source.get("path")
        games = None
        if source.get("enabled") is not False and path and _config_exists(path):
            try:
                games = load_games(source) or []
            except Exception:
                games = None
        if games is None:
            if path:
                paths.append(os.path.normpath(path))
            continue
        names.update(g["name"].lower() for g in games if g.get("name"))
    return names, paths


def attach_orphans_by_name(games: list) -> list:
    """Fold each orphan-only merged game into a non-orphan game with the same name.

    `games` is get_games' merged list ({id, name, sources: [{source_type, ...}]}).
    The orphan's source entry is appended to the matching game, so the game page
    can switch between it and the other source (e.g. to copy saves).
    """
    def is_orphan(g):
        return bool(g["sources"]) and all(s["source_type"] == STEAM_SHORTCUTS_SOURCE_TYPE for s in g["sources"])

    by_name = {g["name"].lower(): g for g in games if not is_orphan(g)}
    out = []
    for g in games:
        target = by_name.get(g["name"].lower()) if is_orphan(g) else None
        if target is not None:
            target["sources"].extend(g["sources"])
        else:
            out.append(g)
    return out


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


def store_root() -> Path:
    """Folder whose .deckyfin/config.json holds Deckyfin-only data for orphans."""
    return get_app_config_path() / "steam_shortcuts"


def _snapshot(game: dict) -> str:
    # Key order must match GameDetail's steamNeedsSync comparison object.
    return json.dumps({
        "name": game["name"],
        "executable": game["executable"],
        "start_dir": game["start_dir"] or None,
        "launch_options": game["launch_options"] or None,
        "proton_version": game["proton_version"],
        "collections": game["collections"],
    })


def load_shortcut_games(sources: list, load_games: LoadGames) -> list:
    """Game configs for every orphan shortcut, merged with stored Deckyfin data."""
    orphans = list_orphan_shortcuts(sources, load_games)
    root = store_root()
    config = get_games_config(root)
    stored_list = config.get("games", [])
    stored = {g.get("name"): g for g in stored_list}

    # Prune entries whose shortcut is gone. Skip when there are no orphans at all
    # (shortcuts.vdf may be temporarily unreadable).
    if orphans:
        names = {o["name"] for o in orphans}
        kept = [g for g in stored_list if g.get("name") in names]
        if len(kept) != len(stored_list):
            try:
                save_games_config({**config, "games": kept}, root)
            except Exception:
                pass

    games = []
    for o in orphans:
        game = dict(stored.get(o["name"]) or {})
        game.update({
            "id": f"shortcut-{o['unsigned_appid']}",
            "name": o["name"],
            "executable": o["exe"],
            "start_dir": o["start_dir"],
            "launch_options": o["launch_options"],
            "collections": o["collections"],
            "proton_version": o["current_proton"],
            "shortcut_app_id": o["unsigned_appid"],
            # The VDF launch_options string already contains any launcher prefix
            # (MangoHud, gamescope, etc). A stored selected_launchers would make
            # GameDetail's buildLaunchOptions prepend the same launcher again on
            # every Update, duplicating it. Orphan shortcuts have no concept of
            # "selected launchers" separate from the raw launch_options string.
            "selected_launchers": [],
        })
        game["steam_snapshot"] = _snapshot(game)
        games.append(game)
    return games


def upsert_store_entry(name: str, updates: dict, root: Path = None) -> dict:
    """Merge `updates` into the stored entry for `name`, creating it if missing.

    `root` is the built-in source's config root (defaults to the Steam Shortcuts store).
    """
    root = root or store_root()
    config = get_games_config(root)
    games = config.get("games", [])
    for g in games:
        if g.get("name") == name:
            g.update(updates)
            entry = g
            break
    else:
        entry = {"name": name, **updates}
        games.append(entry)
    save_games_config({**config, "games": games}, root)
    return entry
