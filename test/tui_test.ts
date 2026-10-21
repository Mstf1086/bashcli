// TUI testleri: gizli giriş maskeleme, render, araç çağrısı ve iptal.
//
// Çalıştırma: npx tsx test/tui_test.ts
import {
  CURSOR_MARKER,
  CombinedAutocompleteProvider,
  getKeybindings,
  visibleWidth,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
import { SecretInput } from "../src/tui/components/secret_input.js";
import { Transcript } from "../src/tui/components/transcript.js";
import {
  COMMANDS,
  findCommand,
  isKnownCommand,
  resolveCommand,
  toSelectItems,
  toSlashCommands,
  withSlash,
} from "../src/commands.js";
import { OverlayPanel } from "../src/tui/components/overlay_panel.js";
import { paintBackground } from "../src/tui/components/overlay_panel.js";
import { SearchableSelect } from "../src/tui/components/searchable_select.js";
import { isCtrlT, isCtrlTab, isTermux } from "../src/tui/keys.js";
import { SlashCommandEditor } from "../src/tui/editor.js";
import { editorTheme, selectListTheme } from "../src/tui/theme.js";
import { Text } from "@earendil-works/pi-tui";

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
  const ok = actual === expected;
  check(name, ok, ok ? "" : `beklenen=${JSON.stringify(expected)} gerçek=${JSON.stringify(actual)}`);
}

/** ANSI kaçışlarını temizler. */
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

// --- 1) SecretInput: gerçek değer asla basılmaz -------------------------
{
  const input = new SecretInput({ prompt: "Key: " });
  for (const ch of "sk-1234567890") input.handleInput(ch);

  const rendered = input.render(60).join("");
  const plain = strip(rendered);

  check(
    "secret: gerçek değer render'da yok",
    !plain.includes("sk-1234567890"),
    `render=${plain}`,
  );
  check(
    "secret: maskelenmiş karakterler var",
    plain.includes("•".repeat(13)),
    `render=${plain}`,
  );
  check("secret: gerçek değer yalnızca getValue ile okunur", input.getValue() === "sk-1234567890");
  check("secret: prompt render'da var", plain.startsWith("Key: "), `render=${plain}`);
}

// --- 2) SecretInput: backspace / silme ----------------------------------
{
  const input = new SecretInput({ prompt: "> " });
  for (const ch of "abcd") input.handleInput(ch);
  input.handleInput("\x7f"); // backspace
  eq("secret: backspace son karakteri siler", input.getValue(), "abc");

  const input2 = new SecretInput({ prompt: "> " });
  for (const ch of "abc") input2.handleInput(ch);
  input2.handleInput("\x1b[D"); // imleç "c"nin önüne
  input2.handleInput("\x1b[3~"); // forward delete → "c" silinir
  eq("secret: forward delete çalışır", input2.getValue(), "ab");
}

// --- 3) SecretInput: Enter ve Escape ------------------------------------
{
  const input = new SecretInput({ prompt: "> " });
  let submitted: string | null = null;
  let escaped = false;
  input.onSubmit = (v) => { submitted = v; };
  input.onEscape = () => { escaped = true; };

  input.handleInput("x");
  input.handleInput("\r");
  eq("secret: Enter değeri gönderir", submitted, "x");

  input.handleInput("\x1b");
  check("secret: Escape iptal bildirir", escaped);
}

// --- 4) SecretInput: odak işaretçisi -------------------------------------
{
  const input = new SecretInput({ prompt: "> " });
  input.handleInput("ab");
  const unfocused = input.render(40).join("");
  check("secret: odak dışındayken imleç işareti yok", !unfocused.includes(CURSOR_MARKER));

  input.focused = true;
  const focused = input.render(40).join("");
  check("secret: odaktayken imleç işareti var", focused.includes(CURSOR_MARKER));
}

// --- 5) SecretInput: maskesiz mod (normal metin girişi) ------------------
{
  const input = new SecretInput({ prompt: "> ", mask: "" });
  input.handleInput("görünür");
  const plain = strip(input.render(40).join(""));
  check("secret: maskesiz mod değeri gösterir", plain.includes("görünür"), `render=${plain}`);
}

