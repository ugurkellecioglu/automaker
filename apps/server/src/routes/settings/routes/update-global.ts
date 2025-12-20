/**
 * PUT /api/settings/global - Update global user settings
 *
 * Accepts partial GlobalSettings update. Fields provided are merged into
 * existing settings (not replaced). Returns updated settings.
 *
 * Request body: `Partial<GlobalSettings>`
 * Response: `{ "success": true, "settings": GlobalSettings }`
 */

import type { Request, Response } from "express";
import type { SettingsService } from "../../../services/settings-service.js";
import type { GlobalSettings } from "../../../types/settings.js";
import { getErrorMessage, logError } from "../common.js";

/**
 * Create handler factory for PUT /api/settings/global
 *
 * @param settingsService - Instance of SettingsService for file I/O
 * @returns Express request handler
 */
export function createUpdateGlobalHandler(settingsService: SettingsService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const updates = req.body as Partial<GlobalSettings>;

      if (!updates || typeof updates !== "object") {
        res.status(400).json({
          success: false,
          error: "Invalid request body - expected settings object",
        });
        return;
      }

      const settings = await settingsService.updateGlobalSettings(updates);

      res.json({
        success: true,
        settings,
      });
    } catch (error) {
      logError(error, "Update global settings failed");
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
