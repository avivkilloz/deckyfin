"""Proton version detection, discovery, and download utilities."""

import os
import tarfile
import tempfile
import threading as _threading
import logging
from pathlib import Path
from typing import Optional

from steam_utils import find_steam_root
from deckyfin_consts import (
    LOGGER_PROTON,
    PROTON_SCRIPT_NAME,
    PROTON_GE_REPO,
    PROTON_GE_RELEASES_URL,
    STEAM_STEAMAPPS_FOLDER,
    STEAM_COMMON_FOLDER,
    STEAM_COMPATTOOLS_FOLDER,
)

logger = logging.getLogger(LOGGER_PROTON)


def list_available_proton() -> list[str]:
    """List available Proton versions installed on the system."""
    steam_root = find_steam_root()
    compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER
    proton_versions = []

    if compat_dir.exists():
        proton_versions.extend([
            d.name for d in compat_dir.iterdir() if d.is_dir()
        ])

    common_dir = steam_root / STEAM_STEAMAPPS_FOLDER / STEAM_COMMON_FOLDER
    if common_dir.exists():
        proton_versions.extend([
            d.name for d in common_dir.iterdir()
            if d.is_dir() and "proton" in d.name.lower()
        ])

    return sorted(proton_versions)


def find_proton_installation(steam_root: Path, proton_name: str) -> Optional[Path]:
    """Find the Proton installation directory and return path to the 'proton' script."""
    compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER / proton_name
    if compat_dir.exists():
        proton_script = compat_dir / PROTON_SCRIPT_NAME
        if proton_script.exists():
            return proton_script

    common_dir = steam_root / STEAM_STEAMAPPS_FOLDER / STEAM_COMMON_FOLDER
    if common_dir.exists():
        proton_dir = common_dir / proton_name
        if proton_dir.exists():
            proton_script = proton_dir / PROTON_SCRIPT_NAME
            if proton_script.exists():
                return proton_script

        for proton_dir in common_dir.iterdir():
            if proton_dir.is_dir() and proton_name.lower() in proton_dir.name.lower():
                proton_script = proton_dir / PROTON_SCRIPT_NAME
                if proton_script.exists():
                    return proton_script

    logger.warning("Proton version '%s' not found on disk", proton_name)
    return None


def get_proton_version_for_game(app_id: int, steam_root: Path, user_id: str) -> Optional[str]:
    """Get the Proton version configured for a specific game."""
    import vdf
    from steam_games import convert_appid_to_config_format, convert_appid_to_unsigned_32bit

    config_appid = convert_appid_to_config_format(app_id)

    localconfig_path = steam_root / "userdata" / user_id / "config" / "localconfig.vdf"
    if not localconfig_path.exists():
        localconfig_path = steam_root / "userdata" / user_id / "config" / "config.vdf"

    if localconfig_path.exists():
        try:
            with open(localconfig_path, "r", encoding="utf-8") as f:
                config = vdf.load(f)
            s = config.get("UserLocalConfigStore", {}).get("Software", {})
            if not s:
                s = config.get("InstallConfigStore", {}).get("Software", {})
            c = s.get("Valve") or s.get("valve")
            if c:
                mapping = c.get("Steam", {}).get("CompatToolMapping", {})
                if config_appid in mapping:
                    return mapping[config_appid].get("name")
        except Exception:
            pass

    unsigned_appid = convert_appid_to_unsigned_32bit(app_id)
    global_config_paths = [
        steam_root / "config" / "config.vdf",
        Path.home() / ".steam" / "steam" / "config" / "config.vdf",
    ]
    for config_path in global_config_paths:
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = vdf.load(f)
                mapping = (
                    config.get("InstallConfigStore", {})
                    .get("Software", {})
                    .get("Valve", {})
                    .get("Steam", {})
                    .get("CompatToolMapping", {})
                )
                if str(unsigned_appid) in mapping:
                    return mapping[str(unsigned_appid)].get("name")
            except Exception:
                pass

    return None


