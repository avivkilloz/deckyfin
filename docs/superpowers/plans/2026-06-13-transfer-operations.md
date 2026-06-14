# Transfer Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add config copy and game file transfer between sources, surfaced as contextual actions inside GameDetail.

**Architecture:** `py_modules/deckyfin_transfer.py` provides the file copy engine and config copy function. `main.py` hosts a `_transfer_registry` dict and five new callables. `GameDetail.tsx` gains an action row below the source selector with inline pickers, confirmation lines, and a progress banner. `SettingsPage.tsx` shows active transfer status on destination source cards.

**Tech Stack:** Python threading + subprocess with `preexec_fn` for FUSE-safe I/O, React 18 + TypeScript with `setInterval` polling, existing `_drop_privs`/`_owner_creds_for` helpers.

---

## File Map

```
New:
  py_modules/deckyfin_transfer.py   — calculate_total_size, copy_game_folder, copy_game_config_fields
  tests/test_transfer.py            — pytest tests for the above

Modified:
  main.py                           — _transfer_registry, _write_game_config_to_source,
                                      copy_game_config, start_game_transfer,
                                      get_transfer_status, cancel_transfer,
                                      list_active_transfers
  src/types.ts                      — TransferStatus interface
  src/components/GameDetail.tsx     — callables, state, action row, pickers,
                                      confirmation, progress banner, reconnect on mount
  src/components/SettingsPage.tsx   — listActiveTransfers callable, transfer badge on cards
```

---

## Background: patterns you must follow

**FUSE permission handling** — Decky runs as root. FUSE mounts (SSHFS etc.) and NFS with `root_squash` block root. Always try direct first; on `PermissionError` retry via subprocess:

```python
preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid)
```

where `_owner_creds_for(path)` returns `(uid, gid)` of the nearest stat-able ancestor.

**Try-direct, except-PermissionError pattern** — used throughout `main.py`. See `update_game_config` (~line 506) for reference.

**Tests live in `tests/`** — import py_modules directly after inserting into `sys.path`. See `tests/test_backend.py` lines 1-15 for the bootstrap pattern.

---

## Task 1: `py_modules/deckyfin_transfer.py` — file copy engine

**Files:**
- Create: `py_modules/deckyfin_transfer.py`
- Create: `tests/test_transfer.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_transfer.py`:

