# Auto Mode Service Refactoring Plan

## Overview

This document proposes a refactoring of `apps/server/src/services/auto-mode-service.ts` (2,497 lines) into smaller, focused modules while leveraging shared packages per `docs/llm-shared-packages.md`.

## Current Problems

1. **Monolithic Service** - 2,497 lines with 16+ public methods mixing concerns
2. **Giant Method** - `runAgent()` is 658 lines handling planning, approval, task execution, file I/O
3. **Code Duplication** - Stream processing repeated 4x, types duplicated in 3 files
4. **Missing Shared Package Usage** - Local types that exist in `@automaker/types`, prompts not in `@automaker/prompts`
5. **No Structured Logging** - Uses `console.log` instead of `createLogger`
6. **Untyped Events** - Event strings scattered, no type safety

## Proposed Architecture

```
apps/server/src/services/
├── auto-mode/
│   ├── index.ts                    # Re-exports AutoModeService (facade)
│   ├── auto-mode-service.ts        # Orchestrator (~300 lines)
│   ├── feature-executor.ts         # Feature execution logic
│   ├── plan-approval-service.ts    # Plan approval flow
│   ├── task-executor.ts            # Multi-task execution
│   ├── worktree-manager.ts         # Git worktree operations
│   ├── output-writer.ts            # Incremental file writing
│   └── types.ts                    # Internal types (RunningFeature, etc.)
├── feature-loader.ts               # Existing - extend with status updates
└── ...

libs/types/src/
├── planning.ts                     # NEW: ParsedTask, PlanSpec, AutoModeEventType
├── feature.ts                      # Update: use PlanSpec from planning.ts
└── index.ts                        # Export planning types

libs/prompts/src/
├── planning.ts                     # NEW: PLANNING_PROMPTS, task parsing, buildTaskPrompt
├── enhancement.ts                  # Existing
└── index.ts                        # Export planning functions

apps/server/src/lib/
├── stream-processor.ts             # NEW: Reusable stream processing utility
└── ...
```

## Phase 1: Shared Package Updates (No Breaking Changes)

### 1.1 Add Planning Types to `@automaker/types`

Create `libs/types/src/planning.ts`:

```typescript
// Task and plan status types
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type PlanSpecStatus = 'pending' | 'generating' | 'generated' | 'approved' | 'rejected';

export interface ParsedTask {
  id: string; // e.g., "T001"
  description: string; // e.g., "Create user model"
  filePath?: string; // e.g., "src/models/user.ts"
  phase?: string; // e.g., "Phase 1: Foundation"
  status: TaskStatus;
}

export interface PlanSpec {
  status: PlanSpecStatus;
  content?: string;
  version: number;
  generatedAt?: string;
  approvedAt?: string;
  reviewedByUser: boolean;
  tasksCompleted?: number;
  tasksTotal?: number;
  currentTaskId?: string;
  tasks?: ParsedTask[];
}

// Auto-mode event types for type safety
export type AutoModeEventType =
  | 'auto_mode_started'
  | 'auto_mode_stopped'
  | 'auto_mode_idle'
  | 'auto_mode_feature_start'
  | 'auto_mode_feature_complete'
  | 'auto_mode_progress'
  | 'auto_mode_tool'
  | 'auto_mode_error'
  | 'auto_mode_task_started'
  | 'auto_mode_task_complete'
  | 'auto_mode_phase_complete'
  | 'planning_started'
  | 'plan_approval_required'
  | 'plan_approved'
  | 'plan_rejected'
  | 'plan_auto_approved'
  | 'plan_revision_requested';
```

Update `libs/types/src/feature.ts` to import `PlanSpec`:

```typescript
import type { PlanSpec } from './planning.js';

export interface Feature {
  // ... existing fields ...
  planSpec?: PlanSpec; // Now references shared type
}
```

### 1.2 Add Planning Prompts to `@automaker/prompts`

Create `libs/prompts/src/planning.ts`:

````typescript
import type { PlanningMode, ParsedTask } from '@automaker/types';

