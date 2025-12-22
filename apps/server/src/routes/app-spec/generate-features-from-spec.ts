/**
 * Generate features from existing app_spec.txt
 *
 * Uses ClaudeProvider.executeStreamingQuery() for SDK interaction.
 */

import type { EventEmitter } from '../../lib/events.js';
import { createLogger } from '@automaker/utils';
import { ProviderFactory } from '../../providers/provider-factory.js';
import { parseAndCreateFeatures } from './parse-and-create-features.js';
import { getAppSpecPath, secureFs } from '@automaker/platform';

const logger = createLogger('SpecRegeneration');

const DEFAULT_MAX_FEATURES = 50;

export async function generateFeaturesFromSpec(
  projectPath: string,
  events: EventEmitter,
  abortController: AbortController,
  maxFeatures?: number
): Promise<void> {
  const featureCount = maxFeatures ?? DEFAULT_MAX_FEATURES;
  logger.debug('========== generateFeaturesFromSpec() started ==========');
  logger.debug('projectPath:', projectPath);
  logger.debug('maxFeatures:', featureCount);

  // Read existing spec from .automaker directory
  const specPath = getAppSpecPath(projectPath);
  let spec: string;

  logger.debug('Reading spec from:', specPath);

  try {
    spec = (await secureFs.readFile(specPath, 'utf-8')) as string;
    logger.info(`Spec loaded successfully (${spec.length} chars)`);
    logger.info(`Spec preview (first 500 chars): ${spec.substring(0, 500)}`);
    logger.info(`Spec preview (last 500 chars): ${spec.substring(spec.length - 500)}`);
  } catch (readError) {
    logger.error('❌ Failed to read spec file:', readError);
    events.emit('spec-regeneration:event', {
      type: 'spec_regeneration_error',
      error: 'No project spec found. Generate spec first.',
      projectPath: projectPath,
    });
    return;
  }

  const prompt = `Based on this project specification:

${spec}

Generate a prioritized list of implementable features. For each feature provide:

1. **id**: A unique lowercase-hyphenated identifier
2. **category**: Functional category (e.g., "Core", "UI", "API", "Authentication", "Database")
3. **title**: Short descriptive title
4. **description**: What this feature does (2-3 sentences)
5. **priority**: 1 (high), 2 (medium), or 3 (low)
6. **complexity**: "simple", "moderate", or "complex"
7. **dependencies**: Array of feature IDs this depends on (can be empty)

Format as JSON:
{
  "features": [
    {
      "id": "feature-id",
      "category": "Feature Category",
      "title": "Feature Title",
      "description": "What it does",
      "priority": 1,
      "complexity": "moderate",
      "dependencies": []
    }
  ]
}

Generate ${featureCount} features that build on each other logically.

IMPORTANT: Do not ask for clarification. The specification is provided above. Generate the JSON immediately.`;

  logger.info('========== PROMPT BEING SENT ==========');
  logger.info(`Prompt length: ${prompt.length} chars`);
  logger.info(`Prompt preview (first 1000 chars):\n${prompt.substring(0, 1000)}`);
  logger.info('========== END PROMPT PREVIEW ==========');

  events.emit('spec-regeneration:event', {
    type: 'spec_regeneration_progress',
    content: 'Analyzing spec and generating features...\n',
    projectPath: projectPath,
  });

  logger.info('Calling provider.executeStreamingQuery() for features...');

  const provider = ProviderFactory.getProviderForModel('haiku');
  const result = await provider.executeStreamingQuery({
    prompt,
    model: 'haiku',
    cwd: projectPath,
    maxTurns: 50,
    allowedTools: ['Read', 'Glob', 'Grep'],
    abortController,
    onText: (text) => {
      logger.debug(`Feature text block received (${text.length} chars)`);
      events.emit('spec-regeneration:event', {
        type: 'spec_regeneration_progress',
        content: text,
        projectPath: projectPath,
      });
    },
  });

  if (!result.success) {
    logger.error('❌ Feature generation failed:', result.error);
    throw new Error(result.error || 'Feature generation failed');
  }

  logger.info(`Feature response length: ${result.text.length} chars`);
  logger.info('========== FULL RESPONSE TEXT ==========');
  logger.info(result.text);
  logger.info('========== END RESPONSE TEXT ==========');

  await parseAndCreateFeatures(projectPath, result.text, events);

  logger.debug('========== generateFeaturesFromSpec() completed ==========');
}