```python
"""Tests for deckyfin_transfer module."""
import sys
import tempfile
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def test_calculate_total_size_empty():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_transfer import calculate_total_size
        assert calculate_total_size(Path(tmp)) == 0


def test_calculate_total_size_nested():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_transfer import calculate_total_size
        root = Path(tmp)
        (root / "a.exe").write_bytes(b"x" * 100)
        (root / "sub").mkdir()
        (root / "sub" / "b.dll").write_bytes(b"y" * 200)
        assert calculate_total_size(root) == 300


def test_copy_game_folder_copies_files():
    with tempfile.TemporaryDirectory() as src_tmp, tempfile.TemporaryDirectory() as dst_tmp:
        from deckyfin_transfer import copy_game_folder
        src = Path(src_tmp) / "Game"
        src.mkdir()
        (src / "game.exe").write_bytes(b"A" * 50)
        (src / "sub").mkdir()
        (src / "sub" / "data.pak").write_bytes(b"B" * 100)

        dst = Path(dst_tmp) / "Game"
        calls = []
        copy_game_folder(src, dst, lambda b: calls.append(b), owner_uid=0, owner_gid=0)

        assert (dst / "game.exe").read_bytes() == b"A" * 50
        assert (dst / "sub" / "data.pak").read_bytes() == b"B" * 100
        assert calls[-1] == 150


def test_copy_game_folder_cleans_up_on_cancel():
    import pytest
    with tempfile.TemporaryDirectory() as src_tmp, tempfile.TemporaryDirectory() as dst_tmp:
        from deckyfin_transfer import copy_game_folder
        src = Path(src_tmp) / "Game"
        src.mkdir()
        (src / "game.exe").write_bytes(b"A" * 50)
        (src / "b.pak").write_bytes(b"B" * 100)

        dst = Path(dst_tmp) / "Game"
        flag = {}
        call_count = [0]

        def progress(b):
            call_count[0] += 1
            if call_count[0] >= 1:
                flag["cancelled"] = True

        with pytest.raises(RuntimeError, match="[Cc]ancelled"):
            copy_game_folder(src, dst, progress, owner_uid=0, owner_gid=0, cancelled_flag=flag)

        assert not dst.exists()


def test_copy_game_config_fields_portable_only():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_config import save_games_config
        from deckyfin_transfer import copy_game_config_fields

        src = Path(tmp) / "src"
        dst = Path(tmp) / "dst"
        src.mkdir()
        dst.mkdir()
        (src / ".deckyfin").mkdir()
        (dst / ".deckyfin").mkdir()

        save_games_config({"games": [{
            "name": "MyGame", "path": "MyGame",
            "executable": "MyGame/game.exe", "start_dir": "MyGame",
            "steam_app_id": 12345, "proton_version": "GE-Proton10",
            "proton_dependencies": ["vcrun2022"], "proton_sync_paths": [],
            "categories": ["RPG"], "launch_options": "--fullscreen",
            "collections": ["Favorites"],
            "steam_snapshot": "should_not_copy", "deps_snapshot": ["vcrun2022"],
            "needs_restart_after_add": True,
        }]}, src)

        save_games_config({"games": [{
            "name": "MyGame", "path": "MyGame", "executable": "",
            "proton_version": "", "proton_dependencies": [],
            "steam_snapshot": "dest_snapshot",
        }]}, dst)

        copy_game_config_fields("MyGame", src, dst)

        from deckyfin_config import get_games_config
        result = get_games_config(dst)
        game = next(g for g in result["games"] if g["name"] == "MyGame")

        assert game["proton_version"] == "GE-Proton10"
        assert game["proton_dependencies"] == ["vcrun2022"]
        assert game["executable"] == "MyGame/game.exe"
        assert game["steam_app_id"] == 12345
        assert game["categories"] == ["RPG"]
        # Non-portable fields must NOT be copied
        assert game.get("steam_snapshot") == "dest_snapshot"
        assert game.get("needs_restart_after_add") is not True


def test_copy_game_config_fields_creates_entry_if_missing():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_config import save_games_config, get_games_config
        from deckyfin_transfer import copy_game_config_fields

        src = Path(tmp) / "src"
        dst = Path(tmp) / "dst"
        src.mkdir(); dst.mkdir()
        (src / ".deckyfin").mkdir(); (dst / ".deckyfin").mkdir()

        save_games_config({"games": [{"name": "NewGame", "path": "NewGame",
            "executable": "NewGame/g.exe", "proton_version": "GE9",
            "proton_dependencies": [], "proton_sync_paths": [],
            "categories": [], "launch_options": "", "collections": [],
        }]}, src)
        save_games_config({"games": []}, dst)

        copy_game_config_fields("NewGame", src, dst)

        games = get_games_config(dst)["games"]
        assert any(g["name"] == "NewGame" and g["proton_version"] == "GE9" for g in games)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/avivilloz/git/avivkilloz/deckyfin
pytest tests/test_transfer.py -v
```

Expected: `ModuleNotFoundError: No module named 'deckyfin_transfer'`

- [ ] **Step 3: Create `py_modules/deckyfin_transfer.py`**

```python
"""File copy engine and config copy utility for Deckyfin transfer operations."""

import os
import json
import shutil
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
    import functools
    import subprocess as _sp
    try:
        proc = _sp.Popen(
            ["python3", "-", str(src), str(dst)],
            stdin=_sp.PIPE,
            stdout=_sp.PIPE,
            stderr=_sp.PIPE,
            text=True,
            preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
        )
        proc.stdin.write(_COPY_SCRIPT)
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
```

- [ ] **Step 4: Run tests — all must pass**

```bash
pytest tests/test_transfer.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_transfer.py tests/test_transfer.py
git commit -m "feat: add deckyfin_transfer module — file copy engine and config copy"
```

---

## Task 2: `main.py` — `_transfer_registry`, config copy helper, `copy_game_config` callable

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Add imports and module-level state**

Find the line `_debug("MODULE LOAD START")` near line 80 and insert **before** it:

```python
import time as _time
import threading as _threading
import uuid as _uuid

_transfer_registry: dict = {}
```

- [ ] **Step 2: Add `_write_game_config_to_source` helper**

Insert after the `_drop_privs` function (around line 180):

