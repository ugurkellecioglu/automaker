/**
 * Output Writer - Incremental file writing for agent output
 *
 * Handles debounced file writes to avoid excessive I/O during streaming.
 * Used to persist agent output to agent-output.md in the feature directory.
 */

import { secureFs } from '@automaker/platform';
import path from 'path';
import { createLogger } from '@automaker/utils';

const logger = createLogger('OutputWriter');

/**
 * Handles incremental, debounced file writing for agent output
 */
export class OutputWriter {
  private content = '';
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly outputPath: string;

  /**
   * Create a new output writer
   *
   * @param outputPath - Full path to the output file
   * @param debounceMs - Debounce interval for writes (default: 500ms)
   * @param initialContent - Optional initial content to start with
   */
  constructor(outputPath: string, debounceMs = 500, initialContent = '') {
    this.outputPath = outputPath;
    this.debounceMs = debounceMs;
    this.content = initialContent;
  }

  /**
   * Append text to the output
   *
   * Schedules a debounced write to the file.
   */
  append(text: string): void {
    this.content += text;
    this.scheduleWrite();
  }

  /**
   * Append text with automatic separator handling
   *
   * Ensures proper spacing between sections.
   */
  appendWithSeparator(text: string): void {
    if (this.content.length > 0 && !this.content.endsWith('\n\n')) {
      if (this.content.endsWith('\n')) {
        this.content += '\n';
      } else {
        this.content += '\n\n';
      }
    }
    this.append(text);
  }

  /**
   * Append a tool use entry
   */
  appendToolUse(toolName: string, input?: unknown): void {
    if (this.content.length > 0 && !this.content.endsWith('\n')) {
      this.content += '\n';
    }
    this.content += `\n🔧 Tool: ${toolName}\n`;
    if (input) {
      this.content += `Input: ${JSON.stringify(input, null, 2)}\n`;
    }
    this.scheduleWrite();
  }

  /**
   * Get the current accumulated content
   */
  getContent(): string {
    return this.content;
  }

  /**
   * Set content directly (for follow-up sessions with previous content)
   */
  setContent(content: string): void {
    this.content = content;
  }

  /**
   * Schedule a debounced write
   */
  private scheduleWrite(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
    }
    this.writeTimeout = setTimeout(() => {
      this.flush().catch((error) => {
        logger.error('Failed to flush output', error);
      });
    }, this.debounceMs);
  }

  /**
   * Flush content to disk immediately
   *
   * Call this to ensure all content is written, e.g., at the end of execution.
   */
  async flush(): Promise<void> {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }

    try {
      await secureFs.mkdir(path.dirname(this.outputPath), { recursive: true });
      await secureFs.writeFile(this.outputPath, this.content);
    } catch (error) {
      logger.error(`Failed to write to ${this.outputPath}`, error);
      // Don't throw - file write errors shouldn't crash execution
    }
  }

  /**
   * Cancel any pending writes
   */
  cancel(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
  }
}

/**
 * Create an output writer for a feature
 *
 * @param featureDir - The feature directory path
 * @param previousContent - Optional content from previous session
 * @returns Configured output writer
 */
export function createFeatureOutputWriter(
  featureDir: string,
  previousContent?: string
): OutputWriter {
  const outputPath = path.join(featureDir, 'agent-output.md');

  // If there's previous content, add a follow-up separator
  const initialContent = previousContent
    ? `${previousContent}\n\n---\n\n## Follow-up Session\n\n`
    : '';

  return new OutputWriter(outputPath, 500, initialContent);
}
