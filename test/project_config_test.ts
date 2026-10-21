// Proje yapılandırması testleri: .bashcli/rules ve .bashcli/ignore.
//
// Kapsam:
//   - Kurallar dizinden (birden çok dosya) ve tek dosyadan okunur, sistem
//     talimatına eklenecek biçimde döner.
//   - Ignore listesi: dosya yoksa gömülü varsayılanlar, varsa kendi listesi.
//   - Desen biçimleri: ad, ad/, yol/, glob, "!" istisna.
//   - .git ve .bashcli her zaman gizlidir.
//   - Araç entegrasyonu: list_files, read_file, search_files ignore'a uyar.
//
// Çalıştırma: npx tsx test/project_config_test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `beklenen=${JSON.stringify(expected)} gerçek=${JSON.stringify(actual)}`);
}

// Workspace geçici bir dizine yönlendirilir: gerçek kullanıcı ayarlarına
// dokunulmaz.
const ws = mkdtempSync(join(tmpdir(), "agent-project-cfg-"));
process.env.CODING_WORKSPACE = ws;

const {
  loadProjectRules, projectRulesSection, loadIgnorePatterns,
  isIgnoredPath, isIgnoredAbsolute, DEFAULT_IGNORE,
} = await import("../src/project-config.js");
const { listFiles, readFile, searchFiles } = await import("../src/coding_tools.js");

const cfg = join(ws, ".bashcli");
const write = (rel: string, content: string): string => {
  const p = join(ws, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, "utf-8");
  return p;
};

// --- 1) Kurallar: dizin biçimi --------------------------------------------
{
  mkdirSync(join(cfg, "rules"), { recursive: true });
  write(".bashcli/rules/stil.md", "Türkçe yorum kullan.\n");
  write(".bashcli/rules/test.md", "Değişiklikten sonra test çalıştır.\n");
  write(".bashcli/rules/okunmayan.txt", "bu yüklenmemeli");

  const rules = loadProjectRules();
  eq("rules: iki md dosyası yüklendi", rules.length, 2);
  eq("rules: alfabetik sıra", rules[0]?.name, "stil.md");
  eq("rules: içerik okundu", rules[1]?.content, "Değişiklikten sonra test çalıştır.");

  const section = projectRulesSection();
  check("rules: talimat bölümü üretildi", section.includes("PROJECT RULES"));
  check("rules: dosya adı bölümde", section.includes("### stil.md"));
  check("rules: içerik bölümde", section.includes("Türkçe yorum kullan."));
}

// --- 2) Kurallar: tek dosya biçimi ---------------------------------------
{
  write(".bashcli/rules.md", "Kurallar tek dosyada.\n");
  const rules = loadProjectRules();
  // Dizin + tek dosya birlikte yüklenir.
  eq("rules: dizin + tek dosya birlikte", rules.length, 3);
  check("rules: tek dosya da yüklendi",
    rules.some((r) => r.name === "rules.md" && r.content.includes("Kurallar tek dosyada.")));
}

// --- 2b) Kurallar: Cline uyumlu .cline/rules dizini ----------------------
{
  write(".cline/rules/token.md",
    "---\n"
    + "description: Token tasarrufu kuralları\n"
    + "globs: [\"**/*\"]\n"
    + "alwaysApply: true\n"
    + "---\n"
    + "\n"
    + "# Token Tasarrufu\n\n"
    + "- Once ara, sonra oku.\n");

  const rules = loadProjectRules();
  // .bashcli (2) + .cline (1) = 3
  eq("rules: .cline kuralı da yüklendi", rules.length, 4);
  const cline = rules.find((r) => r.name.startsWith("token.md"));
  check("rules: .cline kuralı bulundu", !!cline);
  // Frontmatter modele GÖNDERİLMEZ (metadata, içerik değil).
  check("rules: frontmatter ayrıştırıldı", !cline!.content.includes("alwaysApply"));
  check("rules: frontmatter gövdesi kaldı", !cline!.content.includes("description:"));
  check("rules: .cline içeriği korundu", cline!.content.includes("Once ara, sonra oku."));
  // description, başlığa eklenir.
  check("rules: description başlığa eklendi",
    cline!.name.includes("Token tasarrufu kuralları"), cline!.name);

  // .cline her zaman gizlidir: modele gönderilmez.
  check("ignore: .cline her zaman gizli", isIgnoredPath(".cline", true));
  check("ignore: .cline alt yolu gizli", isIgnoredPath(".cline/rules/token.md", false));
}

