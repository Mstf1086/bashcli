// Sahte OpenAI-uyumlu sunucu + gerçek ADK Runner ile uçtan uca tool-calling testi.
// Çalıştırma: npx tsx test/mock_e2e.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionService, Runner } from "@google/adk";
import { createAgent } from "../src/agent.js";

const NL = "\n";
const PORT = 8791;
const seen: any[] = [];

function sse(res: any, payload: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : {};
    seen.push(parsed);
    const userTexts = (parsed.messages ?? [])
      .filter((m: any) => m.role === "user")
      .map((m: any) => String(m.content ?? ""));
    const hasToolResult = (parsed.messages ?? []).some((m: any) => m.role === "tool");

    if (!hasToolResult && !userTexts.some((t: string) => t.includes("dosya yaz"))) {
      // 1. tur: read_file aracı çağır
      return sse(res, {
        id: "chatcmpl-1",
        object: "chat.completion",
        model: parsed.model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Önce mevcut dosyayı okuyorum.",
            tool_calls: [{
              id: "call_abc",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: "hello.txt" }) },
            }],
          },
          finish_reason: "tool_calls",
        }],
      });
    }
    // 2. tur: aracı çalıştı, özetle
    return sse(res, {
      id: "chatcmpl-2",
      object: "chat.completion",
      model: parsed.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Dosya içeriği okundu: merhaba dunya" },
        finish_reason: "stop",
      }],
    });
  });
});

await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const ws = mkdtempSync(join(tmpdir(), "agent-ws-"));
process.env.CODING_WORKSPACE = ws;
process.env.PROVIDER = "custom";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.OPENAI_API_KEY = "test-key";
process.env.AGENT_MODEL = "openai/test-model";
process.env.AGENT_NUM_RETRIES = "0";

const svc = new InMemorySessionService();
const agent = createAgent("build");
const runner = new Runner({ agent, sessionService: svc, appName: "test" });
const session = await svc.createSession({ appName: "test", userId: "u1" });

const events: any[] = [];
for await (const ev of runner.runAsync({
  userId: "u1",
  sessionId: session.id,
  newMessage: { role: "user", parts: [{ text: "merhaba.txt dosyasini oku" }] },
})) {
  events.push(ev);
  for (const p of ev.content?.parts ?? []) {
    if (p.functionCall) console.log("TOOL_CALL:", p.functionCall.name, JSON.stringify(p.functionCall.args));
    if (p.functionResponse) console.log("TOOL_RESP:", p.functionResponse.name, JSON.stringify(p.functionResponse.response));
    if (p.text) console.log("TEXT:", p.text);
  }
}

// İstek gövdesini doğrula: tools şeması OpenAI formatında mı?
const last = seen[seen.length - 1];
const tools = last?.tools ?? [];
console.log("--- doğrulama ---");
console.log("istek sayısı:", seen.length);
console.log("model:", last?.model);
console.log("tools:", tools.map((t: any) => t.function?.name).join(", "));
const decl = tools.find((t: any) => t.function?.name === "read_file");
console.log("read_file şeması:", JSON.stringify(decl?.function?.parameters));
console.log("rol sırası:", (last?.messages ?? []).map((m: any) => m.role).join(" > "));
const toolMsg = (last?.messages ?? []).find((m: any) => m.role === "tool");
console.log("tool mesajı:", JSON.stringify(toolMsg));
// 7 araç: list_files, read_file, write_file, edit_file, search_files,
// run_command, get_api_key
const ok = tools.length === 7
  && decl?.function?.parameters?.type === "object"
  && (last?.messages ?? []).some((m: any) => m.role === "tool");
console.log(ok ? "SONUÇ: BAŞARILI" : "SONUÇ: BAŞARISIZ");

server.close();
rmSync(ws, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
