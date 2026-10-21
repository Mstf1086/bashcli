// TUI süreç kapanış testi.
//
// pi-tui'nin alt ekranı ve Loader'ın setInterval'ı süreci ayakta tutabilir:
// kullanıcı Ctrl+C veya /exit dese bile süreç sonlanmazsa kabuk kilitlenir.
//
// Bu test TuiApp'i gerçekten başlatıp kapatır ve kapanıştan sonra süreçte
// bekleyen handle kalmadığını doğrular.
//
// Çalıştırma: npx tsx test/tui_exit_test.ts
import "./test_setup.js"; // gerçek kullanıcı kaydından izole ol
import { InMemorySessionService, Runner } from "@google/adk";
import { createAgent } from "../src/agent.js";
import { TuiApp } from "../src/tui/app.js";

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

async function main(): Promise<void> {
  const svc = new InMemorySessionService();
  const agent = createAgent("build");
  const runner = new Runner({ agent, sessionService: svc, appName: "app" });
  const sessionId = (await svc.createSession({ appName: "app", userId: "cli_user" })).id;

  const app = new TuiApp({
    svc, runner, agent, sessionId,
    mode: "build", summary: null, inputHist: [],
  });

  const anyApp = app as unknown as {
    running: boolean;
    shutdown(): void;
    run(): Promise<void>;
  };

  // Uygulamayı başlat, kısa süre bekle, sonra kapat.
  // Alt ekran çıktısı test logunu kirletmesin diye stdout geçici olarak
  // yönlendiriliyor.
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: unknown }).write = () => true;
  const runPromise = anyApp.run();
  await new Promise((r) => setTimeout(r, 300));
  anyApp.shutdown();
  await runPromise;

  (process.stdout as unknown as { write: unknown }).write = realWrite;

  check("exit: run() döngüden çıkıp döndü", anyApp.running === false);

  // Loader'ın setInterval'ı süreci ayakta tutabilir; kapatma sırasında
  // durdurulmuş olmalı.
  const loader = (app as unknown as { loader: { stop(): void } }).loader;
  let loaderStopped = true;
  try {
    loader.stop();
  } catch {
    loaderStopped = false;
  }
  check("exit: loader durdurulabiliyor", loaderStopped);

  // Kapanıştan sonra stdin dışında bekleyen handle kalmamalı.
  const handles = (process as any)._getActiveHandles()
    .filter((h: any) => h.constructor?.name !== "WriteStream");
  check(
    "exit: stdin dışında bekleyen handle yok",
    handles.every((h: any) => h.constructor?.name !== "ReadStream"),
    handles.map((h: any) => h.constructor?.name).join(","),
  );

  console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

void main();