```python
def _write_game_config_to_source(
    game_name: str, src_path: str, dst_path: str,
    dst_owner_uid: int, dst_owner_gid: int
) -> None:
    """Copy portable config fields from src to dst. Falls back to subprocess on PermissionError."""
    import functools
    from deckyfin_transfer import copy_game_config_fields
    try:
        copy_game_config_fields(game_name, Path(src_path), Path(dst_path))
    except PermissionError:
        if os.getuid() == 0 and dst_owner_uid != 0:
            script = (
                "import sys; sys.path.insert(0,sys.argv[1]); "
                "from pathlib import Path; "
                "from deckyfin_transfer import copy_game_config_fields; "
                "copy_game_config_fields(sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]))"
            )
            proc = subprocess.run(
                ["python3", "-c", script, _PY_MODULES, game_name, src_path, dst_path],
                capture_output=True, text=True, timeout=15,
                preexec_fn=functools.partial(_drop_privs, dst_owner_uid, dst_owner_gid),
            )
            if proc.returncode != 0:
                raise PermissionError(
                    f"FUSE config write failed: {proc.stderr.strip()[:200]}"
                )
        else:
            raise
```

- [ ] **Step 3: Add `copy_game_config` callable inside the `Plugin` class**

Add after the `get_source_capabilities` method (around line 272):

```python
    async def copy_game_config(
        self, game_name: str, from_source_id: str, to_source_id: str
    ) -> dict:
        """Copy portable config fields for game_name from one source to another."""
        src_source = _get_source_by_id(from_source_id)
        dst_source = _get_source_by_id(to_source_id)
        if not src_source or not dst_source:
            return {"success": False, "error": "Source not found"}
        src_path = src_source.get("path")
        dst_path = dst_source.get("path")
        if not src_path or not dst_path:
            return {"success": False, "error": "Source has no path"}
        try:
            dst_owner_uid, dst_owner_gid = _owner_creds_for(dst_path)
            _write_game_config_to_source(
                game_name, src_path, dst_path, dst_owner_uid, dst_owner_gid
            )
            _debug(f"copy_game_config: {game_name!r} {from_source_id!r} → {to_source_id!r}")
            return {"success": True}
        except Exception as e:
            _debug(f"copy_game_config: error: {e!r}")
            return {"success": False, "error": str(e)}
```

- [ ] **Step 4: Verify Python syntax**

```bash
python3 -m py_compile main.py && echo "OK"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add main.py
git commit -m "feat: add copy_game_config callable and _write_game_config_to_source helper"
```

---

## Task 3: `main.py` — transfer management callables

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Add `start_game_transfer` callable inside `Plugin`**

Add after `copy_game_config`:

