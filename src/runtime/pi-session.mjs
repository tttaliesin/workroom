import {
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

export async function createRoleSession({ directory, modelRuntime, model, tools, systemPrompt }) {
  const extensionRuntime = createExtensionRuntime();
  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: extensionRuntime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime,
    model,
    thinkingLevel: 'low',
    resourceLoader,
    tools: tools.map((t) => t.name),
    customTools: tools,
    sessionManager: SessionManager.inMemory(directory),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      cacheWarming: 'off',
      enableSkillCommands: false,
      enableAnalytics: false,
      enableInstallTelemetry: false,
    }),
  });
}