// --- 6) Transcript: mesajları sırayla yazar -----------------------------
{
  const t = new Transcript({ paddingX: 1 });
  t.addUser("merhaba");
  t.addAssistant("selam");
  t.addToolCall("read_file", { path: "a.txt" });
  t.addToolResponse({ result: "ok" });
  t.addNotice("bilgi");
  t.addNotice("hata", "error");

  const text = strip(t.render(80).join("\n"));
  check("transcript: kullanıcı mesajı var", text.includes("merhaba"), text);
  check("transcript: ajan mesajı var", text.includes("selam"), text);
  check("transcript: araç çağrısı var", text.includes("read_file"), text);
  check("transcript: araç yanıtı var", text.includes("ok"), text);
  check("transcript: hata bildirimi var", text.includes("hata"), text);

  const before = t.length;
  t.clear();
  check("transcript: clear() içeriği siler", t.length === 0 && before > 0);
  const after = strip(t.render(80).join("\n"));
  check("transcript: clear sonrası boş", after.trim() === "", after);
}

// --- 7) Tuş bağlaması: "tui.input.tab" hem tab hem shift+tab olabilir -----
{
  const kb = getKeybindings();
  const original = kb.getKeys("tui.input.tab");
  check("keybinding: varsayılan tab", original.includes("tab" as never), JSON.stringify(original));

  kb.setUserBindings({ ...kb.getUserBindings(), "tui.input.tab": ["tab", "shift+tab"] });
  const both = kb.getKeys("tui.input.tab");
  check("keybinding: tab + shift+tab birlikte", both.includes("tab" as never) && both.includes("shift+tab" as never), JSON.stringify(both));
  check("keybinding: düz tab eşleşir", kb.matches("\t", "tui.input.tab"));
  check("keybinding: shift+tab eşleşir", kb.matches("\x1b[Z", "tui.input.tab"));
  kb.setUserBindings({ ...kb.getUserBindings(), "tui.input.tab": original });
}

// --- 8) OverlayPanel: girdiyi gövdeye yönlendirir -----------------------
{
  const body = new SecretInput({ prompt: "> " });
  const panel = new OverlayPanel(new Text("Başlık"), body, new Text("Alt bilgi"));
  let submitted: string | null = null;
  body.onSubmit = (v) => { submitted = v; };

  panel.handleInput("ab");
  eq("overlay: girdi gövdeye iletilir", body.getValue(), "ab");
  panel.handleInput("\r");
  eq("overlay: Enter gövdeye iletilir", submitted, "ab");

  const lines = panel.render(40);
  check("overlay: başlık render'da", lines.join("").includes("Başlık"), lines.join("|"));
  check("overlay: alt bilgi render'da", lines.join("").includes("Alt bilgi"), lines.join("|"));
  check("overlay: gövde render'da", lines.join("").includes("> "), lines.join("|"));
}

// --- 9) Komut listesi ----------------------------------------------------
{
  check("commands: provider var", COMMANDS.some((c) => c.name === "provider"));
  check("commands: quit var", COMMANDS.some((c) => c.name === "quit"));
  check("commands: mode var", COMMANDS.some((c) => c.name === "mode"));
  check("commands: her komutun açıklaması var", COMMANDS.every((c) => c.desc.length > 0));
  check("commands: isimler benzersiz", new Set(COMMANDS.map((c) => c.name)).size === COMMANDS.length);
  check("commands: isimler '/' öneki içermez", COMMANDS.every((c) => !c.name.startsWith("/")));
  check("commands: withSlash '/' ekler", withSlash("help") === "/help");
  check("commands: withSlash idempotent", withSlash("/help") === "/help");
  check("commands: findCommand bulur", findCommand("quit")?.name === "quit");
  check("commands: findCommand bilinmeyen", findCommand("yok") === undefined);

  // "/exit" kaldırıldı; "/clear" tek başına (sıfırlama + yeni bağlam).
  check("commands: exit kaldırıldı", !COMMANDS.some((c) => c.name === "exit"));
  check("commands: reset kaldırıldı", !COMMANDS.some((c) => c.name === "reset"));
  check("commands: clear var", COMMANDS.some((c) => c.name === "clear"));
  check("commands: clear açıklaması yeni bağlamı anlatıyor",
    COMMANDS.find((c) => c.name === "clear")?.desc.includes("yeni bağlam") === true,
    COMMANDS.find((c) => c.name === "clear")?.desc);
  check("commands: history var", COMMANDS.some((c) => c.name === "history"));
}

