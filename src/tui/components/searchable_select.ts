// Arama kutulu seçim menüsü.
//
// pi-tui'nin `SelectList` bileşeni tek başına yeterli değil:
//   - `items`/`filteredItems` alanları private; dışarıdan özel filtreleme
//     (fuzzy) uygulanamaz.
//   - `setFilter()` yalnızca `value.startsWith()` ile prefix eşleştiriyor;
//     etiket ya da açıklama içinde arama yapılamıyor.
//
// Bu bileşen bu iki eksiği kapatır: üstte bir arama kutusu bulunur ve
// kullanıcı yazdıkça sonuçlar fuzzy eşleşmeye göre süzülür (en iyi eşleşme
// üstte). Seçim listesi pi-tui'nin `SelectList`'i olarak kalır; böylece tema,
// kolon genişlikleri ve kaydırma göstergesi mevcut davranışla aynıdır.
import {
  CURSOR_MARKER,
  SelectList,
  fuzzyFilter,
  getKeybindings,
  type Component,
  type Focusable,
  type SelectItem,
  type SelectListLayoutOptions,
  type SelectListTheme,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

/** Arama kutusunun başlangıç metni. */
const SEARCH_PROMPT = "🔍 ";

/** Arama kutusunda gösterilen yer tutucu. */
const SEARCH_PLACEHOLDER = "ara…";

export interface SearchableSelectOptions {
  /** Tüm öğeler (arama metnine göre süzülür). */
  items: SelectItem[];
  /** Menüde aynı anda görünecek en fazla öğe sayısı. */
  maxVisible?: number;
  /** Listenin teması. */
  theme: SelectListTheme;
  /** Kolon genişliği ayarları. */
  layout?: SelectListLayoutOptions;
  /** Arama kutusu yer tutucusu. */
  placeholder?: string;
  /** "Eşleşen sonuç yok" metni. */
  noMatchText?: string;
}

/**
 * Arama kutusu + filtrelenebilir seçim listesi.
 *
 * Tuş dağılımı:
 *   - yazdırılabilir karakterler, Backspace, Ctrl+U → arama kutusu
 *   - ↑/↓ → listede gezinme
 *   - Enter → seçimi onayla
 *   - Esc / Ctrl+C → iptal
 */
export class SearchableSelect implements Component, Focusable {
  private readonly allItems: SelectItem[];
  private readonly theme: SelectListTheme;
  private readonly layout?: SelectListLayoutOptions;
  private readonly placeholder: string;
  private readonly noMatchText: string;
  private readonly maxVisible: number;
  /** Filtrelenmiş öğeler (arama metnine göre süzülmüş). */
  private visibleItems: SelectItem[] = [];
  /** Aktif liste örneği. */
  private list: SelectList | null = null;
  /** Arama metni. */
  private query = "";
  /** Arama kutusundaki imleç konumu. */
  private cursor = 0;

  /** Focusable arayüzü — TUI odak değişiminde ayarlar. */
  focused = false;

  /** Bir öğe seçildiğinde çağrılır. */
  onSelect?: (item: SelectItem) => void;
  /** Menü iptal edildiğinde çağrılır. */
  onCancel?: () => void;

  constructor(options: SearchableSelectOptions) {
    this.allItems = options.items;
    this.theme = options.theme;
    this.layout = options.layout;
    this.placeholder = options.placeholder ?? SEARCH_PLACEHOLDER;
    this.noMatchText = options.noMatchText ?? "  Eşleşen sonuç yok";
    this.maxVisible = options.maxVisible ?? 12;
    this.applyFilter("");
  }

  /** Şu an görünen (filtrelenmiş) öğe sayısı. */
  get visibleCount(): number {
    return this.visibleItems.length;
  }

  /** Şu an seçili öğenin indeksi. */
  get selectedIndex(): number {
    return this.indexOfSelected();
  }

  /** Aramaya yazılan metin. */
  get searchText(): string {
    return this.query;
  }

  /**
   * Arama metnine göre listeyi süzer.
   *
   * Eşleştirme metinde (etiket + açıklama + değer) fuzzy olarak yapılır:
   * "op" yazıldığında "OpenRouter" bulunur, "zen" yazıldığında "ZenMux".
   * Sorgu boşken öğeler ilk sırasını korur.
   */
  private applyFilter(query: string): void {
    this.query = query;
    if (query.trim()) {
      this.visibleItems = fuzzyFilter(
        this.allItems,
        query,
        (item) => `${item.label} ${item.description ?? ""} ${item.value}`,
      );
    } else {
      this.visibleItems = [...this.allItems];
    }
    this.rebuildList();
  }

  /** Filtrelenmiş öğelerden yeni bir liste örneği kurar. */
  private rebuildList(): void {
    const list = new SelectList(this.visibleItems, this.maxVisible, this.theme, this.layout);
    list.onSelect = (item) => this.onSelect?.(item);
    list.onCancel = () => this.onCancel?.();
    this.list = list;
  }

  /** Seçili öğenin listedeki indeksi. */
  private indexOfSelected(): number {
    const selected = this.list?.getSelectedItem();
    if (!selected) return 0;
    return Math.max(0, this.visibleItems.findIndex((i) => i.value === selected.value));
  }

  /** Seçimi bir üst/alt öğeye taşır. */
  move(delta: number): void {
    const count = this.visibleItems.length;
    if (!count || !this.list) return;
    const current = this.indexOfSelected();
    const next = (current + delta + count) % count;
    this.list.setSelectedIndex(next);
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    // Ok tuşları: listede gezinme.
    if (kb.matches(data, "tui.select.up")) {
      this.move(-1);
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.move(1);
      return;
    }
    // Enter: seçimi onayla.
    if (kb.matches(data, "tui.select.confirm") || data === "\n" || data === "\r") {
      const selected = this.list?.getSelectedItem();
      if (selected) this.onSelect?.(selected);
      return;
    }
    // Esc / Ctrl+C: menüyü iptal et.
    if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel?.();
      return;
    }
    // Backspace: arama metninden son karakteri sil.
    if (kb.matches(data, "tui.editor.deleteCharBackward") || data === "\x7f") {
      if (this.cursor > 0) {
        this.query = this.query.slice(0, this.cursor - 1) + this.query.slice(this.cursor);
        this.cursor--;
        this.applyFilter(this.query);
      }
      return;
    }
    // Ctrl+U: arama metnini temizle.
    if (kb.matches(data, "tui.editor.deleteToLineStart")) {
      if (this.query.length) {
        this.query = "";
        this.cursor = 0;
        this.applyFilter(this.query);
      }
      return;
    }
    // Sol/sağ: imleci taşı.
    if (kb.matches(data, "tui.editor.cursorLeft")) {
      if (this.cursor > 0) this.cursor--;
      return;
    }
    if (kb.matches(data, "tui.editor.cursorRight")) {
      if (this.cursor < this.query.length) this.cursor++;
      return;
    }
    // Yazdırılabilir karakterler: arama metnine ekle.
    if (data >= " " && data !== "\x7f") {
      this.query = this.query.slice(0, this.cursor) + data + this.query.slice(this.cursor);
      this.cursor += data.length;
      this.applyFilter(this.query);
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.list?.handleMouse?.(event);
  }

  invalidate(): void {
    this.list?.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(...this.renderSearch(width));
    if (this.visibleItems.length) {
      lines.push(...(this.list?.render(width) ?? []));
    } else {
      lines.push(this.noMatchText);
    }
    return lines;
  }

  /** Arama kutusunu çizer. */
  private renderSearch(width: number): string[] {
    const prompt = SEARCH_PROMPT;
    const available = Math.max(0, width - prompt.length);
    const text = this.query || this.placeholder;
    // Yatay kaydırma: imleç görünür alanda kalsın.
    let start = 0;
    if (text.length > available) {
      const half = Math.floor(available / 2);
      if (this.cursor <= half) start = 0;
      else if (this.cursor >= text.length - half) start = Math.max(0, text.length - available);
      else start = this.cursor - half;
    }
    const visible = text.slice(start, start + available);
    const cursorInVisible = Math.max(0, Math.min(visible.length - 1, this.cursor - start));
    const atCursor = visible[cursorInVisible] ?? " ";
    const before = visible.slice(0, cursorInVisible);
    const after = visible.slice(cursorInVisible + 1);
    const marker = this.focused ? CURSOR_MARKER : "";
    const cell = `\x1b[7m${atCursor}\x1b[27m`;
    const body = before + marker + cell + after;
    const pad = " ".repeat(Math.max(0, available - body.length));
    return [prompt + body + pad];
  }
}
