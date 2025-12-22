/**
 * Auto Mode Service - Autonomous feature implementation using Claude Agent SDK
 *
 * This is the main orchestrator for auto-mode feature execution.
 * It coordinates:
 * - Feature execution lifecycle
 * - Worktree management (via WorktreeManager)
 * - Plan approval workflow (via PlanApprovalService)
 * - Multi-agent task execution (via TaskExecutor)
 * - Output persistence (via OutputWriter)
 * - Verification & commits (via FeatureVerificationService)
 * - Project analysis (via ProjectAnalyzer)
 */

import { ProviderFactory } from '../providers/provider-factory.js';
import type { ExecuteOptions, PlanningMode } from '@automaker/types';
import {
  buildPromptWithImages,
  classifyError,
  loadContextFiles,
  createLogger,
  sleep,
  processStream,
  extractBeforeMarker,
} from '@automaker/utils';
import { secureFs, getFeatureDir } from '@automaker/platform';
import { resolveModelString, DEFAULT_MODELS } from '@automaker/model-resolver';
import {
  getPlanningPromptPrefix,
  parseTasksFromSpec,
  buildFeaturePrompt,
  buildFollowUpPrompt,
  buildContinuationPrompt,
} from '@automaker/prompts';
import path from 'path';
import type { EventEmitter } from '../lib/events.js';
import { createAutoModeOptions, validateWorkingDirectory } from '../lib/sdk-options.js';
import { FeatureLoader } from './feature-loader.js';

import {
  PlanApprovalService,
  TaskExecutor,
  WorktreeManager,
  ProjectAnalyzer,
  FeatureVerificationService,
  createFeatureOutputWriter,
} from './auto-mode/index.js';
import type {
  RunningFeature,
  AutoModeConfig,
  FeatureExecutionOptions,
  RunAgentOptions,
  TaskExecutionContext,
} from './auto-mode/types.js';

const logger = createLogger('AutoModeService');

export class AutoModeService {
  private events: EventEmitter;
  private runningFeatures = new Map<string, RunningFeature>();
  private featureLoader = new FeatureLoader();
  private autoLoopRunning = false;
  private autoLoopAbortController: AbortController | null = null;
  private config: AutoModeConfig | null = null;

  // Extracted services
  private planApproval: PlanApprovalService;
  private taskExecutor: TaskExecutor;
  private worktreeManager: WorktreeManager;
  private projectAnalyzer: ProjectAnalyzer;
  private verification: FeatureVerificationService;

  constructor(events: EventEmitter) {
    this.events = events;
    this.planApproval = new PlanApprovalService(events);
    this.taskExecutor = new TaskExecutor(events);
    this.worktreeManager = new WorktreeManager();
    this.projectAnalyzer = new ProjectAnalyzer(events);
    this.verification = new FeatureVerificationService(events);
  }

  // ============================================================
  // Auto Loop Management
  // ============================================================

  async startAutoLoop(projectPath: string, maxConcurrency = 3): Promise<void> {
    if (this.autoLoopRunning) throw new Error('Auto mode is already running');

    this.autoLoopRunning = true;
    this.autoLoopAbortController = new AbortController();
    this.config = { maxConcurrency, useWorktrees: true, projectPath };

    this.emitEvent('auto_mode_started', {
      message: `Auto mode started with max ${maxConcurrency} concurrent features`,
      projectPath,
    });
    this.runAutoLoop().catch((error) => {
      logger.error('Loop error', error);
      const errorInfo = classifyError(error);
      this.emitEvent('auto_mode_error', { error: errorInfo.message, errorType: errorInfo.type });
    });
  }

