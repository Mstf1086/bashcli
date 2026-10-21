// Denetim sonrası eklenen regresyon testleri.
// Çalıştırma: npx tsx test/regression_test.ts
import "./test_setup.js";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ws = mkdtempSync(join(tmpdir(), "agent-reg-"));
process.env.CODING_WORKSPACE = ws;

const { editFile, readFile, resolveIn, runCommand, writeFile } = await import("../src/coding_tools.js");
const { isIgnoredAbsolute } = await import("../src/project-config.js");
const { CODING_INSTRUCTION } = await import("../src/agent.js");
const { saveSession, loadSavedEvents } = await import("../src/session-store.js");

let fails = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
}

// 1) edit_file: $& ve $1 kalıpları düz metin olmalı
writeFile("r.txt", "alfa BETA gama");
editFile("r.txt", "BETA", "[$&|$1|$$]");
check("edit_file $ kalıplarını yorumlamaz", readFileSync(join(ws, "r.txt"), "utf-8") === "alfa [$&|$1|$$] gama");

// 2) sembolik bağ ile çalışma alanından kaçış
const outside = mkdtempSync(join(tmpdir(), "agent-out-"));
writeFileSync(join(outside, "gizli.txt"), "sir");
symlinkSync(outside, join(ws, "kacis"));
let escaped = false;
try { resolveIn("kacis/gizli.txt"); } catch { escaped = true; }
check("symlink kaçışı reddedildi", escaped);
let escaped2 = false;
try { resolveIn("kacis/yeni.txt"); } catch { escaped2 = true; }
check("symlink üzerinden yeni dosya reddedildi", escaped2);

// 3) "~foo" ev dizini sayılmaz
check("~foo çalışma alanı içinde kalır", resolveIn("~foo").startsWith(ws));

// 4) .git içine yazma engeli
mkdirSync(join(ws, ".git/hooks"), { recursive: true });
check("write_file .git'e yazmaz", writeFile(".git/hooks/pre-commit", "x").startsWith("Hata"));

// 5) zaman aşımı "exit: 0" göstermemeli
const t = await runCommand("sleep 5", 1);
check("zaman aşımı bildirilir", !t.includes("(exit: 0)"), t.split("\n")[1] ?? "");

// 6) "..foo" adlı yol kök dışı sayılmamalı
writeFileSync(join(ws, "..gizli"), "x");
writeFileSync(join(ws, ".clineignore"), "..gizli\n");
check("..gizli ignore edilir", isIgnoredAbsolute(join(ws, "..gizli"), false));

// 7) read_file: bozuk limit/offset
writeFileSync(join(ws, "n.txt"), "a\nb\nc");
check("read_file limit=-1 güvenli", readFile("n.txt", 1, -1).includes("1: a"));
check("read_file offset=NaN güvenli", readFile("n.txt", NaN, 2).includes("1: a"));

// 8) sistem talimatında artık literal ters eğik çizgi yok
check("talimatta '\\' yok", !CODING_INSTRUCTION.includes("\\"));

// 9) oturum kimliği yol geçişi
saveSession({ id: "../kacak", appName: "a", userId: "u", events: [] });
check("oturum id yol geçişi reddedilir", loadSavedEvents("../kacak").length === 0);
saveSession({ id: "ok-1", appName: "a", userId: "u", events: [] });
const { SESSION_DIR } = await import("../src/session-store.js");
check("oturum dosyası 0600", (statSync(join(SESSION_DIR, "ok-1.json")).mode & 0o777) === 0o600);

if (fails) { console.log(`\n${fails} test başarısız`); process.exit(1); }
console.log("\nTüm regresyon testleri geçti");
