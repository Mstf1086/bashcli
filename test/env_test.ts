// Ortam değişkeni yükleme ve hata mesajlandırma testleri.
//
// Kapsam: ajanın .env'i her konumda yüklenmeli (global kullanım), hedef
// projenin .env'i ajanın ayarlarını ezmemeli, sağlayıcı hataları kullanıcıya
// anlaşılır biçimde bildirilmeli.
//
// Çalıştırma: npx tsx test/env_test.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  check(name, ok, ok ? "" : `beklenen=${JSON.stringify(expected)} gerçek=${JSON.stringify(actual)}`);
}

// --- 1) Hata mesajlandırma -------------------------------------------------
{
  const { describeError } = await import("../src/errors.js");

  const m429 = describeError(new Error("OpenAI-uyumlu API HTTP 429: rate limited"));
  check("errors: 429 kota olarak yorumlanıyor", m429.includes("429") && m429.includes("kota"), m429);
  check("errors: 429 çözüm öneriyor", m429.includes("/provider"), m429);

  const m402 = describeError(new Error("HTTP 402: Payment Required"));
  check("errors: 402 bakiye olarak yorumlanıyor", m402.includes("bakiye"), m402);

  const m401 = describeError(new Error("HTTP 401: Unauthorized"));
  check("errors: 401 anahtar hatası", m401.includes("anahtar"), m401);

  const m403 = describeError(new Error("HTTP 403: Forbidden"));
  check("errors: 403 anahtar hatası", m403.includes("anahtar"), m403);

  const m404 = describeError(new Error("HTTP 404: Not Found"));
  check("errors: 404 model hatası", m404.includes("model"), m404);

  const other = describeError(new Error("bağlantı sıfırlandı"));
  check("errors: bilinmeyen hata olduğu gibi", other.includes("bağlantı sıfırlandı"), other);
  check("errors: bilinmeyen hata 'Hata:' ile başlıyor", other.startsWith("Hata:"), other);

  check("errors: string hata da işleniyor", describeError("HTTP 429").includes("kota"));
}

// --- 2) Env yükleme sırası ------------------------------------------------
{
  // Ajan .env'inin yolunu biliyoruz (providers.ts ENV_PATH).
  const { ENV_PATH } = await import("../src/providers.js");
  check("env: ajanın .env dosyası mevcut", typeof ENV_PATH === "string" && ENV_PATH.length > 0);

  // Simülasyon: iki farklı .env dosyası, doğru öncelik sırası.
  const tmp = mkdtempSync(join(tmpdir(), "agent-env-"));
  const agentEnv = join(tmp, "agent.env");
  const projEnv = join(tmp, "proj.env");
  writeFileSync(agentEnv, "TEST_PROVIDER=agent\nTEST_SHARED=agent\n", "utf-8");
  writeFileSync(projEnv, "TEST_PROVIDER=proje\nTEST_EXTRA=proje\n", "utf-8");

  const { config } = await import("dotenv");
  delete process.env.TEST_PROVIDER;
  delete process.env.TEST_SHARED;
  delete process.env.TEST_EXTRA;

  // 1) ajanın .env'i → 2) projenin .env'i (override:false → önce yüklenen kazanır)
  config({ path: agentEnv, quiet: true });
  config({ path: projEnv, quiet: true });

  eq("env: ajanın değeri proje tarafından ezilmiyor", process.env.TEST_PROVIDER, "agent");
  eq("env: ajana özel değişken yüklendi", process.env.TEST_SHARED, "agent");
  eq("env: projeye özel değişken eklendi", process.env.TEST_EXTRA, "proje");

  delete process.env.TEST_PROVIDER;
  delete process.env.TEST_SHARED;
  delete process.env.TEST_EXTRA;
  rmSync(tmp, { recursive: true, force: true });
}

// --- 3) .env'den sağlayıcı değişkenleri YÜKLENMEZ -------------------------
{
  const { loadAgentEnv, loadWorkspaceEnv } = await import("../src/agent-env.js");
  const { currentLlmKwargs, isProviderEnvKey } = await import("../src/providers.js");

  check("env: PROVIDER sağlayıcı anahtarı sayılır", isProviderEnvKey("PROVIDER"));
  check("env: ZENMUX_API_KEY sağlayıcı anahtarı sayılır", isProviderEnvKey("ZENMUX_API_KEY"));
  check("env: OPENAI_BASE_URL sağlayıcı anahtarı sayılır", isProviderEnvKey("OPENAI_BASE_URL"));
  check("env: AGENT_MODE sağlayıcı anahtarı değil", !isProviderEnvKey("AGENT_MODE"));

  const tmp = mkdtempSync(join(tmpdir(), "agent-env3-"));
  const agentEnv = join(tmp, "agent.env");
  writeFileSync(agentEnv, [
    "PROVIDER=openrouter", "AGENT_MODEL=sizinti/model", "OPENROUTER_API_KEY=sk-or-v1-dosyadan",
    "ZENMUX_API_BASE=https://kotu.example/v1", "CODING_WORKSPACE=/tmp/dayatma", "AGENT_TEST_EXTRA=ok", "",
  ].join("\n"), "utf-8");
  const projDir = join(tmp, "proje");
  mkdirSync(projDir);
  writeFileSync(join(projDir, ".env"),
    "OPENAI_BASE_URL=https://kotu.example/v1\nPROJE_AYARI=evet\n", "utf-8");

  const before = { ...process.env };
  const { ENV_PATH } = await import("../src/providers.js");
  const { copyFileSync } = await import("node:fs");
  const saved = ENV_PATH;
  copyFileSync(agentEnv, saved);           // BASHCLI_ENV geçici dosyası (test_setup)
  delete process.env.AGENT_TEST_EXTRA;
  loadAgentEnv();
  loadWorkspaceEnv(projDir);

  eq("env: .env PROVIDER'ı ezmedi", process.env.PROVIDER, before.PROVIDER);
  eq("env: .env AGENT_MODEL'i ezmedi", process.env.AGENT_MODEL, before.AGENT_MODEL);
  check("env: .env'deki API anahtarı yüklenmedi", process.env.OPENROUTER_API_KEY === before.OPENROUTER_API_KEY);
  eq("env: .env base URL'i ezmedi", process.env.ZENMUX_API_BASE, before.ZENMUX_API_BASE);
  check("env: proje .env OPENAI_BASE_URL yüklenmedi", process.env.OPENAI_BASE_URL === before.OPENAI_BASE_URL);
  eq("env: sağlayıcı dışı ajan ayarı yüklendi", process.env.AGENT_TEST_EXTRA, "ok");
  eq("env: sağlayıcı dışı proje ayarı yüklendi", process.env.PROJE_AYARI, "evet");
  check("env: workspace ajan .env'inden gelmiyor", process.env.CODING_WORKSPACE !== "/tmp/dayatma");

  const kw = currentLlmKwargs();
  check("env: model/anahtar/base çözülüyor", !!kw.model && !!kw.apiKey && !!kw.apiBase, kw.model);
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
