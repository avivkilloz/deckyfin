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


# ── Filesystem helpers ────────────────────────────────────────────────────────

_NETWORK_FSTYPES = frozenset({
    "cifs", "smbfs",                          # SMB/Windows shares
    "nfs", "nfs4", "nfs3",                    # NFS
    "fuse.sshfs",                             # SSHFS
    "fuse.davfs",                             # WebDAV
    "fuse.rclone", "fuse.s3fs",               # cloud storage
    "glusterfs", "ceph",                      # distributed FS
    "afs", "ncpfs",                           # AFS / Novell
})


def _fstype_for_path(path: str) -> Optional[str]:
    """Return the filesystem type of the mount point that covers `path`."""
    try:
        real = os.path.realpath(path)
        best_len = -1
        best_fstype = None
        with open("/proc/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                mnt, fstype = parts[1], parts[2]
                mnt_norm = mnt.rstrip("/") or "/"
                if real == mnt_norm or real.startswith(mnt_norm + "/"):
                    if len(mnt_norm) > best_len:
                        best_len = len(mnt_norm)
                        best_fstype = fstype
        return best_fstype
    except Exception:
        return None


def _validate_local_path(path: str) -> None:
    """Raise ValueError if `path` is unsuitable as a local source."""
    p = Path(path)
    if not p.exists():
        raise ValueError(f"Path does not exist: {path}")
    if not p.is_dir():
        raise ValueError(f"Path is not a directory: {path}")
    if not os.access(str(p), os.W_OK):
        raise ValueError(f"Path is not writable (Deckyfin needs to create a .deckyfin folder inside it): {path}")
    fstype = _fstype_for_path(str(p))
    if fstype in _NETWORK_FSTYPES:
        raise ValueError(
            f"'{path}' is on a network filesystem ({fstype}). "
            "Use source type 'Mount' for network paths — it skips local-only operations "
            "like Proton prefix init that won't work over the network."
        )


# ── Source CRUD ───────────────────────────────────────────────────────────────

def list_sources() -> list:
    """Return all configured sources, normalizing missing enabled field to True."""
    sources = get_app_config().get("sources", [])
    return [{**s, "enabled": s.get("enabled", True)} for s in sources]


def get_source_by_id(source_id: str) -> Optional[dict]:
    """Return a source dict by id, or None."""
    return next((s for s in list_sources() if s["id"] == source_id), None)


def add_source(name: str, type_: str, path: Optional[str], url: Optional[str]) -> dict:
    """Add a new source and return it."""
    if type_ == "local" and path:
        _validate_local_path(path)
    source = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "type": type_,
        "path": path,
        "url": url,
        "enabled": True,
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


def set_source_enabled(source_id: str, enabled: bool) -> bool:
    """Set the enabled flag on a source. Returns True if found, False if not."""
    sources = list_sources()
    for s in sources:
        if s["id"] == source_id:
            s["enabled"] = enabled
            set_app_config({"sources": sources})
            return True
    return False


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
        "enabled": True,
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
