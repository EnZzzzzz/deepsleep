// deepsleep/config/provider.js

/**
 * Provider base class — unified interface for LLM services.
 *
 * Subclasses must implement:
 *   - chat(messages, options) → AsyncIterable<{ type, content, ... }>
 *
 * Subclasses may optionally implement:
 *   - listModels() → Promise<string[]>
 *   - tokenCount(messages) → Promise<number>
 */
export class Provider {
  /** @param {import("./schema.js").ProviderConfig} config */
  constructor(config) {
    this.config = config;
    this.id = config.id;
    this.type = config.type;
    this.defaultModel = config.defaultModel;
  }

  /**
   * Send a chat request, returning an async iterable stream of response events.
   * @param {Array<{role: string, content: string}>} _messages
   * @param {{ model?: string, maxTokens?: number, temperature?: number, tools?: Array<any> }} _options
   * @returns {AsyncIterable<any>}
   */
  async *chat(_messages, _options) {
    throw new Error("Provider.chat() must be implemented by subclass");
  }

  /** @returns {Promise<string[]>} */
  async listModels() {
    return this.config.models;
  }

  /**
   * @param {Array<{role: string, content: string}>} _messages
   * @returns {Promise<number>}
   */
  async tokenCount(_messages) {
    throw new Error("Provider.tokenCount() not implemented");
  }
}

/**
 * Provider registry — manages all registered Provider instances.
 */
export class ProviderRegistry {
  constructor() {
    /** @type {Map<string, Provider>} */
    this._providers = new Map();
  }

  register(provider) {
    this._providers.set(provider.id, provider);
  }

  get(id) {
    return this._providers.get(id);
  }

  getDefault(defaultId) {
    return this._providers.get(defaultId);
  }

  listIds() {
    return [...this._providers.keys()];
  }
}
