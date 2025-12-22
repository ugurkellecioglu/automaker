/**
 * Shell execution utilities
 *
 * Provides cross-platform shell execution with extended PATH
 * to find tools like git and gh in Electron environments.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified exec for async/await usage
 */
export const execAsync = promisify(exec);

/**
 * Path separator for the current platform
 */
const pathSeparator = process.platform === 'win32' ? ';' : ':';

/**
 * Additional paths to search for executables.
 * Electron apps don't inherit the user's shell PATH, so we need to add
 * common tool installation locations.
 */
const additionalPaths: string[] = [];

if (process.platform === 'win32') {
  // Windows paths for Git and other tools
  if (process.env.LOCALAPPDATA) {
    additionalPaths.push(`${process.env.LOCALAPPDATA}\\Programs\\Git\\cmd`);
  }
  if (process.env.PROGRAMFILES) {
    additionalPaths.push(`${process.env.PROGRAMFILES}\\Git\\cmd`);
  }
  if (process.env['ProgramFiles(x86)']) {
    additionalPaths.push(`${process.env['ProgramFiles(x86)']}\\Git\\cmd`);
  }
} else {
  // Unix/Mac paths
  additionalPaths.push(
    '/opt/homebrew/bin', // Homebrew on Apple Silicon
    '/usr/local/bin', // Homebrew on Intel Mac, common Linux location
    '/home/linuxbrew/.linuxbrew/bin', // Linuxbrew
    `${process.env.HOME}/.local/bin` // pipx, other user installs
  );
}

/**
 * Extended PATH that includes common tool installation locations.
 */
export const extendedPath = [process.env.PATH, ...additionalPaths.filter(Boolean)]
  .filter(Boolean)
  .join(pathSeparator);

/**
 * Environment variables with extended PATH for executing shell commands.
 */
export const execEnv = {
  ...process.env,
  PATH: extendedPath,
};

/**
 * Check if an error is ENOENT (file/path not found or spawn failed)
 */
export function isENOENT(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
