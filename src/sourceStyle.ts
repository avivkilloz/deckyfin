import { SourceType } from "./types";

/** Built-in sources (Steam Shortcuts, Steam Library) — no folder, not removable. */
export function isBuiltinSourceType(type: SourceType): boolean {
  return type === "steam_shortcuts" || type === "steam_library";
}

/** Short label shown in source type pills. */
export function sourceTypeLabel(type: SourceType): string {
  if (type === "steam_shortcuts") return "shortcut";
  if (type === "steam_library") return "steam";
  return type;
}

/** Pill/border colors per source type, shared by Settings and the game page. */
export function sourceTypeColors(type: SourceType): { color: string; bg: string } {
  switch (type) {
    case "local":
      return { color: "#27ae60", bg: "#1a3a1a" };
    case "mount":
      return { color: "#e67e22", bg: "#2a2a1a" };
    case "steam_shortcuts":
    case "steam_library":
      return { color: "#66c0f4", bg: "#1a2a3a" };
    default:
      return { color: "#0984e3", bg: "#1a1a3a" };
  }
}
