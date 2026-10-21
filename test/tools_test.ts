// Araç güvenliği ve yazma akışı testi: workspace dışına yazma reddedilmeli,
// write_file + run_command gerçekten çalışmalı.
// Çalıştırma: npx tsx test/tools_test.ts
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listFiles, readFile, writeFile, editFile, searchFiles, runCommand, resolveIn,
} from "../src/coding_tools.js";

const ws = mkdtempSync(join(tmpdir(), "agent-tools-"));
process.env.CODING_WORKSPACE = ws;

let fails = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
}

// 1) workspace dışına çıkış reddedilmeli
let escaped = false;
try { resolveIn("../escape.txt"); } catch { escaped = true; }
check("workspace dışı yol reddedildi", escaped);

check("write_file oluşturdu", writeFile("a/b/merhaba.txt", "satir1\nsatir2").startsWith("Yazildi"));
check("dosya var", existsSync(join(ws, "a/b/merhaba.txt")));
check("read_file okudu", readFile("a/b/merhaba.txt").includes("1: satir1"));

check("edit_file çalıştı", editFile("a/b/merhaba.txt", "satir2", "satirX").startsWith("Duzenlendi"));
check("edit sonrası içerik", readFile("a/b/merhaba.txt").includes("satirX"));

check("edit_file benzersizlik kontrolü",
  editFile("a/b/merhaba.txt", "yok", "x").includes("bulunamadi"));

writeFile("grep-target.txt", "needle burada\nbaşka satır");
check("search_files eşleşti", searchFiles("needle").includes("grep-target.txt"));
check("search_files eşleşmedi", searchFiles("olmayan-xyz").includes("Eslesme yok"));

check("list_files listeledı", listFiles(".", true).includes("grep-target.txt"));
check("list_files boyut yazdı", /grep-target.txt\s+\(\d+ bayt\)/.test(listFiles(".")));

// 2) run_command: çalışma alanında, hata durumu
const out = await runCommand("echo merhaba-dunya");
check("run_command çıktı verdi", out.includes("merhaba-dunya"), out.slice(0, 60));
const outFail = await runCommand("exit 3");
check("run_command hata kodu", outFail.includes("exit: 3"));

// 3) write_file dışarı yazmayı engellemeli
let blocked = false;
try { writeFile("/tmp/kotu-dosya.txt", "x"); } catch { blocked = true; }
check("write_file workspace dışı engellendi", blocked);

rmSync(ws, { recursive: true, force: true });
console.log(fails === 0 ? "SONUÇ: TÜM TESTLER GEÇTİ" : `SONUÇ: ${fails} TEST BAŞARISIZ`);
process.exit(fails === 0 ? 0 : 1);