// Planning mode prompts (moved from auto-mode-service.ts lines 57-211)
export const PLANNING_PROMPTS = {
  lite: `## Planning Phase (Lite Mode)...`,
  lite_with_approval: `## Planning Phase (Lite Mode)...`,
  spec: `## Specification Phase (Spec Mode)...`,
  full: `## Full Specification Phase (Full SDD Mode)...`,
};

/**
 * Get planning prompt for a mode
 */
export function getPlanningPrompt(mode: PlanningMode, requireApproval?: boolean): string {
  if (mode === 'skip') return '';
  if (mode === 'lite' && requireApproval) return PLANNING_PROMPTS.lite_with_approval;
  return PLANNING_PROMPTS[mode] || '';
}

/**
 * Parse tasks from generated spec content
 * Looks for ```tasks code block and extracts task lines
 */
export function parseTasksFromSpec(specContent: string): ParsedTask[] {
  // ... moved from auto-mode-service.ts lines 218-265
}

/**
 * Parse a single task line
 * Format: - [ ] T###: Description | File: path/to/file
 */
export function parseTaskLine(line: string, currentPhase?: string): ParsedTask | null {
  // ... moved from auto-mode-service.ts lines 271-295
}

/**
 * Build a focused prompt for executing a single task
 */
export function buildTaskPrompt(
  task: ParsedTask,
  allTasks: ParsedTask[],
  taskIndex: number,
  planContent: string,
  userFeedback?: string
): string {
  // ... moved from auto-mode-service.ts lines 2389-2458
}
````

## Phase 2: Extract Utility Classes

### 2.1 Create Stream Processor

Create `apps/server/src/lib/stream-processor.ts`:

```typescript
import type { ProviderMessage } from '../providers/types.js';

export interface StreamHandlers {
  onText?: (text: string) => void;
  onToolUse?: (name: string, input: unknown) => void;
  onError?: (error: string) => void;
  onComplete?: (result: string) => void;
}

/**
 * Process provider message stream with unified handling
 * Eliminates the 4x duplicated stream processing pattern
 */
export async function* processStream(
  stream: AsyncGenerator<ProviderMessage>,
  handlers: StreamHandlers
): AsyncGenerator<{ text: string; isComplete: boolean }> {
  for await (const msg of stream) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          handlers.onText?.(block.text || '');
          yield { text: block.text || '', isComplete: false };
        } else if (block.type === 'tool_use') {
          handlers.onToolUse?.(block.name, block.input);
        }
      }
    } else if (msg.type === 'error') {
      handlers.onError?.(msg.error || 'Unknown error');
      throw new Error(msg.error || 'Unknown error');
    } else if (msg.type === 'result' && msg.subtype === 'success') {
      handlers.onComplete?.(msg.result || '');
      yield { text: msg.result || '', isComplete: true };
    }
  }
}
```

### 2.2 Create Output Writer

Create `apps/server/src/services/auto-mode/output-writer.ts`:

```typescript
import * as secureFs from '../../lib/secure-fs.js';
import path from 'path';

/**
 * Handles incremental, debounced file writing for agent output
 */
export class OutputWriter {
  private content = '';
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly outputPath: string,
    debounceMs = 500
  ) {
    this.debounceMs = debounceMs;
  }

  append(text: string): void {
    this.content += text;
    this.scheduleWrite();
  }

  getContent(): string {
    return this.content;
  }

  private scheduleWrite(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
    }
    this.writeTimeout = setTimeout(() => this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
    try {
      await secureFs.mkdir(path.dirname(this.outputPath), { recursive: true });
      await secureFs.writeFile(this.outputPath, this.content);
    } catch (error) {
      console.error(`[OutputWriter] Failed to write: ${error}`);
    }
  }
}
```

## Phase 3: Extract Service Classes

### 3.1 Plan Approval Service

Create `apps/server/src/services/auto-mode/plan-approval-service.ts`:

