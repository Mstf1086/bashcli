// Testler için ortak kurulum.
//
// Gerçek kullanıcı kaydı (~/.bashcli/providers.json) sağlayıcı seçimini
// çevre değişkenlerinin üzerine yazar; bu da testlerin gerçek API'ye gitmesine
// (veya "User not found" hatasına) yol açar. Bu dosya, `BASHCLI_HOME` değerini
// geçici bir dizine çekerek testleri hermetik hâle getirir.
//
// Aynı şekilde ajanın kendi `.env` dosyası da `BASHCLI_ENV` ile geçici bir
// yola çekilir. Aksi hâlde testler geliştiricinin yerel `.env` dosyasına
// bağımlı olurdu — o dosya gitignore'dadır, dolayısıyla CI'da bulunamaz ve
// testler orada başarısız olurdu. Geçici `.env` testlerin beklediği
// sağlayıcı/model/anahtar değerlerini içerir; gerçek anahtarlara dokunulmaz.
//
// Kullanım: bu dosya, ilgili test dosyasının İLK import'u olmalıdır (ESM'de
// import'lar kaynak sırasına göre değerlendirilir).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.BASHCLI_HOME) {
  process.env.BASHCLI_HOME = mkdtempSync(join(tmpdir(), "bashcli-home-"));
}

// BASHCLI_HOME dışarıdan verilmiş olabilir (CI) ve dizin henüz yoktur;
// altına yazacağımız geçici .env için dizini garanti ediyoruz.
mkdirSync(process.env.BASHCLI_HOME, { recursive: true });

if (!process.env.BASHCLI_ENV) {
  const tmpEnv = join(process.env.BASHCLI_HOME, "agent.env");
  writeFileSync(
    tmpEnv,
    [
      "PROVIDER=zenmux",
      "AGENT_MODEL=openai/test-model",
      "ZENMUX_API_KEY=test-key-0000000000",
      "ZENMUX_API_BASE=https://zenmux.ai/api/v1",
      "",
    ].join("\n"),
    "utf-8",
  );
  process.env.BASHCLI_ENV = tmpEnv;
}
