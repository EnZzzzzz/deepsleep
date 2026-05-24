import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import readline from "node:readline";
import {
  Session,
  InputQueue,
  submissionLoop,
  createChannel,
  ProviderRegistry,
  OpType,
  EventType,
} from "./deepsleep/index.js";
import { OpenAIProvider } from "./deepsleep/providers/openai.js";
import { AnthropicProvider } from "./deepsleep/providers/anthropic.js";

// ── Config loading ──────────────────────────────────────

async function loadConfig() {
  const localPath = join(process.cwd(), ".deepsleep", "config.json");
  const globalPath = join(homedir(), ".deepsleep", "config.json");

  for (const p of [localPath, globalPath]) {
    if (existsSync(p)) {
      try {
        const raw = await readFile(p, "utf-8");
        const cfg = JSON.parse(raw);
        console.log(`[deepsleep] loaded config: ${p}`);
        return cfg;
      } catch (e) {
        console.error(`[deepsleep] failed to parse ${p}: ${e.message}`);
      }
    }
  }
  return null;
}

// ── Provider setup ──────────────────────────────────────

const PROVIDER_CLASSES = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
};

const API_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

function buildRegistry(cfg) {
  const registry = new ProviderRegistry();
  const defaultProvider = process.env.DEEPSLEEP_PROVIDER || cfg.defaultProvider || "openai";

  for (const [id, pcfg] of Object.entries(cfg.providers)) {
    const ProviderClass = PROVIDER_CLASSES[pcfg.type];
    if (!ProviderClass) {
      console.error(`[deepsleep] unknown provider type: ${pcfg.type} (provider: ${id})`);
      continue;
    }

    const envKey = API_KEY_ENV[id] || API_KEY_ENV[pcfg.type];
    const apiKey = pcfg.apiKey || (envKey ? process.env[envKey] : "") || "";

    if (!apiKey && id === defaultProvider) {
      console.warn(`[deepsleep] no API key for default provider "${id}".`);
      console.warn(`  Set ${envKey || "OPENAI_API_KEY"} env var or apiKey in config.`);
    }

    registry.register(
      new ProviderClass({
        id,
        type: pcfg.type,
        apiKey,
        baseUrl: pcfg.baseUrl || "",
        defaultModel: pcfg.defaultModel,
        models: pcfg.models || [pcfg.defaultModel],
        options: pcfg.options || {},
      })
    );

    const active = id === defaultProvider ? " [default]" : "";
    const models = pcfg.models?.join(", ") || pcfg.defaultModel;
    console.log(`[deepsleep] registered ${id} (${pcfg.type})${active} — ${models}`);
  }

  return { registry, defaultProvider };
}

// ── Session ─────────────────────────────────────────────

function createSession(registry) {
  const emitter = new EventEmitter();
  const session = new Session({
    agentId: "default",
    agentStatus: emitter,
    registry,
    inputQueue: new InputQueue(),
  });

  session.onStatusChange((status) => {
    console.log(`[agent] ${status}`);
  });

  // Print agent response when a turn completes
  session.onEvent((event) => {
    if (event.type === EventType.TURN_COMPLETE && event.message) {
      console.log(`\n${event.message}`);
    }
    if (event.type === EventType.ERROR && event.message) {
      console.error(`\n[error] ${event.message}`);
    }
  });

  return { session, emitter };
}

// ── One-shot mode ───────────────────────────────────────

async function runOneShot(session, channel, message) {
  // Start the submission loop (runs in background)
  const loopPromise = submissionLoop({ session, rxSub: channel });

  // Send user input
  channel.send({ type: OpType.USER_INPUT, data: { content: message } });

  // Wait for the turn to complete, then shut down
  await new Promise((resolve) => {
    session.onEvent((event) => {
      if (
        event.type === EventType.TURN_COMPLETE ||
        event.type === EventType.ERROR
      ) {
        resolve();
      }
    });
  });

  channel.send({ type: OpType.SHUTDOWN });
  await loopPromise;
}

// ── Interactive REPL ────────────────────────────────────

async function runRepl(session, channel) {
  const loopPromise = submissionLoop({ session, rxSub: channel });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n> ",
  });

  console.log('DeepSleep REPL — type a message, "quit" to exit.\n');

  // Track whether a turn is in flight (to defer next prompt until response arrives)
  let waitingForResponse = false;
  let pendingResolve = null;

  session.onEvent((event) => {
    if (event.type === EventType.TURN_COMPLETE || event.type === EventType.ERROR) {
      if (pendingResolve) {
        pendingResolve();
        pendingResolve = null;
      }
      waitingForResponse = false;
      rl.prompt();
    }
  });

  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "quit" || trimmed === "exit") break;

    if (trimmed.length > 0 && !waitingForResponse) {
      waitingForResponse = true;
      channel.send({ type: OpType.USER_INPUT, data: { content: trimmed } });

      // Block until the turn completes
      await new Promise((resolve) => {
        pendingResolve = resolve;
      });
    }
  }

  rl.close();
  channel.send({ type: OpType.SHUTDOWN });
  await loopPromise;
}

// ── Entry ───────────────────────────────────────────────

async function main() {
  const mode = process.argv[2];

  if (mode === "--help" || mode === "-h") {
    console.log("Usage:");
    console.log("  node main.js              interactive REPL");
    console.log('  node main.js "message"     one-shot message');
    console.log("");
    console.log("Config files (checked in order):");
    console.log("  1. ./.deepsleep/config.json");
    console.log("  2. ~/.deepsleep/config.json");
    console.log("");
    console.log("Environment:");
    console.log("  DEEPSLEEP_PROVIDER     override default provider id");
    console.log("  DEEPSEEK_API_KEY       DeepSeek API key");
    console.log("  OPENAI_API_KEY         OpenAI API key");
    console.log("  ANTHROPIC_API_KEY      Anthropic API key");
    process.exit(0);
  }

  const cfg = await loadConfig();
  if (!cfg) {
    console.error("[deepsleep] no config found.");
    console.error("  Create .deepsleep/config.json or ~/.deepsleep/config.json");
    process.exit(1);
  }

  const { registry } = buildRegistry(cfg);
  const { session } = createSession(registry);
  const channel = createChannel();

  if (mode && mode.length > 0) {
    await runOneShot(session, channel, mode);
  } else {
    await runRepl(session, channel);
  }

  console.log("[deepsleep] done.");
}

main().catch((err) => {
  console.error("[deepsleep] fatal:", err.message);
  process.exit(1);
});