// --- 2c) Kurallar: .cline frontmatter'ı olmayan dosya ---------------------
{
  write(".cline/rules/plain.md", "Sadece düz markdown kurali.\n");
  const rules = loadProjectRules();
  const plain = rules.find((r) => r.name === "plain.md");
  check("rules: frontmatter'sız .cline dosyası yüklendi", !!plain);
  check("rules: frontmatter'sız içerik korundu",
    plain?.content.includes("Sadece düz markdown kurali.") ?? false);
  rmSync(join(ws, ".cline"), { recursive: true, force: true });
}

// --- 3) Ignore: dosya yokken gömülü varsayılanlar ------------------------
{
  rmSync(join(cfg, "ignore"), { force: true });
  rmSync(join(ws, ".clineignore"), { force: true });
  const patterns = loadIgnorePatterns();
  eq("ignore: dosya yokken varsayılan sayısı", patterns.length, DEFAULT_IGNORE.length);
  check("ignore: varsayılanlarda node_modules var", patterns.includes("node_modules"));
  check("ignore: varsayılanlarda .venv var", patterns.includes(".venv"));
  check("ignore: varsayılanlarda .git var", patterns.includes(".git"));
}

// --- 4) Ignore: dosya varsa listeyi değiştirir ----------------------------
{
  write(".bashcli/ignore", "# yorum satiri\n\nnode_modules\nbuild/\n*.log\n");
  const patterns = loadIgnorePatterns();
  eq("ignore: yorum ve boş satır atlandı", patterns.length, 3);
  check("ignore: varsayılanlar değiştirildi", !patterns.includes(".venv"));
  check("ignore: kendi listesi kullanılıyor", patterns.includes("*.log"));
}

// --- 4b) Ignore: .clineignore birlikte uygulanır --------------------------
{
  // Yalnızca .clineignore varsa varsayılanlar da birlikte gelir.
  rmSync(join(cfg, "ignore"), { force: true });
  write(".clineignore", "# yorum\nnode_modules/\n.env\n*.log\n");
  const patterns = loadIgnorePatterns();
  check("ignore: .clineignore desenleri eklendi", patterns.includes(".env"));
  check("ignore: .clineignore ile varsayılanlar da geçerli",
    patterns.includes(".venv"), patterns.join(","));

  // .bashcli/ignore varsa .clineignore de birleşir.
  write(".bashcli/ignore", "build/\n");
  const both = loadIgnorePatterns();
  check("ignore: .bashcli + .clineignore birleşti",
    both.includes(".env") && both.includes("build/"), both.join(","));
  // .bashcli/ignore, varsayılanların yerini alır.
  check("ignore: .bashcli/ignore varsayılanların yerini aldı", !both.includes(".venv"));

  // Sıra: .clineignore önce, .bashcli/ignore sonra (son eşleşen kazanır).
  write(".clineignore", "secret.txt\n");
  write(".bashcli/ignore", "!secret.txt\n");
  check("ignore: son eşleşen kazanır (istisna)",
    !isIgnoredPath("secret.txt", false), "istisna .bashcli/ignore'da, sonra gelmeli");
  rmSync(join(ws, ".clineignore"), { force: true });
}

// --- 4c) Ignore: .clineignore her zaman gizli dosyalar ---------------------
{
  write(".clineignore", "node_modules\n");
  check("gizli: .clineignore dosyası", isIgnoredPath(".clineignore", false));
  check("gizli: .gitignore dosyası", isIgnoredPath(".gitignore", false));
  rmSync(join(ws, ".clineignore"), { force: true });
}

// --- 5) Desen eşleşmesi ---------------------------------------------------
{
  // Testin kendi ignore listesi.
  write(".bashcli/ignore", "node_modules\nbuild/\nsrc/generated\n*.log\n");
  // Basit ad: her derinlikte.
  check("ignore: ad eşleşiyor", isIgnoredPath("node_modules", true));
  check("ignore: derin ad eşleşiyor", isIgnoredPath("a/b/node_modules", true));
  check("ignore: ilgisiz yol eşleşmiyor", !isIgnoredPath("src/app.ts", false));

  // Dizin-only deseni dosyaya uymaz.
  check("ignore: dizin deseni dizini eşliyor", isIgnoredPath("build", true));
  check("ignore: dizin deseni dosyaya uymuyor", !isIgnoredPath("build", false));

  // Köke göreli yol.
  check("ignore: köke göreli yol", isIgnoredPath("src/generated", true));
  check("ignore: köke göreli alt yol", isIgnoredPath("src/generated/x.ts", false));
  check("ignore: benzer yol eşleşmiyor", !isIgnoredPath("src/generator", true));

  // Glob.
  check("ignore: glob *.log", isIgnoredPath("debug.log", false));
  check("ignore: glob alt dizinde", isIgnoredPath("logs/app.log", false));
  check("ignore: glob eşleşmiyor", !isIgnoredPath("debug.txt", false));
}