```python
    async def start_game_transfer(
        self, game_name: str, from_source_id: str, to_source_id: str
    ) -> dict:
        """Start a background file transfer. Returns {success, transfer_id}."""
        import functools
        src_source = _get_source_by_id(from_source_id)
        dst_source = _get_source_by_id(to_source_id)
        if not src_source or not dst_source:
            return {"success": False, "error": "Source not found"}
        src_path = src_source.get("path")
        dst_path = dst_source.get("path")
        if not src_path or not dst_path:
            return {"success": False, "error": "Source has no path"}

        src_game_dir = Path(src_path) / game_name
        dst_game_dir = Path(dst_path) / game_name

        src_uid, src_gid = _owner_creds_for(src_path)
        dst_uid, dst_gid = _owner_creds_for(dst_path)
        # Pick non-root creds if available (for FUSE mounts)
        owner_uid = src_uid if src_uid != 0 else dst_uid
        owner_gid = src_gid if src_gid != 0 else dst_gid

        # Calculate total size (via subprocess if FUSE)
        try:
            if os.getuid() == 0 and owner_uid != 0:
                proc = subprocess.run(
                    ["python3", "-c",
                     "import os,sys;from pathlib import Path;"
                     "t=sum((Path(d)/f).stat().st_size "
                     "for d,_,fs in os.walk(sys.argv[1]) for f in fs);"
                     "print(t)",
                     str(src_game_dir)],
                    capture_output=True, text=True, timeout=60,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
                total_bytes = (
                    int(proc.stdout.strip())
                    if proc.returncode == 0 and proc.stdout.strip()
                    else 0
                )
            else:
                from deckyfin_transfer import calculate_total_size
                total_bytes = calculate_total_size(src_game_dir)
        except Exception:
            total_bytes = 0

        transfer_id = str(_uuid.uuid4())[:8]
        entry = {
            "transfer_id": transfer_id,
            "game_name": game_name,
            "from_source_id": from_source_id,
            "to_source_id": to_source_id,
            "status": "running",
            "bytes_copied": 0,
            "total_bytes": total_bytes,
            "error": None,
            "started_at": _time.time(),
            "cancelled": False,
        }
        _transfer_registry[transfer_id] = entry

        def _run():
            from deckyfin_transfer import copy_game_folder
            try:
                copy_game_folder(
                    src=src_game_dir,
                    dst=dst_game_dir,
                    progress_cb=lambda b: entry.__setitem__("bytes_copied", b),
                    owner_uid=owner_uid,
                    owner_gid=owner_gid,
                    cancelled_flag=entry,
                )
                # Write config to destination
                try:
                    _write_game_config_to_source(
                        game_name, src_path, dst_path, dst_uid, dst_gid
                    )
                except Exception as cfg_err:
                    _debug(f"start_game_transfer: config copy warning: {cfg_err!r}")
                # Initialise destination source (non-fatal)
                try:
                    result = _run_source_script("init", dst_path, dst_uid, dst_gid)
                    if result is None:
                        from deckyfin_config import (
                            detect_game_folders, get_games_config,
                            save_games_config, get_app_folder, get_saves_folder,
                        )
                        gp = Path(dst_path)
                        get_app_folder(gp).mkdir(parents=True, exist_ok=True)
                        get_saves_folder(gp).mkdir(parents=True, exist_ok=True)
                except Exception as init_err:
                    _debug(f"start_game_transfer: init warning: {init_err!r}")
                entry["status"] = "done"
                _debug(f"start_game_transfer: {transfer_id} done")
            except RuntimeError as exc:
                entry["status"] = "failed"
                entry["error"] = str(exc)
                _debug(f"start_game_transfer: {transfer_id} failed: {exc!r}")
            except Exception as exc:
                import shutil
                shutil.rmtree(str(dst_game_dir), ignore_errors=True)
                entry["status"] = "failed"
                entry["error"] = str(exc)
                _debug(f"start_game_transfer: {transfer_id} error: {exc!r}")

        _threading.Thread(target=_run, daemon=True).start()
        return {"success": True, "transfer_id": transfer_id}
```

- [ ] **Step 2: Add `get_transfer_status`, `cancel_transfer`, `list_active_transfers`**

Add after `start_game_transfer`:

```python
    async def get_transfer_status(self, transfer_id: str) -> dict:
        entry = _transfer_registry.get(transfer_id)
        if not entry:
            return {"error": "not found"}
        return {k: v for k, v in entry.items() if k not in ("cancelled", "started_at")}

    async def cancel_transfer(self, transfer_id: str) -> dict:
        entry = _transfer_registry.get(transfer_id)
        if not entry:
            return {"success": False, "error": "not found"}
        if entry["status"] == "running":
            entry["cancelled"] = True
        else:
            _transfer_registry.pop(transfer_id, None)
        return {"success": True}

    async def list_active_transfers(self) -> list:
        now = _time.time()
        stale = [
            tid for tid, e in list(_transfer_registry.items())
            if e["status"] in ("done", "failed") and (now - e["started_at"]) > 600
        ]
        for tid in stale:
            _transfer_registry.pop(tid, None)
        return [
            {k: v for k, v in e.items() if k not in ("cancelled", "started_at")}
            for e in _transfer_registry.values()
        ]
```

- [ ] **Step 3: Verify syntax**

```bash
python3 -m py_compile main.py && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add main.py
git commit -m "feat: add start_game_transfer, get/cancel/list transfer callables"
```

---

## Task 4: `src/types.ts` — `TransferStatus` interface

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add interface at the end of `src/types.ts`**

Append after the `SteamGridArtUrls` interface:

```typescript
export interface TransferStatus {
  transfer_id: string;
  game_name: string;
  from_source_id: string;
  to_source_id: string;
  status: "running" | "done" | "failed";
  bytes_copied: number;
  total_bytes: number;
  error: string | null;
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `created dist in ...ms`

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TransferStatus type"
```

---

## Task 5: `GameDetail.tsx` — callables, state, and config copy flow

**Files:**
- Modify: `src/components/GameDetail.tsx`

- [ ] **Step 1: Add new callables after the existing callable declarations (around line 65)**

