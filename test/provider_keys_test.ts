// Sağlayıcı API anahtarı çözümleme + oturum dosyası maskeleme testleri.
//
// Kapsam:
//  - listProviderKeys(): env → kayıt önceliği, base URL/model çözümleme
//  - providerKeyReport(): tek sağlayıcı / tümü / bilinmeyen sağlayıcı
//  - redactSecrets(): oturum dosyasına yazarken anahtar maskelenir
//
// Çalıştırma: npx tsx test/provider_keys_test.ts
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
    console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected,
    `beklenen=${JSON.stringify(expected)} gerçek=${JSON.stringify(actual)}`);
}

async function main(): Promise<void> {
  const { USER_CONFIG_PATH } = await import("../src/user-config.js");
  const {
    listProviderKeys, getProviderKey, providerKeyReport, saveProvider,
  } = await import("../src/providers.js");
  const { redactSecrets, knownSecretValues, SECRET_MASK } =
    await import("../src/secrets.js");

  // Ortam değişkenlerini temizle: test kendi değerlerini kursun.
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of ["PROVIDER", "OPENROUTER_API_KEY", "OPENAI_API_KEY",
                   "ZENMUX_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
                   "GEMINI_API_KEY", "OPENROUTER_BASE_URL", "OPENAI_BASE_URL"]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }

  const existed = existsSync(USER_CONFIG_PATH);
  const backup = existed ? readFileSync(USER_CONFIG_PATH, "utf-8") : null;

  try {
    // 1) Env'den çözümleme
    process.env.OPENROUTER_API_KEY = "sk-or-v1-envkey-000111";
    process.env.PROVIDER = "openrouter";
    let rows = listProviderKeys();
    const or = rows.find((p) => p.provider === "openrouter");
    eq("env: openrouter anahtarı okundu", or?.apiKey, "sk-or-v1-envkey-000111");
    eq("env: kaynak env", or?.source, "env");
    eq("env: aktif sağlayıcı işaretli", or?.active, true);
    eq("env: envVar adı", or?.envVar, "OPENROUTER_API_KEY");
    eq("env: base URL varsayılan", or?.baseUrl, "https://openrouter.ai/api/v1");

    const groq = rows.find((p) => p.provider === "groq");
    eq("env: anahtarsız sağlayıcı null", groq?.apiKey, null);
    eq("env: anahtarsız sağlayıcı kaynağı none", groq?.source, "none");

    // 2) Kullanıcı kaydı önceliği + aktif olmayan sağlayıcı
    saveProvider("zenmux", "sk-ai-v1-userkey-222333", null, "openai/test-model");
    rows = listProviderKeys();
    const zen = rows.find((p) => p.provider === "zenmux");
    eq("kayit: anahtar okundu", zen?.apiKey, "sk-ai-v1-userkey-222333");
    eq("kayit: kaynak user-config", zen?.source, "user-config");
    eq("kayit: aktif", zen?.active, true);
    eq("kayit: model", zen?.model, "openai/test-model");
    const or2 = rows.find((p) => p.provider === "openrouter");
    eq("kayit: başka sağlayıcı env'den", or2?.apiKey, "sk-or-v1-envkey-000111");
    eq("kayit: başka sağlayıcı aktif değil", or2?.active, false);

    // 3) getProviderKey
    eq("getProviderKey: bulundu", getProviderKey("zenmux")?.apiKey,
      "sk-ai-v1-userkey-222333");
    eq("getProviderKey: yok", getProviderKey("yok-boyle-bir-saglayici"), null);

    // 4) providerKeyReport
    const rep = providerKeyReport("zenmux");
    check("rapor: sağlayıcı adı var", rep.includes("provider: zenmux"));
    check("rapor: anahtar tam değer", rep.includes("sk-ai-v1-userkey-222333"));
    check("rapor: aktif etiketi", rep.includes("(aktif)"));
    const allRep = providerKeyReport();
    check("rapor: tümü listeleniyor", allRep.includes("sk-ai-v1-userkey-222333")
      && allRep.includes("sk-or-v1-envkey-000111"));
    const badRep = providerKeyReport("bilinmeyen-saglayici");
    check("rapor: bilinmeyen sağlayıcı hatası",
      badRep.includes("Hata: bilinmeyen sağlayıcı"), badRep);

    // 5) Maskeleme
    const secrets = knownSecretValues();
    check("maske: bilinen anahtarlar listelendi",
      secrets.includes("sk-ai-v1-userkey-222333")
      && secrets.includes("sk-or-v1-envkey-000111"), JSON.stringify(secrets));
    const red = redactSecrets(
      "curl -H 'Authorization: Bearer sk-ai-v1-userkey-222333' https://x",
    );
    check("maske: anahtar değiştirildi",
      !red.includes("sk-ai-v1-userkey-222333"), red);
    check("maske: mask metni yerinde", red.includes(SECRET_MASK), red);
    check("maske: diğer metin korundu", red.includes("https://x"));

    // 6) Oturum dosyası maskeleme (saveSession gerçek diske yazar)
    const { saveSession, SESSION_DIR } = await import("../src/session-store.js");
    const sid = "test-redact-session";
    saveSession({
      id: sid,
      appName: "app",
      userId: "u",
      events: [{
        content: {
          role: "model",
          parts: [{ text: "anahtar: sk-ai-v1-userkey-222333" }],
        },
      }],
    });
    const file = join(SESSION_DIR, `${sid}.json`);
    const written = readFileSync(file, "utf-8");
    check("oturum: dosya yazildi", existsSync(file));
    check("oturum: anahtar duz metin degil",
      !written.includes("sk-ai-v1-userkey-222333"), written.slice(0, 200));
    check("oturum: maske metni var", written.includes(SECRET_MASK));
    rmSync(file, { force: true });
  } finally {
    // Ortam ve kullanıcı kaydını eski haline getir.
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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
