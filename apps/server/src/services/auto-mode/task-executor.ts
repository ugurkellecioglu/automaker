/**
 * Task Executor - Multi-agent task execution for spec-driven development
 *
 * Handles the sequential execution of parsed tasks from a spec,
 * where each task gets its own focused agent call.
 */

import type { ExecuteOptions, ParsedTask } from '@automaker/types';
import type { EventEmitter } from '../../lib/events.js';
import type { BaseProvider } from '../../providers/base-provider.js';
import { buildTaskPrompt } from '@automaker/prompts';
import { createLogger, processStream } from '@automaker/utils';
import type { TaskExecutionContext, TaskProgress } from './types.js';

const logger = createLogger('TaskExecutor');

/**
 * Handles multi-agent task execution for spec-driven development
 */
export class TaskExecutor {
  private events: EventEmitter;

  constructor(events: EventEmitter) {
    this.events = events;
  }

  /**
   * Execute all tasks sequentially
   *
   * Each task gets its own focused agent call with context about
   * completed and remaining tasks.
   *
   * @param tasks - Parsed tasks from the spec
   * @param context - Execution context including provider, model, etc.
   * @param provider - The provider to use for execution
   * @yields TaskProgress events for each task
   */
  async *executeAll(
    tasks: ParsedTask[],
    context: TaskExecutionContext,
    provider: BaseProvider
  ): AsyncGenerator<TaskProgress> {
    logger.info(
      `Starting multi-agent execution: ${tasks.length} tasks for feature ${context.featureId}`
    );

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex];

      // Check for abort
      if (context.abortController.signal.aborted) {
        throw new Error('Feature execution aborted');
      }

      // Emit task started
      logger.info(`Starting task ${task.id}: ${task.description}`);
      this.emitTaskEvent('auto_mode_task_started', context, {
        taskId: task.id,
        taskDescription: task.description,
        taskIndex,
        tasksTotal: tasks.length,
      });

      yield {
        taskId: task.id,
        taskIndex,
        tasksTotal: tasks.length,
        status: 'started',
      };

      // Build focused prompt for this task
      const taskPrompt = buildTaskPrompt(
        task,
        tasks,
        taskIndex,
        context.planContent,
        context.userFeedback
      );

      // Execute task with dedicated agent call
      const taskOptions: ExecuteOptions = {
        prompt: taskPrompt,
        model: context.model,
        maxTurns: Math.min(context.maxTurns, 50), // Limit turns per task
        cwd: context.workDir,
        allowedTools: context.allowedTools,
        abortController: context.abortController,
      };

      const taskStream = provider.executeQuery(taskOptions);

      // Process task stream
      let taskOutput = '';
      try {
        const result = await processStream(taskStream, {
          onText: (text) => {
            taskOutput += text;
            this.emitProgressEvent(context.featureId, text);
          },
          onToolUse: (name, input) => {
            this.emitToolEvent(context.featureId, name, input);
          },
        });
        taskOutput = result.text;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Task ${task.id} failed: ${errorMessage}`);
        yield {
          taskId: task.id,
          taskIndex,
          tasksTotal: tasks.length,
          status: 'failed',
          output: errorMessage,
        };
        throw error;
      }

      // Emit task completed
      logger.info(`Task ${task.id} completed for feature ${context.featureId}`);
      this.emitTaskEvent('auto_mode_task_complete', context, {
        taskId: task.id,
        tasksCompleted: taskIndex + 1,
        tasksTotal: tasks.length,
      });

      // Check for phase completion
      const phaseComplete = this.checkPhaseComplete(task, tasks, taskIndex);

      yield {
        taskId: task.id,
        taskIndex,
        tasksTotal: tasks.length,
        status: 'completed',
        output: taskOutput,
        phaseComplete,
      };

      // Emit phase complete if needed
      if (phaseComplete !== undefined) {
        this.emitPhaseComplete(context, phaseComplete);
      }
    }

    logger.info(`All ${tasks.length} tasks completed for feature ${context.featureId}`);
  }

  /**
   * Execute a single task (for cases where you don't need the full loop)
   *
   * @param task - The task to execute
   * @param allTasks - All tasks for context
   * @param taskIndex - Index of this task
   * @param context - Execution context
   * @param provider - The provider to use
   * @returns Task output text
   */
  async executeOne(
    task: ParsedTask,
    allTasks: ParsedTask[],
    taskIndex: number,
    context: TaskExecutionContext,
    provider: BaseProvider
  ): Promise<string> {
    const taskPrompt = buildTaskPrompt(
      task,
      allTasks,
      taskIndex,
      context.planContent,
      context.userFeedback
    );

    const taskOptions: ExecuteOptions = {
      prompt: taskPrompt,
      model: context.model,
      maxTurns: Math.min(context.maxTurns, 50),
      cwd: context.workDir,
      allowedTools: context.allowedTools,
      abortController: context.abortController,
    };

    const taskStream = provider.executeQuery(taskOptions);

    const result = await processStream(taskStream, {
      onText: (text) => {
        this.emitProgressEvent(context.featureId, text);
      },
      onToolUse: (name, input) => {
        this.emitToolEvent(context.featureId, name, input);
      },
    });

    return result.text;
  }

  /**
   * Check if completing this task completes a phase
   */
  private checkPhaseComplete(
    task: ParsedTask,
    allTasks: ParsedTask[],
    taskIndex: number
  ): number | undefined {
    if (!task.phase) {
      return undefined;
    }

    const nextTask = allTasks[taskIndex + 1];
    if (!nextTask || nextTask.phase !== task.phase) {
      // Phase changed or no more tasks
      const phaseMatch = task.phase.match(/Phase\s*(\d+)/i);
      return phaseMatch ? parseInt(phaseMatch[1], 10) : undefined;
    }

    return undefined;
  }

  /**
   * Emit a task-related event
   */
  private emitTaskEvent(
    eventType: string,
    context: TaskExecutionContext,
    data: Record<string, unknown>
  ): void {
    this.events.emit('auto-mode:event', {
      type: eventType,
      featureId: context.featureId,
      projectPath: context.projectPath,
      ...data,
    });
  }

  /**
   * Emit progress event for text output
   */
  private emitProgressEvent(featureId: string, content: string): void {
    this.events.emit('auto-mode:event', {
      type: 'auto_mode_progress',
      featureId,
      content,
    });
  }

  /**
   * Emit tool use event
   */
  private emitToolEvent(featureId: string, tool: string, input: unknown): void {
    this.events.emit('auto-mode:event', {
      type: 'auto_mode_tool',
      featureId,
      tool,
      input,
    });
  }

  /**
   * Emit phase complete event
   */
  private emitPhaseComplete(context: TaskExecutionContext, phaseNumber: number): void {
    this.events.emit('auto-mode:event', {
      type: 'auto_mode_phase_complete',
      featureId: context.featureId,
      projectPath: context.projectPath,
      phaseNumber,
    });
  }
}