// --- 9b) Komut adları ve palet -------------------------------------------
{
  check("alias: isKnownCommand('/quit')", isKnownCommand("/quit"));
  check("alias: isKnownCommand('quit')", isKnownCommand("quit"));
  check("alias: isKnownCommand('/help')", isKnownCommand("/help"));
  check("alias: isKnownCommand('/clear')", isKnownCommand("/clear"));
  check("alias: isKnownCommand('/history')", isKnownCommand("/history"));
  check("alias: isKnownCommand('/yok') false", !isKnownCommand("/yok"));

  // Kısaltmalar da bilinen komut sayılmalı: "/prov" → "/provider".
  check("kısaltma: isKnownCommand('/prov')", isKnownCommand("/prov"));
  check("kısaltma: isKnownCommand('/sett')", isKnownCommand("/sett"));
  check("kısaltma: isKnownCommand('/tok')", isKnownCommand("/tok"));

  // Tam eşleşme.
  const exact = resolveCommand("/provider");
  eq("kısaltma: tam eşleşme exact", exact.kind, "exact");
  eq("kısaltma: tam eşleşme komutu", exact.command?.name, "provider");

  // Tek prefix eşleşmesi → o komut.
  const prov = resolveCommand("/prov");
  eq("kısaltma: '/prov' prefix", prov.kind, "prefix");
  eq("kısaltma: '/prov' → provider", prov.command?.name, "provider");

  const sett = resolveCommand("/sett");
  eq("kısaltma: '/sett' → settings", sett.command?.name, "settings");

  const tok = resolveCommand("/tok");
  eq("kısaltma: '/tok' → tokens", tok.command?.name, "tokens");

  // Büyük/küçük harf duyarsız.
  eq("kısaltma: '/PROV' → provider", resolveCommand("/PROV").command?.name, "provider");

  // Belirsiz: birden fazla komut eşleşiyor → aday listesi.
  const m = resolveCommand("/m");
  eq("kısaltma: '/m' belirsiz", m.kind, "ambiguous");
  const names = (m.candidates ?? []).map((c) => c.name);
  check("kısaltma: '/m' model içeriyor", names.includes("model"), names.join(","));
  check("kısaltma: '/m' mode içeriyor", names.includes("mode"), names.join(","));

  const h = resolveCommand("/h");
  eq("kısaltma: '/h' belirsiz", h.kind, "ambiguous");

  // Eşleşme yok.
  eq("kısaltma: '/xyz' eşleşmiyor", resolveCommand("/xyz").kind, "none");
  eq("kısaltma: '/' eşleşmiyor", resolveCommand("/").kind, "none");

  // Argümanlı komut: ad çözülür, argüman korunur.
  const mode = resolveCommand("/mode plan");
  eq("kısaltma: '/mode plan' exact", mode.kind, "exact");
  eq("kısaltma: '/mode plan' komutu", mode.command?.name, "mode");
  eq("kısaltma: '/mode plan' girdisi korunuyor", mode.input, "/mode plan");

  // Otomatik tamamlama listesi tüm komutları içermeli.
  const slash = toSlashCommands();
  check("alias: tamamlama listesi quit içeriyor", slash.some((s) => s.name === "quit"));
  check("alias: tamamlama listesi clear içeriyor", slash.some((s) => s.name === "clear"));
  check("alias: tamamlama listesi history içeriyor", slash.some((s) => s.name === "history"));
  check(
    "alias: tamamlama listesi exit içermiyor",
    !slash.some((s) => s.name === "exit"),
  );

  // Komut paleti (SelectList) komutları göstermeli.
  const items = toSelectItems();
  check("alias: palet quit içeriyor", items.some((i) => i.value === "quit"));
  check(
    "alias: palet etiketi /quit",
    items.find((i) => i.value === "quit")?.label === "/quit",
  );
  check("alias: palet clear içeriyor", items.some((i) => i.value === "clear"));

  // "/qu" yazınca quit önerilmeli.
  const provider = new CombinedAutocompleteProvider(toSlashCommands(), process.cwd());
  const res = await provider.getSuggestions(["/qu"], 0, 3, {
    signal: new AbortController().signal,
  });
  check("alias: /qu için quit önerildi", !!res?.items.some((i) => i.value === "quit"));
}

