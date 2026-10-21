// LLM sağlayıcı kayıt defteri: Python providers.py'nin TS karşılığı.
// Sağlayıcı seçimi + model listeleme + .env kaydı.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readUserProvider, saveUserProvider } from "./user-config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, "..");

/**
 * Ajanın kendi .env dosyasının yolu.
 *
 * Varsayılan: ajan kökündeki `.env` (kurulum dizini).
 * `BASHCLI_ENV` ile başka bir yola yönlendirilebilir — testler bunu
 * geçici bir dosyaya çekerek gerçek kullanıcı ayarlarına dokunmadan
 * hermetik çalışır (`BASHCLI_HOME` ile aynı deseni paylaşır).
 */
export const ENV_PATH = process.env.BASHCLI_ENV
  ? resolve(process.env.BASHCLI_ENV)
  : join(PROJECT_ROOT, ".env");

export interface ProviderSpec {
  key: string;
  label: string;
  keyEnv: string | null;
  baseEnv: string | null;
  defaultBase: string | null;
  modelsKind: "openai" | "anthropic" | "gemini";
  litellmPrefix: string;
  defaultModel: string;
  needsKey?: boolean;
  note?: string;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    key: "zenmux", label: "ZenMux (210+ model aggregator)",
    keyEnv: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE",
    defaultBase: "https://zenmux.ai/api/v1", modelsKind: "openai",
    litellmPrefix: "openai/", defaultModel: "openai/z-ai/glm-4.7-flash-free",
    note: "Bakiye yoksa ücretsiz modeller çalışır.",
  },
  {
    key: "openai", label: "OpenAI (GPT serisi)",
    keyEnv: "OPENAI_API_KEY", baseEnv: "OPENAI_BASE_URL",
    defaultBase: "https://api.openai.com/v1", modelsKind: "openai",
    litellmPrefix: "openai/", defaultModel: "openai/gpt-4o-mini",
  },
  {
    key: "anthropic", label: "Anthropic (Claude serisi)",
    keyEnv: "ANTHROPIC_API_KEY", baseEnv: null,
    // Anthropic'in OpenAI-uyumlu ucu. Boş bırakılırsa istek ZenMux'e düşer
    // ve Anthropic anahtarı yanlış sağlayıcıya gönderilir (HTTP 403).
    defaultBase: "https://api.anthropic.com/v1",
    modelsKind: "anthropic", litellmPrefix: "anthropic/",
    defaultModel: "anthropic/claude-sonnet-4-5",
  },
  {
    key: "gemini", label: "Google Gemini",
    keyEnv: "GEMINI_API_KEY", baseEnv: null,
    // Gemini'nin OpenAI-uyumlu ucu. Boş bırakılırsa istek varsayılan
    // olarak ZenMux'e düşer ve Gemini anahtarı yanlış sağlayıcıya gider
    // (HTTP 403). Bu yüzden açıkça yazılır.
    defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelsKind: "gemini", litellmPrefix: "gemini/",
    // 2.5 serisi yeni kullanıcılara kapalı ("no longer available to new
    // users"); 3.x serisi kullanılabilir.
    defaultModel: "gemini/gemini-3.5-flash",
  },
  {
    key: "openrouter", label: "OpenRouter (çok sağlayıcı)",
    keyEnv: "OPENROUTER_API_KEY", baseEnv: null,
    defaultBase: "https://openrouter.ai/api/v1", modelsKind: "openai",
    litellmPrefix: "openrouter/", defaultModel: "openrouter/openai/gpt-4o-mini",
  },
  {
    key: "groq", label: "Groq (hızlı açık modeller)",
    keyEnv: "GROQ_API_KEY", baseEnv: null,
    defaultBase: "https://api.groq.com/openai/v1", modelsKind: "openai",
    litellmPrefix: "groq/", defaultModel: "groq/llama-3.3-70b-versatile",
  },
  {
    key: "ollama", label: "Ollama (yerel modeller)",
    keyEnv: null, baseEnv: "OLLAMA_API_BASE",
    defaultBase: "http://localhost:11434/v1", modelsKind: "openai",
    litellmPrefix: "ollama/", defaultModel: "ollama/llama3.2",
    needsKey: false, note: "Yerel Ollama sunucusu açık olmalı.",
  },
  {
    key: "custom", label: "Özel OpenAI-uyumlu endpoint",
    keyEnv: "OPENAI_API_KEY", baseEnv: "OPENAI_BASE_URL",
    defaultBase: null, modelsKind: "openai", litellmPrefix: "openai/",
    defaultModel: "", note: "Base URL ve model adını elle gireceksiniz.",
  },
];

