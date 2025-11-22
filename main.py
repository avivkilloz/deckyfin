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

# Using JSON for games configuration - no external dependencies needed

PLUGIN_ID = "deckyfin"
USER_HOME = decky.DECKY_USER_HOME
DATA_DIR = os.path.join(USER_HOME, ".local", "share", PLUGIN_ID)
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
CACHE_GAMES_PATH = os.path.join(DATA_DIR, "games.json")
SAVES_DIR = os.path.join(DATA_DIR, "saves")
PROTONTRICKS_CMD = "flatpak run com.github.Matoking.protontricks"
PROTONTRICKS_FLAGS = "--force --unattended"


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _slugify(value: str) -> str:
    safe = "".join(ch if ch.isalnum() else "-" for ch in value.strip())
    while "--" in safe:
        safe = safe.replace("--", "-")
    return safe.strip("-").lower() or "game"


def load_games_json(path: str) -> Dict[str, Any]:
    """Load games config from a JSON file. Returns dict with 'games' and 'savesPath'."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Games file not found at {path}")

    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in games file: {e}") from e

    if not isinstance(data, dict):
        raise ValueError("Games file must contain a dictionary at the root level")

    games = data.get("games", [])
    if not isinstance(games, list):
        raise ValueError("Games file must have a 'games' key containing a list")

    return {
        "games": games,
        "savesPath": data.get("savesPath", ""),
    }


DEFAULT_SETTINGS: Dict[str, Any] = {
    "remoteHost": "",
    "remoteConfigPath": "",
    "localGamesPath": os.path.join(USER_HOME, "Games"),
    "proton": {
        "compatdataPath": os.path.join(DATA_DIR, "compatdata"),
        "defaultVersion": "GE-Proton10-25",
    },
    "saveBackupPath": os.path.join(SAVES_DIR),
    "rsyncFlags": "-avz",
}


class Plugin:
    def __init__(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(SAVES_DIR, exist_ok=True)
        self.settings: Dict[str, Any] = self._load_settings()
        self._cached_games: List[Dict[str, Any]] = []
        self._config_saves_path: str = ""
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
        config_path = await self._ensure_config_file()
        config_data = load_games_json(config_path)
        games_list = config_data["games"]
        decorated = [self._decorate_game(entry) for entry in games_list]
        self._cached_games = decorated
        self._config_saves_path = config_data.get("savesPath", "")
        return {
            "games": decorated,
            "source": config_path,
            "savesPath": self._config_saves_path,
            "refreshedAt": _now_iso(),
        }

    async def download_game(self, game_name: str) -> Dict[str, Any]:
        """Legacy function - redirects to install_game for comprehensive installation."""
        return await self.install_game(game_name)

    async def setup_proton_prefix(self, steam_appid: int) -> Dict[str, Any]:
        """Create and initialize Proton prefix with the specified Proton version."""
        game = await self._require_game_by_appid(str(steam_appid))
        compatdata_root = self.settings["proton"]["compatdataPath"]
        prefix_path = os.path.join(compatdata_root, str(game["steam_appid"]))
        pfx = os.path.join(prefix_path, "pfx")
        drive_c = os.path.join(pfx, "drive_c")
        user_profile = os.path.join(drive_c, "users", "steamuser")

        # Create directory structure
        for path in [
            prefix_path,
            pfx,
            drive_c,
            os.path.join(user_profile, "Documents"),
            os.path.join(user_profile, "AppData", "Local"),
            os.path.join(user_profile, "AppData", "Roaming"),
        ]:
            os.makedirs(path, exist_ok=True)

        # Get Proton version
        proton_version = (
            game.get("proton_version") or self.settings["proton"]["defaultVersion"]
        )

        # Initialize prefix with Proton by running a dummy command
        # This creates the wine prefix structure properly
        try:
            # Find Proton installation
            steam_root = os.path.join(USER_HOME, ".local", "share", "Steam")
            proton_path = os.path.join(
                steam_root, "steamapps", "common", proton_version
            )

            if not os.path.exists(proton_path):
                # Try alternative location
                proton_path = os.path.join(
                    steam_root, "compatibilitytools.d", proton_version
                )

            if os.path.exists(proton_path):
                # Use Proton's wine to initialize the prefix
                proton_wine = os.path.join(proton_path, "files", "bin", "wine")
                if os.path.exists(proton_wine):
                    # Set WINEPREFIX and run wineboot to initialize
                    env = os.environ.copy()
                    env["WINEPREFIX"] = pfx
                    env["WINEARCH"] = "win64"

                    proc = await asyncio.create_subprocess_exec(
                        proton_wine,
                        "wineboot",
                        "--init",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=env,
                    )
                    await proc.communicate()
                    # wineboot may return non-zero, that's okay for initialization
            else:
                decky.logger.warning(
                    f"Proton version {proton_version} not found at {proton_path}. "
                    "Prefix structure created but not initialized with Proton."
                )
        except Exception as e:
            decky.logger.warning(f"Failed to initialize prefix with Proton: {e}")
            # Continue anyway - structure is created

        # Store metadata
        metadata = {
            "name": game["name"],
            "proton_version": proton_version,
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

        # Upload to remote if configured
        remote_host = self.settings.get("remoteHost", "").strip()
        if remote_host and self._config_saves_path:
            remote_target = os.path.join(
                self._config_saves_path, _slugify(game["name"])
            )
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
            if not game.get("installed"):
                continue
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

    async def install_game(self, game_name: str) -> Dict[str, Any]:
        """Comprehensive game installation: download, prefix, dependencies, saves, Steam."""
        game = await self._require_game_by_name(game_name)

        if game.get("installed"):
            raise RuntimeError(f"Game '{game_name}' is already installed")

        remote_host = self.settings.get("remoteHost", "").strip()
        if not remote_host:
            raise RuntimeError("Remote host is not configured")

        steps = []

        # Step 1: Download game files
        try:
            # path in config is the remote path relative to the games directory
            remote_path = game.get("path", "")
            if not remote_path:
                raise RuntimeError(
                    "Game entry must have a 'path' field specifying remote location"
                )

            # Extract remote games base directory from config path
            remote_config_path = self.settings.get("remoteConfigPath", "")
            remote_games_base = os.path.dirname(remote_config_path)
            remote_target = os.path.join(remote_games_base, remote_path)

            # Local path is always in the configured local games folder, using game name
            local_target = os.path.join(
                self.settings["localGamesPath"], _slugify(game_name)
            )

            os.makedirs(local_target, exist_ok=True)
            await self._rsync_directory(
                remote_target, local_target, download=True, delete=False
            )
            steps.append("Downloaded game files")
        except Exception as e:
            raise RuntimeError(f"Failed to download game: {e}") from e

        # Step 2: Setup Proton prefix
        try:
            await self.setup_proton_prefix(game["steam_appid"])
            steps.append("Created Proton prefix")
        except Exception as e:
            raise RuntimeError(f"Failed to setup prefix: {e}") from e

        # Step 3: Install Proton dependencies
        try:
            deps = game.get("proton_dependencies", [])
            if deps:
                await self._install_proton_dependencies(game["steam_appid"], deps)
                steps.append(f"Installed dependencies: {', '.join(deps)}")
        except Exception as e:
            decky.logger.warning(f"Failed to install some dependencies: {e}")
            steps.append(f"Dependency installation had issues: {e}")

        # Step 4: Import saves from remote
        try:
            if self._config_saves_path:
                await self._import_saves_from_remote(game_name)
                steps.append("Imported saves from remote")
        except Exception as e:
            decky.logger.warning(f"Failed to import saves: {e}")
            steps.append(f"Save import had issues: {e}")

        # Step 5: Add to Steam
        try:
            executable = game.get("executable", "")
            exe_path = os.path.join(local_target, executable)
            categories = game.get("categories", [])
            launch_options = game.get("launch_options", "")
            await self._add_to_steam(
                game["steam_appid"],
                game["name"],
                exe_path,
                game.get("proton_version") or self.settings["proton"]["defaultVersion"],
                categories,
                launch_options,
            )
            steps.append("Added to Steam library")
        except Exception as e:
            raise RuntimeError(f"Failed to add to Steam: {e}") from e

        # Refresh cache
        await self.load_games()

        return {
            "ok": True,
            "message": f"Game '{game_name}' installed successfully",
            "steps": steps,
            "timestamp": _now_iso(),
        }

    async def remove_game(self, game_name: str) -> Dict[str, Any]:
        """Remove game: backup saves, delete files, remove from Steam."""
        game = await self._require_game_by_name(game_name)

        if not game.get("installed"):
            raise RuntimeError(f"Game '{game_name}' is not installed")

        steps = []

        # Step 1: Backup saves
        try:
            await self.sync_game_saves(game_name)
            steps.append("Backed up saves")
        except Exception as e:
            decky.logger.warning(f"Save backup had issues: {e}")
            steps.append(f"Save backup warning: {e}")

        # Step 2: Remove from Steam
        try:
            await self._remove_from_steam(game["steam_appid"])
            steps.append("Removed from Steam library")
        except Exception as e:
            decky.logger.warning(f"Steam removal had issues: {e}")
            steps.append(f"Steam removal warning: {e}")

        # Step 3: Delete game folder
        try:
            if os.path.exists(game["path"]):
                shutil.rmtree(game["path"])
                steps.append("Deleted game folder")
        except Exception as e:
            raise RuntimeError(f"Failed to delete game folder: {e}") from e

        # Step 4: Delete Proton prefix
        try:
            if os.path.exists(game["prefix_path"]):
                shutil.rmtree(game["prefix_path"])
                steps.append("Deleted Proton prefix")
        except Exception as e:
            decky.logger.warning(f"Prefix deletion had issues: {e}")
            steps.append(f"Prefix deletion warning: {e}")

        # Refresh cache
        await self.load_games()

        return {
            "ok": True,
            "message": f"Game '{game_name}' removed successfully",
            "steps": steps,
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

    async def _ensure_config_file(self) -> str:
        """Ensure config file is available, syncing from remote if configured."""
        remote_host = self.settings.get("remoteHost", "").strip()
        remote_config_path = self.settings.get("remoteConfigPath", "").strip()

        if remote_host and remote_config_path:
            # Sync from remote
            await self._rsync_file(remote_config_path, CACHE_GAMES_PATH)
            return CACHE_GAMES_PATH
        else:
            # Use local path (fallback - but user should configure remote)
            raise RuntimeError(
                "Remote host and config path must be configured. "
                "Please set remoteHost and remoteConfigPath in settings."
            )

    def _decorate_game(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        # path in config is the remote path
        remote_path = entry.get("path", "")
        # Local path is always in the configured local games folder, using game name
        game_name = entry.get("name", "game")
        local_path = os.path.join(self.settings["localGamesPath"], _slugify(game_name))
        compatdata_root = self.settings["proton"]["compatdataPath"]
        prefix_path = os.path.join(compatdata_root, str(entry.get("steam_appid")))
        backup_path = os.path.join(self.settings["saveBackupPath"], _slugify(game_name))
        remote_available = bool(
            self.settings.get("remoteHost", "").strip()
            and self.settings.get("remoteConfigPath", "").strip()
        )
        metadata_path = os.path.join(prefix_path, "deckyfin.json")
        last_backup = self._read_last_backup(backup_path)

        return {
            "name": game_name,
            "path": local_path,
            "remote_path": remote_path,
            "steam_appid": entry.get("steam_appid"),
            "proton_version": entry.get("proton_version")
            or self.settings["proton"]["defaultVersion"],
            "proton_dependencies": entry.get("proton_dependencies") or [],
            "proton_sync_paths": entry.get("proton_sync_paths") or [],
            "executable": entry.get("executable", ""),
            "categories": entry.get("categories", []),
            "launch_options": entry.get("launch_options", ""),
            "installed": os.path.exists(local_path),
            "prefix_ready": os.path.exists(os.path.join(prefix_path, "pfx")),
            "prefix_path": prefix_path,
            "backup_path": backup_path,
            "last_backup": last_backup,
            "remote_available": remote_available,
            "metadata_path": metadata_path if os.path.exists(metadata_path) else None,
        }

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
            raise RuntimeError(f"Game '{name}' was not found in the games definition")
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
            "%APPDATA%": os.path.join(
                base_drive, "users", "steamuser", "AppData", "Roaming"
            ),
            "%LOCALAPPDATA%": os.path.join(
                base_drive, "users", "steamuser", "AppData", "Local"
            ),
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
        host = self.settings.get("remoteHost", "").strip()
        if not host:
            raise RuntimeError("Remote host is not configured")
        flags = shlex.split(self.settings.get("rsyncFlags", "-avz"))
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

    async def _install_proton_dependencies(
        self, steam_appid: int, dependencies: List[str]
    ) -> None:
        """Install Proton dependencies using protontricks."""
        prefix_path = os.path.join(
            self.settings["proton"]["compatdataPath"], str(steam_appid)
        )
        if not os.path.exists(prefix_path):
            raise RuntimeError(f"Prefix not found: {prefix_path}")

        for dep in dependencies:
            try:
                proc = await asyncio.create_subprocess_exec(
                    PROTONTRICKS_CMD,
                    str(steam_appid),
                    "--",
                    PROTONTRICKS_FLAGS,
                    dep,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    decky.logger.warning(
                        f"protontricks failed for {dep}: {stderr.decode().strip()}"
                    )
            except FileNotFoundError:
                raise RuntimeError(
                    "protontricks is not installed. Install it to use dependency installation."
                )
            except Exception as e:
                decky.logger.warning(f"Error installing {dep}: {e}")

    async def _import_saves_from_remote(self, game_name: str) -> None:
        """Import saves from remote host."""
        game = await self._require_game_by_name(game_name)
        if not self._config_saves_path:
            return

        remote_host = self.settings.get("remoteHost", "").strip()
        if not remote_host:
            return

        remote_save_path = os.path.join(self._config_saves_path, _slugify(game_name))
        local_backup_path = os.path.join(
            self.settings["saveBackupPath"], _slugify(game_name)
        )

        # Download saves from remote
        if os.path.exists(local_backup_path):
            shutil.rmtree(local_backup_path)
        os.makedirs(local_backup_path, exist_ok=True)

        await self._rsync_directory(
            remote_save_path, local_backup_path, download=True, delete=False
        )

        # Restore saves to prefix
        prefix_path = os.path.join(
            self.settings["proton"]["compatdataPath"], str(game["steam_appid"])
        )
        sync_paths = game.get("proton_sync_paths", [])
        for relative in sync_paths:
            source = os.path.join(local_backup_path, self._sanitize_relative(relative))
            if os.path.exists(source):
                target = self._resolve_proton_path(prefix_path, relative)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                self._copy_any(source, target)

    async def _add_to_steam(
        self,
        steam_appid: int,
        name: str,
        exe_path: str,
        proton_version: str,
        categories: List[str],
        launch_options: str = "",
    ) -> None:
        """Add game to Steam library with categories and launch options.

        Uses the steam_appid directly (no fake appids needed since we use custom compatdata).

        STEAM_COMPAT_DATA_PATH structure:
        - Our compatdata is at: {compatdataPath}/{appid}/pfx/
        - Proton expects: {STEAM_COMPAT_DATA_PATH}/compatdata/{appid}/pfx/
        - So STEAM_COMPAT_DATA_PATH should point to the parent of compatdata folder
        - Example: If compatdata is at ~/.local/share/deckyfin/compatdata/292030/pfx/
        - Then STEAM_COMPAT_DATA_PATH should be ~/.local/share/deckyfin
        - And Proton will look for ~/.local/share/deckyfin/compatdata/292030/pfx/

        Note: Proton version selection for non-Steam games is typically done via
        Steam's Compatibility tool setting in game properties. However, we can
        try to set it via PROTON_USE_VERSION in launch options (may not work
        for all Proton versions, especially custom ones like GE-Proton).
        """
        # Use steam_appid directly - no need to generate fake appids
        # since we're using a custom compatdata folder

        # STEAM_COMPAT_DATA_PATH should point to the parent directory of compatdata
        # Proton will then look for {STEAM_COMPAT_DATA_PATH}/compatdata/{appid}/pfx/
        compatdata_path = self.settings["proton"]["compatdataPath"]
        compatdata_base = os.path.dirname(compatdata_path)

        # Build launch options with compatdata path
        # STEAM_COMPAT_DATA_PATH structure:
        # - Our structure: {compatdataPath}/{appid}/pfx/ (e.g., ~/.local/share/deckyfin/compatdata/292030/pfx/)
        # - Proton expects: {STEAM_COMPAT_DATA_PATH}/compatdata/{appid}/pfx/
        # - So we point to parent of compatdata: ~/.local/share/deckyfin
        # - Proton will then find: ~/.local/share/deckyfin/compatdata/292030/pfx/
        #
        # Note: Proton version selection for non-Steam games must be done via
        # Steam's Compatibility tool setting (right-click game > Properties > Compatibility).
        # PROTON_USE_VERSION in launch options doesn't work reliably for non-Steam games.
        base_launch_opts = f"STEAM_COMPAT_DATA_PATH={compatdata_base} %command%"

        # If user provided launch options, merge them properly
        if launch_options:
            # If user's launch_options doesn't have %command%, append it
            if "%command%" not in launch_options:
                final_launch_opts = f"{base_launch_opts} {launch_options}"
            else:
                # Replace %command% in user's options with the full base options
                final_launch_opts = launch_options.replace(
                    "%command%", base_launch_opts
                )
        else:
            final_launch_opts = base_launch_opts

        decky.logger.info(
            f"Adding {name} to Steam with appid {steam_appid}, "
            f"Proton {proton_version}, categories: {categories}, "
            f"launch options: {final_launch_opts}"
        )

        # Use VDF manipulation to add shortcut
        await self._add_steam_shortcut_vdf(
            appid=steam_appid,
            name=name,
            exe_path=exe_path,
            proton_version=proton_version,
            categories=categories,
            launch_options=final_launch_opts,
        )

    async def _add_steam_shortcut_vdf(
        self,
        appid: int,
        name: str,
        exe_path: str,
        proton_version: str,
        categories: List[str],
        launch_options: str,
    ) -> None:
        """Add Steam shortcut via VDF file manipulation.

        Note: VDF file manipulation is complex. This is a placeholder.
        In production, you should use SteamClient API from Decky or a proper VDF library.
        """
        # Find actual userdata directory
        userdata_base = os.path.join(USER_HOME, ".local", "share", "Steam", "userdata")
        if os.path.exists(userdata_base):
            for user_id in os.listdir(userdata_base):
                if user_id.isdigit():
                    shortcuts_file = os.path.join(
                        userdata_base, user_id, "config", "shortcuts.vdf"
                    )
                    if os.path.exists(shortcuts_file):
                        # Note: VDF parsing/manipulation requires proper library
                        # For now, log what we would do
                        decky.logger.info(
                            f"Would add shortcut to {shortcuts_file}:\n"
                            f"  AppID: {appid}\n"
                            f"  Name: {name}\n"
                            f"  Exe: {exe_path}\n"
                            f"  Launch Options: {launch_options}\n"
                            f"  Categories: {categories}"
                        )
                        # TODO: Implement actual VDF manipulation or use SteamClient API
                        break

    async def _remove_from_steam(self, steam_appid: int) -> None:
        """Remove game from Steam library."""
        # Similar to _add_to_steam, but remove from shortcuts
        decky.logger.info(f"Would remove appid {steam_appid} from Steam")

    # endregion -----------------------------------------------------------
