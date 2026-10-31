# Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users update Deckyfin from its Settings page to the newest Stable release or the rolling Latest-main build, installed through Decky Loader's own plugin installer.

**Architecture:** CI produces identical plugin zips through one shared packaging script that stamps `plugin.json` with version + `deckyfin_build` (channel, commit, time); tags publish Stable releases, pushes to `main` refresh a rolling `latest-main` pre-release. A backend module reads the installed build, queries GitHub's API, and compares builds; the Settings page shows status and calls `DeckyBackend.call("utilities/install_plugin", …)`.

**Tech Stack:** GitHub Actions, bash + jq + python3 zipfile, Python (urllib, pytest), React/TypeScript (vitest).

**Spec:** `docs/superpowers/specs/2026-10-31-self-update-design.md`

## Global Constraints

- Channels: `"stable"` (default) | `"main"`; app-config key `update_channel`.
- Rolling release tag `latest-main`, marked pre-release; assets `deckyfin.zip`, `version.json`.
- Main version: `<base>+main.<sha7>`, `<base>` = newest `vX.Y.Z` tag via `git describe --tags --abbrev=0 --match 'v*'` (full-history checkout), fallback repo `plugin.json` version. Stable version: tag without `v`.
- `plugin.json` gains `deckyfin_build: { channel, commit (full sha), built_at (ISO8601 UTC) }`; no `deckyfin_build` → "Development build".
- Zip layout: `deckyfin/` at root with `main.py`, `plugin.json`, `package.json`, `LICENSE`, `dist/`, `py_modules/`, `src/assets/`.
- Decky install call: `window.DeckyBackend.call("utilities/install_plugin", zip_url, "Deckyfin", version, null, 0)` — guarded; fallback shows URL + "Decky settings → Developer → Install plugin from URL".
- Repo slug from `plugin.json` `publish.website` (`https://github.com/avivkilloz/deckyfin`), fallback constant `avivkilloz/deckyfin`.
- GitHub requests: urllib, 10 s timeout, `User-Agent: deckyfin`, no auth.
- Update button disabled while `runningTaskCount > 0`.
- Checks: `pytest tests/ -q`, `python -m py_compile main.py`, `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- Commit messages end with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Shared packaging script + workflows

**Files:** Create `scripts/package-plugin.sh`; Modify `.github/workflows/release.yml`, `.github/workflows/ci.yml`.

**Interfaces:** Produces `deckyfin.zip` + `version.json` in the repo root when run as `scripts/package-plugin.sh <version> <channel>` after `npm run build`.

- [ ] **Step 1: Script** — `scripts/package-plugin.sh` (executable, `set -euo pipefail`):

```bash
#!/usr/bin/env bash
# Package the built plugin into deckyfin.zip (+ version.json).
# Usage: scripts/package-plugin.sh <version> <channel: stable|main>
# Requires: npm run build already done; jq; python3.
set -euo pipefail

VERSION="${1:?version required}"
CHANNEL="${2:?channel required}"
case "$CHANNEL" in stable|main) ;; *) echo "channel must be stable|main" >&2; exit 1 ;; esac
[[ -d dist ]] || { echo "dist/ missing — run npm run build first" >&2; exit 1; }

COMMIT="$(git rev-parse HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

rm -rf package deckyfin.zip version.json
mkdir -p package/deckyfin/src
cp main.py package.json LICENSE package/deckyfin/
jq --arg v "$VERSION" --arg c "$CHANNEL" --arg s "$COMMIT" --arg t "$BUILT_AT" \
  '.version = $v | .deckyfin_build = {channel: $c, commit: $s, built_at: $t}' \
  plugin.json > package/deckyfin/plugin.json
cp -r dist py_modules package/deckyfin/
cp -r src/assets package/deckyfin/src/
find package/deckyfin -name "__pycache__" -type d -prune -exec rm -rf {} +

(cd package && python3 -m zipfile -c ../deckyfin.zip deckyfin/)
jq -n --arg v "$VERSION" --arg c "$CHANNEL" --arg s "$COMMIT" --arg t "$BUILT_AT" \
  '{version: $v, channel: $c, commit: $s, built_at: $t}' > version.json