export const PROVIDER_MAP: Record<string, ProviderSpec> = Object.fromEntries(
  PROVIDERS.map((p) => [p.key, p]),
);

export interface LlmKwargs {
  model: string;
  apiBase?: string;
  apiKey?: string;
}

/** Env'den OpenAiCompatibleLlm'e geçilecek {model, apiBase?, apiKey?}. */
export function currentLlmKwargs(): LlmKwargs {
  // Öncelik sırası: kullanıcı cihazındaki kayıt → .env → varsayılanlar.
  const user = readUserProvider();
  const spec = PROVIDER_MAP[process.env.PROVIDER ?? "zenmux"] ?? PROVIDER_MAP.zenmux;

  if (user?.model) {
    const userSpec = PROVIDER_MAP[user.provider] ?? spec;
    const kwargs: LlmKwargs = { model: user.model };
    const base = user.baseUrl ?? (userSpec.baseEnv ? process.env[userSpec.baseEnv] : undefined)
      ?? userSpec.defaultBase ?? undefined;
    const key = user.apiKey
      ?? (userSpec.keyEnv ? process.env[userSpec.keyEnv] : undefined);
    if (base) kwargs.apiBase = base;
    if (key) kwargs.apiKey = key;
    return kwargs;
  }

  const kwargs: LlmKwargs = { model: process.env.AGENT_MODEL ?? spec.defaultModel };
  const base = (spec.baseEnv ? process.env[spec.baseEnv] : undefined)
    ?? spec.defaultBase ?? undefined;
  const key = spec.keyEnv ? process.env[spec.keyEnv] : undefined;
  if (base) kwargs.apiBase = base;
  if (key) kwargs.apiKey = key;
  return kwargs;
}

/** Bir sağlayıcının çözülmüş anahtar/bilgi kaydı. */
export interface ProviderKeyInfo {
  /** Sağlayıcı anahtarı (örn. "openrouter"). */
  provider: string;
  /** Görünen ad. */
  label: string;
  /** API anahtarı (yoksa null). */
  apiKey: string | null;
  /** Temel URL. */
  baseUrl: string | null;
  /** Model adı. */
  model: string | null;
  /** Anahtarın okunduğu ortam değişkeni (yoksa null). */
  envVar: string | null;
  /** Anahtarın kaynağı. */
  source: "user-config" | "env" | "none";
  /** Aktif sağlayıcı mı? */
  active: boolean;
}

/**
 * Tüm sağlayıcıların API anahtarı bilgilerini çözer.
 *
 * Öncelik: kullanıcı cihazındaki kayıt (~/.bashcli/providers.json, yalnızca
 * aktif sağlayıcı için) → ortam değişkeni (spec.keyEnv). Ortam değişkenleri
 * ajanın kendi .env'i ve çalışılan projenin .env'i yüklenmiş olduğu için
 * doludur.
 */
