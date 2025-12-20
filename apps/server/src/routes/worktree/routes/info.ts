/**
 * POST /info endpoint - Get worktree info
 */

import type { Request, Response } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { getErrorMessage, logError, normalizePath, resolveWorktreePath } from "../common.js";

const execAsync = promisify(exec);

export function createInfoHandler() {
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

      if (!worktreePath) {
        res.json({ success: true, worktreePath: null, branchName: null });
        return;
      }

      try {
        const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
          cwd: worktreePath,
        });
        res.json({
          success: true,
          worktreePath: normalizePath(worktreePath),
          branchName: stdout.trim(),
        });
      } catch {
        res.json({ success: true, worktreePath: null, branchName: null });
      }
    } catch (error) {
      logError(error, "Get worktree info failed");
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
