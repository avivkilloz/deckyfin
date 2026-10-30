"""Steam Library built-in source — installed Steam Store games."""

import json
import os
from pathlib import Path

_INSTALLED_FLAG = 4
_TOOL_APPIDS = {228980, 1070560, 1391110, 1628350, 4183110, 1826330, 1161040}


def _load_vdf(path: Path) -> dict:
    import vdf
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return vdf.load(f)


def _ci_get(d: dict, key: str, default=None):
    """Case-insensitive dict lookup (Steam's VDF key casing varies)."""
    if key in d:
        return d[key]
    low = key.lower()
    for k, v in d.items():
        if k.lower() == low:
            return v
    return default


def _is_tool(appid: int, name: str) -> bool:
    return (
        appid in _TOOL_APPIDS
        or name.startswith("Proton ")
        or name in ("Proton Experimental", "Proton Hotfix")
        or name.startswith("Steam Linux Runtime")
    )


def _listed_library_roots(steam_root: Path) -> list:
    """Every library root listed in libraryfolders.vdf (deduplicated, root first)."""
    roots = []
    try:
        data = _load_vdf(steam_root / "steamapps" / "libraryfolders.vdf")
        folders = _ci_get(data, "libraryfolders", {}) or {}
        for key, val in folders.items():
            if not key.isdigit():
                continue
            path = _ci_get(val, "path") if isinstance(val, dict) else val
            if path:
                roots.append(Path(path))
    except Exception:
        pass
    if not roots:
        roots = [Path(steam_root)]
    out, seen = [], set()
    for r in roots:
        key = os.path.normpath(str(r))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def list_library_folders(steam_root: Path) -> list:
    """Existing Steam library roots (folders containing `steamapps`), root first."""
    return [r for r in _listed_library_roots(Path(steam_root)) if (r / "steamapps").is_dir()]


def has_missing_libraries(steam_root: Path) -> bool:
    """True when a library listed in libraryfolders.vdf is unavailable (e.g. SD card out)."""
    return any(not (r / "steamapps").is_dir() for r in _listed_library_roots(Path(steam_root)))


def _steam_section(data: dict, root_key: str) -> dict:
    steam = _ci_get(data, root_key, {}) or {}
    for k in ("Software", "Valve", "Steam"):
        steam = _ci_get(steam, k, {}) or {}
    return steam


def read_compat_mapping(steam_root: Path) -> dict:
    """{appid: tool name} from the global config.vdf CompatToolMapping."""
    try:
        data = _load_vdf(Path(steam_root) / "config" / "config.vdf")
    except Exception:
        return {}
    mapping = _ci_get(_steam_section(data, "InstallConfigStore"), "CompatToolMapping", {}) or {}
    return {k: v.get("name") for k, v in mapping.items() if isinstance(v, dict) and v.get("name")}


def read_launch_options(steam_root: Path, user_id: str) -> dict:
    """{appid: LaunchOptions} for apps that have non-empty launch options."""
    try:
        data = _load_vdf(Path(steam_root) / "userdata" / str(user_id) / "config" / "localconfig.vdf")
    except Exception:
        return {}
    apps = _ci_get(_steam_section(data, "UserLocalConfigStore"), "apps", {}) or {}
    out = {}
    for appid, entry in apps.items():
        if isinstance(entry, dict):
            opts = _ci_get(entry, "LaunchOptions", "")
            if opts:
                out[appid] = opts
    return out


def list_installed_games(steam_root: Path, compat: dict, launch: dict) -> list:
    """Installed, non-tool Store games across all library folders."""
    games = []
    for lib in list_library_folders(Path(steam_root)):
        steamapps = lib / "steamapps"
        for manifest in sorted(steamapps.glob("appmanifest_*.acf")):
            try:
                state = _ci_get(_load_vdf(manifest), "AppState", {}) or {}
                appid = int(_ci_get(state, "appid"))
                flags = int(_ci_get(state, "StateFlags", 0) or 0)
            except Exception:
                continue
            name = _ci_get(state, "name", "") or ""
            if not flags & _INSTALLED_FLAG or _is_tool(appid, name):
                continue
            pfx = steamapps / "compatdata" / str(appid) / "pfx"
            prefix_path = str(pfx) if pfx.is_dir() else None
            proton = compat.get(str(appid))
            games.append({
                "appid": appid,
                "name": name,
                "library_path": str(lib),
                "install_dir": str(steamapps / "common" / (_ci_get(state, "installdir", "") or "")),
                "prefix_path": prefix_path,
                "proton_version": proton,
                # A Steam Linux Runtime mapping runs the game natively — no Wine prefix.
                "has_prefix": prefix_path is not None
                or (proton is not None and not proton.lower().startswith("steamlinuxruntime")),
                "size_on_disk": int(_ci_get(state, "SizeOnDisk", 0) or 0),
                "steam_launch_options": launch.get(str(appid), ""),
            })
    return games