```typescript
const listAllSources = callable<[], import("../types").Source[]>("list_sources");
const copyGameConfig = callable<
  [game_name: string, from_source_id: string, to_source_id: string],
  { success: boolean; error?: string }
>("copy_game_config");
const startGameTransfer = callable<
  [game_name: string, from_source_id: string, to_source_id: string],
  { success: boolean; transfer_id?: string; error?: string }
>("start_game_transfer");
const getTransferStatus = callable<
  [transfer_id: string],
  import("../types").TransferStatus & { error?: string }
>("get_transfer_status");
const cancelTransfer = callable<
  [transfer_id: string],
  { success: boolean }
>("cancel_transfer");
const listActiveTransfers = callable<
  [],
  import("../types").TransferStatus[]
>("list_active_transfers");
```

- [ ] **Step 2: Add transfer state variables after the `[capabilities, setCapabilities]` state (around line 132)**

```typescript
// ── All sources (for game copy destination picker) ────────────────────
const [allSources, setAllSources] = useState<import("../types").Source[]>([]);

// ── Config copy state ─────────────────────────────────────────────────
const [showCopyConfigPicker, setShowCopyConfigPicker] = useState(false);
const [copyConfigDest, setCopyConfigDest] = useState<import("../types").GameSource | null>(null);
const [copyConfigConfirming, setCopyConfigConfirming] = useState(false);
const [copyConfigFeedback, setCopyConfigFeedback] = useState<string | null>(null);

// ── Game transfer state ───────────────────────────────────────────────
const [showCopyGamePicker, setShowCopyGamePicker] = useState(false);
const [copyGameDest, setCopyGameDest] = useState<import("../types").Source | null>(null);
const [copyGameConfirming, setCopyGameConfirming] = useState(false);
const [transferId, setTransferId] = useState<string | null>(null);
const [transferStatus, setTransferStatus] = useState<import("../types").TransferStatus | null>(null);
```

- [ ] **Step 3: Load allSources and reconnect to active transfer on mount**

Find the `useEffect` that calls `listProtonVersions` (around line 332) and add a new `useEffect` immediately after it:

```typescript
  useEffect(() => {
    listAllSources().then(setAllSources).catch(() => {});
    listActiveTransfers()
      .then((transfers) => {
        const mine = transfers.find((t) => t.game_name === game.name);
        if (mine) {
          setTransferId(mine.transfer_id);
          setTransferStatus(mine);
        }
      })
      .catch(() => {});
  }, [game.name]);
```

- [ ] **Step 4: Add transfer poll loop**

Add after the `useEffect` from Step 3:

```typescript
  useEffect(() => {
    if (!transferId || transferStatus?.status !== "running") return;
    const poll = setInterval(async () => {
      try {
        const s = await getTransferStatus(transferId);
        if ("error" in s && s.error === "not found") {
          clearInterval(poll);
          setTransferId(null);
          setTransferStatus(null);
          return;
        }
        setTransferStatus(s as import("../types").TransferStatus);
        if (s.status !== "running") clearInterval(poll);
      } catch (_) {}
    }, 2000);
    return () => clearInterval(poll);
  }, [transferId, transferStatus?.status]);
```

- [ ] **Step 5: Add config copy and transfer action handlers**

Add after the `useEffect` blocks and before the `return` statement:

```typescript
  const handleCopyConfig = async () => {
    if (!copyConfigDest) return;
    setCopyConfigConfirming(false);
    setCopyConfigFeedback(null);
    try {
      const res = await copyGameConfig(
        game.name,
        selectedSource.source_id,
        copyConfigDest.source_id,
      );
      setCopyConfigFeedback(res.success ? "✓ Config copied" : `✗ ${res.error ?? "Failed"}`);
    } catch (e) {
      setCopyConfigFeedback(`✗ ${String(e)}`);
    }
    setCopyConfigDest(null);
  };

  const handleStartTransfer = async () => {
    if (!copyGameDest) return;
    setCopyGameConfirming(false);
    try {
      const res = await startGameTransfer(
        game.name,
        selectedSource.source_id,
        copyGameDest.id,
      );
      if (res.success && res.transfer_id) {
        setTransferId(res.transfer_id);
        setTransferStatus({
          transfer_id: res.transfer_id,
          game_name: game.name,
          from_source_id: selectedSource.source_id,
          to_source_id: copyGameDest.id,
          status: "running",
          bytes_copied: 0,
          total_bytes: 0,
          error: null,
        });
      }
    } catch (_) {}
    setCopyGameDest(null);
  };

  const handleCancelOrDismissTransfer = async () => {
    if (transferId) await cancelTransfer(transferId).catch(() => {});
    setTransferId(null);
    setTransferStatus(null);
  };

  const handleRetryTransfer = async () => {
    if (!transferStatus) return;
    const { from_source_id, to_source_id } = transferStatus;
    setTransferStatus(null);
    setTransferId(null);
    try {
      const res = await startGameTransfer(game.name, from_source_id, to_source_id);
      if (res.success && res.transfer_id) {
        setTransferId(res.transfer_id);
        setTransferStatus({
          transfer_id: res.transfer_id,
          game_name: game.name,
          from_source_id,
          to_source_id,
          status: "running",
          bytes_copied: 0,
          total_bytes: 0,
          error: null,
        });
      }
    } catch (_) {}
  };
```

