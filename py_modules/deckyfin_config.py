"""Application configuration management utilities.

Reads/writes the games config.json and app-level settings.
No Steam dependency - pure file I/O.
"""

import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

from deckyfin_consts import (
    APP_CONFIG_DIR,
    APP_CONFIG_SUBDIR,
    CONFIG_FILE,
    APP_FOLDER,
    SAVES_FOLDER,
    LOGGER_CONFIG,
    APP_NAME,
)

logger = logging.getLogger(LOGGER_CONFIG)


# ── App-Level Config (~/.config/deckyfin/config.json) ──────────────────────

def get_app_config_path() -> Path:
    """Get the path to the deckyfin app configuration directory."""
    return Path.home() / APP_CONFIG_DIR / APP_CONFIG_SUBDIR


def get_app_config_file() -> Path:
    """Get the path to the app-level configuration file."""
    return get_app_config_path() / CONFIG_FILE


def get_games_folder() -> Optional[Path]:
    """Get the games folder path from app config."""
    config_file = get_app_config_file()
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
                games_folder = config.get("games_folder")
                if games_folder:
                    path = Path(games_folder)
                    logger.debug("Loaded games folder from config: %s", path)
                    return path
        except Exception as exc:
            logger.warning("Failed to read games folder from config: %s", exc)
    return None


def set_games_folder(games_folder: str) -> Path:
    """Set the games folder path in app config."""
    config_path = get_app_config_path()
    config_path.mkdir(parents=True, exist_ok=True)
    config_file = get_app_config_file()

    config = {}
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as exc:
            logger.warning("Failed to load existing app config, recreating: %s", exc)

    config["games_folder"] = games_folder

    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    path = Path(games_folder)
    logger.info("Games folder set to %s", path)
    return path


