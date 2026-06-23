# Skip Disabled Sources in Backend Probing — Design

**Date:** 2026-06-23  
**Status:** Approved

## Overview

When a source has `enabled=False`, the backend should not probe it for any display-facing data. This avoids unnecessary I/O (and potential hangs on offline mounts) when the user has explicitly disabled a source.

## Affected Functions in `main.py`

### `get_games()` (line 1022)

Skip disabled sources inside the source loop. No games are loaded from a disabled source.

```python
for source in sources:
    if not source.get("enabled", True):
        continue
    # ... existing load logic
```

### `get_art_eligible_games()` (line 1628)

Same pattern — skip disabled sources when collecting games eligible for SteamGridDB artwork.

```python
for source in _list_sources():
    if not source.get("enabled", True):
        continue
    # ... existing load logic
```

### `get_source_capabilities(source_id)` (line 437)

Return empty capabilities immediately if the source is disabled. Guard added after the existing not-found check.

```python
if not source:
    return {"can_play": False, "can_write_config": False, "can_download_to": False}
if not source.get("enabled", True):
    return {"can_play": False, "can_write_config": False, "can_download_to": False}
```

### `get_source_disk_usage(source_id)` (line 748)

Return null disk usage immediately if the source is disabled. Guard added after the existing not-found check.

```python
if not source:
    return {"used": None, "total": None, "free": None}
if not source.get("enabled", True):
    return {"used": None, "total": None, "free": None}
```

## Intentional Exclusions

The legacy restart-flag cleanup loops (lines 377 and 889) iterate sources to clear stale disk state. These are **not** skipped for disabled sources — clearing old flag files from a disabled source is harmless and prevents ghost state if the source is later re-enabled.

Single-source RPC methods called with an explicit `source_id` (e.g. `get_game`, `update_game_config`, `initialize_source`) are also **not** guarded — the caller made an explicit choice to operate on that source, and the Settings page still needs to allow Rescan on a disabled source.

## Testing

No new tests required. The `enabled` field defaulting is already covered by the Task 1 tests in `tests/test_sources.py`. Verify the existing suite passes after the change.
