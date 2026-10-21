// Kullanıcı cihazı yapılandırma testleri.
//
// Kapsam: sağlayıcı bilgisi (API anahtarı dâhil) ajanın .env'ine değil,
// kullanıcının kendi dizinindeki ~/.bashcli/providers.json dosyasına
// yazılmalı ve oradan okunmalı.
//
// Çalıştırma: npx tsx test/user_config_test.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  check(name, actual === expected, `beklenen=${JSON.stringify(expected)} gerçek=${JSON.stringify(actual)}`);
}

async function main(): Promise<void> {
  const { USER_CONFIG_PATH, USER_DIR, readUserProvider, saveUserProvider } =
    await import("../src/user-config.js");
  const { saveProvider, currentLlmKwargs } = await import("../src/providers.js");

  // Testi geçici dizine yönlendirmek için: kayıt yolunu doğrulamak yerine
  // gerçek kullanıcı dosyasını okuyup sonra temizleyeceğiz.
  const existed = existsSync(USER_CONFIG_PATH);
  const backup = existed ? readFileSync(USER_CONFIG_PATH, "utf-8") : null;

  try {
    // 1) Yazma/okuma
    saveUserProvider({
      provider: "zenmux",
      apiKey: "sk-test-1234567890",
      baseUrl: "https://zenmux.ai/api/v1",
      model: "openai/test-model",
    });
    check("kayit: dosya olustu", existsSync(USER_CONFIG_PATH), USER_CONFIG_PATH);
    check("kayit: dizin dogru yerde", USER_DIR.startsWith(tmpdir()) || USER_DIR.includes(".bashcli"), USER_DIR);

    const read = readUserProvider();
    eq("kayit: provider okundu", read?.provider, "zenmux");
    eq("kayit: api anahtari okundu", read?.apiKey, "sk-test-1234567890");
    eq("kayit: model okundu", read?.model, "openai/test-model");

    // Dosya izinleri 0600 olmalı (anahtar gizli).
    const { statSync } = await import("node:fs");
    const mode = statSync(USER_CONFIG_PATH).mode & 0o777;
    eq("kayit: dosya izni 0600", mode, 0o600);

    // 2) currentLlmKwargs kullanıcı kaydını okumalı
    const kw = currentLlmKwargs();
    eq("llm: model kullanici kaydindan", kw.model, "openai/test-model");
    eq("llm: apiBase kullanici kaydindan", kw.apiBase, "https://zenmux.ai/api/v1");
    eq("llm: apiKey kullanici kaydindan", kw.apiKey, "sk-test-1234567890");

    // 3) saveProvider da kullanıcı cihazına yazmalı
    saveProvider("groq", "gsk-test-abcdef", null, "groq/llama-3.3-70b-versatile");
    const after = readUserProvider();
    eq("saveProvider: provider yazildi", after?.provider, "groq");
    eq("saveProvider: anahtar yazildi", after?.apiKey, "gsk-test-abcdef");
    eq("saveProvider: model yazildi", after?.model, "groq/llama-3.3-70b-versatile");
    check("saveProvider: varsayilan base URL yazildi",
      after?.baseUrl === "https://api.groq.com/openai/v1", after?.baseUrl);
  } finally {
    // Eski durumu geri koy
    if (backup !== null) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(USER_CONFIG_PATH, backup, "utf-8");
    } else {
      rmSync(USER_CONFIG_PATH, { force: true });
    }
  }

  console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

void main();
