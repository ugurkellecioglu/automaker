/**
 * Project Analyzer - Analyzes project structure and context
 *
 * Provides project analysis functionality using Claude to understand
 * codebase architecture, patterns, and conventions.
 */

import type { ExecuteOptions } from '@automaker/types';
import { createLogger, classifyError, processStream } from '@automaker/utils';
import { resolveModelString, DEFAULT_MODELS } from '@automaker/model-resolver';
import { getAutomakerDir, secureFs } from '@automaker/platform';
import { ProviderFactory } from '../../providers/provider-factory.js';
import { validateWorkingDirectory } from '../../lib/sdk-options.js';
import path from 'path';
import type { EventEmitter } from '../../lib/events.js';

const logger = createLogger('ProjectAnalyzer');

const ANALYSIS_PROMPT = `Analyze this project and provide a summary of:
1. Project structure and architecture
2. Main technologies and frameworks used
3. Key components and their responsibilities
4. Build and test commands
5. Any existing conventions or patterns

Format your response as a structured markdown document.`;

export class ProjectAnalyzer {
  private events: EventEmitter;

  constructor(events: EventEmitter) {
    this.events = events;
  }

  /**
   * Analyze project to gather context
   */
  async analyze(projectPath: string): Promise<void> {
    validateWorkingDirectory(projectPath);

    const abortController = new AbortController();
    const analysisFeatureId = `analysis-${Date.now()}`;

    this.emitEvent('auto_mode_feature_start', {
      featureId: analysisFeatureId,
      projectPath,
      feature: {
        id: analysisFeatureId,
        title: 'Project Analysis',
        description: 'Analyzing project structure',
      },
    });

    try {
      const analysisModel = resolveModelString(undefined, DEFAULT_MODELS.claude);
      const provider = ProviderFactory.getProviderForModel(analysisModel);

      const options: ExecuteOptions = {
        prompt: ANALYSIS_PROMPT,
        model: analysisModel,
        maxTurns: 5,
        cwd: projectPath,
        allowedTools: ['Read', 'Glob', 'Grep'],
        abortController,
      };

      const stream = provider.executeQuery(options);
      let analysisResult = '';

      const result = await processStream(stream, {
        onText: (text) => {
          analysisResult += text;
          this.emitEvent('auto_mode_progress', {
            featureId: analysisFeatureId,
            content: text,
            projectPath,
          });
        },
      });

      analysisResult = result.text || analysisResult;

      // Save analysis
      const automakerDir = getAutomakerDir(projectPath);
      const analysisPath = path.join(automakerDir, 'project-analysis.md');
      await secureFs.mkdir(automakerDir, { recursive: true });
      await secureFs.writeFile(analysisPath, analysisResult);

      this.emitEvent('auto_mode_feature_complete', {
        featureId: analysisFeatureId,
        passes: true,
        message: 'Project analysis completed',
        projectPath,
      });
    } catch (error) {
      const errorInfo = classifyError(error);
      this.emitEvent('auto_mode_error', {
        featureId: analysisFeatureId,
        error: errorInfo.message,
        errorType: errorInfo.type,
        projectPath,
      });
    }
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.events.emit('auto-mode:event', { type: eventType, ...data });
  }
}
