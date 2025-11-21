import asyncio
import json
import os
import shlex
import shutil
from datetime import datetime
from typing import Any, Dict, List, Optional

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky

PLUGIN_ID = "deckyfin"
USER_HOME = decky.DECKY_USER_HOME
DATA_DIR = os.path.join(USER_HOME, ".local", "share", PLUGIN_ID)
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
CACHE_YAML_PATH = os.path.join(DATA_DIR, "games.yaml")
SAVES_DIR = os.path.join(DATA_DIR, "saves")


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _slugify(value: str) -> str:
    safe = "".join(ch if ch.isalnum() else "-" for ch in value.strip())
    while "--" in safe:
        safe = safe.replace("--", "-")
    return safe.strip("-").lower() or "game"


def _parse_scalar(raw: str) -> Any:
    if raw == "":
        return ""
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    if raw.startswith("'") and raw.endswith("'"):
        return raw[1:-1]
    lowered = raw.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


class SimpleGamesYaml:
    @staticmethod
    def load(path: str) -> List[Dict[str, Any]]:
        if not os.path.exists(path):
            raise FileNotFoundError(f"YAML file not found at {path}")

        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.readlines()

        games: List[Dict[str, Any]] = []
        current: Optional[Dict[str, Any]] = None
        active_list: Optional[str] = None
        inside_games = False

        for raw in lines:
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                continue
            indent = len(raw) - len(raw.lstrip(" "))
            if stripped == "games:":
                inside_games = True
                continue
            if not inside_games:
                continue
            if stripped.startswith("- ") and indent == 2:
                if current:
                    games.append(current)
                current = {}
                active_list = None
                remainder = stripped[2:].strip()
                if remainder:
                    if ":" not in remainder:
                        raise ValueError(f"Malformed line: {raw}")
                    key, value = remainder.split(":", 1)
                    current[key.strip()] = _parse_scalar(value.strip())
                continue
            if current is None:
                raise ValueError("Found property outside of a game entry")
            if stripped.startswith("- ") and indent >= 6 and active_list:
                current.setdefault(active_list, [])
                current[active_list].append(_parse_scalar(stripped[2:].strip()))
                continue
            if ":" in stripped:
                key, value = stripped.split(":", 1)
                key = key.strip()
                value = value.strip()
                if value == "":
                    current[key] = []
                    active_list = key
                else:
                    current[key] = _parse_scalar(value)
                    active_list = None
                continue

        if current:
            games.append(current)

        return games


DEFAULT_SETTINGS: Dict[str, Any] = {
    "localLibraryPath": os.path.join(USER_HOME, "Games"),
    "yamlFilePath": os.path.join(USER_HOME, "Games", "games.yaml"),
    "remote": {
        "enabled": False,
        "host": "",
        "gamesPath": "",
        "yamlFileName": "games.yaml",
        "rsyncFlags": "-avz",
        "savePath": "deckyfin-saves",
    },
    "proton": {
        "compatdataPath": os.path.join(
            USER_HOME, ".local", "share", "Steam", "steamapps", "compatdata"
        ),
        "defaultVersion": "GE-Proton10-25",
    },
    "saveBackupPath": os.path.join(SAVES_DIR),
}


