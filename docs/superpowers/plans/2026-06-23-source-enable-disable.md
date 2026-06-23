# Source Enable/Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enable/disable toggle to each source card in Settings; games from disabled sources are hidden from the game library.

**Architecture:** `enabled: bool` is stored directly on each source entry in `config.json`. A new `set_source_enabled` RPC persists the toggle immediately. The game library filters using the already-loaded `xferSources` state which carries the full `Source` struct.

**Tech Stack:** Python (backend), React 18 + TypeScript (frontend), `@decky/api` callables for RPC.

## Global Constraints

- New source created via `add_source()` must default `enabled=True`.
- Old `config.json` entries missing `enabled` must be treated as `enabled=True` (backward-compat — normalize on read in `list_sources()`).
- A game is hidden from the library only if **every** source copy it has is disabled; if one copy is on an enabled source the game shows.
- No confirmation dialog for the toggle — it is trivially reversible.
- Follow existing source-card button style (`BTN_STYLE`, `Focusable`, `focusClassName="is-focused"`).

---

### Task 1: Backend — `set_source_enabled` in `deckyfin_sources.py`

**Files:**
- Modify: `py_modules/deckyfin_sources.py`
- Test: `tests/test_sources.py`

**Interfaces:**
- Produces: `set_source_enabled(source_id: str, enabled: bool) -> bool` (returns `True` if found, `False` if not)
- Produces: `list_sources()` now always returns dicts with `"enabled": bool`
- Produces: `add_source()` now always returns a source dict with `"enabled": True`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_sources.py`:

```python
def test_add_source_has_enabled_true(tmp_path, monkeypatch):
    """add_source always includes enabled=True."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import add_source
    source = add_source("Games", "local", str(tmp_path), None)
    assert source["enabled"] is True


def test_list_sources_defaults_enabled(tmp_path, monkeypatch):
    """list_sources returns enabled=True for entries without the field."""
    _make_app_config(tmp_path, {
        "sources": [{"id": "abc", "name": "Old", "type": "local", "path": "/games", "url": None}]
    })
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import list_sources
    sources = list_sources()
    assert sources[0]["enabled"] is True


def test_set_source_enabled(tmp_path, monkeypatch):
    """set_source_enabled persists the enabled flag."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import add_source, set_source_enabled, list_sources
    source = add_source("Games", "local", str(tmp_path), None)
    assert set_source_enabled(source["id"], False) is True
    assert list_sources()[0]["enabled"] is False
    assert set_source_enabled(source["id"], True) is True
    assert list_sources()[0]["enabled"] is True


