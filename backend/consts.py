"""Constants used throughout the Deckyfin plugin backend."""

# Application Information
APP_NAME = "deckyfin"
APP_VERSION = "1.0.0"
APP_TITLE = f"{APP_NAME.title()} Game Manager"
APP_DESCRIPTION = "Manage local/home server games on Steam"

# Default Ports (API only, for reference)
DEFAULT_TRANSFER_PORT = 9000
DEFAULT_API_PORT = 9999
DEFAULT_CORS_PORT = 3000

# Default Hosts
DEFAULT_API_HOST = "0.0.0.0"
DEFAULT_CORS_ORIGIN = f"http://localhost:{DEFAULT_CORS_PORT}"

# File and Folder Names
APP_FOLDER = f".{APP_NAME}"
CONFIG_FILE = "config.json"
SAVES_FOLDER = "saves"
COMPATDATA_FOLDER = "compatdata"
SHORTCUTS_VDF = "shortcuts.vdf"
LOCALCONFIG_VDF = "localconfig.vdf"
CONFIG_VDF = "config.vdf"
COMPAT_VDF = "compat.vdf"
LOGINUSERS_VDF = "loginusers.vdf"

# Steam Paths
STEAM_CONFIG_FOLDER = "config"
STEAM_USERDATA_FOLDER = "userdata"
STEAM_STEAMAPPS_FOLDER = "steamapps"
STEAM_COMMON_FOLDER = "common"
STEAM_COMPATTOOLS_FOLDER = "compatibilitytools.d"

# App Config Paths
APP_CONFIG_DIR = ".config"
APP_CONFIG_SUBDIR = APP_NAME

# Timeout Values (in seconds)
API_REQUEST_TIMEOUT = 30
API_LONG_TIMEOUT = 120
PROTONTRICKS_TIMEOUT = 600  # 10 minutes
PREFIX_INIT_TIMEOUT = 300   # 5 minutes

# Transfer Settings
TRANSFER_CHUNK_SIZE = 1024 * 1024  # 1 MB
TRANSFER_TOKEN_LENGTH = 64

# Steam ID Constants
STEAM_ID64_BASE = 76561197960265728

# Proton Constants
PROTON_SCRIPT_NAME = "proton"
PROTON_GE_REPO = "GloriousEggroll/proton-ge-custom"
PROTON_GE_RELEASES_URL = f"https://github.com/{PROTON_GE_REPO}/releases/download"

# Protontricks Constants
PROTONTRICKS_FLATPAK = "com.github.Matoking.protontricks"

# VDF Structure Keys
VDF_USER_LOCAL_CONFIG_STORE = "UserLocalConfigStore"
VDF_INSTALL_CONFIG_STORE = "InstallConfigStore"
VDF_SOFTWARE = "Software"
VDF_VALVE = "Valve"
VDF_STEAM = "Steam"
VDF_COMPAT_TOOL_MAPPING = "CompatToolMapping"
VDF_PLATFORM_OVERRIDES = "platform_overrides"
VDF_SHORTCUTS = "shortcuts"
VDF_USERS = "users"

# App ID Conversion Constants
APPID_CRC32_MASK = 0x80000000
APPID_CONFIG_FORMAT_MASK = 0x02000000

# Logger Names
LOGGER_NAME = APP_NAME
LOGGER_STEAM = f"{LOGGER_NAME}.steam"
LOGGER_PROTON = f"{LOGGER_NAME}.proton"
LOGGER_CONFIG = f"{LOGGER_NAME}.config"
LOGGER_PEER = f"{LOGGER_NAME}.peer"
LOGGER_TRANSFER = f"{LOGGER_NAME}.transfer"
LOGGER_GAMES = f"{LOGGER_NAME}.games"
LOGGER_PREFIX = f"{LOGGER_NAME}.prefix"
LOGGER_PROTON_COMPAT = f"{LOGGER_NAME}.proton_compat"
LOGGER_PROTONTRICKS = f"{LOGGER_NAME}.protontricks"
LOGGER_STEAM_CONTROL = f"{LOGGER_NAME}.steam_control"