class Plugin:
    def __init__(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(SAVES_DIR, exist_ok=True)
        self.settings: Dict[str, Any] = self._load_settings()
        self._cached_games: List[Dict[str, Any]] = []
        self.loop = asyncio.get_event_loop()

    # region lifecycle -----------------------------------------------------
    async def _main(self):
        decky.logger.info("[Deckyfin] Plugin starting up")

    async def _unload(self):
        decky.logger.info("[Deckyfin] Plugin unloading")

    async def _uninstall(self):
        decky.logger.info("[Deckyfin] Plugin uninstall requested")

    async def _migration(self):
        decky.logger.info("[Deckyfin] Running migration step")

    # endregion -----------------------------------------------------------

    # region settings api -------------------------------------------------
    async def get_settings(self) -> Dict[str, Any]:
        return self.settings

    async def save_settings(self, new_settings: Dict[str, Any]) -> Dict[str, Any]:
        self.settings = self._deep_merge(self.settings, new_settings)
        self._persist_settings()
        decky.logger.info("[Deckyfin] Settings saved")
        return self.settings

    # endregion -----------------------------------------------------------

    # region games api ----------------------------------------------------
    async def load_games(self) -> Dict[str, Any]:
        yaml_path = await self._ensure_games_yaml()
        parsed_games = SimpleGamesYaml.load(yaml_path)
        decorated = [self._decorate_game(entry) for entry in parsed_games]
        self._cached_games = decorated
        return {
            "games": decorated,
            "source": yaml_path,
            "refreshedAt": _now_iso(),
        }

    async def download_game(self, game_name: str) -> Dict[str, Any]:
        game = await self._require_game_by_name(game_name)
        remote_cfg = self.settings.get("remote", {})
        if not remote_cfg.get("enabled"):
            raise RuntimeError("Remote downloads are disabled")
        remote_host = remote_cfg.get("host")
        remote_path = remote_cfg.get("gamesPath")
        if not remote_host or not remote_path:
            raise RuntimeError("Remote host or games path is not configured")
        remote_subpath = game.get("remote_path") or os.path.basename(
            game.get("defined_path") or game["path"]
        )
        remote_target = os.path.join(remote_path, remote_subpath)
        local_target = game["path"]
        os.makedirs(local_target, exist_ok=True)
        await self._rsync_directory(
            remote_target, local_target, download=True, delete=False
        )
        return {
            "ok": True,
            "message": f"Game '{game_name}' downloaded to {local_target}",
            "timestamp": _now_iso(),
        }

    async def setup_proton_prefix(self, steam_appid: int) -> Dict[str, Any]:
        game = await self._require_game_by_appid(str(steam_appid))
        compatdata_root = self.settings["proton"]["compatdataPath"]
        prefix_path = os.path.join(compatdata_root, str(game["steam_appid"]))
        pfx = os.path.join(prefix_path, "pfx")
        drive_c = os.path.join(pfx, "drive_c")
        user_profile = os.path.join(drive_c, "users", "steamuser")

        for path in [
            prefix_path,
            pfx,
            drive_c,
            os.path.join(user_profile, "Documents"),
            os.path.join(user_profile, "AppData", "Local"),
            os.path.join(user_profile, "AppData", "Roaming"),
        ]:
            os.makedirs(path, exist_ok=True)

        metadata = {
            "name": game["name"],
            "proton_version": game.get("proton_version")
            or self.settings["proton"]["defaultVersion"],
            "updated_at": _now_iso(),
        }
        metadata_path = os.path.join(prefix_path, "deckyfin.json")
        with open(metadata_path, "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2)

        return {
            "ok": True,
            "message": f"Prepared Proton prefix for {game['name']} at {prefix_path}",
            "prefix_path": prefix_path,
        }

    async def sync_game_saves(self, game_name: str) -> Dict[str, Any]:
        game = await self._require_game_by_name(game_name)
        sync_paths: List[str] = game.get("proton_sync_paths") or []
        if not sync_paths:
            raise RuntimeError(f"{game_name} has no proton_sync_paths configured")
        prefix_path = os.path.join(
            self.settings["proton"]["compatdataPath"], str(game["steam_appid"])
        )
        backup_root = os.path.join(
            self.settings["saveBackupPath"], _slugify(game["name"])
        )
        os.makedirs(backup_root, exist_ok=True)

        copied = []
        for relative in sync_paths:
            resolved = self._resolve_proton_path(prefix_path, relative)
            if not os.path.exists(resolved):
                decky.logger.warning(
                    "[Deckyfin] Save path missing for %s: %s", game_name, relative
                )
                continue
            target = os.path.join(backup_root, self._sanitize_relative(relative))
            self._copy_any(resolved, target)
            copied.append(target)

        if not copied:
            raise RuntimeError(
                f"No save paths for {game_name} were copied. Ensure the prefix exists."
            )

        marker = os.path.join(backup_root, ".last_sync")
        with open(marker, "w", encoding="utf-8") as handle:
            handle.write(_now_iso())

        remote_cfg = self.settings.get("remote", {})
        if remote_cfg.get("enabled") and remote_cfg.get("host"):
            remote_save_root = os.path.join(
                remote_cfg.get("gamesPath") or "", remote_cfg.get("savePath") or ""
            )
            remote_target = os.path.join(remote_save_root, _slugify(game["name"]))
            await self._rsync_directory(
                remote_target, backup_root, upload=True, delete=False
            )

        return {
            "ok": True,
            "message": f"Saves for {game_name} copied to {backup_root}",
            "timestamp": _now_iso(),
        }

    async def sync_all_saves(self) -> Dict[str, Any]:
        if not self._cached_games:
            await self.load_games()
        successes = 0
        failures: List[str] = []
        for game in self._cached_games:
            try:
                await self.sync_game_saves(game["name"])
                successes += 1
            except Exception as err:  # pylint: disable=broad-except
                failures.append(f"{game['name']}: {err}")
        return {
            "ok": len(failures) == 0,
            "message": f"Synced {successes} games",
            "failures": failures,
            "timestamp": _now_iso(),
        }

    # endregion -----------------------------------------------------------

    # region helpers ------------------------------------------------------
    def _load_settings(self) -> Dict[str, Any]:
        if not os.path.exists(SETTINGS_PATH):
            self._persist_settings(DEFAULT_SETTINGS)
            return json.loads(json.dumps(DEFAULT_SETTINGS))
        with open(SETTINGS_PATH, "r", encoding="utf-8") as handle:
            stored = json.load(handle)
        merged = self._deep_merge(DEFAULT_SETTINGS, stored)
        self._persist_settings(merged)
        return merged

    def _persist_settings(self, overrides: Optional[Dict[str, Any]] = None) -> None:
        payload = overrides or self.settings
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)

    async def _ensure_games_yaml(self) -> str:
        remote_cfg = self.settings.get("remote", {})
        if remote_cfg.get("enabled"):
            remote_host = remote_cfg.get("host")
            remote_path = remote_cfg.get("gamesPath")
            yaml_name = remote_cfg.get("yamlFileName") or "games.yaml"
            if not remote_host or not remote_path:
                raise RuntimeError("Remote host and gamesPath are required")
            remote_file = os.path.join(remote_path, yaml_name)
            await self._rsync_file(remote_file, CACHE_YAML_PATH)
            return CACHE_YAML_PATH
        yaml_path = self.settings.get("yamlFilePath")
        if not yaml_path:
            raise RuntimeError("yamlFilePath is not configured")
        return os.path.expanduser(yaml_path)

    def _decorate_game(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        local_path_raw = entry.get("path", "")
        local_path = self._resolve_local_path(local_path_raw)
        compatdata_root = self.settings["proton"]["compatdataPath"]
        prefix_path = os.path.join(compatdata_root, str(entry.get("steam_appid")))
        backup_path = os.path.join(
            self.settings["saveBackupPath"], _slugify(entry.get("name", "game"))
        )
        remote_cfg = self.settings.get("remote", {})
        remote_available = bool(
            remote_cfg.get("enabled") and remote_cfg.get("host") and remote_cfg.get("gamesPath")
        )
        metadata_path = os.path.join(prefix_path, "deckyfin.json")
        last_backup = self._read_last_backup(backup_path)

        return {
            "name": entry.get("name"),
            "path": local_path,
            "defined_path": local_path_raw,
            "steam_appid": entry.get("steam_appid"),
            "proton_version": entry.get("proton_version")
            or self.settings["proton"]["defaultVersion"],
            "proton_dependencies": entry.get("proton_dependencies") or [],
            "proton_sync_paths": entry.get("proton_sync_paths") or [],
            "remote_path": entry.get("remote_path"),
            "installed": os.path.exists(local_path),
            "prefix_ready": os.path.exists(os.path.join(prefix_path, "pfx")),
            "prefix_path": prefix_path,
            "backup_path": backup_path,
            "last_backup": last_backup,
            "remote_available": remote_available,
            "metadata_path": metadata_path if os.path.exists(metadata_path) else None,
        }

    def _resolve_local_path(self, candidate: str) -> str:
        if not candidate:
            return self.settings["localLibraryPath"]
        expanded = os.path.expanduser(candidate)
        if os.path.isabs(expanded):
            return expanded
        return os.path.join(self.settings["localLibraryPath"], candidate)

    def _read_last_backup(self, backup_path: str) -> Optional[str]:
        marker = os.path.join(backup_path, ".last_sync")
        if os.path.exists(marker):
            with open(marker, "r", encoding="utf-8") as handle:
                return handle.read().strip()
        return None

    async def _require_game_by_name(self, name: str) -> Dict[str, Any]:
        if not self._cached_games:
            await self.load_games()
        matches = [game for game in self._cached_games if game["name"] == name]
        if not matches:
            raise RuntimeError(f"Game '{name}' was not found in the YAML definition")
        return matches[0]

    async def _require_game_by_appid(self, appid: str) -> Dict[str, Any]:
        if not self._cached_games:
            await self.load_games()
        for game in self._cached_games:
            if str(game.get("steam_appid")) == str(appid):
                return game
        raise RuntimeError(f"Game with app id {appid} was not found")

    def _resolve_proton_path(self, prefix: str, relative: str) -> str:
        if os.path.isabs(relative):
            return os.path.expanduser(relative)
        cleaned = relative.replace("\\", "/")
        base_drive = os.path.join(prefix, "pfx", "drive_c")
        env_map = {
            "%USERPROFILE%": os.path.join(base_drive, "users", "steamuser"),
            "%APPDATA%": os.path.join(base_drive, "users", "steamuser", "AppData", "Roaming"),
            "%LOCALAPPDATA%": os.path.join(base_drive, "users", "steamuser", "AppData", "Local"),
            "%DOCUMENTS%": os.path.join(base_drive, "users", "steamuser", "Documents"),
        }
        for token, resolved in env_map.items():
            cleaned = cleaned.replace(token, resolved)
        cleaned = cleaned.replace("%DRIVE_C%", base_drive)
        return os.path.normpath(cleaned)

    def _sanitize_relative(self, path_value: str) -> str:
        cleaned = path_value.replace("\\", "/").strip().strip("/")
        return cleaned.replace("/", os.sep)

    def _copy_any(self, source: str, destination: str) -> None:
        if os.path.isdir(source):
            if os.path.exists(destination):
                shutil.rmtree(destination)
            shutil.copytree(source, destination)
        else:
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(source, destination)

    async def _rsync_file(self, remote_file: str, local_path: str) -> None:
        dest_dir = os.path.dirname(local_path)
        os.makedirs(dest_dir, exist_ok=True)
        await self._rsync(
            remote=remote_file,
            local=f"{dest_dir}{os.sep}",
            download=True,
        )

    async def _rsync_directory(
        self,
        remote_path: str,
        local_path: str,
        download: bool = False,
        upload: bool = False,
        delete: bool = False,
    ) -> None:
        if download and upload:
            raise RuntimeError("Specify either download or upload, not both")
        os.makedirs(local_path, exist_ok=True)
        await self._rsync(
            remote=os.path.join(remote_path, ""),
            local=os.path.join(local_path, ""),
            download=download,
            upload=upload,
            delete=delete,
        )

    async def _rsync(
        self,
        remote: str,
        local: str,
        download: bool = False,
        upload: bool = False,
        delete: bool = False,
    ) -> None:
        remote_cfg = self.settings.get("remote", {})
        host = remote_cfg.get("host")
        if not host:
            raise RuntimeError("Remote host is not configured")
        flags = shlex.split(remote_cfg.get("rsyncFlags", "-avz"))
        args = ["rsync", *flags]
        if delete:
            args.append("--delete")
        if download:
            source = f"{host}:{remote}"
            destination = local
        elif upload:
            source = local
            destination = f"{host}:{remote}"
        else:
            raise RuntimeError("Either download or upload must be True for rsync")
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                source,
                destination,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as err:
            raise RuntimeError(
                "rsync is not available on this system. Install rsync to enable remote sync."
            ) from err
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"rsync failed ({proc.returncode}): {stderr.decode().strip() or stdout.decode().strip()}"
            )

    def _deep_merge(self, base: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, Any]:
        result = json.loads(json.dumps(base))
        for key, value in new.items():
            if (
                key in result
                and isinstance(result[key], dict)
                and isinstance(value, dict)
            ):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    # endregion -----------------------------------------------------------