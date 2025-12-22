/**
 * POST /write endpoint - Write file
 */

import type { Request, Response } from 'express';
import { secureFs, PathNotAllowedError } from '@automaker/platform';
import path from 'path';
import { mkdirSafe } from '@automaker/utils';
import { getErrorMessage, logError } from '../common.js';

export function createWriteHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { filePath, content } = req.body as {
        filePath: string;
        content: string;
      };

      if (!filePath) {
        res.status(400).json({ success: false, error: 'filePath is required' });
        return;
      }

      // Ensure parent directory exists (symlink-safe)
      await mkdirSafe(path.dirname(path.resolve(filePath)));
      await secureFs.writeFile(filePath, content, 'utf-8');

      res.json({ success: true });
    } catch (error) {
      // Path not allowed - return 403 Forbidden
      if (error instanceof PathNotAllowedError) {
        res.status(403).json({ success: false, error: getErrorMessage(error) });
        return;
      }

      logError(error, 'Write file failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
