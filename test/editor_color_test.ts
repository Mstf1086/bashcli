// Slash komutu renklendirme ve oturum deposu testleri.
//
// Kapsam:
//  - Renklendirme imleç komutun ortasındayken de çalışmalı
//  - Kaçış dizileri (imleç işaretleri) metin olarak sayılmamalı
//  - Oturum kaydetme/listeleme/yükleme çalışmalı
//
// Çalıştırma: npx tsx test/editor_color_test.ts
import { rmSync } from "node:fs";
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

// Renk desteğini zorla aç: styles modülü import anında renk desteğini
// değerlendirir, bu yüzden import'tan ÖNCE ayarlanmalı.
process.env.FORCE_COLOR = "1";

async function main(): Promise<void> {
  const { colorizeRange, plainText, splitLine } = await import("../src/tui/editor.js");
  const { listSavedSessions, loadSavedEvents, saveSession, SESSION_DIR } =
    await import("../src/session-store.js");

  // pi-tui'nin imleç işaretleri (sıfır genişlikli APC dizileri)
  const CURSOR_MARKER = "\x1b_pi:c\x07";
  const FAKE_START = "\x1b_pi:fc\x07";
  const FAKE_END = "\x1b_pi:/fc\x07";

  // --- 1) Kaçış ayrıştırma ------------------------------------------------
  {
    const line = `  ${CURSOR_MARKER}${FAKE_START}v${FAKE_END}ro`;
    eq("ayrıştırma: düz metin", plainText(line), "  vro");

    const parts = splitLine(line);
    check("ayrıştırma: kaçış parçaları işaretli", parts.some((p) => p.escape));
    check(
      "ayrıştırma: metin parçaları işaretsiz",
      parts.every((p) => p.escape || !p.text.includes("\x1b")),
    );

    // CSI (renk) dizileri de ayrıştırılmalı.
    const colored = "\x1b[95m/\x1b[0mprov";
    eq("ayrıştırma: CSI atlanıyor", plainText(colored), "/prov");
  }

  // --- 2) Renklendirme ------------------------------------------------------
  {
    // İmleç komutun ortasında: "/pr" + imleç("o") + "v"
    const line = ` ${CURSOR_MARKER}${FAKE_START}o${FAKE_END}v`;
    const out = colorizeRange(line, 1, 5);
    check("renk: macenta uygulandı", out.includes("\x1b[95m"), JSON.stringify(out));
    check("renk: cyan uygulandı", out.includes("\x1b[96m"), JSON.stringify(out));
    check("renk: metin korundu", plainText(out) === plainText(line), plainText(out));
    check("renk: imleç işaretleri korundu", out.includes(FAKE_START) && out.includes(FAKE_END));

    // Aralık dışındaki metin renklendirilmemeli.
    const out2 = colorizeRange(" /prov", 1, 5);
    check("renk: aralık dışı renksiz", plainText(out2) === " /prov");
    check("renk: aralık içi renkli", out2.includes("\x1b[95m") && out2.includes("\x1b[96m"));
  }

  // --- 3) Oturum deposu ------------------------------------------------------
  {
    const id = "test-session-123";
    saveSession({
      id,
      appName: "app",
      userId: "u",
      lastUpdateTime: Date.now(),
      events: [
        { content: { role: "user", parts: [{ text: "ilk mesaj" }] } },
        { content: { role: "model", parts: [{ text: "yanıt" }] } },
      ],
    });

    const list = listSavedSessions();
    const found = list.find((s) => s.id === id);
    check("depo: oturum listelendi", !!found);
    eq("depo: mesaj sayısı", found?.messageCount, 2);
    eq("depo: önizleme", found?.preview, "ilk mesaj");

    const events = loadSavedEvents(id);
    eq("depo: event sayısı", events.length, 2);
    eq(
      "depo: ilk event metni",
      (events[0] as { content: { parts: { text: string }[] } }).content.parts[0].text,
      "ilk mesaj",
    );

    // Olmayan oturum.
    eq("depo: olmayan oturum boş", loadSavedEvents("yok-boyle-bir-oturum").length, 0);

    rmSync(join(SESSION_DIR, `${id}.json`), { force: true });
  }

  // --- 4) Mod renkleri ve ">>>" işareti ------------------------------------
  // Mod renkleri: plan = sarı, build = yeşil, auto = turkuaz.
  {
    const { promptMark, setPromptColor } = await import("../src/tui/editor.js");
    const { YELLOW, GREEN, CYAN } = await import("../src/colors.js");

    setPromptColor(YELLOW);
    check(
      "mod: plan işareti sarı",
      promptMark().includes(YELLOW),
      JSON.stringify(promptMark()),
    );
    setPromptColor(GREEN);
    check(
      "mod: build işareti yeşil",
      promptMark().includes(GREEN),
      JSON.stringify(promptMark()),
    );
    setPromptColor(CYAN);
    check(
      "mod: auto işareti turkuaz",
      promptMark().includes(CYAN),
      JSON.stringify(promptMark()),
    );
    check("mod: işaret metni '>>> ' içeriyor", promptMark().includes(">>> "));

    // Mod değişiminde işaret rengi gerçekten değişmeli.
    setPromptColor(YELLOW);
    const planMark = promptMark();
    setPromptColor(GREEN);
    const buildMark = promptMark();
    check("mod: işaret rengi değişiyor", planMark !== buildMark);
  }

  console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

void main();
