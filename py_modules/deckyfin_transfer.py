"""File copy engine and config copy utility for Deckyfin transfer operations."""

import functools
import os
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

from deckyfin_config import get_games_config, save_games_config

PORTABLE_FIELDS = frozenset({
    "executable", "start_dir", "steam_app_id", "proton_version",
    "proton_dependencies", "proton_sync_paths", "categories",
    "launch_options", "collections", "path",
})

# Script sent via stdin to python3 - for FUSE-safe file copy.
# sys.argv: ["-", str(src), str(dst)]
_COPY_SCRIPT = """\
import sys, os, shutil, json
from pathlib import Path
src = Path(sys.argv[1])
dst = Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
bytes_copied = 0
for dirpath, dirnames, filenames in os.walk(src):
    dirnames.sort()
    rel = Path(dirpath).relative_to(src)
    (dst / rel).mkdir(parents=True, exist_ok=True)
    for filename in sorted(filenames):
        src_file = Path(dirpath) / filename
        dst_file = dst / rel / filename
        shutil.copy2(str(src_file), str(dst_file))
        bytes_copied += src_file.stat().st_size
        print(json.dumps({"bytes": bytes_copied}), flush=True)
"""


def _drop_privs(uid: int, gid: int) -> None:
    os.setgid(gid)
    os.setuid(uid)


def calculate_total_size(src_path: Path) -> int:
    """Walk src_path recursively and return total file size in bytes."""
    total = 0
    for dirpath, _, filenames in os.walk(src_path):
        for filename in filenames:
            try:
                total += (Path(dirpath) / filename).stat().st_size
            except OSError:
                pass
    return total


def copy_game_folder(
    src: Path,
    dst: Path,
    progress_cb: Callable[[int], None],
    owner_uid: int,
    owner_gid: int,
    cancelled_flag: Optional[dict] = None,
) -> None:
    """
    Copy src/ into dst/ file-by-file, calling progress_cb(bytes_copied) after each file.
    FUSE-aware: if running as root and owner_uid != 0, copies via subprocess as owner.
    On cancellation or error, deletes dst and raises RuntimeError.
    """
    if os.getuid() == 0 and owner_uid != 0:
        _copy_via_subprocess(src, dst, owner_uid, owner_gid, progress_cb, cancelled_flag)
    else:
        _copy_direct(src, dst, progress_cb, cancelled_flag)


def _copy_direct(
    src: Path,
    dst: Path,
    progress_cb: Callable[[int], None],
    cancelled_flag: Optional[dict],
) -> None:
    try:
        dst.mkdir(parents=True, exist_ok=True)
        bytes_copied = 0
        for dirpath, dirnames, filenames in os.walk(src):
            dirnames.sort()
            rel = Path(dirpath).relative_to(src)
            (dst / rel).mkdir(parents=True, exist_ok=True)
            for filename in sorted(filenames):
                if cancelled_flag and cancelled_flag.get("cancelled"):
                    raise RuntimeError("Transfer cancelled")
                src_file = Path(dirpath) / filename
                dst_file = dst / rel / filename
                shutil.copy2(str(src_file), str(dst_file))
                bytes_copied += src_file.stat().st_size
                progress_cb(bytes_copied)
    except Exception:
        shutil.rmtree(str(dst), ignore_errors=True)
        raise


def _copy_via_subprocess(
    src: Path,
    dst: Path,
    owner_uid: int,
    owner_gid: int,
    progress_cb: Callable[[int], None],
    cancelled_flag: Optional[dict],
) -> None:
    try:
        proc = subprocess.Popen(
            ["python3", "-", str(src), str(dst)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
        )
        try:
            proc.stdin.write(_COPY_SCRIPT)
        finally:
            proc.stdin.close()
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                progress_cb(data["bytes"])
            except (json.JSONDecodeError, KeyError):
                pass
            if cancelled_flag and cancelled_flag.get("cancelled"):
                proc.terminate()
                proc.wait()
                raise RuntimeError("Transfer cancelled")
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read()
            raise RuntimeError(f"Copy subprocess failed: {stderr[:300]}")
    except Exception:
        shutil.rmtree(str(dst), ignore_errors=True)
        raise


def copy_game_config_fields(game_name: str, from_path: Path, to_path: Path) -> None:
    """
    Copy portable config fields for game_name from from_path source to to_path source.
    Creates the game entry in to_path if it does not already exist.
    Skips steam_snapshot, deps_snapshot, needs_restart_after_add, needs_restart.
    """
    src_config = get_games_config(from_path)
    src_game = next(
        (g for g in src_config.get("games", []) if g.get("name") == game_name),
        None,
    )
    if src_game is None:
        raise ValueError(f"Game '{game_name}' not found in source at {from_path}")

    portable = {k: v for k, v in src_game.items() if k in PORTABLE_FIELDS}

    dst_config = get_games_config(to_path)
    dst_games = dst_config.get("games", [])

    found = False
    for i, g in enumerate(dst_games):
        if g.get("name") == game_name:
            dst_games[i] = {**g, **portable}
            found = True
            break
    if not found:
        dst_games.append({"name": game_name, **portable})

    dst_config["games"] = dst_games
    save_games_config(dst_config, to_path)
