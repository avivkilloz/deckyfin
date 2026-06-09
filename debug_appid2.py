"""Figure out the app_id algorithm used by other tools."""
import sys, os, binascii

REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))

import vdf

with open("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf", "rb") as f:
    data = vdf.binary_load(f)

def signed32(val):
    val = val & 0xFFFFFFFF
    return val - 0x100000000 if val >= 0x80000000 else val

# Test different algorithms on entry [1] (Split Fiction)
k = "1"
short = data["shortcuts"][k]
stored = short.get("appid")
appname = short.get("appname")
exe = short.get("exe")

print(f"Game: {appname}")
print(f"Exe: {exe}")
print(f"Stored appid: {stored} ({stored & 0xFFFFFFFF:#010x})")
print()

# Test various algorithms
tests = [
    ("CRC32(exe + appname) | 0x80000000", lambda: (binascii.crc32((exe + appname).encode()) | 0x80000000)),
    ("CRC32(appname + exe) | 0x80000000", lambda: (binascii.crc32((appname + exe).encode()) | 0x80000000)),
    ("CRC32(exe) | 0x80000000", lambda: (binascii.crc32(exe.encode()) | 0x80000000)),
    ("CRC32(appname) | 0x80000000", lambda: (binascii.crc32(appname.encode()) | 0x80000000)),
    ("CRC32(exe + appname) w/o mask", lambda: binascii.crc32((exe + appname).encode())),
    ("CRC32(appname.lower + exe.lower) | mask", lambda: (binascii.crc32((appname.lower() + exe.lower()).encode()) | 0x80000000)),
    ("CRC32(exe.lower + appname.lower) | mask", lambda: (binascii.crc32((exe.lower() + appname.lower()).encode()) | 0x80000000)),
    ("CRC32(exe w/o quotes + appname) | mask", lambda: (binascii.crc32((exe.strip('"') + appname).encode()) | 0x80000000)),
    ("CRC32(appname + exe w/o quotes) | mask", lambda: (binascii.crc32((appname + exe.strip('"')).encode()) | 0x80000000)),
]

for name, fn in tests:
    try:
        result = signed32(fn())
        match = "MATCH" if result == stored else ""
        print(f"  {name:55s} -> {result:12d} {match}")
    except Exception as e:
        print(f"  {name:55s} -> ERROR: {e}")

# Also check: maybe the exe is stored differently in the VDF
print("\n=== Binary VDF raw exe ===")
# Let's read the raw bytes for this entry
with open("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf", "rb") as f:
    raw = f.read()

# Find the exe field for entry 1
idx_exe = raw.find(b"\x01exe\x00", 200)
if idx_exe >= 0:
    # After \x01exe\x00, the string value follows
    ptr = idx_exe + 6  # skip \x01 e x e \x00
    end = raw.find(b"\x00", ptr)
    raw_exe = raw[ptr:end].decode('utf-8', errors='replace')
    print(f"Found exe in binary at offset {idx_exe}: {repr(raw_exe)[:100]}")
    
    # Try CRC32 of the raw exe (from VDF byte stream, not Python's decoded string)
    # The raw exe should be the same as Python decoded it
    test_raw = signed32(binascii.crc32(raw[ptr:end]) | 0x80000000)
    print(f"CRC32(raw_exe_bytes + appname) | mask: {test_raw} {'MATCH' if test_raw == stored else ''}")