- [ ] **Step 6: Add the transfer action row into the JSX**

Find the comment `{/* ── Config Fields ── */}` (line 800) and insert the following block **immediately before** it (i.e. between the source picker dropdown closing tag and the Config Fields comment):

```tsx
      {/* ── Transfer Actions ───────────────────────────────────────────────── */}
      {(game.sources.length >= 2 ||
        allSources.some(
          (s) =>
            s.type !== "agent" &&
            !game.sources.some((gs) => gs.source_id === s.id),
        )) && (
        <div style={{ marginBottom: "10px" }}>
          {/* Buttons row */}
          <Focusable
            focusClassName=""
            style={{ display: "flex", gap: "6px", marginBottom: "4px" }}
          >
            {game.sources.length >= 2 && (
              <Focusable
                onActivate={() => {
                  setShowCopyConfigPicker((v) => !v);
                  setShowCopyGamePicker(false);
                  setCopyConfigDest(null);
                  setCopyConfigConfirming(false);
                }}
                onClick={() => {
                  setShowCopyConfigPicker((v) => !v);
                  setShowCopyGamePicker(false);
                  setCopyConfigDest(null);
                  setCopyConfigConfirming(false);
                }}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, padding: "4px 10px", fontSize: "0.82em" }}
              >
                Copy config →
              </Focusable>
            )}
            {allSources.some(
              (s) =>
                s.type !== "agent" &&
                !game.sources.some((gs) => gs.source_id === s.id),
            ) && (
              <Focusable
                onActivate={() => {
                  setShowCopyGamePicker((v) => !v);
                  setShowCopyConfigPicker(false);
                  setCopyGameDest(null);
                  setCopyGameConfirming(false);
                }}
                onClick={() => {
                  setShowCopyGamePicker((v) => !v);
                  setShowCopyConfigPicker(false);
                  setCopyGameDest(null);
                  setCopyGameConfirming(false);
                }}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, padding: "4px 10px", fontSize: "0.82em" }}
              >
                Copy game →
              </Focusable>
            )}
          </Focusable>

          {/* Config copy: source picker */}
          {showCopyConfigPicker && !copyConfigConfirming && (
            <div
              style={{
                border: "1px solid #555",
                borderRadius: "4px",
                padding: "2px 0",
                marginBottom: "4px",
              }}
            >
              {game.sources
                .filter((s) => s.source_id !== selectedSource.source_id)
                .map((src) => (
                  <Focusable
                    key={src.source_id}
                    onActivate={() => {
                      setCopyConfigDest(src);
                      setShowCopyConfigPicker(false);
                      setCopyConfigConfirming(true);
                    }}
                    onClick={() => {
                      setCopyConfigDest(src);
                      setShowCopyConfigPicker(false);
                      setCopyConfigConfirming(true);
                    }}
                    focusClassName="is-focused"
                    style={{
                      margin: "0 2px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "0.85em",
                      borderBottom: "1px solid #333",
                      color: "#ccc",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "rgba(255,255,255,0.08)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    {src.source_name}
                    <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>
                      ({src.source_type})
                    </span>
                  </Focusable>
                ))}
            </div>
          )}

          {/* Config copy: confirmation */}
          {copyConfigConfirming && copyConfigDest && (
            <div
              style={{
                fontSize: "0.82em",
                color: "#ccc",
                marginBottom: "4px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span>
                Replace <b>{copyConfigDest.source_name}</b>'s config with{" "}
                <b>{selectedSource.source_name}</b>'s?
              </span>
              <Focusable
                onActivate={() => setCopyConfigConfirming(false)}
                onClick={() => setCopyConfigConfirming(false)}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}
              >
                Cancel
              </Focusable>
              <Focusable
                onActivate={handleCopyConfig}
                onClick={handleCopyConfig}
                focusClassName="is-focused"
                style={{
                  ...BTN_STYLE,
                  padding: "2px 8px",
                  fontSize: "0.82em",
                  border: "1px solid #27ae60",
                  color: "#2ecc71",
                }}
              >
                Copy
              </Focusable>
            </div>
          )}

          {copyConfigFeedback && (
            <p
              style={{
                margin: "0 0 4px 0",
                fontSize: "0.82em",
                color: copyConfigFeedback.startsWith("✓") ? "#2ecc71" : "tomato",
              }}
            >
              {copyConfigFeedback}
            </p>
          )}

          {/* Game copy: source picker */}
          {showCopyGamePicker && !copyGameConfirming && (
            <div
              style={{
                border: "1px solid #555",
                borderRadius: "4px",
                padding: "2px 0",
                marginBottom: "4px",
              }}
            >
              {allSources
                .filter(
                  (s) =>
                    s.type !== "agent" &&
                    !game.sources.some((gs) => gs.source_id === s.id),
                )
                .map((src) => (
                  <Focusable
                    key={src.id}
                    onActivate={() => {
                      setCopyGameDest(src);
                      setShowCopyGamePicker(false);
                      setCopyGameConfirming(true);
                    }}
                    onClick={() => {
                      setCopyGameDest(src);
                      setShowCopyGamePicker(false);
                      setCopyGameConfirming(true);
                    }}
                    focusClassName="is-focused"
                    style={{
                      margin: "0 2px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: "0.85em",
                      borderBottom: "1px solid #333",
                      color: "#ccc",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "rgba(255,255,255,0.08)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    {src.name}
                    <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>
                      ({src.type})
                    </span>
                  </Focusable>
                ))}
            </div>
          )}

          {/* Game copy: confirmation */}
          {copyGameConfirming && copyGameDest && (
            <div
              style={{
                fontSize: "0.82em",
                color: "#ccc",
                marginBottom: "4px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span>
                Copy <b>{game.name}</b> to <b>{copyGameDest.name}</b>?
              </span>
              <Focusable
                onActivate={() => setCopyGameConfirming(false)}
                onClick={() => setCopyGameConfirming(false)}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}
              >
                Cancel
              </Focusable>
              <Focusable
                onActivate={handleStartTransfer}
                onClick={handleStartTransfer}
                focusClassName="is-focused"
                style={{
                  ...BTN_STYLE,
                  padding: "2px 8px",
                  fontSize: "0.82em",
                  border: "1px solid #27ae60",
                  color: "#2ecc71",
                }}
              >
                Copy
              </Focusable>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `created dist in ...ms`

- [ ] **Step 8: Commit**

```bash
git add src/components/GameDetail.tsx src/types.ts
git commit -m "feat: add transfer action row and config copy UI to GameDetail"
```

---

## Task 6: `GameDetail.tsx` — progress banner

**Files:**
- Modify: `src/components/GameDetail.tsx`

- [ ] **Step 1: Add a `fmtBytes` helper at module level** (after the `POPULAR_DEPS` array)

```typescript
const fmtBytes = (b: number): string => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
};
```

- [ ] **Step 2: Add the progress banner to the JSX**

Find the closing `</Focusable>` of the root Focusable (line 1589, the very last line of the JSX return). Insert the following **immediately before** it:

```tsx
      {/* ── Transfer Progress Banner ───────────────────────────────────────── */}
      {transferStatus && (() => {
        const pct =
          transferStatus.total_bytes > 0
            ? Math.round((transferStatus.bytes_copied / transferStatus.total_bytes) * 100)
            : 0;
        const destName =
          allSources.find((s) => s.id === transferStatus.to_source_id)?.name ??
          transferStatus.to_source_id;
        return (
          <div
            style={{
              border: "1px solid #444",
              borderRadius: "4px",
              padding: "8px 10px",
              marginTop: "16px",
              background: "#1a1a1a",
              fontSize: "0.82em",
            }}
          >
            {transferStatus.status === "running" && (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "4px",
                  }}
                >
                  <span>
                    ▸ Copying to {destName}… {pct}%
                  </span>
                  <Focusable
                    onActivate={handleCancelOrDismissTransfer}
                    onClick={handleCancelOrDismissTransfer}
                    focusClassName="is-focused"
                    style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                  >
                    ✕
                  </Focusable>
                </div>
                <div
                  style={{ background: "#333", borderRadius: "2px", height: "4px", marginBottom: "3px" }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      background: "#0078d4",
                      borderRadius: "2px",
                      height: "100%",
                      transition: "width 0.3s",
                    }}
                  />
                </div>
                <span style={{ color: "#666" }}>
                  {fmtBytes(transferStatus.bytes_copied)} / {fmtBytes(transferStatus.total_bytes)}
                </span>
              </>
            )}
            {transferStatus.status === "done" && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: "#2ecc71" }}>
                  ✓ Copy complete — go back to refresh the game list
                </span>
                <Focusable
                  onActivate={handleCancelOrDismissTransfer}
                  onClick={handleCancelOrDismissTransfer}
                  focusClassName="is-focused"
                  style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                >
                  ✕
                </Focusable>
              </div>
            )}
            {transferStatus.status === "failed" && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: "tomato" }}>
                  ✗ {transferStatus.error ?? "Transfer failed"}
                </span>
                <Focusable focusClassName="" style={{ display: "flex", gap: "4px" }}>
                  <Focusable
                    onActivate={handleRetryTransfer}
                    onClick={handleRetryTransfer}
                    focusClassName="is-focused"
                    style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}
                  >
                    Retry
                  </Focusable>
                  <Focusable
                    onActivate={handleCancelOrDismissTransfer}
                    onClick={handleCancelOrDismissTransfer}
                    focusClassName="is-focused"
                    style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                  >
                    ✕
                  </Focusable>
                </Focusable>
              </div>
            )}
          </div>
        );
      })()}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `created dist in ...ms`

