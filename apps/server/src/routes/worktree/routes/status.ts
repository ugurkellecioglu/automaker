/**
 * POST /status endpoint - Get worktree status
 */

import type { Request, Response } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { getErrorMessage, logError, resolveWorktreePath } from "../common.js";

const execAsync = promisify(exec);

export function createStatusHandler() {
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
        // Worktree not found, return empty status
        res.json({
          success: true,
          modifiedFiles: 0,
          files: [],
          diffStat: "",
          recentCommits: [],
        });
        return;
      }

      try {
        const { stdout: status } = await execAsync("git status --porcelain", {
          cwd: worktreePath,
        });
        const files = status
          .split("\n")
          .filter(Boolean)
          .map((line) => line.slice(3));
        const { stdout: diffStat } = await execAsync("git diff --stat", {
          cwd: worktreePath,
        });
        const { stdout: logOutput } = await execAsync(
          'git log --oneline -5 --format="%h %s"',
          { cwd: worktreePath }
        );

        res.json({
          success: true,
          modifiedFiles: files.length,
          files,
          diffStat: diffStat.trim(),
          recentCommits: logOutput.trim().split("\n").filter(Boolean),
        });
      } catch {
        res.json({
          success: true,
          modifiedFiles: 0,
          files: [],
          diffStat: "",
          recentCommits: [],
        });
      }
    } catch (error) {
      logError(error, "Get worktree status failed");
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