  private async runAutoLoop(): Promise<void> {
    while (
      this.autoLoopRunning &&
      this.autoLoopAbortController &&
      !this.autoLoopAbortController.signal.aborted
    ) {
      try {
        if (this.runningFeatures.size >= (this.config?.maxConcurrency || 3)) {
          await sleep(5000);
          continue;
        }

        const pendingFeatures = await this.featureLoader.getPending(this.config!.projectPath);
        if (pendingFeatures.length === 0) {
          this.emitEvent('auto_mode_idle', {
            message: 'No pending features - auto mode idle',
            projectPath: this.config!.projectPath,
          });
          await sleep(10000);
          continue;
        }

        const nextFeature = pendingFeatures.find((f) => !this.runningFeatures.has(f.id));
        if (nextFeature) {
          this.executeFeature(
            this.config!.projectPath,
            nextFeature.id,
            this.config!.useWorktrees,
            true
          ).catch((error) => {
            logger.error(`Feature ${nextFeature.id} error`, error);
          });
        }

        await sleep(2000);
      } catch (error) {
        logger.error('Loop iteration error', error);
        await sleep(5000);
      }
    }
    this.autoLoopRunning = false;
  }

  async stopAutoLoop(): Promise<number> {
    const wasRunning = this.autoLoopRunning;
    this.autoLoopRunning = false;
    if (this.autoLoopAbortController) {
      this.autoLoopAbortController.abort();
      this.autoLoopAbortController = null;
    }
    if (wasRunning) {
      this.emitEvent('auto_mode_stopped', {
        message: 'Auto mode stopped',
        projectPath: this.config?.projectPath,
      });
    }
    return this.runningFeatures.size;
  }

  // ============================================================
  // Feature Execution
  // ============================================================

  async executeFeature(
    projectPath: string,
    featureId: string,
    useWorktrees = false,
    isAutoMode = false,
    _providedWorktreePath?: string,
    options?: FeatureExecutionOptions
  ): Promise<void> {
    if (this.runningFeatures.has(featureId)) throw new Error('already running');

    const abortController = new AbortController();
    const startTime = Date.now();

    this.runningFeatures.set(featureId, {
      featureId,
      projectPath,
      worktreePath: null,
      branchName: null,
      abortController,
      isAutoMode,
      startTime,
    });

    try {
      validateWorkingDirectory(projectPath);

      // Check for existing context - resume instead
      if (
        !options?.continuationPrompt &&
        (await this.verification.contextExists(projectPath, featureId))
      ) {
        logger.info(`Feature ${featureId} has existing context, resuming`);
        this.runningFeatures.delete(featureId);
        return this.resumeFeature(projectPath, featureId, useWorktrees);
      }

      this.emitEvent('auto_mode_feature_start', {
        featureId,
        projectPath,
        feature: { id: featureId, title: 'Loading...', description: 'Feature is starting' },
      });

      const feature = await this.featureLoader.get(projectPath, featureId);
      if (!feature) throw new Error(`Feature ${featureId} not found`);

      const { workDir, worktreePath } = await this.worktreeManager.resolveWorkDir(
        projectPath,
        feature.branchName,
        useWorktrees
      );
      validateWorkingDirectory(workDir);

      const running = this.runningFeatures.get(featureId);
      if (running) {
        running.worktreePath = worktreePath;
        running.branchName = feature.branchName ?? null;
      }

      await this.featureLoader.updateStatus(projectPath, featureId, 'in_progress');

      const { formattedPrompt: contextFilesPrompt } = await loadContextFiles({
        projectPath,
        fsModule: secureFs as Parameters<typeof loadContextFiles>[0]['fsModule'],
      });

      let prompt: string;
      if (options?.continuationPrompt) {
        prompt = options.continuationPrompt;
      } else {
        const featurePrompt = buildFeaturePrompt(feature);
        const planningPrefix = getPlanningPromptPrefix(
          feature.planningMode || 'skip',
          feature.requirePlanApproval
        );
        prompt = planningPrefix + featurePrompt;

        if (feature.planningMode && feature.planningMode !== 'skip') {
          this.emitEvent('planning_started', {
            featureId: feature.id,
            mode: feature.planningMode,
            message: `Starting ${feature.planningMode} planning phase`,
          });
        }
      }

      const imagePaths = feature.imagePaths?.map((img) =>
        typeof img === 'string' ? img : img.path
      );
      const model = resolveModelString(feature.model, DEFAULT_MODELS.claude);
      logger.info(`Executing feature ${featureId} with model: ${model} in ${workDir}`);

      await this.runAgent(
        workDir,
        featureId,
        prompt,
        abortController,
        projectPath,
        imagePaths,
        model,
        {
          projectPath,
          planningMode: feature.planningMode,
          requirePlanApproval: feature.requirePlanApproval,
          systemPrompt: contextFilesPrompt || undefined,
        }
      );

      const finalStatus = feature.skipTests ? 'waiting_approval' : 'verified';
      await this.featureLoader.updateStatus(projectPath, featureId, finalStatus);

      this.emitEvent('auto_mode_feature_complete', {
        featureId,
        passes: true,
        projectPath,
        message: `Feature completed in ${Math.round((Date.now() - startTime) / 1000)}s${finalStatus === 'verified' ? ' - auto-verified' : ''}`,
      });
    } catch (error) {
      const errorInfo = classifyError(error);
      if (errorInfo.isAbort) {
        this.emitEvent('auto_mode_feature_complete', {
          featureId,
          passes: false,
          message: 'Feature stopped by user',
          projectPath,
        });
      } else {
        logger.error(`Feature ${featureId} failed`, error);
        await this.featureLoader.updateStatus(projectPath, featureId, 'backlog');
        this.emitEvent('auto_mode_error', {
          featureId,
          error: errorInfo.message,
          errorType: errorInfo.type,
          projectPath,
        });
      }
    } finally {
      this.runningFeatures.delete(featureId);
    }
  }

