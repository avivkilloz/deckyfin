"""Source management for Deckyfin — CRUD, migration, capabilities, game loading."""

import os
import shutil
import uuid
import json as _json
import urllib.request
from pathlib import Path
from typing import Optional

from deckyfin_config import get_app_config, set_app_config, get_games_config
from deckyfin_consts import SOURCES_FILE


# ── Source CRUD ───────────────────────────────────────────────────────────────

def list_sources() -> list:
    """Return all configured sources."""
    return get_app_config().get("sources", [])


def get_source_by_id(source_id: str) -> Optional[dict]:
    """Return a source dict by id, or None."""
    return next((s for s in list_sources() if s["id"] == source_id), None)


def add_source(name: str, type_: str, path: Optional[str], url: Optional[str]) -> dict:
    """Add a new source and return it."""
    source = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "type": type_,
        "path": path,
        "url": url,
    }
    sources = list_sources()
    sources.append(source)
    set_app_config({"sources": sources})
    return source


def remove_source(source_id: str) -> bool:
    """Remove source by id. Returns True if found and removed."""
    sources = list_sources()
    new_sources = [s for s in sources if s["id"] != source_id]
    if len(new_sources) == len(sources):
        return False
    set_app_config({"sources": new_sources})
    return True


def reorder_source(source_id: str, direction: str) -> bool:
    """Move source up or down in the list. Returns True if moved."""
    sources = list_sources()
    idx = next((i for i, s in enumerate(sources) if s["id"] == source_id), None)
    if idx is None:
        return False
    if direction == "up" and idx > 0:
        sources[idx - 1], sources[idx] = sources[idx], sources[idx - 1]
    elif direction == "down" and idx < len(sources) - 1:
        sources[idx], sources[idx + 1] = sources[idx + 1], sources[idx]
    else:
        return False
    set_app_config({"sources": sources})
    return True


# ── Migration ─────────────────────────────────────────────────────────────────

def migrate_games_folder_to_source() -> bool:
    """Convert legacy games_folder to sources list. Returns True if migration ran."""
    config = get_app_config()
    if "sources" in config or "games_folder" not in config:
        return False
    source = {
        "id": str(uuid.uuid4())[:8],
        "name": "Games",
        "type": "local",
        "path": config["games_folder"],
        "url": None,
    }
    set_app_config({"sources": [source]})
    return True


# ── Capabilities ──────────────────────────────────────────────────────────────

def _is_path_writable(path: str) -> bool:
    try:
        return os.access(path, os.W_OK)
    except Exception:
        return False


def _agent_get(url: str, path: str) -> dict:
    req = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return _json.loads(resp.read().decode())


def detect_capabilities(source: dict) -> dict:
    """Return {can_play, can_write_config, can_download_to} for a source."""
    t = source.get("type")
    if t == "agent":
        try:
            data = _agent_get(source["url"], "/capabilities")
            return {
                "can_play": False,
                "can_write_config": bool(data.get("can_write_config", False)),
                "can_download_to": bool(data.get("can_download_to", False)),
            }
        except Exception:
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
    writable = _is_path_writable(source.get("path", ""))
    return {
        "can_play": t == "local",
        "can_write_config": writable,
        "can_download_to": writable,
    }


# ── Disk Usage ────────────────────────────────────────────────────────────────

def get_disk_usage(source: dict) -> dict:
    """Return {used, total, free} in bytes. Returns None values on failure."""
    null = {"used": None, "total": None, "free": None}
    t = source.get("type")
    if t == "agent":
        try:
            return _agent_get(source["url"], "/disk")
        except Exception:
            return null
    path = source.get("path")
    if not path:
        return null
    try:
        usage = shutil.disk_usage(path)
        return {"used": usage.used, "total": usage.total, "free": usage.free}
    except Exception:
        return null


# ── Per-source game loading ───────────────────────────────────────────────────

def load_source_games(source: dict) -> list:
    """Load all game configs from a source. Returns [] on any failure."""
    t = source.get("type")
    if t == "agent":
        try:
            return _agent_get(source["url"], "/games")
        except Exception:
            return []
    # local or mount — read from <source_path>/.deckyfin/config.json
    path = source.get("path")
    if not path:
        return []
    try:
        config = get_games_config(Path(path))
        return config.get("games", [])
    except PermissionError:
        raise  # propagate so caller can retry as FUSE mount owner
    except Exception:
        return []