// --- 6) Her zaman gizli olanlar -------------------------------------------
{
  check("gizli: .git dizini", isIgnoredPath(".git", true));
  check("gizli: .git içindeki dosya", isIgnoredPath(".git/config", false));
  check("gizli: .bashcli dizini", isIgnoredPath(".bashcli", true));
  check("gizli: .bashcli içindeki dosya", isIgnoredPath(".bashcli/ignore", false));
  // İstisna deseni bunları açamaz.
  write(".bashcli/ignore", "node_modules\n!.git\n!.bashcli\n");
  check("gizli: istisna deseni .git'i açamıyor", isIgnoredPath(".git", true));
  check("gizli: istisna deseni .bashcli'yi açamıyor", isIgnoredPath(".bashcli", true));
}

// --- 7) "!" istisna deseni -------------------------------------------------
{
  write(".bashcli/ignore", "node_modules\n!node_modules/keep.txt\n");
  check("istisna: node_modules gizli", isIgnoredPath("node_modules", true));
  check("istisna: açılan dosya görünür", !isIgnoredPath("node_modules/keep.txt", false));
}

// --- 8) Araç entegrasyonu -------------------------------------------------
{
  // ignore listesini sıfırla: yalnızca test için hedefli desen.
  write(".bashcli/ignore", "gizli\n");
  write("gizli/veri.txt", "gizli icerik");
  write("gizli.txt", "gizli dosya");
  write("gorunur.txt", "gorenur icerik");

  // list_files: gizli dizin listelenmez.
  const listed = listFiles(".", true);
  check("araç: list_files gizli dizini göstermiyor", !listed.includes("gizli/"), listed);
  check("araç: list_files normal dosyayı gösteriyor", listed.includes("gorunur.txt"));

  // read_file: gizli dosya okunamaz.
  const read = readFile("gizli/veri.txt");
  check("araç: read_file gizli dosyayı reddediyor", read.includes("ignore listesinde"), read);
  const readOk = readFile("gorunur.txt");
  check("araç: read_file normal dosyayı okuyor", readOk.includes("gorenur icerik"));

  // search_files: gizli dizine girilmez.
  const searched = searchFiles("iceri");
  check("araç: search_files gizli içeriği bulmuyor", !searched.includes("gizli/veri.txt"), searched);
  check("araç: search_files normal içeriği buluyor", searched.includes("gorunur.txt"));
}

// --- 9) Mutlak yol kontrolü ------------------------------------------------
{
  write(".bashcli/ignore", "gizli\n");
  check("mutlak: gizli dizin", isIgnoredAbsolute(join(ws, "gizli"), true));
  check("mutlak: normal dizin", !isIgnoredAbsolute(join(ws, "gorunur.txt"), false));
}

// --- 10) Ignore dosyası varsayılanların yerini alır -----------------------
{
  // Dosya YOKSA: gömülü varsayılanlar geçerli (node_modules gizli).
  rmSync(join(cfg, "ignore"), { force: true });
  mkdirSync(join(ws, "node_modules"), { recursive: true });
  write("node_modules/paket.js", "paket icerigi");
  const withDefaults = listFiles(".", true);
  check("varsayilan: node_modules gizli", !withDefaults.includes("node_modules"), withDefaults);

  // Dosya VARSA: o liste geçerli, varsayılanlar EKLENMEZ.
  // (yani node_modules artık görünür olur)
  write(".bashcli/ignore", "gizli\n");
  const withOwn = listFiles(".", true);
  check("ozel liste: node_modules artik gorunur", withOwn.includes("node_modules"), withOwn);
  check("ozel liste: gizli yine gizli", !withOwn.includes("gizli/"), withOwn);
}

// --- 11) .clineignore: gizli ayarlar (API anahtarları) -------------------
{
  // .clineignore, .bashcli/ignore olmadan da gizli dosyaları korur.
  rmSync(join(cfg, "ignore"), { force: true });
  write(".clineignore", ".env\nnode_modules/\n");
  write(".env", "API_KEY=gizli-anahtar\n");
  write("normal.txt", "normal icerik");

  check("clineignore: .env gizli", isIgnoredPath(".env", false));
  check("clineignore: .env.example gorunur", !isIgnoredPath(".env.example", false));
  check("clineignore: normal dosya gorunur", !isIgnoredPath("normal.txt", false));

  // Araç katmanı: içerik modele ulaşamaz.
  const read = readFile(".env");
  check("clineignore: read_file .env'i reddediyor",
    read.includes("ignore listesinde"), read);
  check("clineignore: read_file .env icerigini sizdirmiyor",
    !read.includes("gizli-anahtar"), read);

  const listed = listFiles(".", true);
  check("clineignore: list_files .env'i göstermiyor",
    !listed.includes(".env"), listed);

  rmSync(join(ws, ".clineignore"), { force: true });
}

rmSync(ws, { recursive: true, force: true });
console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
