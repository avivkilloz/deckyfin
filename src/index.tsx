import { definePlugin } from "@decky/api";
import { GameLibrary } from "./components/GameLibrary";

// Injected once — adds gamepad focus ring to all Focusable elements inside deckyfin
const FOCUS_CSS = `
  #deckyfin-wrap .Panel.gpfocus,
  #deckyfin-wrap .Focusable.gpfocus {
    outline: 2px solid rgba(81, 203, 238, 0.8) !important;
    outline-offset: 1px !important;
  }
`;

let styleEl: HTMLStyleElement | null = null;

export default definePlugin(() => {
  // Inject focus ring CSS when plugin mounts
  styleEl = document.createElement("style");
  styleEl.textContent = FOCUS_CSS;
  document.head.appendChild(styleEl);

  return {
    name: "Deckyfin",
    title: <div>Deckyfin</div>,
    content: <div id="deckyfin-wrap"><GameLibrary /></div>,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="24"
        height="24"
      >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ),
    onDismount() {
      console.log("Deckyfin unmounted");
      // Clean up injected CSS
      if (styleEl) {
        styleEl.remove();
        styleEl = null;
      }
    },
  };
});
