import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import { useSetupStore } from '@/store/setup-store';
import { CodexCliStatus } from '../cli-status/codex-cli-status';
import { CodexSettings } from '../codex/codex-settings';
import { CodexUsageSection } from '../codex/codex-usage-section';
import { Info } from 'lucide-react';
import { getElectronAPI } from '@/lib/electron';
import { createLogger } from '@automaker/utils/logger';
import type { CliStatus as SharedCliStatus } from '../shared/types';

const logger = createLogger('CodexSettings');

export function CodexSettingsTab() {
  // TODO: Add these to app-store
  const [codexAutoLoadAgents, setCodexAutoLoadAgents] = useState(false);
  const [codexSandboxMode, setCodexSandboxMode] = useState<
    'read-only' | 'workspace-write' | 'danger-full-access'
  >('read-only');
  const [codexApprovalPolicy, setCodexApprovalPolicy] = useState<
    'untrusted' | 'on-failure' | 'on-request' | 'never'
  >('untrusted');
  const [codexEnableWebSearch, setCodexEnableWebSearch] = useState(false);
  const [codexEnableImages, setCodexEnableImages] = useState(false);

  const {
    codexAuthStatus,
    codexCliStatus: setupCliStatus,
    setCodexCliStatus,
    setCodexAuthStatus,
  } = useSetupStore();

  const [isCheckingCodexCli, setIsCheckingCodexCli] = useState(false);
  const [displayCliStatus, setDisplayCliStatus] = useState<SharedCliStatus | null>(null);

  // Convert setup-store CliStatus to shared/types CliStatus for display
  const codexCliStatus: SharedCliStatus | null =
    displayCliStatus ||
    (setupCliStatus
      ? {
          success: true,
          status: setupCliStatus.installed ? 'installed' : 'not_installed',
          method: setupCliStatus.method,
          version: setupCliStatus.version || undefined,
          path: setupCliStatus.path || undefined,
        }
      : null);

  const handleRefreshCodexCli = useCallback(async () => {
    setIsCheckingCodexCli(true);
    try {
      const api = getElectronAPI();
      if (api?.setup?.getCodexStatus) {
        const result = await api.setup.getCodexStatus();
        if (result.success) {
          // Update setup store
          setCodexCliStatus({
            installed: result.installed,
            version: result.version,
            path: result.path,
            method: result.auth?.method || 'none',
          });
          // Update display status
          setDisplayCliStatus({
            success: true,
            status: result.installed ? 'installed' : 'not_installed',
            method: result.auth?.method,
            version: result.version || undefined,
            path: result.path || undefined,
          });
          if (result.auth) {
            setCodexAuthStatus({
              authenticated: result.auth.authenticated,
              method: result.auth.method as
                | 'cli_authenticated'
                | 'api_key'
                | 'api_key_env'
                | 'none',
              hasAuthFile: result.auth.method === 'cli_authenticated',
              hasApiKey: result.auth.hasApiKey,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to refresh Codex CLI status:', error);
    } finally {
      setIsCheckingCodexCli(false);
    }
  }, [setCodexCliStatus, setCodexAuthStatus]);

  // Show usage tracking when CLI is authenticated
  const showUsageTracking = codexAuthStatus?.authenticated ?? false;

  return (
    <div className="space-y-6">
      {/* Usage Info */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <Info className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-400/90">
          <span className="font-medium">OpenAI via Codex CLI</span>
          <p className="text-xs text-emerald-400/70 mt-1">
            Access GPT models with tool support for advanced coding workflows.
          </p>
        </div>
      </div>

      <CodexCliStatus
        status={codexCliStatus}
        isChecking={isCheckingCodexCli}
        onRefresh={handleRefreshCodexCli}
      />
      <CodexSettings
        autoLoadCodexAgents={codexAutoLoadAgents}
        codexSandboxMode={codexSandboxMode}
        codexApprovalPolicy={codexApprovalPolicy}
        codexEnableWebSearch={codexEnableWebSearch}
        codexEnableImages={codexEnableImages}
        onAutoLoadCodexAgentsChange={setCodexAutoLoadAgents}
        onCodexSandboxModeChange={setCodexSandboxMode}
        onCodexApprovalPolicyChange={setCodexApprovalPolicy}
        onCodexEnableWebSearchChange={setCodexEnableWebSearch}
        onCodexEnableImagesChange={setCodexEnableImages}
      />
      {showUsageTracking && <CodexUsageSection />}
    </div>
  );
}

export default CodexSettingsTab;