```typescript
import type { EventEmitter } from '../../lib/events.js';
import type { PlanSpec, AutoModeEventType } from '@automaker/types';
import { createLogger } from '@automaker/utils';

interface PendingApproval {
  resolve: (result: ApprovalResult) => void;
  reject: (error: Error) => void;
  featureId: string;
  projectPath: string;
}

interface ApprovalResult {
  approved: boolean;
  editedPlan?: string;
  feedback?: string;
}

const logger = createLogger('PlanApprovalService');

export class PlanApprovalService {
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(private events: EventEmitter) {}

  waitForApproval(featureId: string, projectPath: string): Promise<ApprovalResult> {
    logger.debug(`Registering pending approval for feature ${featureId}`);
    return new Promise((resolve, reject) => {
      this.pendingApprovals.set(featureId, { resolve, reject, featureId, projectPath });
    });
  }

  async resolve(
    featureId: string,
    approved: boolean,
    editedPlan?: string,
    feedback?: string
  ): Promise<{ success: boolean; error?: string }> {
    const pending = this.pendingApprovals.get(featureId);
    if (!pending) {
      return { success: false, error: `No pending approval for ${featureId}` };
    }

    pending.resolve({ approved, editedPlan, feedback });
    this.pendingApprovals.delete(featureId);
    return { success: true };
  }

  cancel(featureId: string): void {
    const pending = this.pendingApprovals.get(featureId);
    if (pending) {
      pending.reject(new Error('Plan approval cancelled'));
      this.pendingApprovals.delete(featureId);
    }
  }

  hasPending(featureId: string): boolean {
    return this.pendingApprovals.has(featureId);
  }
}
```

### 3.2 Task Executor

Create `apps/server/src/services/auto-mode/task-executor.ts`:

```typescript
import type { ExecuteOptions, ParsedTask } from '@automaker/types';
import type { EventEmitter } from '../../lib/events.js';
import type { BaseProvider } from '../../providers/base-provider.js';
import { buildTaskPrompt } from '@automaker/prompts';
import { createLogger } from '@automaker/utils';

const logger = createLogger('TaskExecutor');

interface TaskExecutionContext {
  workDir: string;
  featureId: string;
  projectPath: string;
  provider: BaseProvider;
  model: string;
  maxTurns: number;
  allowedTools?: string[];
  abortController: AbortController;
  planContent: string;
  userFeedback?: string;
}

interface TaskProgress {
  taskId: string;
  taskIndex: number;
  tasksTotal: number;
  status: 'started' | 'completed' | 'failed';
  output?: string;
  phaseComplete?: number;
}

export class TaskExecutor {
  constructor(private events: EventEmitter) {}

  async *executeAll(
    tasks: ParsedTask[],
    context: TaskExecutionContext
  ): AsyncGenerator<TaskProgress> {
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex];

      if (context.abortController.signal.aborted) {
        throw new Error('Feature execution aborted');
      }

      logger.info(`Starting task ${task.id}: ${task.description}`);
      yield {
        taskId: task.id,
        taskIndex,
        tasksTotal: tasks.length,
        status: 'started',
      };

      const taskPrompt = buildTaskPrompt(
        task,
        tasks,
        taskIndex,
        context.planContent,
        context.userFeedback
      );

      const taskStream = context.provider.executeQuery({
        prompt: taskPrompt,
        model: context.model,
        maxTurns: Math.min(context.maxTurns, 50),
        cwd: context.workDir,
        allowedTools: context.allowedTools,
        abortController: context.abortController,
      });

      let taskOutput = '';
      for await (const msg of taskStream) {
        // Process stream messages...
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              taskOutput += block.text || '';
              this.events.emit('auto-mode:event', {
                type: 'auto_mode_progress',
                featureId: context.featureId,
                content: block.text,
              });
            }
          }
        }
      }

      logger.info(`Task ${task.id} completed`);
      yield {
        taskId: task.id,
        taskIndex,
        tasksTotal: tasks.length,
        status: 'completed',
        output: taskOutput,
        phaseComplete: this.checkPhaseComplete(task, tasks, taskIndex),
      };
    }
  }

  private checkPhaseComplete(
    task: ParsedTask,
    allTasks: ParsedTask[],
    taskIndex: number
  ): number | undefined {
    if (!task.phase) return undefined;

    const nextTask = allTasks[taskIndex + 1];
    if (!nextTask || nextTask.phase !== task.phase) {
      const phaseMatch = task.phase.match(/Phase\s*(\d+)/i);
      return phaseMatch ? parseInt(phaseMatch[1], 10) : undefined;
    }
    return undefined;
  }
}
```

