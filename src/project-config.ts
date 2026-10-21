// Proje yapılandırması: .bashcli/rules ve .bashcli/ignore
//
// Çalışan projenin kökünde iki mekanizma desteklenir:
//
// 1) `.bashcli/rules` — proje kuralları (Markdown).
//    Biçimler:
//      - `<proje>/.bashcli/rules/` dizini (içindeki *.md dosyaları, alfabetik)
//      - `<proje>/.bashcli/rules.md` tek dosya
//    İçerikleri ajanın sistem talimatına eklenir.
//
// 2) `.bashcli/ignore` — modele GÖNDERİLMEYECEK yollar.
//    Satır satır desen listesi (gitignore benzeri):
//      - `#` ile başlayan satırlar yorum
//      - `node_modules`   → her derinlikte aynı adlı dosya/dizin
//      - `build/`        → yalnızca dizin
//      - `src/generated` → köke göreli yol
//      - `*.log`         → glob
//      - `**/tmp`        → glob
//      - `!pattern`      → istisna (son eşleşme kazanır)
//    Dosya yoksa gömülü varsayılanlar kullanılır; dosya varsa onun yerini alır.
//    `.git` ve `.bashcli` her zaman gizlidir (istisna desenle bile açılamaz).
//
// Bu modül workspace kökünü src/workspace.ts'den alır; araç katmanı da burayı
// kullanır, böylece iki katman arasında döngüsel bağımlılık oluşmaz.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { workspaceRoot } from "./workspace.js";

/** Proje yapılandırma dizini (workspace kökü içinde). */
export const CONFIG_DIR = ".bashcli";

/** Kuralların okunduğu dizin ve dosya adları. */
export const RULES_DIR_NAME = "rules";
export const RULES_FILE_NAME = "rules.md";

/** Ignore listesinin dosya adı. */
export const IGNORE_FILE_NAME = "ignore";

/**
 * Cline uyumlu kural dizini.
 *
 * `.cline/rules/*.md` dosyaları da proje kuralı olarak yüklenir; böylece
 * aynı kural hem Cline'da hem bu ajanda geçerli olur.
 */
export const CLINE_RULES_DIR = ".cline/rules";

/**
 * Cline uyumlu ignore dosyasının adı (proje kökünde).
 *
 * Gitignore sözdizimini kullanır; `.bashcli/ignore` ile birlikte uygulanır.
 */
export const CLINE_IGNORE_FILE = ".clineignore";

/**
 * Her zaman gizli tutulan dizinler/dosyalar.
 *
 * Bunlar istisna deseniyle bile açılamaz: `.git` sürüm geçmişini, `.bashcli`
 * ise kuralları/oturumları, `.cline` ise Cline kural dosyalarını içerir.
 * Kuralların kendisi zaten sistem talimatıyla modele gider; dosya içeriği
 * gereksiz yere çoğaltılmamalıdır.
 *
 * `.clineignore` ve `.gitignore` de gizlidir: bunlar yalnızca ajan
 * yapılandırmasıdır, modele gönderilmeleri token harcar.
 */
export const ALWAYS_HIDDEN = new Set([
  ".git",
  CONFIG_DIR,
  ".cline",
  CLINE_IGNORE_FILE,
  ".gitignore",
]);

/**
 * `.bashcli/ignore` yoksa kullanılan gömülü varsayılanlar.
 *
 * Bunlar yaygın olarak üretilen, modele gönderilmeye değmeyen klasörlerdir.
 */
export const DEFAULT_IGNORE = [
  ".git",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".cache",
  "dist",
  "build",
];

/** Yüklü proje kuralı. */
export interface ProjectRule {
  /** Kuralın görünen adı (dosya adı). */
  name: string;
  /** Kuralın ham içeriği. */
  content: string;
}

/** Proje kökündeki `.bashcli` dizininin tam yolu. */
export function configDir(): string {
  return join(workspaceRoot(), CONFIG_DIR);
}

/** `.bashcli/ignore` dosyasının tam yolu. */
export function ignoreFilePath(): string {
  return join(configDir(), IGNORE_FILE_NAME);
}

/**
 * Cline uyumlu ignore dosyasının tam yolu.
 *
 * `.clineignore` proje kökünde bulunur ve gitignore sözdizimini kullanır.
 */
export function clineIgnoreFilePath(): string {
  return join(workspaceRoot(), CLINE_IGNORE_FILE);
}