export function listProviderKeys(): ProviderKeyInfo[] {
  const user = readUserProvider();
  const activeKey = user?.provider ?? process.env.PROVIDER ?? "zenmux";
  return PROVIDERS.map((spec) => {
    const active = spec.key === activeKey;
    const userKey = active ? user?.apiKey : undefined;
    const envKey = spec.keyEnv ? process.env[spec.keyEnv] : undefined;
    const baseUrl = (active ? user?.baseUrl : undefined)
      ?? (spec.baseEnv ? process.env[spec.baseEnv] : undefined)
      ?? spec.defaultBase
      ?? null;
    return {
      provider: spec.key,
      label: spec.label,
      apiKey: userKey ?? envKey ?? null,
      baseUrl,
      model: active ? (user?.model ?? spec.defaultModel) : spec.defaultModel,
      envVar: spec.keyEnv,
      source: userKey ? "user-config" : envKey ? "env" : "none",
      active,
    };
  });
}

/** Tek bir sağlayıcının anahtar kaydını döndürür (yoksa null). */
export function getProviderKey(providerKey: string): ProviderKeyInfo | null {
  return listProviderKeys().find((p) => p.provider === providerKey) ?? null;
}

/** Anahtar kaydını okunabilir metne çevirir. */
function formatProviderKey(p: ProviderKeyInfo): string {
  return [
    `provider: ${p.provider}${p.active ? " (aktif)" : ""}`,
    `label: ${p.label}`,
    `api_key: ${p.apiKey ?? "(yok)"}`,
    `base_url: ${p.baseUrl ?? "(yok)"}`,
    `model: ${p.model ?? "(yok)"}`,
    `source: ${p.source === "env" ? `env (${p.envVar})` : p.source}`,
  ].join("\n");
}

/**
 * API anahtarı raporunu metin olarak üretir.
 *
 * `providerKey` verilmezse anahtarı olan tüm sağlayıcılar listelenir.
 * Hem ajanın `get_api_key` aracı hem `/keys` komutu bunu kullanır.
 */
export function providerKeyReport(providerKey?: string): string {
  const all = listProviderKeys();
  if (providerKey) {
    const found = all.find((p) => p.provider === providerKey);
    if (!found) {
      return `Hata: bilinmeyen sağlayıcı: ${providerKey}. `
        + `Seçenekler: ${PROVIDERS.map((p) => p.key).join(", ")}`;
    }
    return formatProviderKey(found);
  }
  const withKey = all.filter((p) => p.apiKey);
  if (!withKey.length) {
    return "Hiçbir sağlayıcı için API anahtarı bulunamadı; /provider ile anahtar girin.";
  }
  return withKey.map(formatProviderKey).join("\n\n");
}

/** Anahtar doğrulama sonucu. */
export interface KeyCheck {
  ok: boolean;
  /** Kullanıcıya gösterilecek açıklama. */
  message: string;
  /** Anahtarın ait olabileceği başka bir sağlayıcı (tespit edildiyse). */
  likelyProvider?: string;
  /**
   * Kesin hata mı? Kesin hatalar (boş anahtar) akışı durdurur; yanlış
   * sağlayıcı uyarısı ve ağ/kota hataları yalnızca uyarı olarak bildirilir.
   */
  fatal?: boolean;
}

/**
 * Anahtarın ait olduğu sağlayıcıyı, anahtar biçiminden tahmin eder.
 *
 * Her sağlayıcının anahtarı kendi önekini taşır; bu, kullanıcının yanlış
 * sağlayıcıya ait anahtarı yapıştırmasını erkenden yakalamamıza yardım eder.
 */
export function guessKeyProvider(apiKey: string): string | undefined {
  const k = apiKey.trim();
  if (k.startsWith("sk-or-v1-")) return "openrouter";
  if (k.startsWith("sk-ai-v1-")) return "zenmux";
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("gsk_") || k.startsWith("gsk-")) return "groq";
  if (k.startsWith("AIza")) return "gemini";
  if (k.startsWith("sk-")) return "openai";
  return undefined;
}