### 3.3 Worktree Manager

Create `apps/server/src/services/auto-mode/worktree-manager.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { createLogger } from '@automaker/utils';

const execAsync = promisify(exec);
const logger = createLogger('WorktreeManager');

export class WorktreeManager {
  /**
   * Find existing worktree path for a branch
   */
  async findWorktreeForBranch(projectPath: string, branchName: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: projectPath,
      });

      const lines = stdout.split('\n');
      let currentPath: string | null = null;
      let currentBranch: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.slice(9);
        } else if (line.startsWith('branch ')) {
          currentBranch = line.slice(7).replace('refs/heads/', '');
        } else if (line === '' && currentPath && currentBranch) {
          if (currentBranch === branchName) {
            return path.isAbsolute(currentPath)
              ? path.resolve(currentPath)
              : path.resolve(projectPath, currentPath);
          }
          currentPath = null;
          currentBranch = null;
        }
      }

      // Check last entry
      if (currentPath && currentBranch === branchName) {
        return path.isAbsolute(currentPath)
          ? path.resolve(currentPath)
          : path.resolve(projectPath, currentPath);
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to find worktree for branch ${branchName}: ${error}`);
      return null;
    }
  }

  /**
   * Resolve working directory for feature execution
   */
  async resolveWorkDir(
    projectPath: string,
    branchName: string | undefined,
    useWorktrees: boolean
  ): Promise<{ workDir: string; worktreePath: string | null }> {
    let worktreePath: string | null = null;

    if (useWorktrees && branchName) {
      worktreePath = await this.findWorktreeForBranch(projectPath, branchName);
      if (worktreePath) {
        logger.info(`Using worktree for branch "${branchName}": ${worktreePath}`);
      } else {
        logger.warn(`Worktree for branch "${branchName}" not found, using project path`);
      }
    }

    const workDir = worktreePath ? path.resolve(worktreePath) : path.resolve(projectPath);
    return { workDir, worktreePath };
  }
}
```

## Phase 4: Refactor AutoModeService

### 4.1 Simplified AutoModeService

The refactored `auto-mode-service.ts` (~300-400 lines) becomes an orchestrator:

```typescript
import type { Feature, ExecuteOptions, PlanSpec, ParsedTask } from '@automaker/types';
import { createLogger, classifyError, buildPromptWithImages, loadContextFiles } from '@automaker/utils';
import { resolveModelString, DEFAULT_MODELS } from '@automaker/model-resolver';
import { getPlanningPrompt, parseTasksFromSpec } from '@automaker/prompts';
import { getFeatureDir } from '@automaker/platform';
import { ProviderFactory } from '../providers/provider-factory.js';
import { validateWorkingDirectory } from '../lib/sdk-options.js';
import type { EventEmitter } from '../lib/events.js';

import { PlanApprovalService } from './auto-mode/plan-approval-service.js';
import { TaskExecutor } from './auto-mode/task-executor.js';
import { WorktreeManager } from './auto-mode/worktree-manager.js';
import { OutputWriter } from './auto-mode/output-writer.js';
import { FeatureLoader } from './feature-loader.js';

const logger = createLogger('AutoModeService');

export class AutoModeService {
  private events: EventEmitter;
  private runningFeatures = new Map<string, RunningFeature>();
  private featureLoader = new FeatureLoader();
  private planApproval: PlanApprovalService;
  private taskExecutor: TaskExecutor;
  private worktreeManager: WorktreeManager;

  constructor(events: EventEmitter) {
    this.events = events;
    this.planApproval = new PlanApprovalService(events);
    this.taskExecutor = new TaskExecutor(events);
    this.worktreeManager = new WorktreeManager();
  }

