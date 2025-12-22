/**
 * Feature Verification Service - Handles verification and commit operations
 *
 * Provides functionality to verify feature implementations (lint, typecheck, test, build)
 * and commit changes to git.
 */

import { createLogger } from '@automaker/utils';
import {
  runVerificationChecks,
  hasUncommittedChanges,
  commitAll,
  shortHash,
} from '@automaker/git-utils';
import { extractTitleFromDescription } from '@automaker/prompts';
import { getFeatureDir, secureFs } from '@automaker/platform';
import path from 'path';
import type { EventEmitter } from '../../lib/events.js';
import type { Feature } from '@automaker/types';

const logger = createLogger('FeatureVerification');

export interface VerificationResult {
  success: boolean;
  failedCheck?: string;
}

export interface CommitResult {
  hash: string | null;
  shortHash?: string;
}

export class FeatureVerificationService {
  private events: EventEmitter;

  constructor(events: EventEmitter) {
    this.events = events;
  }

  /**
   * Resolve the working directory for a feature (checks for worktree)
   */
  async resolveWorkDir(projectPath: string, featureId: string): Promise<string> {
    const worktreePath = path.join(projectPath, '.worktrees', featureId);

    try {
      await secureFs.access(worktreePath);
      return worktreePath;
    } catch {
      return projectPath;
    }
  }

  /**
   * Verify a feature's implementation by running checks
   */
  async verify(projectPath: string, featureId: string): Promise<VerificationResult> {
    const workDir = await this.resolveWorkDir(projectPath, featureId);

    const result = await runVerificationChecks(workDir);

    if (result.success) {
      this.emitEvent('auto_mode_feature_complete', {
        featureId,
        passes: true,
        message: 'All verification checks passed',
      });
    } else {
      this.emitEvent('auto_mode_feature_complete', {
        featureId,
        passes: false,
        message: `Verification failed: ${result.failedCheck}`,
      });
    }

    return result;
  }

  /**
   * Commit feature changes
   */
  async commit(
    projectPath: string,
    featureId: string,
    feature: Feature | null,
    providedWorktreePath?: string
  ): Promise<CommitResult> {
    let workDir = projectPath;

    if (providedWorktreePath) {
      try {
        await secureFs.access(providedWorktreePath);
        workDir = providedWorktreePath;
      } catch {
        // Use project path
      }
    } else {
      workDir = await this.resolveWorkDir(projectPath, featureId);
    }

    // Check for changes
    const hasChanges = await hasUncommittedChanges(workDir);
    if (!hasChanges) {
      return { hash: null };
    }

    // Build commit message
    const title = feature
      ? extractTitleFromDescription(feature.description)
      : `Feature ${featureId}`;
    const commitMessage = `feat: ${title}\n\nImplemented by Automaker auto-mode`;

    // Commit changes
    const hash = await commitAll(workDir, commitMessage);

    if (hash) {
      const short = shortHash(hash);
      this.emitEvent('auto_mode_feature_complete', {
        featureId,
        passes: true,
        message: `Changes committed: ${short}`,
      });
      return { hash, shortHash: short };
    }

    logger.error(`Commit failed for ${featureId}`);
    return { hash: null };
  }

  /**
   * Check if context (agent-output.md) exists for a feature
   */
  async contextExists(projectPath: string, featureId: string): Promise<boolean> {
    const featureDir = getFeatureDir(projectPath, featureId);
    const contextPath = path.join(featureDir, 'agent-output.md');

    try {
      await secureFs.access(contextPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load existing context for a feature
   */
  async loadContext(projectPath: string, featureId: string): Promise<string | null> {
    const featureDir = getFeatureDir(projectPath, featureId);
    const contextPath = path.join(featureDir, 'agent-output.md');

    try {
      return (await secureFs.readFile(contextPath, 'utf-8')) as string;
    } catch {
      return null;
    }
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.events.emit('auto-mode:event', { type: eventType, ...data });
  }
}