def is_ge_proton(proton_name: str) -> bool:
    """Check if a Proton name is a GE-Proton version."""
    return proton_name.startswith("GE-Proton") or proton_name.startswith("GE_Proton")


def download_proton_ge(proton_name: str) -> dict:
    """
    Download a GE-Proton version from GitHub releases.

    Returns dict with 'success', 'message', and optional 'error' keys.
    """
    steam_root = find_steam_root()
    compat_dir = steam_root / "compatibilitytools.d"

    proton_dir = compat_dir / proton_name
    if proton_dir.exists() and (proton_dir / "proton").exists():
        return {
            "success": True,
            "message": f"Proton version '{proton_name}' already exists locally",
        }

    if not is_ge_proton(proton_name):
        return {
            "success": False,
            "message": (
                f"'{proton_name}' is not a GE-Proton version. "
                "Only GE-Proton versions can be auto-downloaded."
            ),
        }

    compat_dir.mkdir(parents=True, exist_ok=True)
    download_url = f"{PROTON_GE_RELEASES_URL}/{proton_name}/{proton_name}.tar.gz"

    tmp_path = None
    try:
        import requests

        logger.info("Downloading %s from %s", proton_name, download_url)
        response = requests.get(download_url, stream=True, timeout=300)
        response.raise_for_status()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".tar.gz") as tmp_file:
            tmp_path = tmp_file.name
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    tmp_file.write(chunk)

        logger.info("Extracting %s to %s", proton_name, compat_dir)
        with tarfile.open(tmp_path, "r:gz") as tar:
            with tempfile.TemporaryDirectory() as extract_tmp:
                tar.extractall(extract_tmp)

                extracted_dir = None
                extracted_dirs = [
                    d for d in Path(extract_tmp).iterdir()
                    if d.is_dir() and proton_name in d.name
                ]
                if not extracted_dirs:
                    for root, dirs, files in os.walk(extract_tmp):
                        if PROTON_SCRIPT_NAME in files:
                            extracted_dir = Path(root)
                            break
                    if not extracted_dir:
                        raise RuntimeError(
                            "Could not find Proton directory in extracted archive"
                        )
                else:
                    extracted_dir = extracted_dirs[0]

                import shutil
                final_dir = compat_dir / proton_name
                if final_dir.exists():
                    shutil.rmtree(final_dir)
                shutil.move(str(extracted_dir), str(final_dir))

        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

        proton_script = final_dir / PROTON_SCRIPT_NAME
        if not proton_script.exists():
            return {
                "success": False,
                "message": f"Downloaded but 'proton' script not found in {final_dir}",
            }

        logger.info("Successfully installed %s", proton_name)
        return {
            "success": True,
            "message": f"Successfully downloaded and installed '{proton_name}'",
        }

    except Exception as e:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        logger.error("Error downloading '%s': %s", proton_name, e)
        return {
            "success": False,
            "message": f"Error downloading '{proton_name}': {str(e)}",
        }


def ensure_proton_available(proton_name: str) -> None:
    """Ensure a Proton version exists locally, downloading GE builds if needed."""
    if not proton_name:
        raise ValueError("proton_name is required")

    available = list_available_proton()
    if proton_name in available:
        logger.debug("Proton %s already available", proton_name)
        return

    if is_ge_proton(proton_name):
        result = download_proton_ge(proton_name)
        if not result.get("success"):
            raise ValueError(
                f"Proton version '{proton_name}' not available: "
                f"{result.get('message', 'Unknown error')}"
            )
        available = list_available_proton()
        if proton_name in available:
            logger.info("Proton %s downloaded and ready", proton_name)
            return
        raise RuntimeError(
            f"Downloaded '{proton_name}' but it is still not available locally"
        )

    raise ValueError(
        f"Proton version '{proton_name}' not found. "
        f"Available: {', '.join(available)}"
    )


# ── Multi-source Proton release catalogue + background install ─────────────────