- [ ] **Step 4: Commit**

```bash
git add src/components/GameDetail.tsx
git commit -m "feat: add transfer progress banner to GameDetail"
```

---

## Task 7: `SettingsPage.tsx` — transfer status on source cards

**Files:**
- Modify: `src/components/SettingsPage.tsx`

- [ ] **Step 1: Add `listActiveTransfers` callable** after the existing callables (around line 15):

```typescript
const listActiveTransfers = callable<
  [],
  import("../types").TransferStatus[]
>("list_active_transfers");
```

- [ ] **Step 2: Add `activeTransfers` state** after `const [diskUsages, setDiskUsages]`:

```typescript
const [activeTransfers, setActiveTransfers] = useState<import("../types").TransferStatus[]>([]);
```

- [ ] **Step 3: Load active transfers on mount**

Find the `useEffect` that loads sources (the one calling `loadSources()`). Inside that same effect, add after `loadSources()`:

```typescript
    listActiveTransfers().then(setActiveTransfers).catch(() => {});
```

- [ ] **Step 4: Show transfer status on destination source cards**

Find the source card section (around line 397, just after the disk usage bar):

```tsx
            {offline && <div style={{ fontSize: "0.75em", color: "#555" }}>Disk info unavailable</div>}
```

Add immediately after that line:

