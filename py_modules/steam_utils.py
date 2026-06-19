"""Steam-related utility functions.

Finds Steam installation, detects users, reads user config.
"""

import logging
from pathlib import Path
from typing import Optional

from deckyfin_consts import LOGGER_STEAM, STEAM_ID64_BASE

logger = logging.getLogger(LOGGER_STEAM)


def _get_real_home() -> Path:
    """Get the real user's home dir. Decky Loader runs as root, so Path.home() returns /root."""
    import os
    # Decky Loader v3+ sets DECKY_USER_HOME directly
    decky_user_home = os.environ.get("DECKY_USER_HOME")
    if decky_user_home:
        home = Path(decky_user_home)
        if home.exists():
            return home
    # Older Decky used UNPRIVILEGED_PATH (a path whose parent is the home dir)
    unprivileged = os.environ.get("UNPRIVILEGED_PATH")
    if unprivileged:
        home = Path(unprivileged).parent
        if home.exists():
            return home
    sudo_user = os.environ.get("SUDO_USER")
    if sudo_user:
        home = Path("/home") / sudo_user
        if home.exists():
            return home
    # DECKY_USER is also set by Decky v3+
    decky_user = os.environ.get("DECKY_USER")
    if decky_user:
        home = Path("/home") / decky_user
        if home.exists():
            return home
    return Path.home()


def find_steam_root() -> Path:
    """Find Steam installation directory (supports native and Flatpak Steam)."""
    home_dir = _get_real_home()
    candidates = [
        # Native Steam locations
        home_dir / ".local" / "share" / "Steam",
        home_dir / ".steam" / "steam",
        home_dir / ".steam" / "debian-installation",
        # Flatpak Steam location
        home_dir / ".var" / "app" / "com.valvesoftware.Steam" / "data" / "Steam",
        # System-wide paths (launchers only — listed last; skipped if they lack userdata)
        Path("/usr/local/steam"),
        Path("/usr/share/steam"),
    ]

    # Prefer any candidate that has actual user data
    for candidate in candidates:
        if (candidate / "userdata").exists():
            logger.debug("Steam root detected at %s", candidate)
            return candidate

    # Fallback: first existing candidate even without userdata
    for candidate in candidates:
        if candidate.exists():
            logger.debug("Steam root (no userdata) detected at %s", candidate)
            return candidate

    raise RuntimeError("Could not find Steam installation")


def steam_id64_to_account_id(steam_id64: int) -> int:
    """Convert Steam ID64 to Account ID (userdata folder ID).

    Steam ID64 = STEAM_ID64_BASE + AccountID
    """
    return steam_id64 - STEAM_ID64_BASE


def find_logged_in_user_from_loginusers(steam_root: Path) -> Optional[str]:
    """Find the currently logged-in Steam user from loginusers.vdf."""
    try:
        import vdf
    except ImportError:
        logger.warning("vdf module not available, cannot parse loginusers.vdf")
        return None

    try:
        loginusers_path = steam_root / "config" / "loginusers.vdf"
        if not loginusers_path.exists():
            return None

        with open(loginusers_path, "r", encoding="utf-8") as f:
            loginusers_data = vdf.load(f)

        users = loginusers_data.get("users", {})
        for steam_id64_str, user_data in users.items():
            if user_data.get("MostRecent") == "1":
                steam_id64 = int(steam_id64_str)
                account_id = steam_id64_to_account_id(steam_id64)
                return str(account_id)

        return None
    except Exception:
        logger.warning("Failed to parse loginusers.vdf", exc_info=True)
        return None


def list_steam_users() -> list[dict]:
    """List all available Steam users with their logged-in status."""
    steam_root = find_steam_root()
    userdata_path = steam_root / "userdata"

    if not userdata_path.exists():
        return []

    logged_in_user_id = find_logged_in_user_from_loginusers(steam_root)

    users = []
    user_dirs = [d for d in userdata_path.iterdir() if d.is_dir() and d.name.isdigit()]

    for user_dir in user_dirs:
        users.append({
            "user_id": user_dir.name,
            "is_logged_in": user_dir.name == logged_in_user_id,
        })

    logger.info("Detected %s Steam user profiles", len(users))
    return users


def get_user_id(user_id_override: Optional[str] = None) -> str:
    """Get user ID, using override if provided, otherwise finding the logged-in user."""
    if user_id_override:
        steam_root = find_steam_root()
        userdata_path = steam_root / "userdata" / user_id_override
        if not userdata_path.exists():
            raise ValueError(f"User ID {user_id_override} not found")
        logger.info("Using provided Steam user_id %s", user_id_override)
        return user_id_override

    steam_root = find_steam_root()
    userdata_path = steam_root / "userdata"

    if not userdata_path.exists():
        raise RuntimeError("Could not find Steam userdata directory")

    logged_in_user = find_logged_in_user_from_loginusers(steam_root)
    if logged_in_user:
        user_path = userdata_path / logged_in_user
        if user_path.exists() and user_path.is_dir():
            logger.info("Auto-detected logged in Steam user %s", logged_in_user)
            return logged_in_user

    user_dirs = [d for d in userdata_path.iterdir() if d.is_dir() and d.name.isdigit()]
    if not user_dirs:
        raise RuntimeError("No user directories found")

    if len(user_dirs) == 1:
        logger.info("Using single Steam user %s", user_dirs[0].name)
        return user_dirs[0].name

    chosen = user_dirs[0].name
    logger.info("Multiple Steam users found, defaulting to %s", chosen)
    return chosen