  async stopFeature(featureId: string): Promise<boolean> {
    const running = this.runningFeatures.get(featureId);
    if (!running) return false;
    this.planApproval.cancel(featureId);
    running.abortController.abort();
    return true;
  }

  async resumeFeature(projectPath: string, featureId: string, useWorktrees = false): Promise<void> {
    if (this.runningFeatures.has(featureId)) throw new Error('already running');

    const context = await this.verification.loadContext(projectPath, featureId);
    if (context) {
      const feature = await this.featureLoader.get(projectPath, featureId);
      if (!feature) throw new Error(`Feature ${featureId} not found`);
      const prompt = buildContinuationPrompt(feature, context);
      return this.executeFeature(projectPath, featureId, useWorktrees, false, undefined, {
        continuationPrompt: prompt,
      });
    }
    return this.executeFeature(projectPath, featureId, useWorktrees, false);
  }

  async followUpFeature(
    projectPath: string,
    featureId: string,
    prompt: string,
    imagePaths?: string[],
    useWorktrees = true
  ): Promise<void> {
    validateWorkingDirectory(projectPath);
    if (this.runningFeatures.has(featureId))
      throw new Error(`Feature ${featureId} is already running`);

    const abortController = new AbortController();
    const feature = await this.featureLoader.get(projectPath, featureId);
    const branchName = feature?.branchName || `feature/${featureId}`;
    const { workDir, worktreePath } = await this.worktreeManager.resolveWorkDir(
      projectPath,
      branchName,
      useWorktrees
    );

    const previousContext = (await this.verification.loadContext(projectPath, featureId)) || '';
    const { formattedPrompt: contextFilesPrompt } = await loadContextFiles({
      projectPath,
      fsModule: secureFs as Parameters<typeof loadContextFiles>[0]['fsModule'],
    });

    const fullPrompt = buildFollowUpPrompt(feature, featureId, previousContext, prompt);

    this.runningFeatures.set(featureId, {
      featureId,
      projectPath,
      worktreePath,
      branchName,
      abortController,
      isAutoMode: false,
      startTime: Date.now(),
    });
    this.emitEvent('auto_mode_feature_start', {
      featureId,
      projectPath,
      feature: feature || {
        id: featureId,
        title: 'Follow-up',
        description: prompt.substring(0, 100),
      },
    });

    try {
      const model = resolveModelString(feature?.model, DEFAULT_MODELS.claude);
      await this.featureLoader.updateStatus(projectPath, featureId, 'in_progress');

      const allImagePaths: string[] = [];
      if (feature?.imagePaths)
        allImagePaths.push(
          ...feature.imagePaths.map((img) => (typeof img === 'string' ? img : img.path))
        );
      if (imagePaths) allImagePaths.push(...imagePaths);

      await this.runAgent(
        workDir,
        featureId,
        fullPrompt,
        abortController,
        projectPath,
        allImagePaths.length > 0 ? allImagePaths : undefined,
        model,
        {
          projectPath,
          planningMode: 'skip',
          previousContent: previousContext || undefined,
          systemPrompt: contextFilesPrompt || undefined,
        }
      );

      const finalStatus = feature?.skipTests ? 'waiting_approval' : 'verified';
      await this.featureLoader.updateStatus(projectPath, featureId, finalStatus);
      this.emitEvent('auto_mode_feature_complete', {
        featureId,
        passes: true,
        message: `Follow-up completed${finalStatus === 'verified' ? ' - auto-verified' : ''}`,
        projectPath,
      });
    } catch (error) {
      const errorInfo = classifyError(error);
      if (!errorInfo.isCancellation) {
        this.emitEvent('auto_mode_error', {
          featureId,
          error: errorInfo.message,
          errorType: errorInfo.type,
          projectPath,
        });
      }
    } finally {
      this.runningFeatures.delete(featureId);
    }
  }

