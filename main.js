import { startServer } from "./server/index.js";
import { ProviderRegistry } from "./deepsleep/config/provider.js";
import { OpenAIProvider } from "./deepsleep/providers/openai.js";
import { AnthropicProvider } from "./deepsleep/providers/anthropic.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROVIDER_CLASSES = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
};

const API_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

async function loadConfig() {
  for (const p of [join(process.cwd(), ".deepsleep", "config.json"), join(homedir(), ".deepsleep", "config.json")]) {
    if (existsSync(p)) {
      try { return JSON.parse(await readFile(p, "utf-8")); } catch {}
    }
  }
  return null;
}

function buildRegistry(cfg) {
  const registry = new ProviderRegistry();
  const defaultProvider = process.env.DEEPSLEEP_PROVIDER || cfg.defaultProvider || "openai";

  for (const [id, pcfg] of Object.entries(cfg.providers)) {
    const ProviderClass = PROVIDER_CLASSES[pcfg.type];
    if (!ProviderClass) continue;
    const envKey = API_KEY_ENV[id] || API_KEY_ENV[pcfg.type];
    const apiKey = pcfg.apiKey || (envKey ? process.env[envKey] : "") || "";
    registry.register(new ProviderClass({ id, type: pcfg.type, apiKey, baseUrl: pcfg.baseUrl || "", defaultModel: pcfg.defaultModel, models: pcfg.models || [pcfg.defaultModel], options: pcfg.options || {} }));
    console.log(`[deepsleep] registered ${id} (${pcfg.type})${id === defaultProvider ? " [default]" : ""}`);
  }
  return registry;
}

async function main() {
  const port = parseInt(process.env.DEEPSLEEP_PORT || "3000", 10);
  const cfg = await loadConfig();
  if (!cfg) {
    console.error("[deepsleep] no config found.");
    console.error("  Create .deepsleep/config.json or ~/.deepsleep/config.json");
    process.exit(1);
  }
  const registry = buildRegistry(cfg);
  const server = await startServer(port, registry);
  console.log(`[deepsleep] WebSocket server listening on ws://localhost:${port}`);

  process.on("SIGINT", () => { server.close(); process.exit(0); });
  process.on("SIGTERM", () => { server.close(); process.exit(0); });
}

main().catch((err) => {
  console.error("[deepsleep] fatal:", err.message);
  process.exit(1);
});