rm -rf package
echo "Packaged deckyfin.zip ($VERSION, $CHANNEL, ${COMMIT:0:7})"
```

- [ ] **Step 2: Verify locally** — `npm run build && scripts/package-plugin.sh 0.0.0+main.test main && python3 -m zipfile -l deckyfin.zip | head -20 && cat version.json && python3 -c "import zipfile,json;print(json.loads(zipfile.ZipFile('deckyfin.zip').read('deckyfin/plugin.json'))['deckyfin_build'])"`. Expected: `deckyfin/` root with listed files, no `__pycache__`, stamped build. Then delete `deckyfin.zip` and `version.json` and add both to `.gitignore`.

- [ ] **Step 3: release.yml** — replace the "Stamp version into plugin.json" and "Package plugin" steps with:

```yaml
      - name: Package plugin
        run: scripts/package-plugin.sh "${GITHUB_REF_NAME#v}" stable
```

and add `version.json` to the release `files:` (multi-line: `deckyfin.zip` and `version.json`). Keep `fail_on_unmatched_files: true`.

- [ ] **Step 4: ci.yml** — add a third job `main-build` that runs only on push to `main` (`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`), `needs: [test, build]`, `permissions: contents: write`:

```yaml
  main-build:
    name: Publish latest-main build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [test, build]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: "18"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Compute version
        id: ver
        run: |
          BASE="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
          BASE="${BASE#v}"
          [ -n "$BASE" ] || BASE="$(jq -r .version plugin.json)"
          echo "version=${BASE}+main.$(git rev-parse --short=7 HEAD)" >> "$GITHUB_OUTPUT"
      - name: Package plugin
        run: scripts/package-plugin.sh "${{ steps.ver.outputs.version }}" main
      - name: Move latest-main tag
        run: |
          git tag -f latest-main
          git push -f origin refs/tags/latest-main
      - name: Publish latest-main pre-release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: latest-main
          name: Latest main (${{ steps.ver.outputs.version }})
          prerelease: true
          make_latest: false
          body: "Rolling build of main at ${{ github.sha }}. Not a stable release."
          files: |
            deckyfin.zip
            version.json
          fail_on_unmatched_files: true
```

Note for reviewers: `softprops/action-gh-release` replaces assets with the same name on an existing release. Also add a concurrency group so two pushes can't race: at the top level of `ci.yml` *job* `main-build`: `concurrency: { group: latest-main, cancel-in-progress: true }`.

- [ ] **Step 5:** `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/workflows/release.yml` (if PyYAML is available; otherwise skip and say so). Commit `ci: shared packaging script and rolling latest-main build`.

---

### Task 2: Backend update logic

**Files:** Create `py_modules/deckyfin_updates.py`, `tests/test_updates.py`; Modify `main.py`.

**Interfaces:**
- `read_installed_build(plugin_dir: Path) -> dict` → `{version: str, channel: "stable"|"main"|None, commit: str|None, built_at: str|None}`
- `parse_release(release: dict, version_info: dict | None) -> dict | None` → `{version, commit, published_at, zip_url, html_url}`
- `compare_builds(installed: dict, latest: dict | None, channel: str) -> str` → `"up_to_date" | "update_available" | "unknown"`
- `repo_slug(plugin_dir: Path) -> str`
- `fetch_latest(channel: str, slug: str, opener=urllib.request.urlopen) -> dict` → `{latest: dict|None, error: str|None}`
- `get_update_channel() -> str`, `set_update_channel(channel: str) -> bool`
- callables `get_update_info(channel: str | None = None)`, `set_update_channel(channel)`

- [ ] **Step 1: Failing tests** — `tests/test_updates.py`:

```python
"""Tests for deckyfin_updates — installed build, release parsing, comparison."""

import io
import json
import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)

import pytest


def _plugin_dir(tmp_path, data):
    d = tmp_path / "plugin"
    d.mkdir()
    (d / "plugin.json").write_text(json.dumps(data))
    return d


@pytest.fixture
def up(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_updates
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_updates)
    return deckyfin_updates


