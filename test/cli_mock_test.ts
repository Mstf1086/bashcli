// CLI'yi sahte OpenAI sunucusuna bağlayıp uçtan uca test eder.
// Çalıştırma: npx tsx test/cli_mock_test.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8793;
const ws = mkdtempSync(join(tmpdir(), "agent-cli-"));
writeFileSync(join(ws, "not.txt"), "merhaba\n");

let sawTools = false;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : {};
    const hasTool = (parsed.messages ?? []).some((m: any) => m.role === "tool");
    if (!hasTool) {
      sawTools = (parsed.tools ?? []).length > 0;
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

const child = spawn("npx", ["tsx", "src/cli.ts", "not.txt dosyasini oku"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    CODING_WORKSPACE: ws,
    PROVIDER: "custom",
    OPENAI_BASE_URL: `http://127.0.0.1:${PORT}/v1`,
    OPENAI_API_KEY: "test",
    AGENT_MODEL: "openai/mock-model",
    AGENT_NUM_RETRIES: "0",
    NO_COLOR: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => { out += d; });
child.stderr.on("data", (d) => { out += d; });
const code = await new Promise<number>((r) => child.on("close", (c) => r(c ?? 0)));

console.log(out);
console.log("--- doğrulama ---");
console.log("çıkış kodu:", code);
console.log("araç şeması gönderildi:", sawTools);
console.log("read_file çağrısı görüldü:", out.includes("read_file"));
console.log("araç yanıtı görüldü:", out.includes("merhaba"));
console.log("final yanıt görüldü:", out.includes("Dosyada"));

const ok = code === 0 && sawTools && out.includes("read_file") && out.includes("merhaba");
console.log(ok ? "SONUÇ: BAŞARILI" : "SONUÇ: BAŞARISIZ");
server.close();
rmSync(ws, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
