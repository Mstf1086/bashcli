// Sağlayıcı taban URL'i (base URL) regresyon testleri.
//
// Kapsam: her sağlayıcının kendi ucuna gittiği doğrulanır. Özellikle
// "defaultBase boş → istek ZenMux'e düşer" hatasının tekrarlamaması
// kontrol edilir: bu hata Gemini/Anthropic anahtarlarını yanlış sağlayıcıya
// gönderip HTTP 403 üretiyordu.
//
// Çalıştırma: npx tsx test/provider_base_test.ts
import { PROVIDERS, PROVIDER_MAP } from "../src/providers.js";
import { stripProviderPrefix } from "../src/openai_compatible_llm.js";
import { describeError } from "../src/errors.js";

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
  check(name, actual === expected,
    `beklenen=${JSON.stringify(expected)} gerçek=${JSON.stringify(actual)}`);
}

// --- 1) Her sağlayıcının defaultBase'i kendi ucuna işaret etmeli ----------
// Boş bırakılan bir sağlayıcı, isteği "varsayılan" adresine (ZenMux)
// düşürür ve anahtarı yanlış yere gönderir. "custom" bunun istisnasıdır:
// kullanıcı URL'sini elle girer.
{
  for (const spec of PROVIDERS) {
    if (spec.key === "custom") continue;
    check(
      `base: ${spec.key} kendi ucuna işaret ediyor`,
      typeof spec.defaultBase === "string" && spec.defaultBase.length > 0,
      `defaultBase=${String(spec.defaultBase)}`,
    );
    check(
      `base: ${spec.key} başka sağlayıcının adresini içermiyor`,
      spec.key === "zenmux" || !/zenmux\.ai/.test(String(spec.defaultBase)),
      `defaultBase=${String(spec.defaultBase)}`,
    );
  }
}

// --- 2) Bilinen sağlayıcı adresleri --------------------------------------
eq("base: gemini OpenAI-uyumlu ucu",
  PROVIDER_MAP.gemini?.defaultBase,
  "https://generativelanguage.googleapis.com/v1beta/openai");
eq("base: anthropic kendi ucu",
  PROVIDER_MAP.anthropic?.defaultBase,
  "https://api.anthropic.com/v1");
eq("base: openrouter kendi ucu",
  PROVIDER_MAP.openrouter?.defaultBase,
  "https://openrouter.ai/api/v1");
eq("base: groq kendi ucu",
  PROVIDER_MAP.groq?.defaultBase,
  "https://api.groq.com/openai/v1");

// --- 3) Varsayılan modeller kullanılabilir seri ---------------------------
// Gemini 2.5 serisi yeni kullanıcılara kapalı ("no longer available to new
// users"); 3.x serisi kullanılabilir.
{
  const g = PROVIDER_MAP.gemini?.defaultModel ?? "";
  check("model: gemini varsayılanı 3.x serisinde", /^gemini\/gemini-3/.test(g), g);
  check("model: gemini varsayılanı 2.5 serisi değil", !/gemini-2\.5/.test(g), g);
}

// --- 4) Model öneki soyması tüm sağlayıcıları kapsamalı ------------------
// Önek soyulmazsa API'ye "gemini/gemini-3.5-flash" gider ve model bulunamaz.
eq("model: gemini/ öneki soyulur",
  stripProviderPrefix("gemini/gemini-3.5-flash"), "gemini-3.5-flash");
eq("model: anthropic/ öneki soyulur",
  stripProviderPrefix("anthropic/claude-sonnet-4-5"), "claude-sonnet-4-5");
eq("model: openai/ öneki soyulur",
  stripProviderPrefix("openai/gpt-4o-mini"), "gpt-4o-mini");
eq("model: öneksiz korunur",
  stripProviderPrefix("z-ai/glm-4.7-flash-free"), "z-ai/glm-4.7-flash-free");

// --- 5) Hata mesajları ---------------------------------------------------
{
  // Google, 404 gövdesinde hangi modelin kullanılması gerektiğini yazar.
  // Bu ipucu genelleştirilmiş mesajda kaybolursa kullanıcı doğru modeli
  // bulamaz.
  const m = describeError(new Error(
    'OpenAI-uyumlu API HTTP 404: [{"error":{"code":404,"message":'
    + '"This model models/gemini-2.5-flash is no longer available to new '
    + 'users. Please update your code to use models/gemini-3.8-flash for the '
    + 'latest features and improvements."}}]'),
  );
  check("hata: 404 önerilen modeli gösteriyor",
    m.includes("gemini-3.8-flash"), m);
  check("hata: 404 eski modelin kullanılamaz olduğunu söylüyor",
    m.includes("kullanılamıyor") || m.includes("artık"), m);

  // 403 artık "yetki yok" demek yerine doğru sağlayıcıyı önerir.
  const f = describeError(new Error("OpenAI-uyumlu API HTTP 403: forbidden"));
  check("hata: 403 yönlendirme içeriyor", f.includes("/provider"), f);

  // 404'te öneri yoksa genel mesaj korunur.
  const g = describeError(new Error("OpenAI-uyumlu API HTTP 404: not found"));
  check("hata: 404 genel mesaj korunuyor",
    g.includes("Model bulunamadı"), g);
}

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
