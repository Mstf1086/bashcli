// Ajan sürümü.
//
// package.json'daki "version" alanından okunur; TS dosyasına sabit yazılmaz
// böylece sürüm güncellendiğinde tek yer değişir.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(HERE, "..", "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const version: string = readVersion();
