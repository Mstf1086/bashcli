// Slash komutu renklendirme testleri.
//
// Kapsam: "/" ile başlayan girdide komut bölgesi renklendirilmeli, normal
// mesajlar değişmemeli, renk desteği olmayan ortamda metin aynen dönmeli.
//
// Çalıştırma: npx tsx test/slash_color_test.ts
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

async function main(): Promise<void> {
  // Renk desteğini zorla aç: styles modülü import anında renk desteğini
  // değerlendirir, bu yüzden import'tan ÖNCE ayarlanmalı.
  process.env.FORCE_COLOR = "1";
  const { slashCommandRange, colorizeSlashCommand, supportsColor } =
    await import("../src/colors.js");

  // --- 1) Komut bölgesi tespiti --------------------------------------------
  {
    const r1 = slashCommandRange("/provider");
    eq("aralık: /provider uzunluğu", r1?.end, 9);

    const r2 = slashCommandRange("/help");
    eq("aralık: /help uzunluğu", r2?.end, 5);

    const r3 = slashCommandRange("/");
    eq("aralık: sadece /", r3?.end, 1);

    // Boşluktan sonrası komutun parçası değil.
    const r4 = slashCommandRange("/mode plan");
    eq("aralık: argüman komuta dahil değil", r4?.end, 5);

    // Normal mesajlar komut değil.
    eq("aralık: normal mesaj", slashCommandRange("merhaba"), null);
    eq("aralık: ortadaki slash", slashCommandRange("mer /haba"), null);
    eq("aralık: boş metin", slashCommandRange(""), null);
  }

  // --- 2) Renklendirme ------------------------------------------------------
  {
    check("renk: renk desteği açık", supportsColor());
    const out = colorizeSlashCommand("/provider");
    check("renk: slash macenta", out.includes("\x1b[95m"), JSON.stringify(out));
    check("renk: komut adı cyan", out.includes("\x1b[96m"), JSON.stringify(out));
    check("renk: metin korunuyor", out.includes("provider"), JSON.stringify(out));
    // ANSI temizlenmiş hâli orijinalle aynı olmalı.
    const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
    eq("renk: temiz metin aynı", clean, "/provider");

    const normal = colorizeSlashCommand("merhaba");
    eq("renk: normal mesaj değişmiyor", normal, "merhaba");
  }

  // --- 2) Ekran temizleme ------------------------------------------------
  // Çıkışta ekran temizlenir: ESC[2J (ekran), ESC[3J (kaydırma tamponu),
  // ESC[H (imleç). Bu diziler stdout'a yazılır.
  {
    const { clearTerminal } = await import("../src/colors.js");
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error — test için geçici olarak yazma fonksiyonu değiştirilir
    process.stdout.write = (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    try {
      clearTerminal();
    } finally {
      process.stdout.write = origWrite;
    }
    const out = chunks.join("");
    check("temizleme: ESC[2J (ekran) gönderiliyor", out.includes("\x1b[2J"), JSON.stringify(out));
    check("temizleme: ESC[3J (tampon) gönderiliyor", out.includes("\x1b[3J"), JSON.stringify(out));
    check("temizleme: ESC[H (imleç) gönderiliyor", out.includes("\x1b[H"), JSON.stringify(out));
  }

  console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

void main();