// --- 10) Slash otomatik tamamlama: çift "/" üretmemeli -------------------
{
  const provider = new CombinedAutocompleteProvider(toSlashCommands(), process.cwd());
  const res = await provider.getSuggestions(["/he"], 0, 3, {
    signal: new AbortController().signal,
  });
  check("autocomplete: /he için help önerildi", !!res?.items.some((i) => i.value === "help"));

  const first = res!.items[0];
  const applied = provider.applyCompletion(["/he"], 0, 3, first, res!.prefix);
  check(
    "autocomplete: çift '/' üretilmiyor",
    applied.lines[0].startsWith("/") && !applied.lines[0].startsWith("//"),
    applied.lines[0],
  );
  check("autocomplete: tamamlama '/help ' yapıyor", applied.lines[0] === "/help ", applied.lines[0]);
}

// --- 10) Terminal arayüzü (başsız sürücü için) --------------------------
{
  // ProcessTerminal yerine kullanılabilen minimal Terminal uygulaması.
  const term: Terminal = {
    start: () => {},
    stop: () => {},
    drainInput: async () => {},
    write: () => {},
    get columns() { return 80; },
    get rows() { return 24; },
    get kittyProtocolActive() { return false; },
    moveBy: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: () => {},
    clearFromCursor: () => {},
    clearScreen: () => {},
    setTitle: () => {},
    setProgress: () => {},
    setProgramStatus: () => {},
  };
  check("terminal: minimal uygulama tür uyumlu", term.columns === 80);
}

// --- 11) Tuş algılama: Ctrl+Tab ve Termux alias'ı Ctrl+T ---------------
{
  // Ctrl+Tab: Kitty CSI u, xterm modifyOtherKeys ve legacy diziler.
  check("keys: Ctrl+Tab (Kitty CSI u)", isCtrlTab("\x1b[9;5u"));
  check("keys: Ctrl+Tab (xterm modifyOtherKeys)", isCtrlTab("\x1b[27;5;9~"));
  check("keys: Ctrl+Tab (legacy 14;5~)", isCtrlTab("\x1b[14;5~"));
  check("keys: Ctrl+Tab (legacy shift+tab)", isCtrlTab("\x1b[Z"));
  check("keys: düz Tab Ctrl+Tab sayılmaz", !isCtrlTab("\t"));

  // Ctrl+T: Termux'ta CTRL+T kontrol karakteri olarak gönderilir.
  check("keys: Ctrl+T (legacy kontrol karakteri)", isCtrlT("\x14"));
  check("keys: Ctrl+T (Kitty CSI u)", isCtrlT("\x1b[116;5u"));
  check("keys: Ctrl+T (xterm modifyOtherKeys)", isCtrlT("\x1b[27;5;116~"));
  check("keys: düz 't' Ctrl+T sayılmaz", !isCtrlT("t"));

  // Termux algılaması: TERMUX_VERSION tanımlıysa true.
  const prev = process.env.TERMUX_VERSION;
  delete process.env.TERMUX_VERSION;
  check("keys: TERMUX_VERSION yoksa Termux değil", !isTermux());
  process.env.TERMUX_VERSION = "0.118.0";
  check("keys: TERMUX_VERSION varsa Termux", isTermux());
  if (prev === undefined) delete process.env.TERMUX_VERSION;
  else process.env.TERMUX_VERSION = prev;
}

