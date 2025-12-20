/**
 * Common utilities for worktree routes
 */

import { createLogger } from "../../lib/logger.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import {
  getErrorMessage as getErrorMessageShared,
  createLogError,
} from "../common.js";

const logger = createLogger("Worktree");
const execAsync = promisify(exec);

export const AUTOMAKER_INITIAL_COMMIT_MESSAGE =
  "chore: automaker initial commit";

/**
 * Normalize path separators to forward slashes for cross-platform consistency.
 * This ensures paths from `path.join()` (backslashes on Windows) match paths
 * from git commands (which may use forward slashes).
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Check if a path is a git repo
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await execAsync("git rev-parse --is-inside-work-tree", { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an error is ENOENT (file/path not found or spawn failed)
 * These are expected in test environments with mock paths
 */
export function isENOENT(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Check if a path is a mock/test path that doesn't exist
 */
export function isMockPath(worktreePath: string): boolean {
  return worktreePath.startsWith("/mock/") || worktreePath.includes("/mock/");
}

/**
 * Conditionally log worktree errors - suppress ENOENT for mock paths
 * to reduce noise in test output
 */
export function logWorktreeError(
  error: unknown,
  message: string,
  worktreePath?: string
): void {
  // Don't log ENOENT errors for mock paths (expected in tests)
  if (isENOENT(error) && worktreePath && isMockPath(worktreePath)) {
    return;
  }
  logError(error, message);
}

// Re-export shared utilities
export { getErrorMessageShared as getErrorMessage };
export const logError = createLogError(logger);

/**
 * Resolve the actual worktree path for a feature.
 *
 * This function handles multiple scenarios:
 * 1. If projectPath itself is the worktree directory, return it
 * 2. If the worktree exists at projectPath/.worktrees/featureId, return that
 * 3. Look up the worktree using git worktree list to find by feature branch pattern
 *
 * @param projectPath - The project path (could be main repo or already a worktree)
 * @param featureId - The feature ID to find the worktree for
 * @returns The resolved worktree path, or null if not found
 */
export async function resolveWorktreePath(
  projectPath: string,
  featureId: string
): Promise<string | null> {
  // First, check if projectPath itself is the worktree we're looking for
  // This handles the case where projectPath is already a worktree path
  const projectBasename = path.basename(projectPath);
  if (projectBasename === featureId || projectPath.includes(`/.worktrees/${featureId}`)) {
    try {
      await fs.access(projectPath);
      return projectPath;
    } catch {
      // Path doesn't exist, continue to other checks
    }
  }

  // Check the standard worktree location: projectPath/.worktrees/featureId
  const standardWorktreePath = path.join(projectPath, ".worktrees", featureId);
  try {
    await fs.access(standardWorktreePath);
    return standardWorktreePath;
  } catch {
    // Standard path doesn't exist, continue to git worktree lookup
  }

  // Try to find the worktree using git worktree list
  // This handles cases where the worktree directory name differs from featureId
  // (e.g., when using sanitized branch names)
  try {
    const { stdout } = await execAsync("git worktree list --porcelain", {
      cwd: projectPath,
    });

    const lines = stdout.split("\n");
    let currentPath: string | null = null;
    let currentBranch: string | null = null;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice(9);
      } else if (line.startsWith("branch ")) {
        currentBranch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "" && currentPath && currentBranch) {
        // Check if this worktree matches the featureId
        // Match by: branch name contains featureId, or path contains featureId
        if (
          currentBranch === featureId ||
          currentBranch === `feature/${featureId}` ||
          currentPath.includes(featureId)
        ) {
          // Resolve to absolute path for cross-platform compatibility
          const resolvedPath = path.isAbsolute(currentPath)
            ? path.resolve(currentPath)
            : path.resolve(projectPath, currentPath);
          return resolvedPath;
        }
        currentPath = null;
        currentBranch = null;
      }
    }

    // Check last entry if file doesn't end with newline
    if (currentPath && currentBranch) {
      if (
        currentBranch === featureId ||
        currentBranch === `feature/${featureId}` ||
        currentPath.includes(featureId)
      ) {
        const resolvedPath = path.isAbsolute(currentPath)
          ? path.resolve(currentPath)
          : path.resolve(projectPath, currentPath);
        return resolvedPath;
      }
    }
  } catch {
    // Git command failed, worktree not found
  }

  return null;
}

/**
 * Ensure the repository has at least one commit so git commands that rely on HEAD work.
 * Returns true if an empty commit was created, false if the repo already had commits.
 */
export async function ensureInitialCommit(repoPath: string): Promise<boolean> {
  try {
    await execAsync("git rev-parse --verify HEAD", { cwd: repoPath });
    return false;
  } catch {
    try {
      await execAsync(
        `git commit --allow-empty -m "${AUTOMAKER_INITIAL_COMMIT_MESSAGE}"`,
        { cwd: repoPath }
      );
      logger.info(
        `[Worktree] Created initial empty commit to enable worktrees in ${repoPath}`
      );
      return true;
    } catch (error) {
      const reason = getErrorMessageShared(error);
      throw new Error(
        `Failed to create initial git commit. Please commit manually and retry. ${reason}`
      );
    }
  }
}
