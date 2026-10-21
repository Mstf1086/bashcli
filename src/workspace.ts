// Çalışma alanı (workspace) kökü.
//
// Bu modül ayrı bir dosyada tutulur çünkü hem araç katmanı (src/coding_tools.ts)
// hem de proje yapılandırması (src/project-config.ts) workspace köküne ihtiyaç
// duyar; tek bir modülde toplamak döngüsel bağımlılığı (circular dependency)
// önler.
//
// Öncelik sırası (src/cli.ts'de belirlenir): -w argümanı > CODING_WORKSPACE > CWD.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Çalışma alanının kök dizini. */
export function workspaceRoot(): string {
  const root = resolve(process.env.CODING_WORKSPACE ?? homedir());
  mkdirSync(root, { recursive: true });
  return root;
}