def test_read_installed_build_main(tmp_path, up):
    d = _plugin_dir(tmp_path, {"version": "0.1.8+main.abc1234",
                               "deckyfin_build": {"channel": "main", "commit": "abc1234def", "built_at": "2026-10-31T10:00:00Z"}})
    assert up.read_installed_build(d) == {"version": "0.1.8+main.abc1234", "channel": "main",
                                          "commit": "abc1234def", "built_at": "2026-10-31T10:00:00Z"}


def test_read_installed_build_dev(tmp_path, up):
    d = _plugin_dir(tmp_path, {"version": "0.1.0"})
    assert up.read_installed_build(d) == {"version": "0.1.0", "channel": None, "commit": None, "built_at": None}


def test_read_installed_build_missing_file(tmp_path, up):
    assert up.read_installed_build(tmp_path / "nope")["version"] == "unknown"


REL = {
    "tag_name": "v0.1.9", "published_at": "2026-10-30T12:00:00Z", "html_url": "https://github.com/x/y/releases/tag/v0.1.9",
    "assets": [{"name": "deckyfin.zip", "browser_download_url": "https://github.com/x/y/releases/download/v0.1.9/deckyfin.zip"},
               {"name": "version.json", "browser_download_url": "https://example/version.json"}],
}


def test_parse_release_with_version_info(up):
    info = {"version": "0.1.9", "channel": "stable", "commit": "fff000", "built_at": "t"}
    assert up.parse_release(REL, info) == {
        "version": "0.1.9", "commit": "fff000", "published_at": "2026-10-30T12:00:00Z",
        "zip_url": "https://github.com/x/y/releases/download/v0.1.9/deckyfin.zip",
        "html_url": "https://github.com/x/y/releases/tag/v0.1.9",
    }


def test_parse_release_without_version_info_uses_tag(up):
    assert up.parse_release(REL, None)["version"] == "0.1.9"
    assert up.parse_release(REL, None)["commit"] is None


def test_parse_release_without_zip(up):
    assert up.parse_release({**REL, "assets": []}, None) is None


@pytest.mark.parametrize("installed,latest,channel,expected", [
    ({"version": "0.1.8", "channel": "stable", "commit": "a"}, {"version": "0.1.9", "commit": "b"}, "stable", "update_available"),
    ({"version": "0.1.9", "channel": "stable", "commit": "b"}, {"version": "0.1.9", "commit": "b"}, "stable", "up_to_date"),
    ({"version": "0.1.10", "channel": "stable", "commit": "c"}, {"version": "0.1.9", "commit": "b"}, "stable", "up_to_date"),
    ({"version": "0.1.8+main.abc", "channel": "main", "commit": "abc"}, {"version": "0.1.8", "commit": "x"}, "stable", "update_available"),
    ({"version": "0.1.0", "channel": None, "commit": None}, {"version": "0.1.8", "commit": "x"}, "stable", "update_available"),
    ({"version": "0.1.8+main.abc", "channel": "main", "commit": "abc"}, {"version": "0.1.8+main.def", "commit": "def"}, "main", "update_available"),
    ({"version": "0.1.8+main.abc", "channel": "main", "commit": "abc"}, {"version": "0.1.8+main.abc", "commit": "abc"}, "main", "up_to_date"),
    ({"version": "0.1.0", "channel": None, "commit": None}, {"version": "0.1.8+main.def", "commit": "def"}, "main", "update_available"),
    ({"version": "0.1.8", "channel": "stable", "commit": "a"}, None, "stable", "unknown"),
])
def test_compare_builds(up, installed, latest, channel, expected):
    assert up.compare_builds(installed, latest, channel) == expected


def test_repo_slug(tmp_path, up):
    d = _plugin_dir(tmp_path, {"publish": {"website": "https://github.com/avivkilloz/deckyfin"}})
    assert up.repo_slug(d) == "avivkilloz/deckyfin"
    assert up.repo_slug(tmp_path / "missing") == "avivkilloz/deckyfin"


def test_update_channel_setting(tmp_path, up):
    assert up.get_update_channel() == "stable"
    assert up.set_update_channel("main") is True
    assert up.get_update_channel() == "main"
    assert up.set_update_channel("beta") is False
    assert up.get_update_channel() == "main"


class _Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


