/**
 * Common utilities shared across all route modules
 */

import { createLogger } from '@automaker/utils';

// Re-export git utilities from shared package
export {
  BINARY_EXTENSIONS,
  GIT_STATUS_MAP,
  type FileStatus,
  isGitRepo,
  parseGitStatus,
  generateSyntheticDiffForNewFile,
  appendUntrackedFileDiffs,
  listAllFilesInDirectory,
  generateDiffsForNonGitDirectory,
  getGitRepositoryDiffs,
} from '@automaker/git-utils';

// Re-export error utilities from shared package
export { getErrorMessage } from '@automaker/utils';

// Re-export exec utilities
export { execAsync, execEnv, isENOENT } from '../lib/exec-utils.js';

type Logger = ReturnType<typeof createLogger>;

/**
 * Create a logError function for a specific logger
 * This ensures consistent error logging format across all routes
 */
export function createLogError(logger: Logger) {
  return (error: unknown, context: string): void => {
    logger.error(`❌ ${context}:`, error);
  };
}