PROTON_SOURCES = [
    {"id": "ge", "name": "GE-Proton", "repo": "GloriousEggroll/proton-ge-custom"},
    {"id": "cachyos", "name": "CachyOS Proton", "repo": "CachyOS/proton-cachyos"},
]

_releases_cache: dict = {}   # repo → {"pages": {page: [...]}, "ts": float}
_CACHE_TTL = 3600

_proton_install_registry: dict = {}   # install_name → {status, bytes_downloaded, total_bytes, error}
_proton_cancel_events: dict = {}      # install_name → threading.Event


def list_proton_sources() -> list[dict]:
    """Return the list of supported Proton source types."""
    return list(PROTON_SOURCES)


def _pick_asset(assets: list) -> dict | None:
    """Pick the preferred tarball asset from a GitHub release's assets list."""
    for ext in (".tar.gz", ".tar.zst", ".tar.xz"):
        for a in assets:
            name = a.get("name", "")
            if name.endswith(ext) and not name.endswith(".sha512sum"):
                return a
    return None


def fetch_proton_releases(source_id: str, page: int = 1, per_page: int = 10) -> dict:
    """Fetch one page of releases for a Proton source, annotated with installed status.

    Returns ``{source_id, releases: [{tag_name, install_name, size_bytes, download_url, installed}], has_more}``.
    Pages are cached per-repo for one hour; stale cache served on network error.
    """
    import time
    try:
        import requests as _req
    except ImportError:
        return {"source_id": source_id, "releases": [], "has_more": False}

    source = next((s for s in PROTON_SOURCES if s["id"] == source_id), None)
    if source is None:
        return {"source_id": source_id, "releases": [], "has_more": False}

    repo = source["repo"]
    now = time.time()
    cache = _releases_cache.setdefault(repo, {"pages": {}, "ts": 0.0})

    if page not in cache["pages"] or now - cache["ts"] > _CACHE_TTL:
        try:
            resp = _req.get(
                f"https://api.github.com/repos/{repo}/releases",
                params={"per_page": per_page, "page": page},
                timeout=15,
                headers={"Accept": "application/vnd.github.v3+json"},
            )
            resp.raise_for_status()
            raw_releases = []
            for release in resp.json():
                if release.get("draft") or release.get("prerelease"):
                    continue
                asset = _pick_asset(release.get("assets", []))
                if asset is None:
                    continue
                asset_name = asset["name"]
                # strip common archive extensions to get the install directory name
                for ext in (".tar.gz", ".tar.zst", ".tar.xz"):
                    if asset_name.endswith(ext):
                        install_name = asset_name[: -len(ext)]
                        break
                else:
                    install_name = release["tag_name"]
                raw_releases.append({
                    "tag_name": release["tag_name"],
                    "install_name": install_name,
                    "size_bytes": asset.get("size", 0),
                    "download_url": asset["browser_download_url"],
                })
            cache["pages"][page] = raw_releases
            cache["ts"] = now
        except Exception as exc:
            logger.warning("Failed to fetch %s releases page %s: %s", repo, page, exc)
            raw_releases = cache["pages"].get(page, [])
    else:
        raw_releases = cache["pages"][page]

    installed = set(list_available_proton())
    releases = [
        {**r, "installed": r["install_name"] in installed}
        for r in raw_releases
    ]
    has_more = len(raw_releases) == per_page  # heuristic — if full page, likely more
    return {"source_id": source_id, "releases": releases, "has_more": has_more}


