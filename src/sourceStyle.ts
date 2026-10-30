import { SourceType } from "./types";

/** Short label shown in source type pills ("steam" for the built-in Steam Shortcuts source). */
export function sourceTypeLabel(type: SourceType): string {
  return type === "steam_shortcuts" ? "steam" : type;
}

/** Pill/border colors per source type, shared by Settings and the game page. */
export function sourceTypeColors(type: SourceType): { color: string; bg: string } {
  switch (type) {
    case "local":
      return { color: "#27ae60", bg: "#1a3a1a" };
    case "mount":
      return { color: "#e67e22", bg: "#2a2a1a" };
    case "steam_shortcuts":
      return { color: "#66c0f4", bg: "#1a2a3a" };
    default:
      return { color: "#0984e3", bg: "#1a1a3a" };
  }
}
