import { VFC, ReactNode } from "react";
import { Navigation, Focusable } from "@decky/ui";

interface Props {
  url: string;
  children: ReactNode;
}

/** Inline, text-styled link that opens `url` in the Steam overlay browser. */
export const ExternalLink: VFC<Props> = ({ url, children }) => (
  <Focusable
    onActivate={() => Navigation.NavigateToExternalWeb(url)}
    onClick={() => Navigation.NavigateToExternalWeb(url)}
    focusClassName="is-focused"
    style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}
  >
    {children}
  </Focusable>
);
