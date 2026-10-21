// OpenAI-uyumlu model (ZenMux dahil): ADK BaseLlm alt sınıfı.
// OpenAI Chat Completions API'sini konuşur; tool-calling destekler.
// ADK; FunctionTool deklarasyonlarını llmRequest.config.tools içine
// Gemini FunctionDeclaration formatında koyar; biz OpenAI formatına çeviririz.
import { BaseLlm, type BaseLlmConnection } from "@google/adk";
import type {
  Content,
  FunctionDeclaration,
  GenerateContentResponse,
  Part,
} from "@google/genai";
import type { LlmRequest, LlmResponse } from "@google/adk";

export interface OpenAiCompatibleParams {
  model: string;
  apiBase: string;
  apiKey?: string;
  temperature?: number;
  maxRetries?: number;
}

/** OpenAI uyumlu araç çağrısı. */
interface OaiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /**
   * Gemini 3.x, araç çağrısı yanıtında `extra_content.google.thought_signature`
   * döndürür ve bir sonraki istekte bunun geri gönderilmesini zorunlu kılar.
   * Sağlayıcıdan bağımsız tutmak için isteğe bağlı alan olarak tanımlandı.
   */
  extra_content?: { google?: { thought_signature?: string } };
}

interface OaiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** Gemini Schema (OBJECT/STRING) → OpenAI JSON Schema (object/string). */
function lowerSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lowerSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : lowerSchema(v);
    }
    return out;
  }
  return node;
}

function declToOaiTool(decl: FunctionDeclaration): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: decl.name ?? "unnamed",
      description: decl.description ?? "",
      parameters: lowerSchema(decl.parameters ?? { type: "OBJECT", properties: {} }),
    },
  };
}

/**
 * Sağlayıcı önekini model adından çıkarır.
 *
 * LiteLLM benzeri önekler ("openai/", "openrouter/", "groq/", "ollama/") API'ye
 * gönderilmemelidir; ancak OpenRouter "vendor/model" biçimini kullanır, bu
 * yüzden yalnızca ilk segment çıkarılır.
 *
 * Önek olmayan adlar (ör. "z-ai/glm-4.7-flash-free") olduğu gibi korunur.
 */
export function stripProviderPrefix(model: string): string {
  const PREFIXES = ["openai/", "openrouter/", "groq/", "ollama/", "anthropic/", "gemini/"];
  for (const p of PREFIXES) {
    if (model.startsWith(p)) return model.slice(p.length);
  }
  return model;
}

/**
 * ADK'nın sistem talimatını metne çevirir.
 *
 * ADK iki biçim kullanabiliyor:
 *   - `appendInstructions()` talimatı doğrudan **string** olarak yazar
 *     (`llmRequest.config.systemInstruction = newInstructions`).
 *   - Bazı sürümler `{ parts: [{ text }] }` biçiminde bir yapı bekler.
 *
 * İkisi de desteklenir; aksi halde talimat sessizce düşer ve model
 * "Sen bir kodlama ajanısın" yönergesini hiç almaz.
 */
export function extractSystemInstruction(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const parts = (value as { parts?: { text?: string }[] }).parts;
  if (Array.isArray(parts)) {
    return parts.map((p) => p.text ?? "").filter(Boolean).join("\n");
  }
  // Yapıda doğrudan "text" alanı varsa onu da kabul et.
  const text = (value as { text?: string }).text;
  return typeof text === "string" ? text : "";
}