  // Public methods remain the same API, but delegate to sub-services
  async executeFeature(...): Promise<void> {
    // Validation
    validateWorkingDirectory(projectPath);

    // Resolve work directory via WorktreeManager
    const { workDir, worktreePath } = await this.worktreeManager.resolveWorkDir(
      projectPath, feature.branchName, useWorktrees
    );

    // Build prompt (simplified)
    const prompt = getPlanningPrompt(feature.planningMode, feature.requirePlanApproval)
      + this.buildFeaturePrompt(feature);

    // Execute agent (delegated to runAgent which uses TaskExecutor)
    await this.runAgent(workDir, featureId, prompt, ...);
  }

  // Plan approval delegated to PlanApprovalService
  waitForPlanApproval = this.planApproval.waitForApproval.bind(this.planApproval);
  resolvePlanApproval = this.planApproval.resolve.bind(this.planApproval);
  cancelPlanApproval = this.planApproval.cancel.bind(this.planApproval);
  hasPendingApproval = this.planApproval.hasPending.bind(this.planApproval);
}
```

## File Changes Summary

### New Files to Create

| File                                                          | Purpose                    | Est. Lines |
| ------------------------------------------------------------- | -------------------------- | ---------- |
| `libs/types/src/planning.ts`                                  | Planning types             | ~50        |
| `libs/prompts/src/planning.ts`                                | Planning prompts & parsing | ~200       |
| `apps/server/src/lib/stream-processor.ts`                     | Stream utility             | ~50        |
| `apps/server/src/services/auto-mode/index.ts`                 | Re-exports                 | ~10        |
| `apps/server/src/services/auto-mode/plan-approval-service.ts` | Approval logic             | ~100       |
| `apps/server/src/services/auto-mode/task-executor.ts`         | Task execution             | ~150       |
| `apps/server/src/services/auto-mode/worktree-manager.ts`      | Git worktrees              | ~80        |
| `apps/server/src/services/auto-mode/output-writer.ts`         | File I/O                   | ~60        |
| `apps/server/src/services/auto-mode/types.ts`                 | Internal types             | ~40        |

### Files to Modify

| File                                                    | Changes                            |
| ------------------------------------------------------- | ---------------------------------- |
| `libs/types/src/index.ts`                               | Export planning types              |
| `libs/types/src/feature.ts`                             | Import PlanSpec                    |
| `libs/prompts/src/index.ts`                             | Export planning functions          |
| `apps/server/src/services/auto-mode-service.ts`         | Refactor to orchestrator           |
| `apps/ui/src/store/app-store.ts`                        | Import types from @automaker/types |
| `apps/ui/src/components/.../planning-mode-selector.tsx` | Import PlanningMode                |
| `apps/server/tests/.../auto-mode-task-parsing.test.ts`  | Import from @automaker/prompts     |

### Files to Delete (after refactoring)

None - old file becomes the slim orchestrator.

## Verification Checklist

After refactoring, verify:

- [ ] `npm run build:packages` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run test:packages` passes
- [ ] `npm run test:server` passes
- [ ] `npm run test` (E2E) passes
- [ ] Feature execution works in UI
- [ ] Plan approval flow works (spec/full modes)
- [ ] Task progress events appear correctly
- [ ] Resume feature works
- [ ] Follow-up feature works

## Migration Strategy

1. **Phase 1**: Add shared package updates (non-breaking)
2. **Phase 2**: Extract utilities (stream-processor, output-writer)
3. **Phase 3**: Extract services one at a time, keeping old code as fallback
4. **Phase 4**: Wire up orchestrator, remove old code
5. **Phase 5**: Update tests to use new imports

Each phase should be a separate PR for easier review.

## Benefits

| Metric           | Before               | After                |
| ---------------- | -------------------- | -------------------- |
| Main file lines  | 2,497                | ~400                 |
| Largest method   | 658 lines            | ~100 lines           |
| Code duplication | 4x stream processing | 1 utility            |
| Type safety      | None for events      | Full                 |
| Testability      | Hard (monolith)      | Easy (focused units) |
| Logging          | console.log          | createLogger         |

## Open Questions

1. Should `startAutoLoop`/`stopAutoLoop` remain in AutoModeService or become a separate `AutoLoopService`?
2. Should we add a `FeatureRepository` class to consolidate all feature file operations?
3. Is the recovery mechanism in `resolvePlanApproval` still needed with the refactored architecture?
