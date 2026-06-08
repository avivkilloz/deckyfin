/**
 * useArtwork — apply SteamGridDB art via Steam's native SetCustomArtworkForApp API.
 *
 * Instead of manually copying files to the grid folder, this hook uses
 * SteamClient.Apps.SetCustomArtworkForApp() — the same API the official
 * SteamGridDB Decky plugin uses. This handles all asset types correctly:
 *   eAssetType 0 = grid_p  (portrait capsule)
 *   eAssetType 1 = hero    (hero banner)
 *   eAssetType 2 = logo    (logo)
 *   eAssetType 3 = grid_l  (landscape wide capsule)
 *
 * For icons (type 4) on non-Steam shortcuts, we keep the manual file-copy
 * approach via the existing apply_steam_grid backend method, since the
 * Steam API doesn't handle icons for shortcuts properly.
 */
import { useCallback } from "react";
import { callable } from "@decky/api";
import { AssetType, SteamAssetType } from "../types";

// ── Backend callables ────────────────────────────────────────────────────────

const fetchArtUrls = callable<
  [game_name: string],
  {
    success: boolean;
    error?: string;
    game_id?: number;
    game_name?: string;
    grid_p?: string;
    hero?: string;
    logo?: string;
    wide?: string;
  }
>("fetch_steamgrid_art_urls");

const downloadAsBase64 = callable<[url: string], string>(
  "download_as_base64"
);

// ── Get logo position JSON path for shortcuts ────────────────────────────────

/**
 * Initialize a default logo position for a shortcut.
 * Without this, logos on non-Steam shortcuts appear blank.
 */
async function initDefaultLogoPosition(appOverview: any): Promise<void> {
  try {
    await window.appDetailsStore.SaveCustomLogoPosition(appOverview, {
      pinnedPosition: "BottomLeft",
      nWidthPct: 50,
      nHeightPct: 50,
    });
  } catch {
    // Non-critical — logo position is a nice-to-have
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useArtwork() {
  /**
   * Download an image URL as base64 via the Python backend.
   */
  const downloadImage = useCallback(
    async (url: string): Promise<string | null> => {
      try {
        return await downloadAsBase64(url);
      } catch (err) {
        console.error("[Deckyfin] Failed to download image:", url, err);
        return null;
      }
    },
    []
  );

  /**
   * Clear custom artwork for a given asset type using Steam's API.
   */
  const clearArt = useCallback(
    async (appId: number, assetType: SteamAssetType): Promise<void> => {
      try {
        await SteamClient.Apps.ClearCustomArtworkForApp(appId, assetType);
        // ClearCustomArtworkForApp resolves instantly, not after clearing
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        console.error(
          `[Deckyfin] Failed to clear art type ${assetType}:`,
          err
        );
      }
    },
    []
  );

  /**
   * Apply a single art asset using Steam's native API.
   *
   * Steps:
   *   1. Clear existing custom artwork for this type
   *   2. Download image as base64 from backend
   *   3. Call SteamClient.Apps.SetCustomArtworkForApp()
   *
   * For icons (type 4) on shortcuts, falls through to the legacy method.
   */
  const applyArtByType = useCallback(
    async (
      appId: number,
      url: string,
      assetType: SteamAssetType,
      appOverview?: any
    ): Promise<boolean> => {
      // Icons on shortcuts need the legacy shortcuts.vdf approach
      if (assetType === AssetType.ICON) {
        return false; // caller should use applySteamGridLegacy for icons
      }

      const b64data = await downloadImage(url);
      if (!b64data) return false;

      await clearArt(appId, assetType);
      try {
        await SteamClient.Apps.SetCustomArtworkForApp(
          appId,
          b64data,
          "png",
          assetType
        );

        // For logos on shortcuts, init a default logo position
        if (assetType === AssetType.LOGO && appOverview?.BIsShortcut()) {
          await initDefaultLogoPosition(appOverview);
        }

        return true;
      } catch (err) {
        console.error(
          `[Deckyfin] SetCustomArtworkForApp failed for type ${assetType}:`,
          err
        );
        return false;
      }
    },
    [downloadImage, clearArt]
  );

  /**
   * Fetch SteamGridDB art URLs, download each available asset, and apply
   * via Steam's native SetCustomArtworkForApp API.
   *
   * This is the main "Add Art" action — replaces the legacy file-copy approach.
   *
   * @returns Summary of what was applied and what failed.
   */
  const applyAllArt = useCallback(
    async (
      gameName: string,
      appId: number,
      appOverview?: any
    ): Promise<{ applied: string[]; errors: string[] }> => {
      const applied: string[] = [];
      const errors: string[] = [];

      // 1. Fetch art URLs from SteamGridDB
      let urls: any;
      try {
        urls = await fetchArtUrls(gameName);
      } catch (err: any) {
        errors.push(`API error: ${err?.message || "Failed to fetch art URLs"}`);
        return { applied, errors };
      }

      if (!urls?.success) {
        errors.push(urls?.error || `No SteamGridDB results for '${gameName}'`);
        return { applied, errors };
      }

      // 2. Apply each available art type via Steam API
      const typeMap: Array<{ key: string; type: SteamAssetType; url?: string }> = [
        { key: "grid_p", type: AssetType.GRID_P, url: urls.grid_p },
        { key: "hero", type: AssetType.HERO, url: urls.hero },
        { key: "logo", type: AssetType.LOGO, url: urls.logo },
        { key: "wide", type: AssetType.GRID_L, url: urls.wide },
      ];

      for (const { key, type, url } of typeMap) {
        if (!url) {
          errors.push(`No ${key} URL found on SteamGridDB`);
          continue;
        }

        const ok = await applyArtByType(appId, url, type, appOverview);
        if (ok) {
          applied.push(key);
        } else {
          errors.push(`Failed to apply ${key}`);
        }
      }

      return { applied, errors };
    },
    [applyArtByType]
  );

  return {
    applyAllArt,
    applyArtByType,
    downloadImage,
    clearArt,
  };
}

export default useArtwork;