function contentToOaiMessages(c: Content): OaiMessage[] {
  const role = c.role === "model" ? "assistant" : c.role === "function" ? "tool" : "user";
  const parts = c.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
  const calls = parts.filter((p) => p.functionCall?.name);
  const resps = parts.filter((p) => p.functionResponse?.name);
  if (resps.length) {
    return resps.map((p) => ({
      role: "tool",
      tool_call_id: p.functionResponse!.id ?? p.functionResponse!.name!,
      content: JSON.stringify(p.functionResponse!.response ?? {}),
    }));
  }
  if (calls.length) {
    return [
      {
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((p, i) => {
          const tc: OaiToolCall = {
            id: p.functionCall!.id ?? `call_${i}`,
            type: "function" as const,
            function: {
              name: p.functionCall!.name!,
              arguments: JSON.stringify(p.functionCall!.args ?? {}),
            },
          };
          // Gemini 3.x, araç çağrısını izleyen istekte thought_signature'ın
          // geri gönderilmesini zorunlu tutuyor. ADK bu imzayı functionCall
          // içinde taşımadığı için, biz alttaki alandan okuyup ekliyoruz.
          const sig = (p.functionCall as { thoughtSignature?: string } | undefined)
            ?.thoughtSignature;
          if (sig) (tc as OaiToolCall & { extra_content?: unknown }).extra_content =
            { google: { thought_signature: sig } };
          return tc;
        }),
      },
    ];
  }
  return [{ role, content: text || "(boş)" }];
}

export class OpenAiCompatibleLlm extends BaseLlm {
  static readonly supportedModels: Array<string | RegExp> = [/.*/];
  readonly apiBase: string;
  readonly apiKey?: string;
  readonly temperature: number;
  readonly maxRetries: number;

  constructor({ model, apiBase, apiKey, temperature, maxRetries }: OpenAiCompatibleParams) {
    super({ model });
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.temperature = temperature ?? 0.2;
    this.maxRetries = maxRetries ?? 5;
  }

