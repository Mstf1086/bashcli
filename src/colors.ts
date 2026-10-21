// Paylaşılan renk paleti.
//
// Hem düz REPL (src/cli.ts) hem de TUI (src/tui/*) bu modülü kullanır;
// böylece ANSI kaçışları tek bir yerde tanımlanır.
//
// Renkler ANSI SGR kaçışlarıyla üretilir; pi-tui'nin styleText API'si
// yerine elle kaçış kullanıyoruz çünkü tema fonksiyonları (text) => string
// imzasında ve her çağrıda kaçış üretmek daha öngörülebilir.

/** Renk desteği var mı? (pipe/NO_COLOR/dumb terminallerde kapalı) */
export function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  if (!process.stdout.isTTY) return false;
  if ((process.env.TERM ?? "") === "dumb") return false;
  return true;
}

const C = supportsColor();

export const RESET = C ? "\x1b[0m" : "";
export const CYAN = C ? "\x1b[96m" : "";
export const GREEN = C ? "\x1b[92m" : "";
export const YELLOW = C ? "\x1b[93m" : "";
export const MAGENTA = C ? "\x1b[95m" : "";
export const RED = C ? "\x1b[91m" : "";
export const BLUE = C ? "\x1b[94m" : "";
export const DIM = C ? "\x1b[2m" : "";
export const BOLD = C ? "\x1b[1m" : "";
export const ITALIC = C ? "\x1b[3m" : "";
export const UNDERLINE = C ? "\x1b[4m" : "";

/** Sıfırlar dahil stil uygular. */
export function style(text: string, ...codes: string[]): string {
  if (!C || codes.length === 0) return text;
  return `${codes.join("")}${text}${RESET}`;
}

/** ANSI kaçış dizilerini (CSI/OSC/APC) yakalayan desen. */
const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x1b]*(?:\x07|\x1b\\))/g;

/**
 * Metnin terminalde kapladığı görünür genişlik (ANSI kaçışları sayılmaz).
 *
 * Kutu (banner) gibi sabit genişlikli çizimlerde hizalama için kullanılır.
 */
export function visibleWidth(text: string): number {
  const plain = text.replace(ANSI_RE, "");
  let width = 0;
  // Surrogate çiftler (emoji) tek karakter sayılır.
  for (const ch of plain) {
    const cp = ch.codePointAt(0) ?? 0;
    // Birleşen işaretler (accent) ve varyasyon seçiciler genişlik katmaz.
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue;
    if (cp >= 0x200b && cp <= 0x200f) continue;
    width += 1;
  }
  return width;
}

/**
 * Metni verilen görünür genişliğe göre sağdan boşlukla tamamlar.
 *
 * ANSI kaçışları genişliğe dahil edilmez; kutunun çerçevesi hizalı kalır.
 */
export function padVisible(text: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(text));
  return text + " ".repeat(pad);
}

/**
 * Metindeki slash komutu bölgesinin karakter aralığını bulur.
 *
 * Slash komutu yalnızca satırın başında "/ ile başlıyorsa komut sayılır
 * (pi-tui'nin otomatik tamamlama davranışıyla aynı kural). Aralık
 * [start, end) biçimindedir.
 */
export function slashCommandRange(text: string): { start: number; end: number } | null {
  if (!text.startsWith("/")) return null;
  const m = /^\/[^\s]*/.exec(text);
  if (!m) return null;
  return { start: 0, end: m[0].length };
}

/**
 * Düz metindeki slash komutunu renklendirir.
 *
 * "/" işareti macenta+kalın, komut adı cyan gösterilir; böylece kullanıcı
 * komut yazdığını normal mesajdan ayırt edebilir. Renk desteği yoksa metin
 * olduğu gibi döner.
 */
export function colorizeSlashCommand(text: string): string {
  if (!C) return text;
  const range = slashCommandRange(text);
  if (!range) return text;
  const cmd = text.slice(range.start, range.end);
  const slash = cmd.slice(0, 1);
  const name = cmd.slice(1);
  return style(slash, MAGENTA, BOLD) + style(name, CYAN) + text.slice(range.end);
}

/**
 * Terminal ekranını temizler ve imleci sol üste alır.
 *
 * - ESC[2J : ekranı temizle
 * - ESC[3J : kaydırma tamponunu temizle
 * - ESC[H  : imleci satır 1, sütun 1'e taşı
 *
 * Program çıkarken çağrılır; böylece kullanıcı kabuk istemine temiz bir
 * ekranla döner.
 */
export function clearTerminal(): void {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}
