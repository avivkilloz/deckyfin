# Agent Source

> **Not yet implemented.** This source type is planned for a future release.

---

## What it will be

An **agent source** connects Deckyfin to a remote machine running the Deckyfin Agent — a lightweight HTTP service that exposes your games folder over your local network without requiring a filesystem mount on the Steam Deck.

Unlike a mount source, no drive is mounted locally. Deckyfin communicates with the agent over HTTP to:

- List available games
- Read and write game configuration
- Report disk usage
- (Planned) Trigger game downloads to the Steam Deck

---

## Planned setup

1. Install the Deckyfin Agent on your home server (Linux or Windows)
2. Point the agent at your games folder
3. Add the agent URL (e.g. `http://192.168.1.x:5000`) as a source in Deckyfin

---

## Status

This type is reserved in the data model and visible in the UI, but agent communication is not yet implemented. Selecting it will have no effect until a future update.
