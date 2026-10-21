// get_api_key aracı uçtan uca testi.
//
// Kapsam:
//  - Model araç şemasında get_api_key görünür.
//  - Model get_api_key çağırdığında sağlayıcı anahtarı aracın yanıtında döner.
//  - Yanıt bağlamda modele geri gider (ikinci istekte tool mesajı).
//  - Oturum dosyasına yazılırken anahtar maskelenir.
//
// Çalıştırma: npx tsx test/keys_e2e_test.ts
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
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

const PORT = 8801;
const requests: any[] = [];
let callCount = 0;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    requests.push(parsed);
    callCount++;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (callCount === 1) {
      // İlk tur: aracı çağır.
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_key",
              type: "function",
              function: {
                name: "get_api_key",
                arguments: JSON.stringify({ provider: "openrouter" }),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }));
    } else {
      // İkinci tur: aracın yanıtı bağlamda.
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Anahtar alindi." },
          finish_reason: "stop",
        }],
      }));
    }
  });
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const ws = mkdtempSync(join(tmpdir(), "keys-e2e-ws-"));
const home = mkdtempSync(join(tmpdir(), "keys-e2e-home-"));
// Kullanıcı kaydında OpenRouter anahtarı olsun; env'de de olsun.
mkdirSync(join(home, ".bashcli"), { recursive: true });
writeFileSync(
  join(home, ".bashcli", "providers.json"),
  JSON.stringify({
    provider: {
      provider: "openrouter",
      apiKey: "sk-or-v1-e2e-secret-abcdef",
      // Mock sunucuya yönlendir: gerçek API'ye gitmesin.
      baseUrl: `http://127.0.0.1:${PORT}/v1`,
      model: "openrouter/openai/gpt-4o-mini",
    },
  }, null, 2),
  "utf-8",
);

const child = spawn("npx", ["tsx", "src/cli.ts", "anahtari ver"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    CODING_WORKSPACE: ws,
    PROVIDER: "custom",
    OPENAI_BASE_URL: `http://127.0.0.1:${PORT}/v1`,
    OPENAI_API_KEY: "test",
    AGENT_MODEL: "openai/mock",
    AGENT_NUM_RETRIES: "0",
    NO_COLOR: "1",
    BASHCLI_HOME: home,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", () => {});
child.stderr.on("data", () => {});
await new Promise((r) => child.on("close", r));
server.close();

// --- Kontroller ------------------------------------------------------------
const first = requests[0] ?? {};
const tools = first.tools ?? [];
const names = tools.map((t: any) => t.function?.name);
check("e2e: get_api_key şeması gönderildi", names.includes("get_api_key"),
  JSON.stringify(names));

// İkinci istekte tool mesajı aracın yanıtını taşımalı.
const second = requests[1] ?? {};
const messages = second.messages ?? [];
const toolMsg = messages.find((m: any) => m.role === "tool");
check("e2e: tool mesajı gönderildi", !!toolMsg, JSON.stringify(messages.map((m: any) => m.role)));
const toolContent = typeof toolMsg?.content === "string"
  ? toolMsg.content
  : JSON.stringify(toolMsg?.content ?? "");
check("e2e: anahtar aracın yanıtında",
  toolContent.includes("sk-or-v1-e2e-secret-abcdef"), toolContent.slice(0, 300));
check("e2e: sağlayıcı adı yanıtta", toolContent.includes("openrouter"));

// Oturum dosyasında anahtar düz metin olmamalı.
const sessionDir = join(import.meta.dirname, "..", ".bashcli", "sessions");
const files = existsSync(sessionDir)
  ? readdirSync(sessionDir).filter((f) => f.endsWith(".json"))
  : [];
let leaked = false;
let found = false;
for (const f of files) {
  const raw = readFileSync(join(sessionDir, f), "utf-8");
  if (raw.includes("sk-or-v1-e2e-secret-abcdef")) leaked = true;
  if (raw.includes("[api-anahtari-gizlendi]")) found = true;
}
check("e2e: oturum dosyasinda duz anahtar yok", !leaked, `${files.length} dosya tarandi`);
check("e2e: oturum dosyasinda maske var", found, `${files.length} dosya tarandi`);

rmSync(ws, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
