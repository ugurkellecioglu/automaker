/**
 * Cursor CLI Model IDs
 * Reference: https://cursor.com/docs
 */
export type CursorModelId =
  | 'auto' // Auto-select best model
  | 'claude-sonnet-4' // Claude Sonnet 4
  | 'claude-sonnet-4-thinking' // Claude Sonnet 4 with extended thinking
  | 'composer-1' // Cursor Composer agent model
  | 'gpt-4o' // GPT-4o
  | 'gpt-4o-mini' // GPT-4o Mini
  | 'gemini-2.5-pro' // Gemini 2.5 Pro
  | 'o3-mini'; // O3 Mini

/**
 * Cursor model metadata
 */
export interface CursorModelConfig {
  id: CursorModelId;
  label: string;
  description: string;
  hasThinking: boolean;
  tier: 'free' | 'pro';
}

/**
 * Complete model map for Cursor CLI
 */
export const CURSOR_MODEL_MAP: Record<CursorModelId, CursorModelConfig> = {
  auto: {
    id: 'auto',
    label: 'Auto (Recommended)',
    description: 'Automatically selects the best model for each task',
    hasThinking: false,
    tier: 'free',
  },
  'claude-sonnet-4': {
    id: 'claude-sonnet-4',
    label: 'Claude Sonnet 4',
    description: 'Anthropic Claude Sonnet 4 via Cursor',
    hasThinking: false,
    tier: 'pro',
  },
  'claude-sonnet-4-thinking': {
    id: 'claude-sonnet-4-thinking',
    label: 'Claude Sonnet 4 (Thinking)',
    description: 'Claude Sonnet 4 with extended thinking enabled',
    hasThinking: true,
    tier: 'pro',
  },
  'composer-1': {
    id: 'composer-1',
    label: 'Composer 1',
    description: 'Cursor Composer agent model optimized for multi-file edits',
    hasThinking: false,
    tier: 'pro',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'OpenAI GPT-4o via Cursor',
    hasThinking: false,
    tier: 'pro',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    label: 'GPT-4o Mini',
    description: 'OpenAI GPT-4o Mini (faster, cheaper)',
    hasThinking: false,
    tier: 'free',
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Google Gemini 2.5 Pro via Cursor',
    hasThinking: false,
    tier: 'pro',
  },
  'o3-mini': {
    id: 'o3-mini',
    label: 'O3 Mini',
    description: 'OpenAI O3 Mini reasoning model',
    hasThinking: true,
    tier: 'pro',
  },
};

/**
 * Helper: Check if model has thinking capability
 */
export function cursorModelHasThinking(modelId: CursorModelId): boolean {
  return CURSOR_MODEL_MAP[modelId]?.hasThinking ?? false;
}

/**
 * Helper: Get display name for model
 */
export function getCursorModelLabel(modelId: CursorModelId): string {
  return CURSOR_MODEL_MAP[modelId]?.label ?? modelId;
}

/**
 * Helper: Get all cursor model IDs
 */
export function getAllCursorModelIds(): CursorModelId[] {
  return Object.keys(CURSOR_MODEL_MAP) as CursorModelId[];
}