/**
 * API anahtarını seçilen sağlayıcıya karşı doğrular.
 *
 * Model listesi uçları bazı sağlayıcılarda yetkisiz anahtarla da çalışabilir;
 * bu yüzden doğrulama gerçek bir sohbet isteğiyle yapılır. Hatalı sağlayıcı
 * seçilmişse kullanıcı, doğru sağlayıcıya yönlendirilir.
 */
export async function verifyApiKey(
  providerKey: string,
  apiKey: string,
  baseUrl: string | null,
): Promise<KeyCheck> {
  const spec = PROVIDER_MAP[providerKey];
  if (!spec) return { ok: false, message: `Bilinmeyen sağlayıcı: ${providerKey}` };
  if (!apiKey) return { ok: false, fatal: true, message: "API anahtarı boş." };

  const likely = guessKeyProvider(apiKey);
  const base = ((baseUrl ?? spec.defaultBase ?? "") as string).replace(/\/+$/, "");

  // Anahtar biçimi başka bir sağlayıcıya aitse, istek yapmadan uyar.
  // Bu bir uyarıdır, kesici hata değil: kullanıcı seçtiği sağlayıcıda
  // kalmaya devam edebilir (kayıt engellenmez).
  if (likely && likely !== providerKey && providerKey !== "custom") {
    const other = PROVIDER_MAP[likely];
    return {
      ok: false,
      fatal: false,
      likelyProvider: likely,
      message: `Bu anahtar ${other?.label ?? likely} formatında görünüyor, `
        + `ama ${spec.label} seçildi. Yanlış sağlayıcıya ait bir anahtar `
        + "kaydedilirse tüm istekler reddedilir.",
    };
  }

  if (spec.modelsKind === "anthropic") {
    try {
      await httpGetJson("https://api.anthropic.com/v1/models?limit=1", {
        Accept: "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      });
      return { ok: true, message: "Anahtar doğrulandı." };
    } catch (e) {
      return { ok: false, message: `Anahtar doğrulanamadı: ${errText(e)}` };
    }
  }

  if (!base) {
    return { ok: true, message: "Base URL girilmedi; doğrulama yapılamadı." };
  }

  // OpenAI-uyumlu: küçük bir sohbet isteği gönder.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: stripPrefix(spec.defaultModel || spec.litellmPrefix + "gpt-4o-mini"),
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
      }),
      signal: ctrl.signal,
    });
    if (resp.ok) return { ok: true, message: "Anahtar doğrulandı." };
    const body = await resp.text().catch(() => "");
    return {
      ok: false,
      // HTTP hatası kesin değildir: kota (429) ya da bakiye (402) durumunda
      // akış devam etmeli, kullanıcı model listesine geçebilsin.
      message: `Anahtar doğrulanamadı (HTTP ${resp.status}): `
        + `${body.slice(0, 200)}`,
    };
  } catch (e) {
    return { ok: false, message: `Anahtar doğrulanamadı: ${errText(e)}` };
  } finally {
    clearTimeout(t);
  }
}

/** Sağlayıcı önekini model adından çıkarır (openai/, openrouter/, ...). */
function stripPrefix(model: string): string {
  for (const p of ["openai/", "openrouter/", "groq/", "ollama/", "anthropic/", "gemini/"]) {
    if (model.startsWith(p)) return model.slice(p.length);
  }
  return model;
}