def test_set_source_enabled_not_found(tmp_path, monkeypatch):
    """set_source_enabled returns False for unknown id."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import set_source_enabled
    assert set_source_enabled("nonexistent", False) is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_sources.py::test_add_source_has_enabled_true tests/test_sources.py::test_list_sources_defaults_enabled tests/test_sources.py::test_set_source_enabled tests/test_sources.py::test_set_source_enabled_not_found -v
```

Expected: FAIL (AttributeError or AssertionError — `set_source_enabled` not defined, `enabled` key missing).

- [ ] **Step 3: Implement in `deckyfin_sources.py`**

In `list_sources()`, replace:
```python
def list_sources() -> list:
    """Return all configured sources."""
    return get_app_config().get("sources", [])
```
with:
```python
def list_sources() -> list:
    """Return all configured sources, normalizing missing enabled field to True."""
    sources = get_app_config().get("sources", [])
    return [{**s, "enabled": s.get("enabled", True)} for s in sources]
```

In `add_source()`, add `"enabled": True` to the source dict (after `"url": url,`):
```python
    source = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "type": type_,
        "path": path,
        "url": url,
        "enabled": True,
    }
```

After `reorder_source()`, add the new function:
```python
def set_source_enabled(source_id: str, enabled: bool) -> bool:
    """Set the enabled flag on a source. Returns True if found, False if not."""
    config = get_app_config()
    sources = config.get("sources", [])
    for s in sources:
        if s["id"] == source_id:
            s["enabled"] = enabled
            set_app_config({"sources": sources})
            return True
    return False
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_sources.py::test_add_source_has_enabled_true tests/test_sources.py::test_list_sources_defaults_enabled tests/test_sources.py::test_set_source_enabled tests/test_sources.py::test_set_source_enabled_not_found -v
```

Expected: 4 passed.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
pytest tests/test_sources.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add py_modules/deckyfin_sources.py tests/test_sources.py
git commit -m "feat: add set_source_enabled to deckyfin_sources"
```

---

### Task 2: RPC — expose `set_source_enabled` in `main.py`

**Files:**
- Modify: `main.py:60-70` (import block), add new method near `remove_source`/`reorder_source`

**Interfaces:**
- Consumes: `set_source_enabled(source_id: str, enabled: bool) -> bool` from `deckyfin_sources`
- Produces: `async def set_source_enabled(self, source_id: str, enabled: bool) -> dict` RPC callable as `"set_source_enabled"` from TypeScript

- [ ] **Step 1: Add import**

In `main.py`, find the `from deckyfin_sources import (` block (line 60) and add `set_source_enabled as _set_source_enabled,`:

```python
from deckyfin_sources import (
    list_sources as _list_sources,
    add_source as _add_source,
    remove_source as _remove_source,
    reorder_source as _reorder_source,
    set_source_enabled as _set_source_enabled,
    get_source_by_id as _get_source_by_id,
    detect_capabilities as _detect_capabilities,
    get_disk_usage as _get_disk_usage,
    migrate_games_folder_to_source as _migrate_games_folder_to_source,
    load_source_games as _load_source_games,
)
```

- [ ] **Step 2: Add RPC method**

In `main.py`, after the `reorder_source` method (around line 429), add:

```python
    async def set_source_enabled(self, source_id: str, enabled: bool) -> dict:
        found = _set_source_enabled(source_id, enabled)
        return {"success": found, "error": None if found else f"Source '{source_id}' not found"}
```

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: expose set_source_enabled RPC in main.py"
```

---

### Task 3: TypeScript — add `enabled` to `Source` interface

**Files:**
- Modify: `src/types.ts:93-99`

**Interfaces:**
- Produces: `Source.enabled: boolean` available everywhere `Source` is used

- [ ] **Step 1: Update the interface**

In `src/types.ts`, replace:

```typescript
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  path: string | null;
  url: string | null;
}
```

with:

```typescript
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  path: string | null;
  url: string | null;
  enabled: boolean;
}
```

- [ ] **Step 2: Build to verify no type errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add enabled field to Source TypeScript interface"
```

---

### Task 4: Settings UI — Disable/Enable button on source card

**Files:**
- Modify: `src/components/SettingsPage.tsx`

**Interfaces:**
- Consumes: `set_source_enabled(source_id: str, enabled: bool) -> dict` RPC (from Task 2)
- Consumes: `Source.enabled: boolean` (from Task 3)
- Consumes: `loadSources()` — already exists in SettingsPage, refreshes `sources` state after a change

- [ ] **Step 1: Add callable at top of file**

In `src/components/SettingsPage.tsx`, after the `reorderSource` callable (line 21), add:

```typescript
const setSourceEnabled = callable<[source_id: string, enabled: boolean], { success: boolean }>("set_source_enabled");
```

- [ ] **Step 2: Add handler function**

In `src/components/SettingsPage.tsx`, after `handleRescanSource` (around line 450), add:

```typescript
  const handleToggleSource = async (source_id: string, enabled: boolean) => {
    try {
      await setSourceEnabled(source_id, enabled);
      await loadSources();
    } catch {}
  };
```

- [ ] **Step 3: Add Disable/Enable button to source card and dim disabled cards**

In `src/components/SettingsPage.tsx`, find the source card container (line 665):

```typescript
          <div key={src.id} style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px", opacity: offline ? 0.7 : 1 }}>
```

Replace with:

```typescript
          <div key={src.id} style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px", opacity: (offline || src.enabled === false) ? 0.5 : 1 }}>
```

Then find the action buttons group (lines 690–699):

```typescript
                <Focusable focusClassName="" style={{ display: "flex", gap: "4px" }}>
                  <Focusable onActivate={() => handleRescanSource(src.id)} onClick={() => handleRescanSource(src.id)} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px" }}>
                    {sourceMessage?.id === src.id ? sourceMessage.msg : "Rescan"}
                  </Focusable>
                  <Focusable onActivate={() => handleRemoveSource(src.id)} onClick={() => handleRemoveSource(src.id)} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px", borderColor: "#c0392b", color: "#e74c3c" }}>
                    Remove
                  </Focusable>
                </Focusable>
```

Replace with:

```typescript
                <Focusable focusClassName="" style={{ display: "flex", gap: "4px" }}>
                  <Focusable onActivate={() => handleRescanSource(src.id)} onClick={() => handleRescanSource(src.id)} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px" }}>
                    {sourceMessage?.id === src.id ? sourceMessage.msg : "Rescan"}
                  </Focusable>
                  <Focusable onActivate={() => handleToggleSource(src.id, src.enabled === false)} onClick={() => handleToggleSource(src.id, src.enabled === false)} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px", borderColor: src.enabled === false ? "#27ae60" : "#888", color: src.enabled === false ? "#2ecc71" : "#aaa" }}>
                    {src.enabled === false ? "Enable" : "Disable"}
                  </Focusable>
                  <Focusable onActivate={() => handleRemoveSource(src.id)} onClick={() => handleRemoveSource(src.id)} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px", borderColor: "#c0392b", color: "#e74c3c" }}>
                    Remove
                  </Focusable>
                </Focusable>
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPage.tsx
git commit -m "feat: add disable/enable button to source card in settings"
```

---

### Task 5: Game Library — filter games from disabled sources

**Files:**
- Modify: `src/components/GameLibrary.tsx:465-477`

**Interfaces:**
- Consumes: `xferSources: Source[]` — already loaded in GameLibrary via `listAllSources()`, carries `Source.enabled: boolean` (from Task 3)
- Consumes: `game.sources[i].source_id: string` — the per-copy source ID on each `MergedGame`

- [ ] **Step 1: Add disabled-source filter to `filteredGames`**

In `src/components/GameLibrary.tsx`, find the `filteredGames` computation (line 465):

```typescript
  const filteredGames = games.filter((g) => {
    if (searchQuery && !g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    if (filterSourceIds.size > 0 && !g.sources.some((s) => filterSourceIds.has(s.source_id)))
      return false;
```

Replace with:

```typescript
  const filteredGames = games.filter((g) => {
    const disabledIds = new Set(xferSources.filter((s) => s.enabled === false).map((s) => s.id));
    if (disabledIds.size > 0 && g.sources.every((s) => disabledIds.has(s.source_id)))
      return false;
    if (searchQuery && !g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    if (filterSourceIds.size > 0 && !g.sources.some((s) => filterSourceIds.has(s.source_id)))
      return false;
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/GameLibrary.tsx
git commit -m "feat: hide games from disabled sources in game library"
```
