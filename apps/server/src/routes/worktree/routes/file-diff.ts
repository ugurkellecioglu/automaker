/**
 * POST /file-diff endpoint - Get diff for a specific file
 */

import type { Request, Response } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { getErrorMessage, logError, resolveWorktreePath } from "../common.js";
import { generateSyntheticDiffForNewFile } from "../../common.js";

const execAsync = promisify(exec);

export function createFileDiffHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectPath, featureId, filePath } = req.body as {
        projectPath: string;
        featureId: string;
        filePath: string;
      };

      if (!projectPath || !featureId || !filePath) {
        res.status(400).json({
          success: false,
          error: "projectPath, featureId, and filePath required",
        });
        return;
      }

      // Resolve the actual worktree path using the helper function
      // This handles cases where:
      // - projectPath is already the worktree
      // - worktree is at projectPath/.worktrees/featureId
      // - worktree directory name differs from featureId (sanitized branch names)
      const worktreePath = await resolveWorktreePath(projectPath, featureId);

      if (!worktreePath) {
        // Worktree not found, return empty diff
        res.json({ success: true, diff: "", filePath });
        return;
      }

      try {
        // First check if the file is untracked
        const { stdout: status } = await execAsync(
          `git status --porcelain -- "${filePath}"`,
          { cwd: worktreePath }
        );

        const isUntracked = status.trim().startsWith("??");

        let diff: string;
        if (isUntracked) {
          // Generate synthetic diff for untracked file
          diff = await generateSyntheticDiffForNewFile(worktreePath, filePath);
        } else {
          // Use regular git diff for tracked files
          const result = await execAsync(
            `git diff HEAD -- "${filePath}"`,
            {
              cwd: worktreePath,
              maxBuffer: 10 * 1024 * 1024,
            }
          );
          diff = result.stdout;
        }

        res.json({ success: true, diff, filePath });
      } catch (innerError) {
        logError(innerError, "Worktree file diff failed");
        res.json({ success: true, diff: "", filePath });
      }
    } catch (error) {
      logError(error, "Get worktree file diff failed");
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