def store_root() -> Path:
    """Folder whose .deckyfin/config.json holds Deckyfin-only data for Store games."""
    from deckyfin_config import get_app_config_path
    return get_app_config_path() / "steam_library"


def _snapshot(game: dict) -> str:
    # Key order must match GameDetail's steamNeedsSync object (executable/start_dir
    # are undefined for Store games and dropped by JSON.stringify).
    return json.dumps({
        "name": game["name"],
        "launch_options": game["launch_options"] or None,
        "proton_version": game["proton_version"],
        "collections": game["collections"],
    })


def load_library_games(steam_root: Path = None, user_id: str = None) -> list:
    """Game configs for installed Store games, merged with stored Deckyfin data."""
    from deckyfin_config import get_games_config, save_games_config
    try:
        if steam_root is None:
            from steam_utils import find_steam_root
            steam_root = find_steam_root()
        if user_id is None:
            from steam_utils import get_user_id
            user_id = get_user_id()
    except Exception:
        return []
    if not steam_root:
        return []
    installed = list_installed_games(
        Path(steam_root), read_compat_mapping(Path(steam_root)), read_launch_options(Path(steam_root), user_id),
    )
    root = store_root()
    config = get_games_config(root)
    stored_list = config.get("games", [])

    matched = {}  # installed appid -> index into stored_list
    for g in installed:
        idx = _match_store_entry(stored_list, g["appid"], g["name"])
        if idx is not None:
            matched[g["appid"]] = idx

    # Prune entries of uninstalled games — but only when every listed library is
    # present (an unmounted SD card would otherwise wipe its games' data) and the
    # scan found something (Steam files may be temporarily unreadable).
    if installed and not has_missing_libraries(Path(steam_root)):
        keep = set(matched.values())
        kept = [e for i, e in enumerate(stored_list) if i in keep]
        if len(kept) != len(stored_list):
            try:
                save_games_config({**config, "games": kept}, root)
            except Exception:
                pass

    games = []
    for g in installed:
        idx = matched.get(g["appid"])
        entry = dict(stored_list[idx]) if idx is not None else {}
        game = {
            **entry,
            "id": f"steam-{g['appid']}",
            "name": g["name"],
            "steam_app_id": g["appid"],
            "library_path": g["library_path"],
            "install_dir": g["install_dir"],
            "prefix_path": g["prefix_path"],
            "has_prefix": g["has_prefix"],
            "size_on_disk": g["size_on_disk"],
            # Steam owns these for Store games; stored values are ignored.
            "launch_options": g["steam_launch_options"],
            "proton_version": g["proton_version"],
            "selected_launchers": [],
            "collections": entry.get("collections") or [],
        }
        game["steam_snapshot"] = _snapshot({**game, "collections": []})
        games.append(game)
    return games


def _appid_of(entry: dict):
    try:
        return int(entry.get("steam_app_id"))
    except (TypeError, ValueError):
        return None


def _match_store_entry(stored_list: list, appid: int, name: str):
    """Index of the stored entry for a game: by steam_app_id first, then by name.

    A name match whose entry records a different steam_app_id belongs to another game.
    """
    by_appid = [i for i, e in enumerate(stored_list) if _appid_of(e) == appid]
    if by_appid:
        return next((i for i in by_appid if stored_list[i].get("name") == name), by_appid[0])
    for i, e in enumerate(stored_list):
        if e.get("name") == name and _appid_of(e) is None:
            return i
    return None


# Fields Steam owns for Store games — never persisted in the Deckyfin store.
STEAM_OWNED_FIELDS = ("proton_version", "launch_options", "selected_launchers", "executable", "start_dir")


def store_config_updates(updates: dict, steam_app_id) -> dict:
    """Config updates to persist for a Store game: Steam-owned fields dropped,
    steam_app_id recorded so the entry survives a rename."""
    out = {k: v for k, v in updates.items() if k not in STEAM_OWNED_FIELDS}
    if out and steam_app_id is not None:
        out["steam_app_id"] = steam_app_id
    return out
