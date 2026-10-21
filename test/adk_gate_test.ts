// ADK entegrasyon testi: onay kapısı (beforeToolCallback) + token takibi.
//
// Kapsam:
//   - Onay kapısı araç gövdesine gömülü değil, beforeToolCallback'te.
//     Reddedilen araç ÇALIŞMAZ; modele "onaylamadı" mesajı gider.
//   - Onay isteyen araçlar: write_file, edit_file, run_command.
//   - Okuma araçları (read_file) onay istemez.
//   - usageMetadata ADK event'ine taşınır (token sayacı çalışır).
//
// Çalıştırma: npx tsx test/adk_gate_test.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionService, Runner } from "@google/adk";
import { createAgent } from "../src/agent.js";
import { setApprovalHook } from "../src/approval.js";
import { addUsage, emptyUsage, formatTokens } from "../src/token-usage.js";

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

const PORT = 8794;
const seen: any[] = [];
/** Modelin çağırması istendiği araç. */
let plannedTool: { name: string; args: Record<string, unknown> } | null = null;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : {};
    seen.push(parsed);
    const hasToolResult = (parsed.messages ?? []).some((m: any) => m.role === "tool");
    res.writeHead(200, { "Content-Type": "application/json" });
    if (!hasToolResult && plannedTool) {
      const t = plannedTool;
      plannedTool = null;
      res.end(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        model: parsed.model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: t.name, arguments: JSON.stringify(t.args) },
            }],
          },
          finish_reason: "tool_calls",
        }],
        // Token kullanımı: ADK usageMetadata'ının kaynağı.
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }));
      return;
    }
    res.end(JSON.stringify({
      id: "chatcmpl-2",
      object: "chat.completion",
      model: parsed.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Bitti." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    }));
  });
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const ws = mkdtempSync(join(tmpdir(), "adk-gate-"));
process.env.CODING_WORKSPACE = ws;
process.env.PROVIDER = "custom";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.OPENAI_API_KEY = "test-key";
process.env.AGENT_MODEL = "openai/test-model";
process.env.AGENT_NUM_RETRIES = "0";

const svc = new InMemorySessionService();
const agent = createAgent("build");
const runner = new Runner({ agent, sessionService: svc, appName: "test" });

/** Bir aracı çalıştırıp event'leri toplar. */
async function runTool(name: string, args: Record<string, unknown>) {
  plannedTool = { name, args };
  const session = await svc.createSession({ appName: "test", userId: "u1" });
  const events: any[] = [];
  for await (const ev of runner.runAsync({
    userId: "u1",
    sessionId: session.id,
    newMessage: { role: "user", parts: [{ text: "aracı çalıştır" }] },
  })) {
    events.push(ev);
  }
  return events;
}

/** Bir event'teki functionResponse metnini döndürür. */
function toolResponseText(events: any[]): string {
  for (const ev of events) {
    for (const p of ev.content?.parts ?? []) {
      if (p.functionResponse) {
        const r = (p.functionResponse as { response?: unknown }).response;
        return typeof r === "string" ? r : JSON.stringify(r ?? "");
      }
    }
  }
  return "";
}

// --- 1) Onay REDDEDILDI: arac calismamali -------------------------------
{
  const asked: string[] = [];
  setApprovalHook(async (req) => { asked.push(req.tool); return false; });
  plannedTool = { name: "write_file", args: { path: "yazilacak.txt", content: "x" } };
  const events = await runTool("write_file", { path: "yazilacak.txt", content: "x" });
  check("red: onay soruldu", asked.includes("write_file"), JSON.stringify(asked));
  check("red: dosya yazilmadi", !existsSync(join(ws, "yazilacak.txt")));
  const resp = toolResponseText(events);
  check("red: modele onay mesaji gitti", resp.includes("onaylamadı"), resp);
}

// --- 2) Onay VERILDI: arac calismali ------------------------------------
{
  setApprovalHook(async () => true);
  plannedTool = { name: "write_file", args: { path: "yazilsin.txt", content: "merhaba" } };
  const events = await runTool("write_file", { path: "yazilsin.txt", content: "merhaba" });
  check("onay: dosya yazildi", existsSync(join(ws, "yazilsin.txt")));
  check("onay: icerik dogru",
    readFileSync(join(ws, "yazilsin.txt"), "utf-8") === "merhaba");
  check("onay: modele basarili sonuc gitti",
    !toolResponseText(events).includes("onaylamadı"));
}

// --- 3) Okuma araci onay istemez -----------------------------------------
{
  const asked: string[] = [];
  setApprovalHook(async (req) => { asked.push(req.tool); return false; });
  plannedTool = { name: "read_file", args: { path: "yazilsin.txt" } };
  await runTool("read_file", { path: "yazilsin.txt" });
  check("okuma: onay sorulmadi", !asked.includes("read_file"), JSON.stringify(asked));
}

// --- 4) Onay ozeti icerigi dogru -----------------------------------------
{
  let summary = "";
  setApprovalHook(async (req) => { summary = req.summary; return false; });
  plannedTool = { name: "run_command", args: { command: "echo test" } };
  await runTool("run_command", { command: "echo test" });
  check("ozet: komut yaziyor", summary.includes("echo test"), summary);
}

// --- 5) usageMetadata event'e tasiniyor ----------------------------------
{
  setApprovalHook(async () => true);
  const events = await runTool("read_file", { path: "yazilsin.txt" });
  const withUsage = events.filter((e) => e.usageMetadata);
  check("usage: event'te usageMetadata var", withUsage.length > 0);
  const total = withUsage.reduce(
    (sum, e) => sum + (e.usageMetadata?.totalTokenCount ?? 0), 0);
  check("usage: token toplami hesaplandi", total > 0, String(total));
}

// --- 6) Token sayaci yardimcisi ------------------------------------------
{
  let u = emptyUsage();
  check("tokens: baslangic bos", u.total === 0 && u.calls === 0);
  u = addUsage(u, { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 });
  u = addUsage(u, { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 });
  check("tokens: toplam birikiyor", u.total === 180, String(u.total));
  check("tokens: cagri sayisi", u.calls === 2, String(u.calls));
  check("tokens: giris ayri tutuluyor", u.prompt === 150, String(u.prompt));
  check("tokens: format", formatTokens(999) === "999", formatTokens(999));
  check("tokens: format bin", formatTokens(1500) === "1.5k", formatTokens(1500));
}

setApprovalHook(null);
server.close();
rmSync(ws, { recursive: true, force: true });

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