  // ============================================================
  // Verification & Git (delegated)
  // ============================================================

  async verifyFeature(projectPath: string, featureId: string): Promise<boolean> {
    const result = await this.verification.verify(projectPath, featureId);
    return result.success;
  }

  async commitFeature(
    projectPath: string,
    featureId: string,
    providedWorktreePath?: string
  ): Promise<string | null> {
    const feature = await this.featureLoader.get(projectPath, featureId);
    const result = await this.verification.commit(
      projectPath,
      featureId,
      feature,
      providedWorktreePath
    );
    return result.hash;
  }

  contextExists(projectPath: string, featureId: string): Promise<boolean> {
    return this.verification.contextExists(projectPath, featureId);
  }

  analyzeProject(projectPath: string): Promise<void> {
    return this.projectAnalyzer.analyze(projectPath);
  }

  // ============================================================
  // Status
  // ============================================================

  getStatus(): { isRunning: boolean; runningFeatures: string[]; runningCount: number } {
    return {
      isRunning: this.runningFeatures.size > 0,
      runningFeatures: Array.from(this.runningFeatures.keys()),
      runningCount: this.runningFeatures.size,
    };
  }

  getRunningAgents(): Array<{
    featureId: string;
    projectPath: string;
    projectName: string;
    isAutoMode: boolean;
  }> {
    return Array.from(this.runningFeatures.values()).map((rf) => ({
      featureId: rf.featureId,
      projectPath: rf.projectPath,
      projectName: path.basename(rf.projectPath),
      isAutoMode: rf.isAutoMode,
    }));
  }

  // ============================================================
  // Plan Approval (delegated to PlanApprovalService)
  // ============================================================

  waitForPlanApproval(
    featureId: string,
    projectPath: string
  ): Promise<{ approved: boolean; editedPlan?: string; feedback?: string }> {
    return this.planApproval.waitForApproval(featureId, projectPath);
  }

  async resolvePlanApproval(
    featureId: string,
    approved: boolean,
    editedPlan?: string,
    feedback?: string,
    projectPathFromClient?: string
  ): Promise<{ success: boolean; error?: string }> {
    const result = this.planApproval.resolve(featureId, approved, editedPlan, feedback);

    if (!result.success && projectPathFromClient) {
      return this.handleApprovalRecovery(
        featureId,
        approved,
        editedPlan,
        feedback,
        projectPathFromClient
      );
    }

    if (result.success && result.projectPath) {
      await this.featureLoader.updatePlanSpec(result.projectPath, featureId, {
        status: approved ? 'approved' : 'rejected',
        approvedAt: approved ? new Date().toISOString() : undefined,
        reviewedByUser: true,
        content: editedPlan,
      });
      if (!approved && feedback)
        this.planApproval.emitRejected(featureId, result.projectPath, feedback);
    }

    return result;
  }

