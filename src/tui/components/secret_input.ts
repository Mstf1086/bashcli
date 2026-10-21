// Maskeli (parola) tek satır giriş bileşeni.
//
// pi-tui'nin `Input` bileşeninde parola modu YOK: `value`/`cursor` alanları
// `private` olduğu için alt sınıfta maskeleme uygulanamıyor. Bu yüzden bileşeni
// sıfırdan `Component & Focusable` olarak uyguluyoruz.
//
// Güvenlik notları:
// - `render()` asla gerçek değeri basmaz; yalnızca `•` maskesi.
// - Gerçek değer yalnızca `getValue()` ile, `onSubmit` çağrıldığında okunur.
import {
  CURSOR_MARKER,
  getKeybindings,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";

const MASK = "•";

export interface SecretInputOptions {
  prompt?: string;
  /** Maske karakteri (varsayılan "•"). */
  mask?: string;
  /** Kaç karakterden sonra maskeleme koyulmaz (0 = hepsi maskeli). */
  revealLast?: number;
}

export class SecretInput implements Component, Focusable {
  private value = "";
  private cursor = 0;
  private readonly prompt: string;
  private readonly mask: string;
  private readonly revealLast: number;
  private pasteBuffer = "";
  private isInPaste = false;

  /** Focusable arayüzü — TUI odak değişiminde ayarlar. */
  focused = false;

  onSubmit?: (value: string) => void;
  onEscape?: () => void;
  /** Enter'a basıldığında, değer boşsa çağrılır. */
  onSubmitEmpty?: () => void;

  constructor(options: SecretInputOptions = {}) {
    this.prompt = options.prompt ?? "> ";
    this.mask = options.mask ?? MASK;
    this.revealLast = options.revealLast ?? 0;
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = value.length;
  }

  /** Değeri temizler. */
  clear(): void {
    this.value = "";
    this.cursor = 0;
  }

  invalidate(): void {
    // Yeniden çizim gerekmez; render her çağrıldığında yeniden hesaplanır.
  }


  handleInput(data: string): void {
    // Yapıştırma (bracketed paste) — gerçek değer toplanır, maskelenerek basılır.
    if (data.includes("\x1b[200~")) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      data = data.replace("\x1b[200~", "");
    }
    if (this.isInPaste) {
      this.pasteBuffer += data;
      const end = this.pasteBuffer.indexOf("\x1b[201~");
      if (end === -1) return;
      const pasted = this.pasteBuffer.substring(0, end);
      this.pasteBuffer = "";
      this.isInPaste = false;
      this.insert((pasted.replace(/\r/g, "\n").split("\n")[0] ?? "").replace(/\n/g, ""));
      return;
    }

    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.cancel")) {
      this.onEscape?.();
      return;
    }
    if (kb.matches(data, "tui.input.submit") || data === "\n") {
      if (this.value.length === 0) this.onSubmitEmpty?.();
      else this.onSubmit?.(this.value);
      return;
    }
    if (kb.matches(data, "tui.editor.deleteCharBackward")) {
      if (this.cursor > 0) {
        this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
        this.cursor--;
      }
      return;
    }
    if (kb.matches(data, "tui.editor.deleteCharForward")) {
      if (this.cursor < this.value.length) {
        this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
      }
      return;
    }
    if (kb.matches(data, "tui.editor.deleteWordBackward")) {
      this.deleteWordBackwards();
      return;
    }
    if (kb.matches(data, "tui.editor.deleteToLineStart")) {
      this.value = this.value.slice(this.cursor);
      this.cursor = 0;
      return;
    }
    if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
      this.value = this.value.slice(0, this.cursor);
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLeft")) {
      if (this.cursor > 0) this.cursor--;
      return;
    }
    if (kb.matches(data, "tui.editor.cursorRight")) {
      if (this.cursor < this.value.length) this.cursor++;
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLineStart")) {
      this.cursor = 0;
      return;
    }
    if (kb.matches(data, "tui.editor.cursorLineEnd")) {
      this.cursor = this.value.length;
      return;
    }

    // Yazdırılabilir karakterler
    if (data >= " " && data !== "\x7f") {
      this.insert(data);
    }
  }


  render(width: number): string[] {
    const available = width - this.prompt.length;
    if (available <= 0) return [this.prompt.slice(0, Math.max(0, width))];

    // Maskeli gösterim: son `revealLast` karakter açık kalır (0 ise hepsi maskeli).
    const masked = this.maskedValue();
    // Yatay kaydırma: imleç görünür alanda kalsın.
    let start = 0;
    if (masked.length > available) {
      const half = Math.floor(available / 2);
      if (this.cursor <= half) start = 0;
      else if (this.cursor >= masked.length - half) start = Math.max(0, masked.length - available);
      else start = this.cursor - half;
    }
    const visible = masked.slice(start, start + available);
    const cursorInVisible = Math.max(0, Math.min(visible.length - 1, this.cursor - start));
    const atCursor = visible[cursorInVisible] ?? " ";
    const before = visible.slice(0, cursorInVisible);
    const after = visible.slice(cursorInVisible + 1);

    const marker = this.focused ? CURSOR_MARKER : "";
    const cell = `\x1b[7m${atCursor}\x1b[27m`;
    const body = before + marker + cell + after;
    const pad = " ".repeat(Math.max(0, available - body.length));
    return [this.prompt + body + pad];
  }

  /**
   * Maskelenmiş gösterim (son N karakter hariç).
   * `mask` boş string ise değer olduğu gibi gösterilir (normal metin girişi).
   */
  private maskedValue(): string {
    if (!this.mask) return this.value;
    const len = this.value.length;
    const reveal = Math.min(this.revealLast, len);
    const hidden = len - reveal;
    return this.mask.repeat(hidden) + this.value.slice(hidden);
  }

  private insert(text: string): void {
    if (!text) return;
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
  }

  private deleteWordBackwards(): void {
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.value[i - 1] ?? "")) i--;
    while (i > 0 && !/\s/.test(this.value[i - 1] ?? "")) i--;
    this.value = this.value.slice(0, i) + this.value.slice(this.cursor);
    this.cursor = i;
  }
}
