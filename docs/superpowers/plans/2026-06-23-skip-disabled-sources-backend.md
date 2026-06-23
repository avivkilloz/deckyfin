# Skip Disabled Sources in Backend Probing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four `enabled` guards in `main.py` so disabled sources are never probed for games, artwork eligibility, capabilities, or disk usage.

**Architecture:** Each guard is a one-liner added immediately after the existing not-found / loop-entry check in the relevant method. No new abstractions. The `enabled` field already exists on every source dict (defaulted to `True` by `list_sources()`).

**Tech Stack:** Python (`main.py`), pytest.

## Global Constraints

- All changes are in `main.py` only.
- Guard expression is `source.get("enabled", True)` — never `source["enabled"]` (backward compat for legacy entries).
- Legacy restart-flag cleanup loops (lines 377 and 889) must NOT be guarded — they clear stale disk state and must run even for disabled sources.
- Single-source RPC methods called with an explicit `source_id` (e.g. `get_game`, `update_game_config`, `initialize_source`) must NOT be guarded — explicit caller intent.
- Existing test suite (`pytest tests/ -v`) must pass after the change.

---

### Task 1: Add enabled guards to four backend methods

**Files:**
- Modify: `main.py` — four locations (lines 1022, 1628, 437–439, 748–750)

**Interfaces:**
- Consumes: `source.get("enabled", True)` — already present on every source dict returned by `_list_sources()` and `_get_source_by_id()`
- Produces: no API surface change — callers receive the same return types, just with disabled sources omitted/short-circuited

- [ ] **Step 1: Add guard in `get_games()`**

In `main.py`, find `get_games()` (around line 1017). The for-loop starts at approximately line 1022:

```python
        for source in sources:
            games = []
            try:
```

Replace with:

```python
        for source in sources:
            if not source.get("enabled", True):
                continue
            games = []
            try:
```

- [ ] **Step 2: Add guard in `get_art_eligible_games()`**

In `main.py`, find `get_art_eligible_games()` (around line 1616). The for-loop starts at approximately line 1628:

```python
        for source in _list_sources():
            try:
                games = _load_source_games(source)
```

Replace with:

```python
        for source in _list_sources():
            if not source.get("enabled", True):
                continue
            try:
                games = _load_source_games(source)
```

- [ ] **Step 3: Add guard in `get_source_capabilities()`**

In `main.py`, find `get_source_capabilities()` (around line 436). The current early-return block looks like:

```python
        source = _get_source_by_id(source_id)
        if not source:
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
        caps = _detect_capabilities(source)
```

Replace with:

```python
        source = _get_source_by_id(source_id)
        if not source:
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
        if not source.get("enabled", True):
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
        caps = _detect_capabilities(source)
```

- [ ] **Step 4: Add guard in `get_source_disk_usage()`**

In `main.py`, find `get_source_disk_usage()` (around line 746). The current early-return block looks like:

```python
        source = _get_source_by_id(source_id)
        if not source:
            return {"used": None, "total": None, "free": None}
        path = source.get("path", "")
```

Replace with:

```python
        source = _get_source_by_id(source_id)
        if not source:
            return {"used": None, "total": None, "free": None}
        if not source.get("enabled", True):
            return {"used": None, "total": None, "free": None}
        path = source.get("path", "")
```

- [ ] **Step 5: Run the full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass (68 passing, 0 failing).

- [ ] **Step 6: Commit**

```bash
git add main.py
git commit -m "feat: skip disabled sources in backend probing"
```
