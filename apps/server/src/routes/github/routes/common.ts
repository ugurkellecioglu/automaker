/**
 * Common utilities for GitHub routes
 */

import { createLogger } from '@automaker/utils';
import { createLogError, getErrorMessage } from '../../common.js';
import { execAsync, execEnv } from '../../../lib/exec-utils.js';

const logger = createLogger('GitHub');

// Re-export exec utilities for convenience
export { execAsync, execEnv } from '../../../lib/exec-utils.js';

// Re-export error utilities
export { getErrorMessage } from '../../common.js';

export const logError = createLogError(logger);
