/**
 * POST /validate-path endpoint - Validate and add path to allowed list
 */

import type { Request, Response } from 'express';
import { secureFs, isPathAllowed } from '@automaker/platform';
import path from 'path';
import { getErrorMessage, logError } from '../common.js';

export function createValidatePathHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        res.status(400).json({ success: false, error: 'filePath is required' });
        return;
      }

      const resolvedPath = path.resolve(filePath);

      // Check if path exists
      try {
        const stats = await secureFs.stat(resolvedPath);

        if (!stats.isDirectory()) {
          res.status(400).json({ success: false, error: 'Path is not a directory' });
          return;
        }

        res.json({
          success: true,
          path: resolvedPath,
          isAllowed: isPathAllowed(resolvedPath),
        });
      } catch {
        res.status(400).json({ success: false, error: 'Path does not exist' });
      }
    } catch (error) {
      logError(error, 'Validate path failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
