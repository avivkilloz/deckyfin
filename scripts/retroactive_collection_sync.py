"""Retroactively sync all existing shortcut tags to localconfig.vdf user-collections.

Run this once after deploying the fix to bring existing collections into localconfig.vdf.
Usage: python3 retroactive_collection_sync.py
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'py_modules'))

import json
import base64
import vdf
from pathlib import Path

STEAM_ROOT = Path("/home/deck/.local/share/Steam")
USER_ID = "892854676"
SHORTCUTS_PATH = STEAM_ROOT / "userdata" / USER_ID / "config" / "shortcuts.vdf"
LOCALCONFIG_PATH = STEAM_ROOT / "userdata" / USER_ID / "config" / "localconfig.vdf"

# Load shortcuts.vdf
with open(SHORTCUTS_PATH, 'rb') as f:
    shortcuts_data = vdf.binary_load(f)

# Load localconfig.vdf
with open(LOCALCONFIG_PATH, 'r') as f:
    lc = vdf.load(f)

# Build expected srm- collections from all shortcut tags
expected = {}  # srm-key -> {id, added: [appids], removed: []}
shortcuts = shortcuts_data.get("shortcuts", {})
for idx, s in sorted(shortcuts.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 999):
    if not idx.isdigit():
        continue
    tags = s.get("tags", {})
    if not tags:
        continue
    appid = s.get("appid")
    if appid is None:
        name = s.get("AppName") or s.get("appname", "?")
        exe = s.get("Exe") or s.get("exe", "")
        import binascii
        appid = (binascii.crc32((exe + name).encode()) | 0x80000000) - 0x100000000

    for _, tag_name in sorted(tags.items()):
        if not tag_name:
            continue
        key = "srm-" + base64.b64encode(tag_name.encode("utf-8")).decode("utf-8")
        if key not in expected:
            expected[key] = {"id": key, "added": [], "removed": []}
        if appid not in expected[key]["added"]:
            expected[key]["added"].append(appid)

# Merge into existing user-collections
ws = lc.setdefault("UserLocalConfigStore", {}).setdefault("WebStorage", {})
raw = ws.get("user-collections", "{}")
if isinstance(raw, str):
    existing = json.loads(raw)
else:
    existing = raw

changes = 0
for key, entry in expected.items():
    if key not in existing or not isinstance(existing[key], dict):
        existing[key] = entry
        changes += 1
        print(f"  ADDED:  {key}")
    else:
        # Merge appids
        for appid in entry["added"]:
            if appid not in existing[key].get("added", []):
                existing[key].setdefault("added", []).append(appid)
                changes += 1
                print(f"  ADDED appid {appid} to {key}")

# Remove stale srm- entries (collections that no longer have any games)
stale = []
for key in list(existing.keys()):
    if key.startswith("srm-") and key not in expected:
        stale.append(key)
for key in stale:
    del existing[key]
    changes += 1
    print(f"  REMOVED stale: {key}")

if changes > 0:
    ws["user-collections"] = json.dumps(existing, ensure_ascii=False)
    with open(LOCALCONFIG_PATH, 'w') as f:
        vdf.dump(lc, f)
    print(f"\nSynced {changes} changes to localconfig.vdf")
else:
    print("\nNo changes needed — collections already in sync")
