#!/usr/bin/env node
// bashcli — global giriş noktası.
//
// Ajanı TypeScript kaynaklarından çalıştırır: tsx'in ESM loader'ını
// kaydedip src/cli.ts'ini içe aktarır. Böylece derleme adımı gerekmez;
// kaynak kodda yapılan her değişiklik anında geçerli olur.
//
// Kullanım:
//   bashcli                      # etkileşimli TUI (workspace = bulunulan dizin)
//   bashcli "görev"              # tek seferlik görev
//   bashcli -w /yol/proje        # farklı workspace
//   bashcli -m plan              # başlangıç modu
//   bashcli --plain              # düz REPL (TUI olmadan)
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, "..");
const CLI = join(ROOT, "src", "cli.ts");

// tsx'i bul: TS dosyaları doğrudan import edilebilsin.
// Denenecek yollar sırayla:
//   1) bu dosyanın yanındaki node_modules (lokal kurulum / npm link)
//   2) createRequire ile çözümlenen tsx (npm global kurulumunda tsx, paketin
//      değil global kökün node_modules'ına taşınır)
const TSX_CANDIDATES = [
  join(ROOT, "node_modules", "tsx", "dist", "esm", "api", "index.mjs"),
];
try {
  const req = createRequire(join(ROOT, "package.json"));
  TSX_CANDIDATES.push(req.resolve("tsx/dist/esm/api/index.mjs"));
} catch {
  // tsx çözümlenemediyse ilk aday yeterli olabilir.
}

const tsxEntry = TSX_CANDIDATES.find((p) => existsSync(p));
if (!tsxEntry) {
  console.error(
    "bashcli başlatılamadı: tsx bulunamadı. Proje dizininde `npm install` çalıştırın.",
  );
  process.exit(1);
}

const { register } = await import(tsxEntry);
const unregister = register();

// process.argv[1] bu betiğin yoluna işaret ediyor; gerçek giriş noktası
// src/cli.ts olmalı ki cli.ts kendi argv'sini doğru okusun.
const originalArgv = process.argv;
process.argv = [originalArgv[0], CLI, ...originalArgv.slice(2)];

try {
  await import(join(ROOT, "src", "cli.ts"));
} catch (err) {
  console.error("bashcli başlatılamadı:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  // unregister bekleyen import'ları temizler; süreç zaten kapanıyor.
  void unregister;
}