/** Hata nesnesinden okunabilir metin çıkarır. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
}


async function httpGetJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${url} — ${body.slice(0, 200)}`);
    }
    return resp.json();
  } finally {
    clearTimeout(t);
  }
}

/** Sağlayıcının model listesini çeker (alfabetik, tekilsiz). */
export async function fetchModels(
  providerKey: string,
  apiKey: string | null,
  baseUrl: string | null,
): Promise<string[]> {
  const spec = PROVIDER_MAP[providerKey];
  if (!spec) throw new Error(`Bilinmeyen sağlayıcı: ${providerKey}`);

  let ids: string[] = [];
  if (spec.modelsKind === "openai") {
    const base = ((baseUrl ?? spec.defaultBase ?? "") as string).replace(/\/+$/, "");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const data = (await httpGetJson(`${base}/models`, headers)) as {
      data?: { id?: string }[];
    };
    ids = (data.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
  } else if (spec.modelsKind === "anthropic") {
    const data = (await httpGetJson("https://api.anthropic.com/v1/models?limit=1000", {
      Accept: "application/json",
      "x-api-key": apiKey ?? "",
      "anthropic-version": "2023-06-01",
    })) as { data?: { id?: string }[] };
    ids = (data.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
  } else if (spec.modelsKind === "gemini") {
    // OpenAI-uyumlu uç kullanılır: burada dönen model kimlikleri (models/
    // öneki atılmış hali) sohbet isteğinde gönderilen kimliklerle birebir
    // aynıdır. Native uç (`/v1beta/models`) hem farklı kimlikler döndürür
    // hem de anahtarı sorgu dizesine gömerek günlüklere sızdırır.
    const data = (await httpGetJson(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
      { Accept: "application/json", Authorization: `Bearer ${apiKey ?? ""}` },
    )) as { data?: { id?: string }[] };
    for (const m of data.data ?? []) {
      const name = (m.id ?? "").replace(/^models\//, "");
      if (name) ids.push(name);
    }
    // Gemini'ın model listesi metin dışı modelleri de içerir (görsel üretimi,
    // TTS, ses/transcribe, canlı akış, gömme/embedding, video üretimi).
    // Bunlar sohbet isteğinde kullanılamaz; listeye girerse kullanıcı seçip
    // hata alır. Bu yüzden elenir.
    const NON_CHAT = new RegExp(
      "-(image|tts|transcribe|audio|robotics|computer-use|live|embedding|banana)"
      + "|^(lyria|deep-research|antigravity|nano-banana|aqa|veo|embedding)",
      "i",
    );
    ids = ids.filter((id) => !NON_CHAT.test(id));
  } else {
    throw new Error(`Desteklenmeyen kind: ${spec.modelsKind}`);
  }
  return [...new Set(ids)].sort();
}

/** `.env` dosyasındaki anahtarları güncelle/ekle ve process.env'e uygula. */
export function saveEnv(updates: Record<string, string>): void {
  let lines: string[] = [];
  if (existsSync(ENV_PATH)) {
    lines = readFileSync(ENV_PATH, "utf-8").split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
  }
  for (const [key, value] of Object.entries(updates)) {
    const prefix = `${key}=`;
    const i = lines.findIndex((l) => l.trimStart().startsWith(prefix));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
    process.env[key] = value;
  }
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

/** Sağlayıcı seçimini .env'e kaydet. */
/**
 * Sağlayıcı seçimini kaydeder.
 *
 * Ayarlar **yalnızca kullanıcının cihazında** (~/.bashcli/providers.json)
 * saklanır; ajanın .env dosyasına yazılmaz. Böylece:
 *  - Anahtar ajan güncellendiğinde ya da taşındığında korunur
 *  - Ajanın kurulum dizini değişmez (birden fazla ajan aynı ayarı kullanır)
 *  - Dosya yalnızca sahibi tarafından okunabilir (0600)
 */
export function saveProvider(
  providerKey: string,
  apiKey: string | null,
  baseUrl: string | null,
  model: string,
): void {
  const spec = PROVIDER_MAP[providerKey];
  const base = baseUrl ?? spec?.defaultBase ?? undefined;
  saveUserProvider({
    provider: providerKey,
    apiKey: apiKey ?? undefined,
    baseUrl: base ?? undefined,
    model,
  });
  // Çalışan sürecin env'ini de güncelle: yeni ayarlar hemen geçerli olsun.
  process.env.PROVIDER = providerKey;
  process.env.AGENT_MODEL = model;
}