def get_app_config() -> Dict[str, Any]:
    """Get the full app configuration."""
    config_file = get_app_config_file()
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def set_app_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Set (merge) values into the app configuration."""
    config_path = get_app_config_path()
    config_path.mkdir(parents=True, exist_ok=True)
    config_file = get_app_config_file()

    existing_config = get_app_config()
    existing_config.update(config)

    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(existing_config, f, indent=2)

    logger.info("App config updated keys=%s", ", ".join(config.keys()))
    return existing_config


# ── Games Folder Config (<games_folder>/.deckyfin/config.json) ────────────

def get_app_folder(games_folder: Optional[Path] = None) -> Path:
    """Get the .deckyfin folder path inside the games folder."""
    if games_folder is None:
        games_folder = get_games_folder()
        if games_folder is None:
            raise ValueError(
                "Games folder not configured. Please set games_folder in app config first."
            )
    return Path(games_folder) / APP_FOLDER


def get_games_config_file(games_folder: Optional[Path] = None) -> Path:
    """Get the path to the games config.json file."""
    return get_app_folder(games_folder) / CONFIG_FILE


def get_saves_folder(games_folder: Optional[Path] = None) -> Path:
    """Get the saves folder path."""
    return get_app_folder(games_folder) / SAVES_FOLDER


# ── Game Config CRUD ──────────────────────────────────────────────────────

class GameConfigError(Exception):
    """Raised when game config operations fail."""
    pass


def detect_game_folders(games_path: Path) -> List[Dict[str, str]]:
    """
    Detect non-hidden subdirectories in the games folder.

    Returns:
        List of dicts with 'name' (display name) and 'path' (folder-friendly)
    """
    game_folders = []
    if not games_path.exists():
        return game_folders

    for item in games_path.iterdir():
        if item.name.startswith("."):
            continue
        if item.is_dir():
            folder_name = item.name
            path_name = folder_name.lower().replace(" ", "-")
            game_folders.append({
                "name": folder_name,
                "path": path_name,
            })

    return sorted(game_folders, key=lambda x: x["name"])


def find_game_executables(game_dir: Path) -> List[str]:
    """
    Scan a game directory for .exe files recursively.

    Returns:
        List of relative paths from game_dir to each .exe found.
    """
    exes = []
    if not game_dir.exists() or not game_dir.is_dir():
        return exes

    for item in game_dir.rglob("*.exe"):
        if item.is_file():
            exes.append(str(item.relative_to(game_dir)))

    return sorted(exes)


def initialize_app_structure(games_folder: Optional[str] = None) -> Dict[str, Any]:
    """
    Initialize the .deckyfin folder structure in the games folder.
    Auto-detects game folders and creates initial config entries.
    """
    try:
        logger.info("Initializing %s structure (games_folder=%s)", APP_NAME, games_folder)

        if games_folder:
            set_games_folder(games_folder)

        games_path = get_games_folder()
        if games_path is None:
            return {
                "success": False,
                "message": "Games folder not configured. Please provide games_folder parameter.",
            }

        games_path = Path(games_path)
        games_path.mkdir(parents=True, exist_ok=True)

        app_folder = get_app_folder(games_path)
        app_folder.mkdir(parents=True, exist_ok=True)

        saves_folder = get_saves_folder(games_path)
        saves_folder.mkdir(parents=True, exist_ok=True)

        config_file = get_games_config_file(games_path)
        existing_config = get_games_config(games_path)
        existing_games = {
            game.get("name"): game for game in existing_config.get("games", [])
        }

        detected_folders = detect_game_folders(games_path)
        games_initialized = []

        for folder_info in detected_folders:
            folder_name = folder_info["name"]
            folder_path = folder_info["path"]

            if folder_name in existing_games:
                continue

            game_config = {
                "name": folder_name,
                "path": folder_path,
                "executable": "",
                "proton_version": "",
                "proton_dependencies": [],
                "proton_sync_paths": [],
                "categories": [],
                "launch_options": "",
            }
            existing_games[folder_name] = game_config
            games_initialized.append(folder_name)

        updated_config = {"games": list(existing_games.values())}
        save_games_config(updated_config, games_path)

        return {
            "success": True,
            "message": f"{APP_NAME} structure initialized successfully",
            "paths": {
                "games_folder": str(games_path),
                "app_folder": str(app_folder),
                "config_file": str(config_file),
                "saves_folder": str(saves_folder),
            },
            "games_initialized": games_initialized,
            "games_count": len(existing_games),
        }
    except Exception as e:
        logger.exception("Failed to initialize %s structure", APP_NAME)
        return {
            "success": False,
            "message": f"Failed to initialize {APP_NAME} structure: {str(e)}",
        }


def get_games_config(games_folder: Optional[Path] = None) -> Dict[str, Any]:
    """Get the games configuration from .deckyfin/config.json."""
    config_file = get_games_config_file(games_folder)
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"games": []}


def save_games_config(config: Dict[str, Any], games_folder: Optional[Path] = None) -> None:
    """Save the games configuration."""
    config_file = get_games_config_file(games_folder)
    config_file.parent.mkdir(parents=True, exist_ok=True)

    if "games" not in config:
        config["games"] = []

    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def list_game_configs(games_folder: Optional[Path] = None) -> List[Dict[str, Any]]:
    """List all game configurations."""
    config = get_games_config(games_folder)
    return config.get("games", [])


def get_game_config(game_name: str, games_folder: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Get a specific game configuration by name."""
    games = list_game_configs(games_folder)
    for game in games:
        if game.get("name") == game_name:
            return game
    return None


def add_game_config(game_config: Dict[str, Any], games_folder: Optional[Path] = None) -> Dict[str, Any]:
    """Add or update a game configuration."""
    config = get_games_config(games_folder)
    games = config.get("games", [])

    game_name = game_config.get("name")
    if not game_name:
        raise GameConfigError("Game config must have a 'name' field")

    updated = False
    for i, existing_game in enumerate(games):
        if existing_game.get("name") == game_name:
            games[i] = game_config
            updated = True
            break

    if not updated:
        games.append(game_config)
        logger.info("Added game config '%s'", game_name)
    else:
        logger.info("Updated game config '%s'", game_name)

    config["games"] = games
    save_games_config(config, games_folder)
    return game_config


def remove_game_config(game_name: str, games_folder: Optional[Path] = None) -> bool:
    """Remove a game configuration by name."""
    config = get_games_config(games_folder)
    games = config.get("games", [])

    original_count = len(games)
    games = [g for g in games if g.get("name") != game_name]

    if len(games) < original_count:
        config["games"] = games
        save_games_config(config, games_folder)
        logger.info("Removed game config '%s'", game_name)
        return True

    return False