def start_proton_install(install_name: str, download_url: str) -> dict:
    """Start a background download + install of any Proton release.

    ``install_name`` is the directory name to create in ``compatibilitytools.d/``.
    ``download_url`` is the direct asset download URL (from :func:`fetch_proton_releases`).
    Poll :func:`get_proton_install_statuses` for progress.
    """
    if not install_name or not download_url:
        return {"success": False, "error": "install_name and download_url are required"}

    existing = _proton_install_registry.get(install_name, {})
    if existing.get("status") in ("downloading", "extracting"):
        return {"success": False, "error": "Already installing"}

    if install_name in list_available_proton():
        return {"success": False, "error": "Already installed"}

    cancel_event = _threading.Event()
    _proton_cancel_events[install_name] = cancel_event
    _proton_install_registry[install_name] = {
        "status": "downloading",
        "bytes_downloaded": 0,
        "total_bytes": 0,
        "error": None,
    }

    def _run() -> None:
        import shutil
        import subprocess as _sp
        try:
            import requests as _req
        except ImportError:
            _proton_install_registry[install_name]["status"] = "failed"
            _proton_install_registry[install_name]["error"] = "requests not available"
            return

        entry = _proton_install_registry[install_name]
        steam_root = find_steam_root()
        compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER
        compat_dir.mkdir(parents=True, exist_ok=True)

        suffix = ".tar.gz"
        for ext in (".tar.gz", ".tar.zst", ".tar.xz"):
            if download_url.endswith(ext):
                suffix = ext
                break

        tmp_path = None
        try:
            resp = _req.get(download_url, stream=True, timeout=300)
            resp.raise_for_status()
            entry["total_bytes"] = int(resp.headers.get("content-length", 0))

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp_path = tmp.name
                downloaded = 0
                for chunk in resp.iter_content(chunk_size=65536):
                    if cancel_event.is_set():
                        entry["status"] = "cancelled"
                        return
                    if chunk:
                        tmp.write(chunk)
                        downloaded += len(chunk)
                        entry["bytes_downloaded"] = downloaded

            if cancel_event.is_set():
                entry["status"] = "cancelled"
                return

            entry["status"] = "extracting"

            with tempfile.TemporaryDirectory() as extract_tmp:
                # Use system tar — handles gz, zst, xz without Python lib dependencies
                _sp.run(
                    ["tar", "-xf", tmp_path, "-C", extract_tmp],
                    check=True, timeout=600,
                )
                # Find the directory containing a proton script
                extracted_dir = None
                for root, dirs, files in os.walk(extract_tmp):
                    if PROTON_SCRIPT_NAME in files or "toolmanifest.vdf" in files:
                        extracted_dir = Path(root)
                        break
                if extracted_dir is None:
                    raise RuntimeError("Could not find Proton directory in archive")

                final_dir = compat_dir / install_name
                if final_dir.exists():
                    shutil.rmtree(final_dir)
                shutil.move(str(extracted_dir), str(final_dir))

            entry["status"] = "done"
            logger.info("Installed Proton version: %s", install_name)

        except Exception as exc:
            if not cancel_event.is_set():
                entry["status"] = "failed"
                entry["error"] = str(exc)
                logger.error("Failed to install %s: %s", install_name, exc)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
            _proton_cancel_events.pop(install_name, None)

    _threading.Thread(target=_run, daemon=True).start()
    return {"success": True, "error": None}


def cancel_proton_install(install_name: str) -> dict:
    """Cancel an in-progress Proton download."""
    event = _proton_cancel_events.get(install_name)
    if event:
        event.set()
        _proton_install_registry.pop(install_name, None)
        return {"success": True, "error": None}
    return {"success": False, "error": "No active install for this version"}


def delete_proton_version(install_name: str) -> dict:
    """Delete an installed Proton version from compatibilitytools.d."""
    import shutil
    steam_root = find_steam_root()
    proton_dir = steam_root / STEAM_COMPATTOOLS_FOLDER / install_name
    if not proton_dir.exists():
        return {"success": False, "error": f"'{install_name}' not found in compatibilitytools.d"}
    try:
        shutil.rmtree(proton_dir)
        logger.info("Deleted Proton version: %s", install_name)
        return {"success": True, "error": None}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def get_proton_install_statuses() -> dict:
    """Return a snapshot of all tracked install operations."""
    return {k: dict(v) for k, v in _proton_install_registry.items()}