  /**
   * İstek gövdesini ve başlıkları kurar.
   *
   * Ayrı bir metot olarak tutuldu: gövdenin içeriği (özellikle Gemini 3.x'in
   * `thought_signature` geri gönderimi) regresyon testleriyle doğrulanır.
   */
  buildRequest(llmRequest: LlmRequest): {
    body: Record<string, unknown>;
    headers: Record<string, string>;
  } {
    const cfg = (llmRequest.config ?? {}) as Record<string, unknown>;
    const system = extractSystemInstruction(cfg.systemInstruction);

    const tools: Record<string, unknown>[] = [];
    for (const t of (cfg.tools as { functionDeclarations?: FunctionDeclaration[] }[] | undefined) ?? []) {
      for (const d of t.functionDeclarations ?? []) tools.push(declToOaiTool(d));
    }

    // ADK, gerekirse sonuna "devam et" mesajı ekler; ekleme yapılmadan
    // önce OpenAI mesaj listesini kurmamız gerekiyor.
    this.maybeAppendUserContent(llmRequest);

    const messages: OaiMessage[] = [];
    if (system) messages.push({ role: "system", content: system });
    for (const c of llmRequest.contents ?? []) {
      messages.push(...contentToOaiMessages(c));
    }

    // Sağlayıcı öneki API'ye gönderilmez:
    //   "openai/slug"        → "slug"
    //   "openrouter/vendor/m" → "vendor/m"   (OpenRouter vendor/model ister)
    //   "groq/slug"          → "slug"
    // Önek olmayan model adları (ör. "z-ai/glm-4.7") olduğu gibi korunur.
    const modelId = stripProviderPrefix(this.model);

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: this.temperature,
    };
    // max_tokens açıkça gönderilir: sağlayıcılar yoksa modelin azami
    // değerini kullanır (örn. 65535) ve düşük bakiyeli hesaplarda istek
    // "requires more credits" hatasıyla reddedilir. AGENT_MAX_TOKENS ile
    // ayarlanabilir.
    const maxTokens = parseInt(process.env.AGENT_MAX_TOKENS ?? "4096", 10);
    if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    return { body, headers };
  }

  async *generateContentAsync(
    llmRequest: LlmRequest,
    _stream?: boolean,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    const { body, headers } = this.buildRequest(llmRequest);

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Kullanıcı isteği iptal ettiyse yeniden deneme yok: istek hemen durur.
      if (abortSignal?.aborted) return;
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      // Zaman aşımı ve kullanıcı iptali tek sinyalde birleştirilir:
      // ESC'ye basıldığında açık HTTP isteği de düşer (bağlantı açık kalmasın).
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(), 120_000);
      const ctrl = abortSignal
        ? AbortSignal.any([timeoutCtrl.signal, abortSignal])
        : timeoutCtrl.signal;
      try {
        const resp = await fetch(`${this.apiBase}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: ctrl,
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          // Yalnızca geçici/yoğunluk hataları yeniden denenir; 4xx (kötü anahtar,
          // bakiye yok, geçersiz model) kalıcıdır ve tekrar denenmez.
          const retryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(resp.status);
          const err = new Error(`OpenAI-uyumlu API HTTP ${resp.status}: ${txt.slice(0, 400)}`);
          if (process.env.AGENT_DEBUG) {
            console.error(`[llm] HTTP ${resp.status} (deneme ${attempt + 1}/${this.maxRetries + 1}, `
              + `retry=${retryable}): ${txt.slice(0, 500)}`);
          }
          if (!retryable || attempt === this.maxRetries) throw err;
          lastErr = err;
          continue;
        }
        const data = (await resp.json()) as {
          choices?: {
            message?: {
              content?: string | null;
              tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
            };
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        yield this.toLlmResponse(data.choices?.[0]?.message ?? {}, data.usage);
        return;
      } catch (e) {
        // Kalıcı HTTP hataları yukarıda fırlatıldı; buraya yalnızca ağ/timeout
        // hataları ve yeniden denenecek durumlar düşer.
        if (e instanceof Error && e.message.startsWith("OpenAI-uyumlu API HTTP")) throw e;
        // Kullanıcı iptali bir hata değildir: sessizce sonlanır.
        if (abortSignal?.aborted) return;
        lastErr = e;
        if (process.env.AGENT_DEBUG) {
          console.error(`[llm] istisna (deneme ${attempt + 1}/${this.maxRetries + 1}):`,
            e instanceof Error ? `${e.name}: ${e.message}` : e);
        }
        if (attempt === this.maxRetries) throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * Model yanıtını ADK'nin beklediği biçime çevirir.
   *
   * Test edilebilirlik için public: `thoughtSignature` taşıma davranışı
   * (Gemini 3.x uyumluluğu) regresyon testleri tarafından doğrulanır.
   */
  toLlmResponse(
    msg: {
      content?: string | null;
      tool_calls?: {
        id?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: { google?: { thought_signature?: string } };
      }[];
    },
    usage?: { prompt_tokens?: number; completion_tokens?: number },
  ): LlmResponse {
    const parts: Content["parts"] = [];
    if (msg.content) parts.push({ text: msg.content });
    for (const tc of msg.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        args = { _raw: tc.function?.arguments ?? "" };
      }
      const fc: Record<string, unknown> = {
        id: tc.id,
        name: tc.function?.name ?? "",
        args,
      };
      // Gemini 3.x imzası: sonraki istekte geri gönderilmek üzere saklanır.
      // ADK'nın functionCall tipi bu alanı tanımaz; alttaki "thoughtSignature"
      // anahtarından okunur (bkz. contentToOaiMessages).
      const sig = tc.extra_content?.google?.thought_signature;
      if (sig) fc.thoughtSignature = sig;
      parts.push({ functionCall: fc } as unknown as Part);
    }
    if (!parts.length) parts.push({ text: "" });
    const content = { role: "model", parts } as Content;
    // ADK, token sayısını LlmResponse.usageMetadata üzerinden bekler; bu alan
    // event'e kopyalanır. Boş bırakılırsa ADK token sayısını tahmin eder
    // ( karakter/4 ) ve kullanıcı gerçek tüketimi göremez.
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    return {
      content,
      usageMetadata: {
        promptTokenCount: promptTokens,
        candidatesTokenCount: completionTokens,
        totalTokenCount: promptTokens + completionTokens,
      },
    } as LlmResponse;
  }

  /**
   * Canlı (live) bağlantı — ADK'nın `BaseLlm` sözleşmesi bunu abstract
   * tanımlar, bu yüzden uygulanmak zorundadır.
   *
   * bashcli canlı/streaming konuşma kullanmaz; her tur tam yanıt bekler.
   * Bu yüzden bağlantı bilerek reddedilir: sessizce yarım çalışan bir
   * canlı akış yerine açık bir hata verir.
   */
  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("OpenAiCompatibleLlm: canlı (live) bağlantı desteklenmiyor.");
  }
}

