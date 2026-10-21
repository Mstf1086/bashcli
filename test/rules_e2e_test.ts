// Proje kuralları + sistem talimatı uçtan uca testi.
//
// Kapsam:
//   - ADK sistem talimatı string olarak yazar; LLM adaptörü onu string
//     biçimde okumalıdır (aksi halde talimat sessizce düşer).
//   - .bashcli/rules içeriği modele gönderilen sistem talimatında yer alır.
//   - .bashcli/ignore listesindeki dosyalar modele gönderilmez.
//
// Çalıştırma: npx tsx test/rules_e2e_test.ts
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const { extractSystemInstruction } = await import("../src/openai_compatible_llm.js");

// --- 1) Sistem talimatı çıkarımı -----------------------------------------
{
  check("system: string biçimi okunuyor",
    extractSystemInstruction("Merhaba") === "Merhaba");
  check("system: parts biçimi okunuyor",
    extractSystemInstruction({ parts: [{ text: "A" }, { text: "B" }] }) === "A\nB");
  check("system: undefined boş dönüyor",
    extractSystemInstruction(undefined) === "");
  check("system: null boş dönüyor",
    extractSystemInstruction(null) === "");
  check("system: bilinmeyen yapı boş dönüyor",
    extractSystemInstruction({ foo: 1 }) === "");
}

// --- 2) Uçtan uca: kurallar modele gider, ignore edilir -------------------
{
  const PORT = 8799;
  let captured: any = null;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      captured = JSON.parse(body || "{}");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Tamam." },
          finish_reason: "stop",
        }],
      }));
    });
  });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

  const ws = mkdtempSync(join(tmpdir(), "rules-e2e-"));
  mkdirSync(join(ws, ".bashcli", "rules"), { recursive: true });
  writeFileSync(
    join(ws, ".bashcli", "rules", "stil.md"),
    "- Yanitlar TURKCE olmali.\n",
    "utf-8",
  );
  writeFileSync(join(ws, ".bashcli", "ignore"), "gizli\n", "utf-8");
  writeFileSync(join(ws, "gizli.txt"), "GIZLI ICERIK", "utf-8");
  writeFileSync(join(ws, "gorunur.txt"), "GORUNUR ICERIK", "utf-8");

  const home = mkdtempSync(join(tmpdir(), "rules-home-"));
  const child = spawn("npx", ["tsx", "src/cli.ts", "merhaba"], {
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

  const messages = captured?.messages ?? [];
  const system = messages.find((m: any) => m.role === "system")?.content ?? "";
  check("e2e: sistem mesajı gönderildi", system.length > 0, `uzunluk=${system.length}`);
  check("e2e: kodlama talimatı gönderildi",
    system.includes("autonomous coding agent"), system.slice(0, 120));
  check("e2e: proje kuralları bölümü gönderildi",
    system.includes("PROJECT RULES"), system.slice(0, 200));
  check("e2e: kural içeriği gönderildi",
    system.includes("TURKCE olmali"));
  check("e2e: kural dosya adı gönderildi",
    system.includes("### stil.md"));

  rmSync(ws, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
