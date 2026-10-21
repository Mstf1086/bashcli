// /provider anahtar doğrulama testleri.
//
// Kapsam: yanlış sağlayıcıya ait anahtar tespit edilmeli, doğru eşleşme
// kabul edilmeli, gerçek API hatası anlaşılır biçimde bildirilmeli.
//
// Çalıştırma: npx tsx test/provider_verify_test.ts
import { guessKeyProvider, verifyApiKey } from "../src/providers.js";
import { stripProviderPrefix } from "../src/openai_compatible_llm.js";

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

// --- 1) Anahtar biçiminden sağlayıcı tahmini ------------------------------
eq("anahtar: OpenRouter", guessKeyProvider("sk-or-v1-abc123"), "openrouter");
eq("anahtar: ZenMux", guessKeyProvider("sk-ai-v1-abc123"), "zenmux");
eq("anahtar: Anthropic", guessKeyProvider("sk-ant-api03-abc"), "anthropic");
eq("anahtar: Groq", guessKeyProvider("gsk_abc123"), "groq");
eq("anahtar: Gemini", guessKeyProvider("AIzaSyABC"), "gemini");
eq("anahtar: OpenAI", guessKeyProvider("sk-proj-abc"), "openai");
eq("anahtar: bilinmeyen", guessKeyProvider("xyz"), undefined);

// --- 2) Model adı öneki soyma --------------------------------------------
eq("model: openai/ öneki", stripProviderPrefix("openai/gpt-4o-mini"), "gpt-4o-mini");
eq("model: openrouter/ öneki", stripProviderPrefix("openrouter/google/gemini-2.5-flash"), "google/gemini-2.5-flash");
eq("model: groq/ öneki", stripProviderPrefix("groq/llama-3.3-70b"), "llama-3.3-70b");
eq("model: öneksiz korunur", stripProviderPrefix("z-ai/glm-4.7-flash-free"), "z-ai/glm-4.7-flash-free");
eq("model: vendor/model korunur", stripProviderPrefix("meta/llama-3.1-70b"), "meta/llama-3.1-70b");

// --- 3) Yanlış sağlayıcı tespiti (ağ çağrısı yapılmadan) ----------------
{
  // ZenMux seçilmiş, OpenRouter anahtarı girilmiş → uyarılmalı.
  const r = await verifyApiKey("zenmux", "sk-or-v1-abc123def456", null);
  check("doğrulama: yanlış sağlayıcı yakalandı", !r.ok);
  eq("doğrulama: olası sağlayıcı openrouter", r.likelyProvider, "openrouter");
  check("doğrulama: mesajda ipucu var", r.message.includes("OpenRouter"), r.message);
  // Uyarı kesici hata değildir: akış (kayıt) durmaz, kullanıcı seçtiği
  // sağlayıcıda kalır.
  check("doğrulama: yanlış sağlayıcı uyarısı kesici değil", r.fatal === false, `fatal=${r.fatal}`);

  // Aynı anahtar, doğru sağlayıcıyla → uyarı üretmemeli (ağ denemesi yapılır).
  const r2 = await verifyApiKey("openrouter", "sk-or-v1-abc123def456", "http://127.0.0.1:9/v1");
  check("doğrulama: eşleşen sağlayıcı uyarı üretmiyor", r2.likelyProvider === undefined);
}

// --- 4) Boş anahtar -------------------------------------------------------
{
  const r = await verifyApiKey("zenmux", "", null);
  check("doğrulama: boş anahtar reddediliyor", !r.ok);
  check("doğrulama: boş anahtar kesici hata", r.fatal === true, `fatal=${r.fatal}`);
}

// --- 5) Gerçek hata mesajı (erişilemeyen endpoint) -----------------------
{
  const r = await verifyApiKey("custom", "sk-test-1234567890", "http://127.0.0.1:9/v1");
  check("doğrulama: erişilemeyen endpoint hata veriyor", !r.ok);
  check("doğrulama: hata mesajı anlaşılır", r.message.length > 10, r.message);
}

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
