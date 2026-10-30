"""Steam Library built-in source — installed Steam Store games."""

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


def list_library_folders(steam_root: Path) -> list:
    """Existing Steam library roots (folders containing `steamapps`), root first."""
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
        if key in seen or not (r / "steamapps").is_dir():
            continue
        seen.add(key)
        out.append(r)
    return out


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
                "has_prefix": prefix_path is not None or proton is not None,
                "size_on_disk": int(_ci_get(state, "SizeOnDisk", 0) or 0),
                "steam_launch_options": launch.get(str(appid), ""),
            })
    return games
