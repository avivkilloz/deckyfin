# Mount Source

A **mount source** is a network drive mounted on your Steam Deck's filesystem — your home server or NAS, accessed over your local network. The drive must be mounted before you add it as a source in Deckyfin.

Supported mount methods:

| Method | Best for |
|---|---|
| **SSHFS** | Linux home servers; no server-side config beyond SSH |
| **Samba (CIFS)** | Windows servers, NAS appliances (Synology, TrueNAS, QNAP) |
| **NFS** | Linux servers; best LAN performance |

For step-by-step setup of all three methods, see [network-mounts.md](network-mounts.md).

---

## What you need before adding this source

1. Your server/NAS must be sharing the games folder (via SSH, Samba, or NFS)
2. The drive must be mounted on your Steam Deck at a local path (e.g. `/home/deck/homeserver/drive`)
3. The mount should be persistent — set up via a systemd unit so it reconnects after reboot

See [network-mounts.md](network-mounts.md) for full server-side and client-side setup instructions for each method.

---

## Adding it in Deckyfin

1. Open Deckyfin → **Settings → Sources → Add Source**
2. Give it a name (e.g. "Home Server")
3. Select type **mount**
4. Browse to or type the mount path (e.g. `/home/deck/homeserver/drive`)
5. Tap **Save**

After saving, tap **Rescan** to detect games. If the drive shows as **offline**, the mount is not active — check your systemd unit with `systemctl status home-deck-homeserver-drive.mount` (CIFS/NFS) or `systemctl --user status home-deck-homeserver-drive.service` (SSHFS).

---

## What Deckyfin does to the source folder

Identical to a local source — Deckyfin writes a single `.deckyfin/config.json` file inside your mounted games folder:

```
/home/deck/homeserver/drive/
├── .deckyfin/
│   └── config.json   ← Deckyfin writes only this file (on the server)
├── Cyberpunk 2077/
├── The Witcher 3/
└── Hades/
```

Because the folder is on your server, `config.json` is stored on the server. This means your game configuration travels with the drive — if you mount it on another machine running Deckyfin, your settings are already there.

---

## How Deckyfin handles root access restrictions

Decky Loader runs as root, which creates a complication for network mounts:

- **SSHFS and other FUSE mounts**: The Linux kernel blocks root from entering a FUSE mount unless it was mounted with `-o allow_other`. Deckyfin does not require this option — instead, it automatically spawns subprocesses as the mount owner (uid=1000) to read and write the config file, scan game folders, and check disk usage.

- **NFS with `root_squash`** (the default on most NAS servers): The NFS server maps root to `nobody`, blocking direct access. Deckyfin applies the same subprocess fallback as FUSE.

- **Samba (CIFS)**: Root has full access to CIFS mounts. No special handling needed.

You do not need to configure anything for this to work — it is automatic.

---

## Notes

- If the mount is offline, Deckyfin shows the source as **offline** and skips it when loading games. Your game entries from the last successful scan are not lost.
- Disk usage (shown in the source card) requires the mount to be online.
- Game executables are run via Steam's Proton layer — the `.exe` files are read over the mount at launch time. Performance depends on your network speed. For best results, use a wired LAN connection.
