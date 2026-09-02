import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:read-dir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  analyzeFile: (payload: { filePath: string; content: string }) => ipcRenderer.invoke('engine:analyze', payload),
  safeRemove: (filePath: string, lines: number[]) => ipcRenderer.invoke('engine:safe-remove', filePath, lines),
  runPythonFile: (filePath: string) => ipcRenderer.invoke('python:run-file', filePath),
  onPythonOutput: (callback: (data: any) => void) => {
    const listener = (_: any, arg: any) => callback(arg);
    ipcRenderer.on('python:output', listener);
    return () => ipcRenderer.removeListener('python:output', listener);
  },
  github: {
    configStatus: () => ipcRenderer.invoke('github:configStatus'),
    status: () => ipcRenderer.invoke('github:status'),
    connect: () => ipcRenderer.invoke('github:connect'),
    disconnect: () => ipcRenderer.invoke('github:disconnect'),
    listRepos: () => ipcRenderer.invoke('github:listRepos'),
    associateRepo: (payload: { workspacePath: string; repo: any }) => ipcRenderer.invoke('github:associateRepo', payload),
    getSelectedRepo: (workspacePath: string) => ipcRenderer.invoke('github:getSelectedRepo', workspacePath),
    resolveLocalPath: (payload: { repo: any; currentWorkspacePath?: string }) => ipcRenderer.invoke('github:resolveLocalPath', payload),
    selectCloneDestination: (defaultName?: string) => ipcRenderer.invoke('github:selectCloneDestination', defaultName),
    cloneRepo: (payload: { repo: any; destinationDir: string }) => ipcRenderer.invoke('github:cloneRepo', payload),
  },
  intelligence: {
    preflightEstimate: (payload: any) => ipcRenderer.invoke('intelligence:preflight-estimate', payload),
    getEvidence: (sessionId?: string) => ipcRenderer.invoke('intelligence:get-evidence', { sessionId }),
    correlateBreakage: (payload: any) => ipcRenderer.invoke('intelligence:correlate-breakage', payload),
    getDecisions: (payload?: any) => ipcRenderer.invoke('intelligence:get-decisions', payload),
    recordDecision: (payload: any) => ipcRenderer.invoke('intelligence:record-decision', payload),
    confirmDecision: (payload: { decisionId: string; workspacePath?: string }) => ipcRenderer.invoke('intelligence:confirm-decision', payload),
    rejectDecision: (payload: { decisionId: string; workspacePath?: string }) => ipcRenderer.invoke('intelligence:reject-decision', payload),
    replayDecision: (payload: { query: string; workspacePath?: string; filePath?: string; symbol?: string; commit?: string }) => ipcRenderer.invoke('intelligence:replay-decision', payload),
    searchDecisions: (payload: { query?: string; workspacePath?: string }) => ipcRenderer.invoke('intelligence:search-decisions', payload),
    detectDecisions: (payload: { text: string; workspacePath?: string; activeFilePath?: string; threadId?: string }) => ipcRenderer.invoke('intelligence:detect-decisions', payload),
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    setConfig: (providerId: string, modelId?: string) => ipcRenderer.invoke('ai:set-config', { providerId, modelId }),
    setApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke('ai:set-api-key', { providerId, apiKey }),
    removeApiKey: (providerId: string) => ipcRenderer.invoke('ai:remove-api-key', providerId),
    getVerifiedUsage: (providerId?: string) => ipcRenderer.invoke('ai:get-verified-usage', providerId),
    onConfigChange: (callback: (config: any) => void) => {
      const handler = (_event: any, config: any) => callback(config);
      ipcRenderer.on('ai:config-changed', handler);
      return () => {
        ipcRenderer.removeListener('ai:config-changed', handler);
      };
    },
    onFailover: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('ai:failover-triggered', handler);
      return () => {
        ipcRenderer.removeListener('ai:failover-triggered', handler);
      };
    },
    onTestVerificationStatus: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('ai:test-verification-status', handler);
      return () => {
        ipcRenderer.removeListener('ai:test-verification-status', handler);
      };
    },
  },
  harness: {
    planRefactor: (payload: any) => ipcRenderer.invoke('harness:plan-refactor', payload),
    getRefactorPlan: (planId: string) => ipcRenderer.invoke('harness:get-refactor-plan', planId),
    approveRefactorPlan: (payload: { planId: string; approvedBy?: string; stepByStep?: boolean }) => ipcRenderer.invoke('harness:approve-refactor-plan', payload),
    rejectRefactorPlan: (payload: { planId: string; reason?: string }) => ipcRenderer.invoke('harness:reject-refactor-plan', payload),
    executeRefactorPlan: (payload: { planId: string; stepByStep?: boolean }) => ipcRenderer.invoke('harness:execute-refactor-plan', payload),
    onRefactorPlanUpdate: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('harness:refactor-plan-updated', handler);
      return () => {
        ipcRenderer.removeListener('harness:refactor-plan-updated', handler);
      };
    },
    verifyPostMutation: (payload: any) => ipcRenderer.invoke('harness:verify-post-mutation', payload),
  },
});



