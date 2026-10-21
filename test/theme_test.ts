// TUI tema testleri.
//
// Kapsam: seçili komut (ok tuşuyla üstüne gelinen ya da yazıyla en iyi
// eşleşen) farklı renkte görünmeli; diğer öğeler sade olmalı.
//
// Çalıştırma: npx tsx test/theme_test.ts
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

async function main(): Promise<void> {
  process.env.FORCE_COLOR = "1";
  const { selectListTheme } = await import("../src/tui/theme.js");

  // Seçili öğenin metni renkli olmalı.
  const sel = selectListTheme.selectedText("provider");
  check("tema: seçili metin renkli", sel.includes("\x1b["), JSON.stringify(sel));
  check("tema: seçili metin cyan", sel.includes("\x1b[96m"), JSON.stringify(sel));
  check("tema: seçili metin kalın", sel.includes("\x1b[1m"), JSON.stringify(sel));
  check("tema: seçili metin metni koruyor", sel.includes("provider"), JSON.stringify(sel));

  // Seçili önek (→) farklı bir renkte.
  const prefix = selectListTheme.selectedPrefix("→ ");
  check("tema: seçili önek renkli", prefix.includes("\x1b["), JSON.stringify(prefix));
  check("tema: seçili önek green", prefix.includes("\x1b[92m"), JSON.stringify(prefix));

  // Seçili olmayan öğeler sade (renksiz) olmalı.
  const desc = selectListTheme.description("açıklama");
  check("tema: açıklama soluk", desc.includes("\x1b[2m"), JSON.stringify(desc));

  console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

void main();
