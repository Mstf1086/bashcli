// Klavye yardımcıları.
//
// pi-tui, TUI başlarken Kitty keyboard protocol'ünü etkinleştirmeye çalışır.
// Kitty destekleyen terminaller tuşları Kitty biçiminde gönderir; destekle-
// yenler (ya da DA1 sorgusuna geç cevap verenler) legacy dizileri gönderir.
// Kitty etkinken legacy diziler reddedildiği için ok tuşları çalışmaz ve
// menülerde seçim değiştirilemez.
//
// Bu modül her iki biçimi de kabul eder: legacy diziler doğrudan, Kitty
// biçimleri ise pi-tui'nin matchesKey() eşleştirmesiyle tanınır.
import { matchesKey } from "@earendil-works/pi-tui";

/** Yukarı ok tuşu (legacy veya Kitty biçimi). */
export function isUp(data: string): boolean {
  return data === "\x1b[A" || data === "\x1bOA" || matchesKey(data, "up");
}

/** Aşağı ok tuşu (legacy veya Kitty biçimi). */
export function isDown(data: string): boolean {
  return data === "\x1b[B" || data === "\x1bOB" || matchesKey(data, "down");
}

/**
 * Ctrl+Tab.
 *
 * Desteklenen biçimler:
 *   - Kitty CSI u:      "\x1b[9;5u"
 *   - xterm modifyOtherKeys: "\x1b[27;5;9~"
 *   - bazı terminaller: "\x1b[14;5~" / "\x1b[Z" (shift+tab ile aynı)
 *   - Kitty/modifyOtherKeys eşleşmesi (matchesKey)
 *
 * Not: Termux Kitty protokolünü desteklemez ve Ctrl+Tab'ı düz Tab olarak
 * gönderir; orada `isCtrlT` alias'ı kullanılır.
 */
export function isCtrlTab(data: string): boolean {
  return (
    data === "\x1b[9;5u"
    || data === "\x1b[14;5~"
    || data === "\x1b[27;5;9~"
    || data === "\x1b[Z"
    || matchesKey(data, "ctrl+tab")
  );
}

/**
 * Ctrl+T — Termux'ta onay (oto onay) değiştirmek için kullanılan alias.
 *
 * Termux CTRL+harf tuşlarını kontrol karakteri olarak gönderir
 * (CTRL+T = "\x14"); bu dizi Tab'dan ayırt edilebilir olduğu için
 * Ctrl+Tab'ın gönderilemediği terminallerde onay değiştirilebilir.
 */
export function isCtrlT(data: string): boolean {
  return (
    data === "\x14"
    || data === "\x1b[116;5u"
    || data === "\x1b[27;5;116~"
    || matchesKey(data, "ctrl+t")
  );
}

/** Termux oturumu mu? (TERMUX_VERSION yalnızca Termux'ta tanımlıdır.) */
export function isTermux(): boolean {
  return Boolean(process.env.TERMUX_VERSION);
}

/** Shift+Tab (legacy: "\x1b[Z"). */
export function isShiftTab(data: string): boolean {
  return data === "\x1b[Z";
}

/** Enter (gönderim). */
export function isEnter(data: string): boolean {
  return data === "\r" || data === "\n" || matchesKey(data, "enter");
}

/** Escape. */
export function isEscape(data: string): boolean {
  return data === "\x1b" || matchesKey(data, "escape");
}

/** Ctrl+C. */
export function isCtrlC(data: string): boolean {
  return data === "\x03" || matchesKey(data, "ctrl+c");
}

/** Ctrl+U (satırı temizle). */
export function isCtrlU(data: string): boolean {
  return data === "\x15" || matchesKey(data, "ctrl+u");
}
