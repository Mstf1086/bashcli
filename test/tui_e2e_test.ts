// TUI uçtan uca testi: sahte OpenAI sunucusu + gerçek TUI bileşenleri.
//
// Çalıştırma: npx tsx test/tui_e2e_test.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionService, Runner } from "@google/adk";
import { createAgent } from "../src/agent.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
}

const PORT = 8795;
const ws = mkdtempSync(join(tmpdir(), "agent-tui-"));
writeFileSync(join(ws, "not.txt"), "merhaba\n");

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : {};
    const hasTool = (parsed.messages ?? []).some((m: any) => m.role === "tool");
    if (!hasTool) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Okudum.",
            tool_calls: [{
              id: "c1", type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: "not.txt" }) },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Dosyada 'merhaba' yazıyor." },
        finish_reason: "stop",
      }],
    }));
  });
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

process.env.CODING_WORKSPACE = ws;
process.env.PROVIDER = "custom";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.OPENAI_API_KEY = "test";
process.env.AGENT_MODEL = "openai/mock-model";
process.env.AGENT_NUM_RETRIES = "0";

const { TuiApp } = await import("../src/tui/app.js");

const svc = new InMemorySessionService();
const agent = createAgent("build");
const runner = new Runner({ agent, sessionService: svc, appName: "app" });
const sessionId = (await svc.createSession({ appName: "app", userId: "cli_user" })).id;

const app = new TuiApp({
  svc, runner, agent, sessionId,
  mode: "build", summary: null, inputHist: [],
});

// Uygulamayı başlatmadan render edebilmek için iç bileşenlere eriş.
const anyApp = app as unknown as {
  transcript: { render(w: number): string[] };
  state: { mode: string; inputHist: string[] };
};

// --- 1) Araç çağrısı turu: transcript'e düşer ----------------------------
{
  // Gerçek tur: araç çağrısı + yanıt.
  await (app as unknown as { handleSubmit(t: string): Promise<void> }).handleSubmit(
    "not.txt dosyasini oku",
  );
  const out = anyApp.transcript.render(100).join("\n");
  check("e2e: araç çağrısı transcript'te", out.includes("read_file"), out);
  check("e2e: araç yanıtı transcript'te", out.includes("merhaba"), out);
  check("e2e: asistan yanıtı transcript'te", out.includes("Dosyada"), out);
  check("e2e: kullanıcı mesajı transcript'te", out.includes("not.txt dosyasini oku"), out);
  check("e2e: mod değişmedi", anyApp.state.mode === "build");
  check("e2e: geçmişe eklendi", anyApp.state.inputHist.includes("not.txt dosyasini oku"));
}

// --- 2) İptal: Esc aktif isteği durdurur ---------------------------------
{
  const ctrl = new AbortController();
  const anyApp2 = app as unknown as {
    abortController: AbortController | null;
    handleGlobalKey(d: string): unknown;
  };
  anyApp2.abortController = ctrl;
  anyApp2.handleGlobalKey("\x1b");
  check("e2e: Esc iptal sinyalini tetikler", ctrl.signal.aborted);
  check("e2e: iptal sonrası denetleyici temizlendi", anyApp2.abortController === null);
}

// --- 3) Tab mod döngüsü --------------------------------------------------
{
  const anyApp2 = app as unknown as {
    state: { mode: string };
    handleGlobalKey(d: string): unknown;
  };
  anyApp2.handleGlobalKey("\t");
  check("e2e: Tab modu değiştirdi", anyApp2.state.mode === "auto", anyApp2.state.mode);
  anyApp2.handleGlobalKey("\t");
  check("e2e: Tab tekrar döngüye devam etti", anyApp2.state.mode === "plan", anyApp2.state.mode);
}

// --- 4) Ctrl+C kapanış --------------------------------------------------
{
  const anyApp2 = app as unknown as {
    running: boolean;
    handleGlobalKey(d: string): unknown;
  };
  anyApp2.handleGlobalKey("\x03");
  check("e2e: Ctrl+C uygulamayı kapatır", anyApp2.running === false);
}

// --- 5) Overlay açıkken Ctrl+C uygulamayı kapatmamalı -------------------
{
  const anyApp2 = app as unknown as {
    running: boolean;
    tui: { hasOverlay(): boolean };
    handleGlobalKey(d: string): unknown;
  };
  // Overlay varmış gibi davranmak için hasOverlay'ı geçici olarak true yaparız.
  const realHasOverlay = anyApp2.tui.hasOverlay.bind(anyApp2.tui);
  (anyApp2.tui as unknown as { hasOverlay(): boolean }).hasOverlay = () => true;
  anyApp2.running = true;
  anyApp2.handleGlobalKey("\x03");
  check("e2e: overlay açıkken Ctrl+C uygulamayı kapatmaz", anyApp2.running === true);
  (anyApp2.tui as unknown as { hasOverlay(): boolean }).hasOverlay = realHasOverlay;
}

// --- 6) Overlay varken tuşlar overlay'e iletilir ------------------------
{
  const anyApp2 = app as unknown as {
    running: boolean;
    tui: { hasOverlay(): boolean };
    handleGlobalKey(d: string): unknown;
  };
  const realHasOverlay = anyApp2.tui.hasOverlay.bind(anyApp2.tui);
  (anyApp2.tui as unknown as { hasOverlay(): boolean }).hasOverlay = () => true;
  anyApp2.running = true;
  // Esc overlay'de iptal olmalı; istek iptal sinyali üretmemeli.
  anyApp2.handleGlobalKey("\x1b");
  check("e2e: overlay açıkken Esc uygulamayı kapatmaz", anyApp2.running === true);
  (anyApp2.tui as unknown as { hasOverlay(): boolean }).hasOverlay = realHasOverlay;
}

server.close();
rmSync(ws, { recursive: true, force: true });
console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
