// deepsleep/config/schema.js

/**
 * Provider 配置项
 * @typedef {{
 *   id: string,
 *   type: string,
 *   apiKey?: string,
 *   baseUrl?: string,
 *   defaultModel: string,
 *   models: string[],
 *   options?: Record<string, any>
 * }} ProviderConfig
 */

/**
 * 全局配置 Schema
 * @typedef {{
 *   version: string,
 *   defaultProvider: string,
 *   providers: Record<string, ProviderConfig>,
 *   agent?: { maxTurns?: number, tokenBudget?: number, timeoutMs?: number },
 *   skillsDir?: string
 * }} DeepSleepConfig
 */

/** @returns {DeepSleepConfig} */
export function defaultConfig() {
  return {
    version: "0.1.0",
    defaultProvider: "openai",
    providers: {},
    agent: {
      maxTurns: 50,
      tokenBudget: 200_000,
      timeoutMs: 600_000, // 10 minutes
    },
    skillsDir: "~/.deepsleep/skills",
  };
}

/**
 * 校验并补全配置
 * @param {Partial<DeepSleepConfig>} partial
 * @returns {DeepSleepConfig}
 */
export function normalizeConfig(partial) {
  const base = defaultConfig();
  return {
    ...base,
    ...partial,
    agent: { ...base.agent, ...(partial.agent || {}) },
  };
}

/**
 * 校验 Provider 配置
 * @param {Partial<ProviderConfig>} partial
 * @returns {ProviderConfig}
 */
export function normalizeProviderConfig(partial) {
  if (!partial.id) throw new Error("provider.id is required");
  if (!partial.type) throw new Error("provider.type is required");
  if (!partial.defaultModel) throw new Error("provider.defaultModel is required");
  return {
    id: partial.id,
    type: partial.type,
    apiKey: partial.apiKey || "",
    baseUrl: partial.baseUrl || "",
    defaultModel: partial.defaultModel,
    models: partial.models || [partial.defaultModel],
    options: partial.options || {},
  };
}
