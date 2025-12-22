/**
 * Common utilities for worktree routes
 */

import { createLogger } from '@automaker/utils';
import { getErrorMessage as getErrorMessageShared, createLogError } from '../common.js';
import { execAsync, execEnv, isENOENT } from '../../lib/exec-utils.js';
import { FeatureLoader } from '../../services/feature-loader.js';

const logger = createLogger('Worktree');
const featureLoader = new FeatureLoader();

// Re-export exec utilities for convenience
export { execAsync, execEnv, isENOENT } from '../../lib/exec-utils.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum allowed length for git branch names */
export const MAX_BRANCH_NAME_LENGTH = 250;

// ============================================================================
// Validation utilities
// ============================================================================

/**
 * Validate branch name to prevent command injection.
 * Git branch names cannot contain: space, ~, ^, :, ?, *, [, \, or control chars.
 * We also reject shell metacharacters for safety.
 */
export function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._\-/]+$/.test(name) && name.length < MAX_BRANCH_NAME_LENGTH;
}

/**
 * Check if gh CLI is available on the system
 */
export async function isGhCliAvailable(): Promise<boolean> {
  try {
    const checkCommand = process.platform === 'win32' ? 'where gh' : 'command -v gh';
    await execAsync(checkCommand, { env: execEnv });
    return true;
  } catch {
    return false;
  }
}

export const AUTOMAKER_INITIAL_COMMIT_MESSAGE = 'chore: automaker initial commit';

/**
 * Normalize path separators to forward slashes for cross-platform consistency.
 * This ensures paths from `path.join()` (backslashes on Windows) match paths
 * from git commands (which may use forward slashes).
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Check if a path is a git repo
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a mock/test path that doesn't exist
 */
export function isMockPath(worktreePath: string): boolean {
  return worktreePath.startsWith('/mock/') || worktreePath.includes('/mock/');
}

/**
 * Conditionally log worktree errors - suppress ENOENT for mock paths
 * to reduce noise in test output
 */
export function logWorktreeError(error: unknown, message: string, worktreePath?: string): void {
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
 * Ensure the repository has at least one commit so git commands that rely on HEAD work.
 * Returns true if an empty commit was created, false if the repo already had commits.
 */
export async function ensureInitialCommit(repoPath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --verify HEAD', { cwd: repoPath });
    return false;
  } catch {
    try {
      await execAsync(`git commit --allow-empty -m "${AUTOMAKER_INITIAL_COMMIT_MESSAGE}"`, {
        cwd: repoPath,
      });
      logger.info(`[Worktree] Created initial empty commit to enable worktrees in ${repoPath}`);
      return true;
    } catch (error) {
      const reason = getErrorMessageShared(error);
      throw new Error(
        `Failed to create initial git commit. Please commit manually and retry. ${reason}`
      );
    }
  }
}