/** Bir ignore dosyasını satır satır desen listesine çevirir. */
function parseIgnoreFile(path: string): string[] {
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Cline tarzı YAML frontmatter'ı ayrıştırır.
 *
 * `.cline/rules/*.md` dosyaları başında:
 * ```
 * ---
 * description: ...
 * globs: [...]
 * alwaysApply: true
 * ---
 * ```
 * bulunabilir. Bu blok modele gönderilmez (metadata, içerik değil);
 * sadece "description" alanı kural başlığına eklenir.
 *
 * @returns Ayrıştırılmış gövde ve (varsa) açıklama.
 */
function stripFrontmatter(content: string): { body: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { body: content };
  const meta = m[1];
  const dm = /^\s*description\s*:\s*(.+)$/m.exec(meta);
  const description = dm ? dm[1].trim().replace(/^["']|["']$/g, "") : undefined;
  return { body: content.slice(m[0].length), description };
}

/**
 * Proje kurallarını okur.
 *
 * Hem `.bashcli/rules/` dizinini (içindeki *.md dosyaları) hem de
 * `.bashcli/rules.md` dosyasını destekler. İkisi birden varsa ikisi de
 * yüklenir (dizin önce, sonra tek dosya).
 *
 * Ayrıca `.cline/rules/` dizini de taranır: Cline ile paylaşılan kurallar
 * bu ajanda da geçerli olur (frontmatter ayrıştırılır).
 */
export function loadProjectRules(): ProjectRule[] {
  const rules: ProjectRule[] = [];

  // 1) .bashcli/rules/*.md
  const dir = join(configDir(), RULES_DIR_NAME);
  if (existsSync(dir)) {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      try {
        const content = readFileSync(join(dir, name), "utf-8").trim();
        if (content) rules.push({ name, content });
      } catch {
        // okunamayan kural dosyası atlanır
      }
    }
  }

  // 2) .bashcli/rules.md
  const single = join(configDir(), RULES_FILE_NAME);
  if (existsSync(single)) {
    try {
      const content = readFileSync(single, "utf-8").trim();
      if (content) rules.push({ name: RULES_FILE_NAME, content });
    } catch {
      // okunamayan kural dosyası atlanır
    }
  }

  // 3) .cline/rules/*.md (Cline ile paylaşılan kurallar)
  const clineDir = join(workspaceRoot(), CLINE_RULES_DIR);
  if (existsSync(clineDir)) {
    let names: string[] = [];
    try {
      names = readdirSync(clineDir).filter((n) => n.toLowerCase().endsWith(".md")).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      try {
        const raw = readFileSync(join(clineDir, name), "utf-8");
        const { body, description } = stripFrontmatter(raw);
        const content = body.trim();
        if (!content) continue;
        const label = description ? `${name} — ${description}` : name;
        rules.push({ name: label, content });
      } catch {
        // okunamayan kural dosyası atlanır
      }
    }
  }

  return rules;
}

/**
 * Kuralları sistem talimatına eklenecek biçimde döndürür.
 *
 * Kural yoksa boş string döner; bu durumda talimat değişmez.
 */
export function projectRulesSection(): string {
  const rules = loadProjectRules();
  if (!rules.length) return "";
  const parts = rules.map((r) => `### ${r.name}\n\n${r.content}`);
  return [
    "",
    "## PROJECT RULES (.bashcli/rules)",
    "",
    "The user has defined project-specific rules for this repository. They are",
    "authoritative: follow them unless the user explicitly overrides them in",
    "the current conversation.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}

/** Bir ignore deseni. */
interface IgnorePattern {
  /** Bu desen bir istisna mı (! ile başlıyor)? */
  negated: boolean;
  /** Desen yalnızca dizinler için mi (sonda /)? */
  dirOnly: boolean;
  /** Köke göreli midir (içinde / var mı)? */
  anchored: boolean;
  /** Desenin gövdesi (önek/sondaki işaretler temizlenmiş). */
  body: string;
}

/**
 * Ignore listesini okur.
 *
 * İki kaynak birlikte uygulanır:
 *
 * 1. `.clineignore` (proje kökü) — Cline ile paylaşılan gitignore listesi.
 * 2. `.bashcli/ignore` — bu ajana özel liste.
 *
 * Öncelik kuralı:
 * - `.bashcli/ignore` varsa **o** kullanılır (gömülü varsayılanların yerini
 *   alır) — proje özelidir.
 * - Yalnızca `.clineignore` varsa, varsayılanlar da birlikte uygulanır
 *   (`.clineignore` bu ajanın kendi yapılandırması değildir).
 * - Hiçbiri yoksa gömülü varsayılanlar kullanılır.
 *
 * Sıra önemlidir: "!" istisnalarında **son eşleşen** kazanır. `.clineignore`
 * önce, `.bashcli/ignore` sonra konur; böylece proje özel istisna, genel
 * istisnayı geçersiz kılar.
 */
export function loadIgnorePatterns(): string[] {
  const bashcliPath = ignoreFilePath();
  const clinePath = clineIgnoreFilePath();
  const hasBashcli = existsSync(bashcliPath);
  const hasCline = existsSync(clinePath);

  if (!hasBashcli && !hasCline) return [...DEFAULT_IGNORE];

  const clinePatterns = hasCline ? parseIgnoreFile(clinePath) : [];
  if (!hasBashcli) return [...DEFAULT_IGNORE, ...clinePatterns];

  // .bashcli/ignore varsa varsayılanların yerini alır.
  return [...clinePatterns, ...parseIgnoreFile(bashcliPath)];
}

/** Deseni ayrıştırır. */
function parsePattern(raw: string): IgnorePattern | null {
  let p = raw.trim();
  if (!p || p.startsWith("#")) return null;
  let negated = false;
  if (p.startsWith("!")) {
    negated = true;
    p = p.slice(1).trim();
    if (!p) return null;
  }
  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  // Baştaki "/" köke göreli olmanın işaretidir; gövdeden çıkarılır.
  if (p.startsWith("/")) p = p.slice(1);
  if (!p) return null;
  return { negated, dirOnly, anchored: p.includes("/"), body: p };
}

/** Glob deseni → regex. "*" tek segment, "**" çok segment eşleşir. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Bir desen, verilen göreli yola uyuyor mu?
 *
 * @param path Workspace köküne göreli yol ("/" ile ayrılmış).
 * @param isDir Yol bir dizin mi?
 * @param baseName Yolun son bileşeni.
 */
function patternMatches(
  pat: IgnorePattern,
  path: string,
  isDir: boolean,
  baseName: string,
): boolean {
  if (pat.dirOnly && !isDir) return false;
  if (pat.anchored) {
    // Köke göreli: yolun kendisi ya da altındaki bir yol eşleşmeli.
    const re = globToRegExp(pat.body);
    if (re.test(path)) return true;
    // Alt yol: yolun segment sınırlarından birinde desen bitiyor.
    for (let i = 1; i < path.length; i++) {
      if (path[i] === "/" && re.test(path.slice(0, i))) return true;
    }
    return false;
  }
  // Körele değil: dosya adı eşleşmeli.
  return globToRegExp(pat.body).test(baseName);
}

/**
 * Verilen göreli yol ignore edilmeli mi?
 *
 * En eşleşen (son) desen kazanır; böylece "!pattern" ile istisna tanımlanabilir.
 * `.git` ve `.bashcli` her zaman gizlidir.
 *
 * Yolun HER bileşeni denetlenir: bir dizin (ör. "node_modules") bir desene
 * uyuyorsa, onun altındaki dosyalar da gizlidir (gitignore davranışı). Bu,
 * "node_modules" yazıldığında "node_modules/pkg/index.js" dosyasının da
 * gizlenmesini sağlar.
 *
 * @param path Workspace köküne göreli yol ("/" ile ayrılmış).
 * @param isDir Yol bir dizin mi?
 */
export function isIgnoredPath(path: string, isDir: boolean): boolean {
  const norm = path.split(sep).join("/").replace(/^\.\//, "");
  if (!norm) return false;
  const segments = norm.split("/");
  // Her zaman gizli olanlar: yolun herhangi bir bileşeni .git veya .bashcli
  // ise gizlidir (istisna deseniyle bile açılamaz).
  if (segments.some((s) => ALWAYS_HIDDEN.has(s))) return true;
  const patterns = loadIgnorePatterns()
    .map(parsePattern)
    .filter((p): p is IgnorePattern => p !== null);
  let ignored = false;
  // Yolun her prefix'i denetlenir: önce üst dizinler, sonra dosyanın kendisi.
  for (let i = 0; i < segments.length; i++) {
    const prefix = segments.slice(0, i + 1).join("/");
    // Son bileşen dışındakiler dizindir.
    const prefixIsDir = i < segments.length - 1 ? true : isDir;
    const baseName = segments[i];
    for (const pat of patterns) {
      if (!patternMatches(pat, prefix, prefixIsDir, baseName)) continue;
      ignored = !pat.negated;
    }
  }
  return ignored;
}

/**
 * Workspace köküne göreli mutlak yol ignore edilmeli mi?
 *
 * @param absolute Mutlak dosya sistemi yolu.
 * @param isDir Yol bir dizin mi?
 */
export function isIgnoredAbsolute(absolute: string, isDir: boolean): boolean {
  const root = workspaceRoot();
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith("..")) return false;
  return isIgnoredPath(rel, isDir);
}