def test_fetch_latest_main_reads_version_json(up):
    calls = []

    def opener(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else req
        calls.append(url)
        if url.endswith("/releases/tags/latest-main"):
            return _Resp(json.dumps({**REL, "tag_name": "latest-main"}).encode())
        if url == "https://example/version.json":
            return _Resp(json.dumps({"version": "0.1.9+main.fff", "commit": "fff"}).encode())
        raise AssertionError(url)

    res = up.fetch_latest("main", "x/y", opener=opener)
    assert res["error"] is None
    assert res["latest"]["version"] == "0.1.9+main.fff"
    assert res["latest"]["commit"] == "fff"
    assert calls[0] == "https://api.github.com/repos/x/y/releases/tags/latest-main"


def test_fetch_latest_network_error(up):
    def opener(req, timeout=None):
        raise OSError("offline")
    res = up.fetch_latest("stable", "x/y", opener=opener)
    assert res["latest"] is None and "offline" in res["error"]


def test_fetch_latest_missing_release(up):
    import urllib.error

    def opener(req, timeout=None):
        raise urllib.error.HTTPError(getattr(req, "full_url", req), 404, "Not Found", {}, None)
    res = up.fetch_latest("main", "x/y", opener=opener)
    assert res["latest"] is None and res["error"] == "No build on this channel yet"
```

- [ ] **Step 2:** `pytest tests/test_updates.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement** `py_modules/deckyfin_updates.py`:

```python
"""Self-update: installed build info, GitHub release lookup, build comparison."""

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from deckyfin_config import get_app_config, set_app_config

CHANNELS = ("stable", "main")
DEFAULT_SLUG = "avivkilloz/deckyfin"
_TIMEOUT = 10
_HEADERS = {"User-Agent": "deckyfin", "Accept": "application/vnd.github+json"}


def _read_plugin_json(plugin_dir: Path) -> dict:
    try:
        return json.loads((Path(plugin_dir) / "plugin.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def read_installed_build(plugin_dir: Path) -> dict:
    data = _read_plugin_json(plugin_dir)
    build = data.get("deckyfin_build") if isinstance(data.get("deckyfin_build"), dict) else {}
    channel = build.get("channel") if build.get("channel") in CHANNELS else None
    return {
        "version": str(data.get("version") or "unknown"),
        "channel": channel,
        "commit": build.get("commit") or None,
        "built_at": build.get("built_at") or None,
    }


def repo_slug(plugin_dir: Path) -> str:
    site = ((_read_plugin_json(plugin_dir).get("publish") or {}).get("website") or "")
    m = re.match(r"https?://github\.com/([^/\s]+/[^/\s]+?)/?$", site)
    return m.group(1) if m else DEFAULT_SLUG


def parse_release(release: dict, version_info: Optional[dict]) -> Optional[dict]:
    assets = release.get("assets") or []
    zip_asset = next((a for a in assets if a.get("name") == "deckyfin.zip"), None)
    if not zip_asset:
        return None
    info = version_info or {}
    tag = str(release.get("tag_name") or "")
    return {
        "version": info.get("version") or (tag[1:] if tag.startswith("v") else tag),
        "commit": info.get("commit") or None,
        "published_at": release.get("published_at"),
        "zip_url": zip_asset.get("browser_download_url"),
        "html_url": release.get("html_url"),
    }


def _semver(v: str) -> Optional[tuple]:
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", v or "")
    return tuple(int(x) for x in m.groups()) if m else None


def compare_builds(installed: dict, latest: Optional[dict], channel: str) -> str:
    if not latest:
        return "unknown"
    if channel == "main":
        if installed.get("channel") != "main" or not installed.get("commit"):
            return "update_available"
        same = latest.get("commit") and installed["commit"].startswith(latest["commit"][:7]) \
            and latest["commit"].startswith(installed["commit"][:7])
        return "up_to_date" if same else "update_available"
    # stable
    if installed.get("channel") != "stable":
        return "update_available"
    a, b = _semver(installed.get("version", "")), _semver(latest.get("version", ""))
    if a is None or b is None:
        return "unknown"
    return "update_available" if b > a else "up_to_date"


def _get_json(url: str, opener: Callable) -> dict:
    req = urllib.request.Request(url, headers=_HEADERS)
    with opener(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_latest(channel: str, slug: str, opener: Callable = urllib.request.urlopen) -> dict:
    base = f"https://api.github.com/repos/{slug}"
    url = f"{base}/releases/tags/latest-main" if channel == "main" else f"{base}/releases/latest"
    try:
        release = _get_json(url, opener)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"latest": None, "error": "No build on this channel yet"}
        return {"latest": None, "error": f"GitHub returned HTTP {e.code}"}
    except Exception as e:
        return {"latest": None, "error": f"Couldn't reach GitHub: {e}"}
    info = None
    vj = next((a for a in release.get("assets") or [] if a.get("name") == "version.json"), None)
    if vj and vj.get("browser_download_url"):
        try:
            info = _get_json(vj["browser_download_url"], opener)
        except Exception:
            info = None
    latest = parse_release(release, info)
    return {"latest": latest, "error": None if latest else "No build on this channel yet"}


def get_update_channel() -> str:
    ch = get_app_config().get("update_channel")
    return ch if ch in CHANNELS else "stable"


def set_update_channel(channel: str) -> bool:
    if channel not in CHANNELS:
        return False
    set_app_config({"update_channel": channel})
    return True
```

Notes: `urllib.request.Request` has `full_url` (the test opener reads it). Network calls run in the async callable via `asyncio.to_thread` (or `loop.run_in_executor`) so a slow GitHub can't block the plugin's event loop — check how main.py runs other blocking work and follow it.

`main.py`: import `read_installed_build, repo_slug, fetch_latest, compare_builds, get_update_channel, set_update_channel as _set_update_channel` from `deckyfin_updates`; plugin dir = `Path(__file__).resolve().parent`; add:

```python
    async def get_update_info(self, channel: Optional[str] = None) -> dict:
        """Installed build vs newest build on the channel (GitHub)."""
        import asyncio
        plugin_dir = Path(__file__).resolve().parent
        ch = channel if channel in ("stable", "main") else get_update_channel()
        installed = read_installed_build(plugin_dir)
        res = await asyncio.to_thread(fetch_latest, ch, repo_slug(plugin_dir))
        latest = res["latest"]
        return {"channel": ch, "installed": installed, "latest": latest,
                "status": compare_builds(installed, latest, ch), "error": res["error"]}

    async def set_update_channel(self, channel: str) -> dict:
        return {"success": _set_update_channel(channel)}
```

- [ ] **Step 4:** `pytest tests/ -q` PASS; `python -m py_compile main.py`.
- [ ] **Step 5:** Commit `feat: backend update check for Stable and Latest main channels`.

---

### Task 3: Settings "Updates" section

**Files:** Create `src/updates.ts`, `src/updates.test.ts`; Modify `src/components/SettingsPage.tsx`, `src/components/GameLibrary.tsx`.

**Interfaces:** Consumes `get_update_info`, `set_update_channel` (Task 2). Produces:
- `type BuildInfo = { version: string; channel: "stable" | "main" | null; commit: string | null; built_at?: string | null }`
- `type LatestInfo = { version: string; commit: string | null; published_at: string | null; zip_url: string; html_url: string | null }`
- `describeBuild(b: BuildInfo): string` — `"0.1.9 (stable)"`, `"0.1.8+main.abc1234 (main · abc1234)"`, `"0.1.0 — Development build"`
- `statusLabel(status: string, error: string | null): string` — `"Up to date"` / `"Update available"` / error text / `"Unknown"`
- `installViaDecky(url: string, version: string): Promise<string | null>` (null = started OK, else error message)

- [ ] **Step 1: Failing tests** — `src/updates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeBuild, statusLabel } from "./updates";

describe("describeBuild", () => {
  it("formats stable, main and development builds", () => {
    expect(describeBuild({ version: "0.1.9", channel: "stable", commit: "abcdef1234" })).toBe("0.1.9 (stable)");
    expect(describeBuild({ version: "0.1.8+main.abc1234", channel: "main", commit: "abc1234ffff" })).toBe("0.1.8+main.abc1234 (main · abc1234)");
    expect(describeBuild({ version: "0.1.0", channel: null, commit: null })).toBe("0.1.0 — Development build");
  });
});

describe("statusLabel", () => {
  it("maps statuses and prefers errors", () => {
    expect(statusLabel("up_to_date", null)).toBe("Up to date");
    expect(statusLabel("update_available", null)).toBe("Update available");
    expect(statusLabel("unknown", "Couldn't reach GitHub: offline")).toBe("Couldn't reach GitHub: offline");
    expect(statusLabel("unknown", null)).toBe("Unknown");
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL.

- [ ] **Step 3: Implement** `src/updates.ts` (no `@decky/*` imports):

```ts
export type BuildInfo = { version: string; channel: "stable" | "main" | null; commit: string | null; built_at?: string | null };
export type LatestInfo = { version: string; commit: string | null; published_at: string | null; zip_url: string; html_url: string | null };

export function describeBuild(b: BuildInfo): string {
  if (!b.channel) return `${b.version} — Development build`;
  if (b.channel === "main") return `${b.version} (main · ${(b.commit ?? "").slice(0, 7)})`;
  return `${b.version} (stable)`;
}

export function statusLabel(status: string, error: string | null): string {
  if (error) return error;
  if (status === "up_to_date") return "Up to date";
  if (status === "update_available") return "Update available";
  return "Unknown";
}

/** Ask Decky Loader to install the zip (Decky shows its own confirmation). Returns an error message or null. */
export async function installViaDecky(url: string, version: string): Promise<string | null> {
  try {
    const call = (window as any).DeckyBackend?.call;
    if (typeof call !== "function") return "Decky's installer isn't available";
    await (window as any).DeckyBackend.call("utilities/install_plugin", url, "Deckyfin", version, null, 0);
    return null;
  } catch (e: any) {
    return e?.message || "Install failed";
  }
}
```

- [ ] **Step 4: Settings UI** — in `SettingsPage.tsx` add callables `getUpdateInfo` (`[channel?: string]`) and `setUpdateChannel`, a new prop `runningTaskCount?: number` (pass it from `GameLibrary.tsx`'s `<SettingsPage …>` using the same value it passes to GameDetail), and an **Updates** section in the same collapsible-section style as the other Settings sections:
  - state: `updateInfo` (result), `updateLoading`, `updateFeedback`, `installError`;
  - on mount: `getUpdateInfo()`;
  - Channel chips `Stable` / `Latest main` (active = `updateInfo.channel`); selecting calls `setUpdateChannel(ch)` then `getUpdateInfo(ch)`;
  - lines: `Installed: describeBuild(installed)`, `Latest: <latest.version> · <published date>` or the error, `Status: statusLabel(...)`;
  - "Update Deckyfin" button only when `status === "update_available"` and `latest`: disabled (opacity 0.4, no-op) while `runningTaskCount > 0` with hint "Finish running tasks first"; on activate `installViaDecky(latest.zip_url, latest.version)`; on error show the error, the zip URL and "Install it from Decky settings → Developer → Install plugin from URL";
  - "Check again" link always (re-calls `getUpdateInfo(channel)`).
  CLAUDE.md rule: rename a useState setter if it collides with a callable name (e.g. `setUpdateChannel` callable vs state — name state differently).

- [ ] **Step 5:** `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- [ ] **Step 6:** Commit `feat: Updates section in Settings (Stable / Latest main)`.

---

### Task 4: Verification

- [ ] `pytest tests/ -q`; `python -m py_compile main.py`; `npm test`; `npx tsc --noEmit -p .`; `npm run build`; `scripts/package-plugin.sh 0.0.0+main.local main` produces a valid zip (then delete artifacts).
- [ ] Read-only live check of `get_update_info` logic: `cd py_modules && python3 -c "from deckyfin_updates import *; from pathlib import Path; print(fetch_latest('stable', 'avivkilloz/deckyfin'))"` → v0.1.8 with a zip URL.
- [ ] Manual (after merge + push): the `CI` workflow's `main-build` job publishes `latest-main` with `deckyfin.zip` + `version.json`; on the Deck, Settings → Updates shows both channels and "Update Deckyfin" triggers Decky's install prompt.
