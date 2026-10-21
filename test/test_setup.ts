// Testler için ortak kurulum.
//
// Gerçek kullanıcı kaydı (~/.bashcli/providers.json) sağlayıcı seçimini
// çevre değişkenlerinin üzerine yazar; bu da testlerin gerçek API'ye gitmesine
// (veya "User not found" hatasına) yol açar. Bu dosya, `BASHCLI_HOME` değerini
// geçici bir dizine çekerek testleri hermetik hâle getirir.
//
// Kullanım: bu dosya, ilgili test dosyasının İLK import'u olmalıdır (ESM'de
// import'lar kaynak sırasına göre değerlendirilir).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.BASHCLI_HOME) {
  process.env.BASHCLI_HOME = mkdtempSync(join(tmpdir(), "bashcli-home-"));
}
