"""Compare Steam's stored appid vs what Deckyfin returns."""
import sys, os
REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))

from steam_games import get_steam_shortcut_info, list_nonsteam_games

# Pick a game that was added before Deckyfin
game_name = "Split Fiction"

# Get what Deckyfin detects
info = get_steam_shortcut_info(game_name)
if info:
    print(f"Deckyfin sees '{game_name}':")
    print(f"  index:          {info['index']}")
    print(f"  name:           {info['name']}")
    print(f"  exe:            {info['exe']}")
    print(f"  app_id:         {info['app_id']}  (signed)")
    print(f"  unsigned_appid: {info['unsigned_appid']}  (unsigned)")
else:
    print(f"Deckyfin does NOT find '{game_name}'")

# Also list a few games showing both app_id fields
print("\n=== All detected games ===")
games = list_nonsteam_games()
for g in games[:10]:
    print(f"  {g['name']:40s} app_id={g['app_id']:12d} config_appid={g['config_appid']}")
