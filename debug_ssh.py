"""Debug script to run on Steam Deck via SSH."""
import sys, os
from pathlib import Path

# Add vendored modules
REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))

from steam_utils import find_steam_root, get_user_id

sr = find_steam_root()
uid = get_user_id()
print(f"Steam root: {sr}")
print(f"User ID: {uid}")

svdf = sr / "userdata" / uid / "config" / "shortcuts.vdf"
print(f"Shortcuts path: {svdf}")
print(f"Exists: {svdf.stat().st_mode:o}" if svdf.exists() else f"Exists: NO")
print(f"Size: {svdf.stat().st_size}")

import vdf
with open(svdf, "rb") as f:
    data = vdf.binary_load(f)

shortcuts = data.get("shortcuts", {})
print(f"Number of shortcuts: {len(shortcuts)}")
for k in sorted(shortcuts.keys(), key=int):
    v = shortcuts[k]
    print(f"  [{k}]: {v.get('AppName', '?')} -> {v.get('Exe', '')[:60]}")