// --- 12) Menü arka planı: tüm satırı kaplar ------------------------------
{
  // Arka plan, metin bittiği yerde kesilmemeli: satır içindeki reset
  // (renkli metnin sonundaki \x1b[0m) arka planı da kapatıyordu.
  const line = "\x1b[1m\x1b[96mBaslik\x1b[0m";
  const painted = paintBackground(line, 30);
  // Görünür genişlik 30 olmalı (metin + dolgu).
  const visible = painted.replace(/\x1b\[[0-9;]*m/g, "").length;
  eq("arka plan: satır tam genişlikte", visible, 30);
  // Metinden sonra da arka plan devam etmeli (reset'ten sonra yeniden uygulanır).
  const resetIdx = painted.indexOf("\x1b[0m");
  check("arka plan: reset'ten sonra arka plan yeniden uygulanıyor",
    painted.indexOf("\x1b[48;5;236m", resetIdx) > resetIdx, painted);
  // Dolgu, arka plan kapatılmadan ÖNCE gelmeli.
  const bgEnd = painted.lastIndexOf("\x1b[49m");
  const padStart = painted.indexOf(" ".repeat(10));
  check("arka plan: dolgu arka planın içinde", padStart > 0 && padStart < bgEnd, painted);
}

// --- 13) Arama kutulu menü (SearchableSelect) -----------------------------
{
  const items = [
    { value: "zenmux", label: "ZenMux (210+ model aggregator)", description: "Çok sağlayıcı" },
    { value: "openrouter", label: "OpenRouter (çok sağlayıcı)", description: "Birçok model" },
    { value: "groq", label: "Groq", description: "Hızlı çıkarım" },
  ];
  const menu = new SearchableSelect({ items, theme: selectListTheme });
  eq("arama: başlangıçta tüm öğeler görünür", menu.visibleCount, 3);
  eq("arama: arama metni boş", menu.searchText, "");

  // Yazı yazınca liste süzülür.
  menu.handleInput("z");
  check("arama: 'z' yazıldı", menu.searchText === "z", menu.searchText);
  check("arama: 'z' sonuçları süzdü", menu.visibleCount < 3, String(menu.visibleCount));

  // Fuzzy eşleşme: etiketin parçası yeterli ("zen" yalnızca ZenMux).
  menu.handleInput("e");
  menu.handleInput("n");
  eq("arama: fuzzy 'zen' etikette eşleşiyor", menu.visibleCount, 1);

  // Backspace ile geri alınır.
  menu.handleInput("\x7f");
  eq("arama: backspace metni kısaltıyor", menu.searchText, "ze");

  // Ctrl+U metni temizler.
  menu.handleInput("\x15");
  eq("arama: ctrl+u metni temizliyor", menu.searchText, "");
  eq("arama: temizlenince tüm öğeler döndü", menu.visibleCount, 3);

  // Etiket içinde arama: "aggregator" yazınca ZenMux bulunur.
  menu.handleInput("aggregator");
  eq("arama: etiket içinde arama", menu.visibleCount, 1);

  // Hiç eşleşme yok.
  menu.handleInput("\x15");
  menu.handleInput("zzzz");
  eq("arama: eşleşme yokken sonuç boş", menu.visibleCount, 0);
  const lines = menu.render(60);
  check("arama: 'eşleşen sonuç yok' gösteriliyor",
    lines.join("").includes("Eşleşen sonuç yok"), lines.join("|"));

  // Enter seçimi onaylar.
  let picked: string | null = null;
  menu.onSelect = (i) => { picked = i.value; };
  menu.handleInput("\x15");
  menu.handleInput("g");
  menu.handleInput("\r");
  eq("arama: Enter seçimi onaylıyor", picked, "groq");

  // Esc iptal eder.
  let cancelled = false;
  menu.onCancel = () => { cancelled = true; };
  menu.handleInput("\x1b");
  check("arama: Esc iptal ediyor", cancelled);

  // Ok tuşları seçimi değiştirir.
  menu.handleInput("\x15");
  const first = menu.selectedIndex;
  menu.move(1);
  check("arama: ok tuşu seçimi değiştiriyor", menu.selectedIndex !== first,
    `${first} -> ${menu.selectedIndex}`);
}

// --- 14) Komut geçmişi: up/down ok tuşları --------------------------------
{
  // SlashCommandEditor gerçek bir TUI gerektirir; testte yalnızca
  // giriş/çıktı ve render için gereken minimal bir sahte TUI kullanılır.
  const fakeTui = {
    terminal: {
      get columns() { return 80; },
      get rows() { return 24; },
      get kittyProtocolActive() { return false; },
    },
    requestRender() {},
    requestImmediateRender() {},
    getShowHardwareCursor() { return false; },
    setShowHardwareCursor() {},
    getClearOnShrink() { return false; },
    setClearOnShrink() {},
  } as unknown as TUI;

  const history: string[] = ["/help", "/rules", "/mode plan"];
  const ed = new SlashCommandEditor(fakeTui, editorTheme, { paddingX: 1 });
  ed.setHistory(history);
  const text = () => ed.getText();

  // Up: en yeni kayıt.
  ed.handleInput("\x1b[A");
  eq("geçmiş: up en yeni kaydı gösteriyor", text(), "/mode plan");
  // Up: daha eski kayıt.
  ed.handleInput("\x1b[A");
  eq("geçmiş: up daha eski kayda gidiyor", text(), "/rules");
  // Up: en eski kayıtta durur.
  ed.handleInput("\x1b[A");
  eq("geçmiş: up en eskide duruyor", text(), "/help");
  ed.handleInput("\x1b[A");
  eq("geçmiş: up en eskiyi geçmiyor", text(), "/help");

  // Down: yeni kayda döner.
  ed.handleInput("\x1b[B");
  eq("geçmiş: down yeni kayda dönüyor", text(), "/rules");
  ed.handleInput("\x1b[B");
  eq("geçmiş: down en yeniye dönüyor", text(), "/mode plan");

  // Down: en yeniden sonra taslağa döner.
  ed.handleInput("\x1b[B");
  eq("geçmiş: down en yeniden sonra taslağa dönüyor", text(), "");

  // Yazı yazınca gezinme biter: up yine en yeni kaydı gösterir.
  ed.handleInput("x");
  eq("geçmiş: yazı metni yerleştiriyor", text(), "x");
  ed.handleInput("\x1b[A");
  eq("geçmiş: yazdıktan sonra up en yeni kaydı gösteriyor", text(), "/mode plan");

  // Taslak korunur: yazılan metin, en yeniden sonra geri gelir.
  ed.setText("");
  ed.handleInput("deneme");
  ed.handleInput("\x1b[A");
  eq("geçmiş: up yazılan metni geçmişle değiştiriyor", text(), "/mode plan");
  ed.handleInput("\x1b[B");
  ed.handleInput("\x1b[B");
  ed.handleInput("\x1b[B");
  eq("geçmiş: down taslağı geri yüklüyor", text(), "deneme");

  // Geçmiş boşsa ok tuşları bir şey yapmaz.
  const emptyEd = new SlashCommandEditor(fakeTui, editorTheme, { paddingX: 1 });
  emptyEd.setHistory([]);
  emptyEd.handleInput("\x1b[A");
  eq("geçmiş: boş geçmişte up metni değiştirmiyor", emptyEd.getText(), "");

  // Yeni kayıt eklendiğinde (paylaşılan dizi) listede görünür.
  history.push("/quit");
  ed.setText("");
  ed.handleInput("\x1b[A");
  eq("geçmiş: yeni kayıt en yeni olarak görünüyor", text(), "/quit");
}

// --- 15) ">>> " işareti satırı taşırmıyor (sarma regresyonu) --------------
{
  // Regresyon: işaret render SONRASINDA eklenince ilk satır 4 sütun
  // taşıyor ve yazılan karakterler alt satıra düzgün geçmiyordu
  // (80 karakterden yalnızca 72'si görünüyordu).
  const fakeTui = {
    terminal: {
      get columns() { return 80; },
      get rows() { return 24; },
      get kittyProtocolActive() { return false; },
    },
    requestRender() {},
    requestImmediateRender() {},
    getShowHardwareCursor() { return false; },
    setShowHardwareCursor() {},
    getClearOnShrink() { return false; },
    setClearOnShrink() {},
  } as unknown as TUI;

  for (const width of [40, 60, 80]) {
    const ed = new SlashCommandEditor(fakeTui, editorTheme, { paddingX: 1 });
    const text = "A".repeat(80);
    ed.setText(text);

    const lines = ed.render(width).map((l) => strip(l));
    // Hiçbir satır ekran genişliğini aşmamalı.
    const overflowing = lines.filter((l) => visibleWidth(l) > width);
    eq(`sarma ${width}: taşan satır yok`, overflowing.length, 0);
    // Yazılan 80 karakterin tamamı görünmeli (kayıp olmamalı).
    const shown = lines.join("").split("A").length - 1;
    eq(`sarma ${width}: 80 karakterin tamamı görünüyor`, shown, 80);
    // İlk içerik satırı ">>> " işaretiyle başlamalı.
    check(`sarma ${width}: ilk satır işaretle başlıyor`,
      lines[1]?.trimStart().startsWith(">>> ") ?? false, lines[1] ?? "");
  }
}

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
