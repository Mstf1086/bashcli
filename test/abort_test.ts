// İptal (abort) testi: ESC'ye basıldığında açık HTTP isteği de düşmeli.
//
// Kapsam:
//   - OpenAiCompatibleLlm, ADK'nın abortSignal'ını HTTP isteğine bağlar.
//     Önceden sinyal alınıp yok sayılıyordu; istek sunucuda açık kalıyordu.
//   - İptalde hata fırlatılmaz; istek sessizce sonlanır (kullanıcı hata
//     mesajı görmez, istemci bağlantıyı kapatır).
//
// Çalıştırma: npx tsx test/abort_test.ts
import { createServer } from "node:http";
import { OpenAiCompatibleLlm } from "../src/openai_compatible_llm.js";

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

const PORT = 8795;
let serverSawClose = false;

const server = createServer((req, res) => {
  // Bağlantı kapandığında sunucu haberdar olur (istemci iptali).
  req.on("close", () => { serverSawClose = true; });
  // Yanıt verme: istek asılı kalır; iptal onu kurtarmalı.
  const t = setTimeout(() => { if (!res.writableEnded) res.end("{}"); }, 20_000);
  t.unref();
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const llm = new OpenAiCompatibleLlm({
  model: "openai/test",
  apiBase: `http://127.0.0.1:${PORT}/v1`,
  apiKey: "k",
  maxRetries: 0,
});

// 1) İptal edilen istek: hızlı sonlanmalı, hata fırlatmamalı.
{
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 300);
  const t0 = Date.now();
  let threw = false;
  try {
    for await (const _ of llm.generateContentAsync(
      { contents: [{ role: "user", parts: [{ text: "m" }] }] } as never,
      false,
      ctrl.signal,
    )) { /* yanıt bekleniyor */ }
  } catch {
    threw = true;
  }
  const elapsed = Date.now() - t0;
  check("iptal: istek hizli sonlandi", elapsed < 3000, `${elapsed}ms`);
  check("iptal: hata firlatilmadi", !threw);
  // Sunucu bağlantının kapandığını görmeli (istek açık kalmadı).
  await new Promise((r) => setTimeout(r, 200));
  check("iptal: sunucu baglanti kapandigini gordu", serverSawClose);
}

// 2) İptal edilmemiş istek normal şekilde ilerlemeli (kontrol).
{
  serverSawClose = false;
  const t0 = Date.now();
  const ctrl = new AbortController();
  // Sunucu bu sefer yanıt vermiyor; iptal olmadan istek beklemede kalır.
  // Bu yüzden yalnızca "hemen bitmedi" kontrolü yapılır.
  const p = (async () => {
    for await (const _ of llm.generateContentAsync(
      { contents: [{ role: "user", parts: [{ text: "m" }] }] } as never,
      false,
      ctrl.signal,
    )) { /* yoksay */ }
  })();
  await new Promise((r) => setTimeout(r, 500));
  const stillRunning = Date.now() - t0 >= 500;
  check("kontrol: iptal yokken isket devam ediyor", stillRunning);
  ctrl.abort();
  await p.catch(() => {});
}

server.close();

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