  cancelPlanApproval(featureId: string): void {
    this.planApproval.cancel(featureId);
  }
  hasPendingApproval(featureId: string): boolean {
    return this.planApproval.hasPending(featureId);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private async handleApprovalRecovery(
    featureId: string,
    approved: boolean,
    editedPlan: string | undefined,
    feedback: string | undefined,
    projectPath: string
  ): Promise<{ success: boolean; error?: string }> {
    logger.debug(`Attempting approval recovery for feature ${featureId}`);
    const feature = await this.featureLoader.get(projectPath, featureId);
    if (feature?.planSpec?.status !== 'generated')
      return { success: false, error: `No pending approval for feature ${featureId}` };

    if (approved) {
      await this.featureLoader.updatePlanSpec(projectPath, featureId, {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        reviewedByUser: true,
        content: editedPlan || feature.planSpec.content,
      });
      const planContent = editedPlan || feature.planSpec.content || '';
      let continuationPrompt = `The plan/specification has been approved. `;
      if (feedback) continuationPrompt += `\n\nUser feedback: ${feedback}\n\n`;
      continuationPrompt += `Now proceed with the implementation:\n\n${planContent}`;
      this.executeFeature(projectPath, featureId, true, false, undefined, {
        continuationPrompt,
      }).catch((error) => logger.error(`Recovery execution failed for ${featureId}`, error));
    } else {
      await this.featureLoader.updatePlanSpec(projectPath, featureId, {
        status: 'rejected',
        reviewedByUser: true,
      });
      await this.featureLoader.updateStatus(projectPath, featureId, 'backlog');
      this.planApproval.emitRejected(featureId, projectPath, feedback);
    }

    return { success: true };
  }

  private async runAgent(
    workDir: string,
    featureId: string,
    prompt: string,
    abortController: AbortController,
    projectPath: string,
    imagePaths?: string[],
    model?: string,
    options?: RunAgentOptions
  ): Promise<void> {
    const planningMode = options?.planningMode || 'skip';
    const previousContent = options?.previousContent;
    const planningModeRequiresApproval =
      planningMode === 'spec' ||
      planningMode === 'full' ||
      (planningMode === 'lite' && options?.requirePlanApproval === true);
    const requiresApproval = planningModeRequiresApproval && options?.requirePlanApproval === true;

    if (process.env.AUTOMAKER_MOCK_AGENT === 'true')
      return this.runMockAgent(workDir, featureId, projectPath);

    const sdkOptions = createAutoModeOptions({ cwd: workDir, model, abortController });
    const finalModel = sdkOptions.model!;
    const maxTurns = sdkOptions.maxTurns || 100;
    const allowedTools = sdkOptions.allowedTools as string[] | undefined;

    logger.debug(
      `runAgent for ${featureId}: model=${finalModel}, planningMode=${planningMode}, requiresApproval=${requiresApproval}`
    );
    const provider = ProviderFactory.getProviderForModel(finalModel);
    const { content: promptContent } = await buildPromptWithImages(
      prompt,
      imagePaths,
      workDir,
      false
    );

    const featureDir = getFeatureDir(projectPath, featureId);
    const outputWriter = createFeatureOutputWriter(featureDir, previousContent);

    const executeOptions: ExecuteOptions = {
      prompt: promptContent,
      model: finalModel,
      maxTurns,
      cwd: workDir,
      allowedTools,
      abortController,
      systemPrompt: options?.systemPrompt,
    };
    const stream = provider.executeQuery(executeOptions);
    let specDetected = false;

    try {
      for await (const msg of stream) {
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              outputWriter.appendWithSeparator(block.text);
              if (
                planningModeRequiresApproval &&
                !specDetected &&
                outputWriter.getContent().includes('[SPEC_GENERATED]')
              ) {
                specDetected = true;
                const planContent = extractBeforeMarker(
                  outputWriter.getContent(),
                  '[SPEC_GENERATED]'
                );
                if (planContent) {
                  await this.handleSpecGenerated(
                    featureId,
                    projectPath,
                    planContent,
                    planningMode,
                    requiresApproval,
                    workDir,
                    finalModel,
                    maxTurns,
                    allowedTools,
                    abortController,
                    provider,
                    outputWriter
                  );
                  return;
                }
              }
              if (!specDetected)
                this.emitEvent('auto_mode_progress', { featureId, content: block.text });
            } else if (block.type === 'tool_use' && block.name) {
              this.emitEvent('auto_mode_tool', { featureId, tool: block.name, input: block.input });
              outputWriter.appendToolUse(block.name, block.input);
            }
          }
        } else if (msg.type === 'error') {
          throw new Error(msg.error || 'Unknown error');
        }
      }
    } finally {
      await outputWriter.flush();
    }
  }

  private async handleSpecGenerated(
    featureId: string,
    projectPath: string,
    planContent: string,
    planningMode: PlanningMode,
    requiresApproval: boolean,
    workDir: string,
    model: string,
    maxTurns: number,
    allowedTools: string[] | undefined,
    abortController: AbortController,
    provider: ReturnType<typeof ProviderFactory.getProviderForModel>,
    outputWriter: ReturnType<typeof createFeatureOutputWriter>
  ): Promise<void> {
    let parsedTasks = parseTasksFromSpec(planContent);

    await this.featureLoader.updatePlanSpec(projectPath, featureId, {
      status: 'generated',
      content: planContent,
      version: 1,
      generatedAt: new Date().toISOString(),
      reviewedByUser: false,
      tasks: parsedTasks,
      tasksTotal: parsedTasks.length,
      tasksCompleted: 0,
    });

    let approvedPlanContent = planContent;
    let userFeedback: string | undefined;

    if (requiresApproval) {
      this.planApproval.emitApprovalRequired(featureId, projectPath, planContent, planningMode, 1);
      const approvalResult = await this.planApproval.waitForApproval(featureId, projectPath);

      if (!approvalResult.approved) {
        if (!approvalResult.feedback?.trim()) throw new Error('Plan cancelled by user');
        throw new Error('Plan revision not yet implemented in refactored version');
      }

      approvedPlanContent = approvalResult.editedPlan || planContent;
      userFeedback = approvalResult.feedback;
      if (approvalResult.editedPlan) parsedTasks = parseTasksFromSpec(approvalResult.editedPlan);
      this.planApproval.emitApproved(featureId, projectPath, !!approvalResult.editedPlan, 1);
    } else {
      this.planApproval.emitAutoApproved(featureId, projectPath, planContent, planningMode);
    }

    await this.featureLoader.updatePlanSpec(projectPath, featureId, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      reviewedByUser: requiresApproval,
    });

    if (parsedTasks.length > 0) {
      const context: TaskExecutionContext = {
        workDir,
        featureId,
        projectPath,
        model,
        maxTurns,
        allowedTools,
        abortController,
        planContent: approvedPlanContent,
        userFeedback,
      };
      for await (const progress of this.taskExecutor.executeAll(parsedTasks, context, provider)) {
        await this.featureLoader.updatePlanSpec(projectPath, featureId, {
          tasksCompleted: progress.taskIndex + (progress.status === 'completed' ? 1 : 0),
          currentTaskId: progress.taskId,
        });
      }
    } else {
      const continuationPrompt = `The plan has been approved. Implement it:\n\n${approvedPlanContent}`;
      const continuationStream = provider.executeQuery({
        prompt: continuationPrompt,
        model,
        maxTurns,
        cwd: workDir,
        allowedTools,
        abortController,
      });
      await processStream(continuationStream, {
        onText: (text) => {
          outputWriter.append(text);
          this.emitEvent('auto_mode_progress', { featureId, content: text });
        },
        onToolUse: (name, input) => {
          this.emitEvent('auto_mode_tool', { featureId, tool: name, input });
        },
      });
    }

    await outputWriter.flush();
  }

  private async runMockAgent(
    workDir: string,
    featureId: string,
    projectPath: string
  ): Promise<void> {
    logger.info(`MOCK MODE: Skipping real agent for ${featureId}`);
    await sleep(500);
    this.emitEvent('auto_mode_progress', { featureId, content: 'Mock agent: Analyzing...' });
    await sleep(300);
    this.emitEvent('auto_mode_progress', { featureId, content: 'Mock agent: Implementing...' });
    await sleep(300);
    await secureFs.writeFile(path.join(workDir, 'yellow.txt'), 'yellow');

    const featureDir = getFeatureDir(projectPath, featureId);
    const outputPath = path.join(featureDir, 'agent-output.md');
    await secureFs.mkdir(path.dirname(outputPath), { recursive: true });
    await secureFs.writeFile(outputPath, '# Mock Agent Output\n\nThis is a mock response.');
    logger.info(`MOCK MODE: Completed for ${featureId}`);
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.events.emit('auto-mode:event', { type: eventType, ...data });
  }
}