```tsx
            {(() => {
              const xfer = activeTransfers.find(
                (t) => t.to_source_id === src.id && t.status === "running",
              );
              if (!xfer) return null;
              const pct =
                xfer.total_bytes > 0
                  ? Math.round((xfer.bytes_copied / xfer.total_bytes) * 100)
                  : 0;
              return (
                <div style={{ fontSize: "0.75em", color: "#e67e22", marginTop: "4px" }}>
                  ⟳ Receiving {xfer.game_name}… {pct}%
                </div>
              );
            })()}
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `created dist in ...ms`

- [ ] **Step 6: Run all tests**

```bash
pytest tests/ -v 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsPage.tsx
git commit -m "feat: show active transfer status on Settings source cards"
```

---

## Self-review checklist

After all tasks are complete, verify:

- [ ] `pytest tests/test_transfer.py -v` — all 6 tests pass
- [ ] `npm run build` — no errors
- [ ] `python3 -m py_compile main.py` — no errors
- [ ] GameDetail shows "Copy config →" only when `game.sources.length >= 2`
- [ ] GameDetail shows "Copy game →" only when a non-agent source without this game exists
- [ ] Both pickers require confirmation before executing
- [ ] Progress banner reconnects after sidebar close/reopen (via `listActiveTransfers` on mount)
- [ ] Settings source card shows `⟳ Receiving…` for active transfers
