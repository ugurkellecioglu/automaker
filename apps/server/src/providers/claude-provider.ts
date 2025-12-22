/**
 * Claude Provider - Executes queries using Claude Agent SDK
 *
 * Wraps the @anthropic-ai/claude-agent-sdk for seamless integration
 * with the provider architecture.
 *
 * Provides two query methods:
 * - executeQuery(): Streaming async generator for complex multi-turn sessions
 * - executeSimpleQuery(): One-shot queries that return text directly (title gen, descriptions, etc.)
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { BaseProvider } from './base-provider.js';
import { resolveModelString } from '@automaker/model-resolver';
import { CLAUDE_MODEL_MAP } from '@automaker/types';
import type {
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
  SimpleQueryOptions,
  SimpleQueryResult,
  StreamingQueryOptions,
  StreamingQueryResult,
  PromptContentBlock,
} from './types.js';

export class ClaudeProvider extends BaseProvider {
  getName(): string {
    return 'claude';
  }

  /**
   * Execute a query using Claude Agent SDK
   */
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const {
      prompt,
      model,
      cwd,
      systemPrompt,
      maxTurns = 20,
      allowedTools,
      abortController,
      conversationHistory,
      sdkSessionId,
    } = options;

    // Build Claude SDK options
    const defaultTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'];
    const toolsToUse = allowedTools || defaultTools;

    const sdkOptions: Options = {
      model,
      systemPrompt,
      maxTurns,
      cwd,
      allowedTools: toolsToUse,
      permissionMode: 'acceptEdits',
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
      },
      abortController,
      // Resume existing SDK session if we have a session ID
      ...(sdkSessionId && conversationHistory && conversationHistory.length > 0
        ? { resume: sdkSessionId }
        : {}),
    };

    // Build prompt payload
    let promptPayload: string | AsyncIterable<any>;

    if (Array.isArray(prompt)) {
      // Multi-part prompt (with images)
      promptPayload = (async function* () {
        const multiPartPrompt = {
          type: 'user' as const,
          session_id: '',
          message: {
            role: 'user' as const,
            content: prompt,
          },
          parent_tool_use_id: null,
        };
        yield multiPartPrompt;
      })();
    } else {
      // Simple text prompt
      promptPayload = prompt;
    }

    // Execute via Claude Agent SDK
    try {
      const stream = query({ prompt: promptPayload, options: sdkOptions });

      // Stream messages directly - they're already in the correct format
      for await (const msg of stream) {
        yield msg as ProviderMessage;
      }
    } catch (error) {
      console.error('[ClaudeProvider] executeQuery() error during execution:', error);
      throw error;
    }
  }

  /**
   * Detect Claude SDK installation (always available via npm)
   */
  async detectInstallation(): Promise<InstallationStatus> {
    // Claude SDK is always available since it's a dependency
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    const status: InstallationStatus = {
      installed: true,
      method: 'sdk',
      hasApiKey,
      authenticated: hasApiKey,
    };

    return status;
  }

  /**
   * Get available Claude models
   */
  getAvailableModels(): ModelDefinition[] {
    const models = [
      {
        id: 'claude-opus-4-5-20251101',
        name: 'Claude Opus 4.5',
        modelString: 'claude-opus-4-5-20251101',
        provider: 'anthropic',
        description: 'Most capable Claude model',
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsVision: true,
        supportsTools: true,
        tier: 'premium' as const,
        default: true,
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        modelString: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        description: 'Balanced performance and cost',
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsVision: true,
        supportsTools: true,
        tier: 'standard' as const,
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        modelString: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        description: 'Fast and capable',
        contextWindow: 200000,
        maxOutputTokens: 8000,
        supportsVision: true,
        supportsTools: true,
        tier: 'standard' as const,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        modelString: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        description: 'Fastest Claude model',
        contextWindow: 200000,
        maxOutputTokens: 8000,
        supportsVision: true,
        supportsTools: true,
        tier: 'basic' as const,
      },
    ] satisfies ModelDefinition[];
    return models;
  }

  /**
   * Check if the provider supports a specific feature
   */
  supportsFeature(feature: string): boolean {
    const supportedFeatures = ['tools', 'text', 'vision', 'thinking'];
    return supportedFeatures.includes(feature);
  }

  /**
   * Execute a simple one-shot query and return text directly
   *
   * Use this for:
   * - Title generation from description
   * - Text enhancement
   * - File/image description
   * - Any quick, single-turn completion without tools
   *
   * @example
   * ```typescript
   * const provider = ProviderFactory.getProviderForModel('haiku');
   * const result = await provider.executeSimpleQuery({
   *   prompt: 'Generate a title for: User authentication feature',
   *   systemPrompt: 'You are a title generator...',
   * });
   * if (result.success) console.log(result.text);
   * ```
   */
  async executeSimpleQuery(options: SimpleQueryOptions): Promise<SimpleQueryResult> {
    const { prompt, model, systemPrompt, abortController } = options;

    const resolvedModel = resolveModelString(model, CLAUDE_MODEL_MAP.haiku);

    try {
      const sdkOptions: Options = {
        model: resolvedModel,
        systemPrompt,
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'acceptEdits',
        abortController,
      };

      // Handle both string prompts and multi-part content blocks
      const stream = Array.isArray(prompt)
        ? query({ prompt: this.createPromptGenerator(prompt), options: sdkOptions })
        : query({ prompt, options: sdkOptions });
      const { text } = await this.extractTextFromStream(stream);

      if (!text || text.trim().length === 0) {
        return {
          text: '',
          success: false,
          error: 'Empty response from Claude',
        };
      }

      return {
        text: text.trim(),
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ClaudeProvider] executeSimpleQuery() error:', errorMessage);
      return {
        text: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a streaming query with tools and/or structured output
   *
   * Use this for:
   * - Spec generation (with JSON schema output)
   * - Feature generation from specs
   * - Suggestions generation
   * - Any query that needs tools or progress callbacks
   *
   * @example
   * ```typescript
   * const provider = ProviderFactory.getProviderForModel('opus');
   * const result = await provider.executeStreamingQuery({
   *   prompt: 'Analyze this project...',
   *   cwd: '/path/to/project',
   *   allowedTools: ['Read', 'Glob', 'Grep'],
   *   outputFormat: { type: 'json_schema', schema: mySchema },
   *   onText: (chunk) => console.log('Progress:', chunk),
   * });
   * console.log(result.structuredOutput);
   * ```
   */
  async executeStreamingQuery(options: StreamingQueryOptions): Promise<StreamingQueryResult> {
    const {
      prompt,
      model,
      systemPrompt,
      cwd,
      maxTurns = 100,
      allowedTools = ['Read', 'Glob', 'Grep'],
      abortController,
      outputFormat,
      onText,
      onToolUse,
    } = options;

    const resolvedModel = resolveModelString(model, CLAUDE_MODEL_MAP.haiku);

    try {
      const sdkOptions: Options = {
        model: resolvedModel,
        systemPrompt,
        maxTurns,
        cwd,
        allowedTools: [...allowedTools],
        permissionMode: 'acceptEdits',
        abortController,
        ...(outputFormat && { outputFormat }),
      };

      // Handle both string prompts and multi-part content blocks
      const stream = Array.isArray(prompt)
        ? query({ prompt: this.createPromptGenerator(prompt), options: sdkOptions })
        : query({ prompt, options: sdkOptions });
      const { text, structuredOutput } = await this.extractTextFromStream(stream, {
        onText,
        onToolUse,
      });

      if (!text && !structuredOutput) {
        return {
          text: '',
          success: false,
          error: 'Empty response from Claude',
        };
      }

      return {
        text: text.trim(),
        success: true,
        structuredOutput,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ClaudeProvider] executeStreamingQuery() error:', errorMessage);
      return {
        text: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Create a multi-part prompt generator for content blocks
   */
  private createPromptGenerator(content: PromptContentBlock[]) {
    // Return an async generator that yields SDK user messages
    // The SDK expects this format for multi-part prompts
    return (async function* () {
      yield {
        type: 'user' as const,
        session_id: '',
        message: { role: 'user' as const, content },
        parent_tool_use_id: null,
      };
    })();
  }

  /**
   * Extract text and structured output from SDK stream
   *
   * This consolidates the duplicated extractTextFromStream() function
   * that was copied across 5+ route files.
   */
  private async extractTextFromStream(
    stream: AsyncIterable<unknown>,
    handlers?: {
      onText?: (text: string) => void;
      onToolUse?: (name: string, input: unknown) => void;
    }
  ): Promise<{ text: string; structuredOutput?: unknown }> {
    let responseText = '';
    let structuredOutput: unknown = undefined;

    for await (const msg of stream) {
      const message = msg as {
        type: string;
        subtype?: string;
        result?: string;
        structured_output?: unknown;
        message?: {
          content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
        };
      };

      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            responseText += block.text;
            handlers?.onText?.(block.text);
          } else if (block.type === 'tool_use' && block.name) {
            handlers?.onToolUse?.(block.name, block.input);
          }
        }
      } else if (message.type === 'result' && message.subtype === 'success') {
        if (message.result) {
          responseText = message.result;
        }
        if (message.structured_output) {
          structuredOutput = message.structured_output;
        }
      } else if (message.type === 'result' && message.subtype === 'error_max_turns') {
        console.warn('[ClaudeProvider] Hit max turns limit');
      } else if (
        message.type === 'result' &&
        message.subtype === 'error_max_structured_output_retries'
      ) {
        throw new Error('Failed to produce valid structured output after retries');
      } else if (message.type === 'error') {
        const errorMsg = (message as { error?: string }).error || 'Unknown error';
        throw new Error(errorMsg);
      }
    }

    return { text: responseText, structuredOutput };
  }
}
