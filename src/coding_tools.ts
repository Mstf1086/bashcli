// Dosya/komut araç çekirdeği (Python coding_tools.py'nin TS karşılığı).
// Tüm yollar WORKSPACE_ROOT (CODING_WORKSPACE env veya ~) içine hapsedilir.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isIgnoredAbsolute, isIgnoredPath } from "./project-config.js";
import { workspaceRoot } from "./workspace.js";

export { workspaceRoot };

const NL = "\n";

const MAX_OUTPUT_CHARS = 12_000;
export const MAX_READ_LINES = 2_000;

/** Kullanıcı yolunu çözümle; çalışma alanı dışını reddet. */
export function resolveIn(path: string): string {
  const root = workspaceRoot();
  const p = resolve(root, path.startsWith("~") ? join(homedir(), path.slice(1)) : path);
  if (p !== root && !p.startsWith(root + "/")) {
    throw new Error(`Yol çalışma alanı dışında: ${path} (kök: ${root})`);
  }
  return p;
}

export function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  return text.slice(0, half) + NL + `... [kirpildi, toplam ${text.length}] ...` + NL + text.slice(-half);
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function walk(
  dir: string,
  prefix: string,
  relPath: string,
  depth: number,
  lines: string[],
  recursive: boolean,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
    entries.sort((a, b) => {
      const rank = (n: string) => (isDir(join(dir, n)) ? 0 : 1);
      return rank(a) - rank(b) || a.toLowerCase().localeCompare(b.toLowerCase());
    });
  } catch {
    lines.push(`${prefix}[erisim yok]`);
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = relPath ? `${relPath}/${name}` : name;
    const dirEntry = isDir(full);
    // Gizli yollar listelenmez.
    if (isIgnoredPath(rel, dirEntry)) continue;
    if (dirEntry) {
      lines.push(`${prefix}${name}/`);
      if (recursive && depth < 8) walk(full, prefix + "  ", rel, depth + 1, lines, recursive);
    } else {
      let size = -1;
      try { size = statSync(full).size; } catch { /* yoksay */ }
      lines.push(`${prefix}${name}  (${size} bayt)`);
    }
  }
}


export function listFiles(directory = ".", recursive = false): string {
  const root = resolveIn(directory);
  if (!existsSync(root)) return `Hata: Dizin bulunamadı: ${directory}`;
  if (!isDir(root)) return `Hata: Bu bir dizin degil: ${directory}`;
  // Doğrudan yasakli bir dizin istenirse reddet.
  if (isIgnoredAbsolute(root, true)) {
    return `Hata: ${directory} ignore listesinde; icerigi modele gonderilemez.`;
  }
  const lines: string[] = [];
  const rel = relative(workspaceRoot(), root).split(sep).join("/");
  walk(root, "", rel === "." ? "" : rel, 0, lines, recursive);
  if (!lines.length) return `${directory} bos.`;
  return truncate(lines.join(NL));
}

export function readFile(path: string, offset = 1, limit: number = MAX_READ_LINES): string {
  const full = resolveIn(path);
  if (!existsSync(full)) return `Hata: Dosya bulunamadi: ${path}`;
  if (isDir(full)) return `Hata: Bu bir dizin: ${path}`;
  // Ignore listesindeki dosyalar modele gonderilmez.
  if (isIgnoredAbsolute(full, false)) {
    return `Hata: ${path} ignore listesinde; icerigi modele gonderilemez.`;
  }
  const all = readFileSync(full, "utf-8").split(NL);
  const start = Math.max(0, offset - 1);
  const slice = all.slice(start, start + limit);
  let out = slice.map((l, i) => `${start + i + 1}: ${l}`).join(NL);
  if (start + limit < all.length) out += NL + `... (${all.length} satirin bir kismi)`;
  return truncate(out);
}

export function writeFile(path: string, content: string): string {
  const full = resolveIn(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return `Yazildi: ${path} (${content.length} karakter)`;
}

export function editFile(path: string, oldStr: string, newStr: string): string {
  const full = resolveIn(path);
  if (!existsSync(full)) return `Hata: Dosya bulunamadi: ${path}`;
  const raw = readFileSync(full, "utf-8");
  const count = raw.split(oldStr).length - 1;
  if (count === 0) return "Hata: old_str bulunamadi; once read_file ile okuyun.";
  if (count > 1) return `Hata: old_str ${count} kez geciyor; benzersiz blok verin.`;
  writeFileSync(full, raw.replace(oldStr, newStr), "utf-8");
  return `Duzenlendi: ${path}`;
}

export function searchFiles(pattern: string, directory = ".", maxHits = 50): string {
  const root = resolveIn(directory);
  if (!existsSync(root)) return `Hata: Dizin bulunamadi: ${directory}`;
  // Doğrudan yasakli bir dizin aranılamaz.
  if (isIgnoredAbsolute(root, true)) {
    return `Hata: ${directory} ignore listesinde; icerigi modele gonderilemez.`;
  }
  let re: RegExp;
  try { re = new RegExp(pattern); } catch (e) { return `Hata: Gecersiz regex: ${e}`; }
  const hits: string[] = [];
  // Yığında mutlak yol + göreli yol birlikte tutulur; göreli yol ignore
  // kontrolü için gerekir.
  const stack: Array<{ abs: string; rel: string }> = [{
    abs: root,
    rel: relative(workspaceRoot(), root).split(sep).join("/"),
  }];
  while (stack.length && hits.length < maxHits) {
    const cur = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(cur.abs); } catch { continue; }
    for (const name of entries) {
      if (hits.length >= maxHits) break;
      const full = join(cur.abs, name);
      const rel = cur.rel === "." ? name : `${cur.rel}/${name}`;
      const dirEntry = isDir(full);
      // Gizli dizinlere girilmez, gizli dosyalar okunmaz.
      if (isIgnoredPath(rel, dirEntry)) continue;
      if (dirEntry) {
        stack.push({ abs: full, rel });
        continue;
      }
      let size = 0;
      try { size = statSync(full).size; } catch { continue; }
      if (size > 512 * 1024) continue;
      let text: string;
      try { text = readFileSync(full, "utf-8"); } catch { continue; }
      const lines = text.split(NL);
      for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
        if (re.test(lines[i])) hits.push(`${full}:${i + 1}: ${lines[i].slice(0, 200)}`);
      }
    }
  }
  if (!hits.length) return `Eslesme yok: ${pattern}`;
  return truncate(hits.join(NL));
}

export function runCommand(
  command: string,
  timeoutSec = 120,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolveP) => {
    execFile("/bin/sh", ["-c", command],
      {
        cwd: workspaceRoot(),
        timeout: timeoutSec * 1000,
        maxBuffer: 4 * 1024 * 1024,
        // İptal sinyali: ADK'nın abortSignal'ı. ESC'ye basıldığında alt süreç
        // de sonlandırılır; aksi halde komut süreç sonuna kadar çalışır.
        ...(signal ? { signal } : {}),
      },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code;
        const out = (stdout ?? "") + (stderr ? "[stderr]" + NL + stderr : "");
        if (signal?.aborted) {
          resolveP(`$ ${command}` + NL + "(iptal edildi)");
          return;
        }
        resolveP(truncate(`$ ${command}` + NL + `(exit: ${code ?? 0})` + NL + out).slice(0, 60_000));
      });
  });
}

