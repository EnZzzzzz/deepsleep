import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigManager } from "../../deepsleep/config/manager.js";

const TEST_HOME = join(tmpdir(), ".deepsleep-test");

describe("ConfigManager", () => {
  before(async () => {
    await rm(TEST_HOME, { recursive: true, force: true });
    await mkdir(TEST_HOME, { recursive: true });
  });

  after(async () => {
    await rm(TEST_HOME, { recursive: true, force: true });
  });

  it("load returns default config when no file exists", async () => {
    const mgr = new ConfigManager(TEST_HOME);
    const cfg = await mgr.load();
    assert.equal(cfg.version, "0.1.0");
  });

  it("save and load round-trip", async () => {
    const mgr = new ConfigManager(TEST_HOME);
    const cfg = { ...(await mgr.load()), defaultProvider: "anthropic" };
    await mgr.save(cfg);
    const loaded = await mgr.load();
    assert.equal(loaded.defaultProvider, "anthropic");
  });

  it("getProvider returns null for missing provider", async () => {
    const mgr = new ConfigManager(TEST_HOME);
    const p = await mgr.getProvider("nonexistent");
    assert.equal(p, null);
  });

  it("setProvider and getProvider", async () => {
    const mgr = new ConfigManager(TEST_HOME);
    const prov = { id: "openai", type: "openai", defaultModel: "gpt-4" };
    await mgr.setProvider(prov);
    const loaded = await mgr.getProvider("openai");
    assert.equal(loaded.defaultModel, "gpt-4");
  });
});
