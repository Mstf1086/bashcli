// Overlay paneli: odaklanabilir bir sarmalayıcı.
//
// pi-tui'de `VStack`/`Box` gibi konteynerler `Focusable` implementasyonuna
// sahip değildir; TUI odaklı bileşene giriş iletir. Bu yüzden başlık + içerik
// düzenini gösteren bir panel oluşturup, giriş olaylarını asıl odaklı
// bileşene (SelectList / SecretInput) yönlendiren bu sarmalayıcıyı overlay'e
// koyuyoruz.
//
// Odak (focused) durumu gövdeye de aktarılır: SecretInput yalnızca odaktayken
// CURSOR_MARKER basar; bu işaret donanım imlecini (IME) doğru konuma taşır.
import {
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export class OverlayPanel implements Component, Focusable {
  private isFocused = false;

  constructor(
    private readonly title: Component,
    private readonly body: Component,
    private readonly footer?: Component,
  ) {}

  /** TUI odak değişiminde ayarlar; gövdeye de iletilir. */
  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    if ("focused" in this.body) {
      (this.body as unknown as Focusable).focused = value;
    }
  }

  /** Gövde bileşeninin girişini yönlendir. */
  handleInput(data: string): void {
    this.body.handleInput?.(data);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.body.handleMouse?.(event);
  }

  invalidate(): void {
    this.title.invalidate();
    this.body.invalidate();
    this.footer?.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(...this.title.render(width));
    lines.push(...this.body.render(width));
    if (this.footer) lines.push(...this.footer.render(width));
    // Menü arka planı gri; her satır sonuna kadar doldurulur ve metnin
    // görünürlüğü korunur.
    return lines.map((line) => paintBackground(line, width));
  }
}

/**
 * Salt-okunur bilgi penceresi gövdesi.
 *
 * `/tools`, `/rules`, `/keys` gibi komutların çıktısını bir menü gibi gösterir:
 * satırlar kaydırılabilir, Esc/Enter ile kapatılır. Metin sarmalama yapılır
 * (uzun açıklamalar alt satıra taşar) ve ekran yüksekliğine göre kırpılır.
 */
export class InfoList implements Component, Focusable {
  private offset = 0;
  private isFocused = false;

  constructor(
    private readonly lines: string[],
    /** Görüntülenecek en fazla satır sayısı (ekran yüksekliği). */
    private readonly maxVisible: number,
    /** Kullanıcı kaydırdığında çağrılır (yeni satırları göstermek için). */
    private readonly onScroll?: () => void,
  ) {}

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
  }

  /** Görünür satır sayısı. */
  get visibleCount(): number {
    return Math.min(this.lines.length, this.maxVisible);
  }

  /** Kullanıcı bir satır aşağı kaydırdı. */
  scrollDown(): void {
    if (this.offset + this.visibleCount < this.lines.length) {
      this.offset++;
      this.onScroll?.();
    }
  }

  /** Kullanıcı bir satır yukarı kaydırdı. */
  scrollUp(): void {
    if (this.offset > 0) {
      this.offset--;
      this.onScroll?.();
    }
  }

  handleInput(data: string): void {
    if (data === "\x1b[A" || data === "\x1bOA") this.scrollUp();
    else if (data === "\x1b[B" || data === "\x1bOB") this.scrollDown();
  }

  invalidate(): void {
    // Metin değişmiyor; yeniden çizim gerekmez.
  }

  render(width: number): string[] {
    const bodyWidth = Math.max(1, width - 2);
    // Satırları sarmalayıp, görünür pencereyi dilimle.
    const wrapped: string[] = [];
    for (const line of this.lines) {
      const parts = wrapTextWithAnsi(line, bodyWidth);
      wrapped.push(...(parts.length ? parts : [""]));
    }
    const end = Math.min(wrapped.length, this.offset + this.maxVisible);
    return wrapped.slice(this.offset, end);
  }
}

/** Overlay arka planı için gri renk kodu. */
const BG_GRAY = "\x1b[48;5;236m";
/** Arka planı geri al. */
const BG_RESET = "\x1b[49m";

/**
 * Bir satırın arka planını gri yapar ve satırı tam genişliğe doldurur.
 *
 * İki ayrı tuzak vardır ve ikisi de burada giderilir:
 *
 * 1) Dolgu, arka plan kapatıldıktan SONRA eklenirse boşluklar arka plansız
 *    kalır. Bu yüzden dolgu önce eklenir, arka plan sonra uygulanır.
 *
 * 2) Satır içindeki bir SGR reset'i (ör. renkli metnin sonundaki \x1b[0m)
 *    arka planı da kapatır. Bu yüzden her reset'ten sonra arka plan yeniden
 *    uygulanır; aksi halde gri alan metin bittiği yerde kesilirdi.
 *
 * @param line Metin satırı (ANSI kaçışları içerebilir).
 * @param width Satırın tamamlanacağı toplam genişlik.
 */
export function paintBackground(line: string, width: number): string {
  const visible = visibleWidth(line);
  const pad = Math.max(0, width - visible);
  // Dolgu metnin ARASINDA, arka plan uygulamasından önce eklenir.
  const padded = line + " ".repeat(pad);
  // Reset'lerden sonra arka planı yeniden uygula: ".*\x1b[0m" → reset + arka plan.
  const withBg = padded.replace(
    /(\x1b\[[0-9;]*m)/g,
    (seq) => (seq === "\x1b[0m" || seq === BG_RESET ? seq + BG_GRAY : seq),
  );
  return `${BG_GRAY}${withBg}${BG_RESET}`;
}

