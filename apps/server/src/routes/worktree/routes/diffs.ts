/**
 * POST /diffs endpoint - Get diffs for a worktree
 */

import type { Request, Response } from "express";
import { getErrorMessage, logError, resolveWorktreePath } from "../common.js";
import { getGitRepositoryDiffs } from "../../common.js";

export function createDiffsHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId } = req.body as {
        projectPath: string;
        featureId: string;
      };

      if (!projectPath || !featureId) {
        res
          .status(400)
          .json({
            success: false,
            error: "projectPath and featureId required",
          });
        return;
      }

      // Resolve the actual worktree path using the helper function
      // This handles cases where:
      // - projectPath is already the worktree
      // - worktree is at projectPath/.worktrees/featureId
      // - worktree directory name differs from featureId (sanitized branch names)
      const worktreePath = await resolveWorktreePath(projectPath, featureId);

      if (worktreePath) {
        try {
          // Get diffs from the resolved worktree path
          const result = await getGitRepositoryDiffs(worktreePath);
          res.json({
            success: true,
            diff: result.diff,
            files: result.files,
            hasChanges: result.hasChanges,
          });
          return;
        } catch (innerError) {
          logError(innerError, "Failed to get diffs from worktree");
        }
      }

      // Worktree not found or failed - fallback to main project path
      try {
        const result = await getGitRepositoryDiffs(projectPath);
        res.json({
          success: true,
          diff: result.diff,
          files: result.files,
          hasChanges: result.hasChanges,
        });
      } catch (fallbackError) {
        logError(fallbackError, "Fallback to main project also failed");
        res.json({ success: true, diff: "", files: [], hasChanges: false });
      }
    } catch (error) {
      logError(error, "Get worktree diffs failed");
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
