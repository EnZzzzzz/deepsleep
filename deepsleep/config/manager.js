import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { defaultConfig, normalizeConfig, normalizeProviderConfig } from "./schema.js";

export class ConfigManager {
  /** @param {string} homeDir — config root, defaults to ~/.deepsleep */
  constructor(homeDir = null) {
    this.homeDir = homeDir || join(process.env.HOME || "~", ".deepsleep");
    this.configPath = join(this.homeDir, "config.json");
  }

  async load() {
    if (!existsSync(this.configPath)) {
      return defaultConfig();
    }
    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return normalizeConfig(parsed);
    } catch {
      return defaultConfig();
    }
  }

  async save(config) {
    const normalized = normalizeConfig(config);
    await mkdir(this.homeDir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(normalized, null, 2), "utf-8");
  }

  async getProvider(providerId) {
    const cfg = await this.load();
    return cfg.providers[providerId] || null;
  }

  async setProvider(providerConfig) {
    const normalized = normalizeProviderConfig(providerConfig);
    const cfg = await this.load();
    cfg.providers[normalized.id] = normalized;
    await this.save(cfg);
  }
}
