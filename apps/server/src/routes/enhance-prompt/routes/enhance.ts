/**
 * POST /enhance-prompt endpoint - Enhance user input text
 *
 * Uses Claude AI via ClaudeProvider to enhance text based on the specified
 * enhancement mode. Supports modes: improve, technical, simplify, acceptance
 */

import type { Request, Response } from 'express';
import { createLogger } from '@automaker/utils';
import { ProviderFactory } from '../../../providers/provider-factory.js';
import {
  getSystemPrompt,
  buildUserPrompt,
  isValidEnhancementMode,
  type EnhancementMode,
} from '@automaker/prompts';

const logger = createLogger('EnhancePrompt');

/**
 * Request body for the enhance endpoint
 */
interface EnhanceRequestBody {
  /** The original text to enhance */
  originalText: string;
  /** The enhancement mode to apply */
  enhancementMode: string;
  /** Optional model override */
  model?: string;
}

/**
 * Success response from the enhance endpoint
 */
interface EnhanceSuccessResponse {
  success: true;
  enhancedText: string;
}

/**
 * Error response from the enhance endpoint
 */
interface EnhanceErrorResponse {
  success: false;
  error: string;
}

/**
 * Create the enhance request handler
 *
 * @returns Express request handler for text enhancement
 */
export function createEnhanceHandler(): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { originalText, enhancementMode, model } = req.body as EnhanceRequestBody;

      // Validate required fields
      if (!originalText || typeof originalText !== 'string') {
        const response: EnhanceErrorResponse = {
          success: false,
          error: 'originalText is required and must be a string',
        };
        res.status(400).json(response);
        return;
      }

      if (!enhancementMode || typeof enhancementMode !== 'string') {
        const response: EnhanceErrorResponse = {
          success: false,
          error: 'enhancementMode is required and must be a string',
        };
        res.status(400).json(response);
        return;
      }

      // Validate text is not empty
      const trimmedText = originalText.trim();
      if (trimmedText.length === 0) {
        const response: EnhanceErrorResponse = {
          success: false,
          error: 'originalText cannot be empty',
        };
        res.status(400).json(response);
        return;
      }

      // Validate and normalize enhancement mode
      const normalizedMode = enhancementMode.toLowerCase();
      const validMode: EnhancementMode = isValidEnhancementMode(normalizedMode)
        ? normalizedMode
        : 'improve';

      logger.info(`Enhancing text with mode: ${validMode}, length: ${trimmedText.length} chars`);

      // Get the system prompt for this mode
      const systemPrompt = getSystemPrompt(validMode);

      // Build the user prompt with few-shot examples
      const userPrompt = buildUserPrompt(validMode, trimmedText, true);

      const provider = ProviderFactory.getProviderForModel(model || 'sonnet');
      const result = await provider.executeSimpleQuery({
        prompt: userPrompt,
        model: model || 'sonnet',
        systemPrompt,
      });

      if (!result.success) {
        logger.warn('Failed to enhance text:', result.error);
        const response: EnhanceErrorResponse = {
          success: false,
          error: result.error || 'Failed to generate enhanced text',
        };
        res.status(500).json(response);
        return;
      }

      logger.info(`Enhancement complete, output length: ${result.text.length} chars`);

      const response: EnhanceSuccessResponse = {
        success: true,
        enhancedText: result.text,
      };
      res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error('Enhancement failed:', errorMessage);

      const response: EnhanceErrorResponse = {
        success: false,
        error: errorMessage,
      };
      res.status(500).json(response);
    }
  };
}
