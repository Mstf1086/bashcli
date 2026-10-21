// Gemini uyumluluk testleri.
//
// Kapsam: Gemini 3.x'in arac cagrilarinda zorunlu kilidigi thought_signature
// mekanizmasi. Imza olmadan ikinci istek HTTP 400 alir:
//   "Function call is missing a thought_signature in functionCall parts."
//
// Calistirma: npx tsx test/gemini_compat_test.ts
import { OpenAiCompatibleLlm } from "../src/openai_compatible_llm.js";

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

// --- 1) Gelen thought_signature yakalanip saklanmali ----------------------
// Gemini, arac cagrisi yanitinda extra_content.google.thought_signature
// dondurur. Bu imza bir sonraki istekte geri gonderilmezse API 400 verir.
{
  const llm = new OpenAiCompatibleLlm({
    model: "gemini/gemini-3.5-flash",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "test-key",
  });
  const res = llm.toLlmResponse({
    content: null,
    tool_calls: [
      {
        id: "call_1",
        function: { name: "list_files", arguments: "{}" },
        extra_content: { google: { thought_signature: "SIG-ABC-123" } },
      },
    ],
  });
  const part = res.content?.parts?.[0] as
    | { functionCall?: { name?: string; thoughtSignature?: string } }
    | undefined;
  eq("imza: arac cagrisi adı korunuyor", part?.functionCall?.name, "list_files");
  eq("imza: thoughtSignature saklanıyor",
    part?.functionCall?.thoughtSignature, "SIG-ABC-123");
}

// --- 2) Imza olmayan yanitta alan eklenmemeli ---------------------------
{
  const llm = new OpenAiCompatibleLlm({
    model: "gemini/gemini-3.5-flash",
    apiBase: "https://x.example/v1",
    apiKey: "k",
  });
  const res = llm.toLlmResponse({
    content: "merhaba",
    tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }],
  });
  const part = res.content?.parts?.[0] as
    | { functionCall?: { thoughtSignature?: string } }
    | undefined;
  check("imza: imza yoksa alan da yok",
    part?.functionCall?.thoughtSignature === undefined,
    JSON.stringify(part));
}

// --- 3) Imza, sonraki istekte geri gonderilmeli -------------------------
// contentToOaiMessages, functionCall icindeki thoughtSignature'i okuyup
// extra_content altina yazar.
{
  const llm = new OpenAiCompatibleLlm({
    model: "gemini/gemini-3.5-flash",
    apiBase: "https://x.example/v1",
    apiKey: "k",
  });
  const { body } = llm.buildRequest({
    model: "gemini/gemini-3.5-flash",
    contents: [
      {
        role: "model",
        parts: [
          {
            functionCall: {
              id: "call_1",
              name: "list_files",
              args: {},
              // ADK'nin functionCall tipi bu alani tanimaz; gercek akista
              // toLlmResponse bunu yerlestirir.
              thoughtSignature: "SIG-XYZ",
            },
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof llm.buildRequest>[0]);
  const messages = (body.messages ?? []) as {
    role: string;
    tool_calls?: {
      extra_content?: { google?: { thought_signature?: string } };
    }[];
  }[];
  const tc = (messages.find((m) => m.role === "assistant")?.tool_calls ?? [])[0];
  eq("imza: istek gövdesinde geri gönderiliyor",
    tc?.extra_content?.google?.thought_signature, "SIG-XYZ");
}

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
