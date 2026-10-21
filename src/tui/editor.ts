// Slash komutu yazarken girdi satırını renklendiren editör.
//
// pi-tui'nin Editor'ı metin rengi için tema hook'u sunmuyor; ancak referans
// implementasyondaki (pi-coding-agent) "rainbow-editor" örneği gibi render()
// çıktısı sonradan işlenebiliyor. Biz de aynı yaklaşımı kullanıyoruz:
// super.render() sonucunu alıp, slash komutu bölgesini ANSI ile boyuyoruz.
//
// Böylece kullanıcı "/provider" yazarken komut kısmı renkli görünür ve
// "normal mesaj mı, komut mu" ayrımı anında anlaşılır.
import {
  Editor,
  getKeybindings,
  visibleWidth,
  type EditorOptions,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  BOLD,
  CYAN,
  MAGENTA,
  slashCommandRange,
  style,
  supportsColor,
} from "../colors.js";

/**
 * Terminal kaçış dizileri (CSI/OSC/APC).
 *
 * APC dizileri pi-tui'nin imleç işaretlerini (CURSOR_MARKER, sahte imleç)
 * taşır; sıfır genişliklidirler ve renklendirilecek metnin parçası
 * değildir. Bu diziler ayıklandığında kalan metin, imlecin nerede olduğu
 * bilinmese bile birebir elde edilir.
 */
const ESCAPE_RE = /\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x07]*\x07)/g;

/** Bir satırı kaçış dizileri ve düz metin parçalarına ayırır. */
export function splitLine(line: string): { text: string; escape: boolean }[] {
  const parts: { text: string; escape: boolean }[] = [];
  let last = 0;
  ESCAPE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ESCAPE_RE.exec(line)) !== null) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index), escape: false });
    parts.push({ text: m[0], escape: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), escape: false });
  return parts;
}

/** Kaçış dizileri çıkarılmış hâliyle satırın düz metni. */
export function plainText(line: string): string {
  return splitLine(line)
    .filter((p) => !p.escape)
    .map((p) => p.text)
    .join("");
}

/**
 * Bir satırdaki [start, end) karakter aralığını renklendirir.
 *
 * Aralık düz metin üzerinden tanımlıdır; kaçış dizileri (imleç işaretleri
 * dâhil) yerinde bırakılır. Böylece imleç komutun ortasındayken de renk
 * doğru uygulanır.
 */
export function colorizeRange(line: string, start: number, end: number): string {
  let out = "";
  let pos = 0;
  for (const part of splitLine(line)) {
    if (part.escape) {
      out += part.text;
      continue;
    }
    const len = part.text.length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s >= e) {
      out += part.text;
      pos += len;
      continue;
    }
    const localStart = s - pos;
    const localEnd = e - pos;
    const seg = part.text.slice(localStart, localEnd);
    out += part.text.slice(0, localStart);
    // "/" macenta+kalın, komut adı cyan.
    out += style(seg.slice(0, 1), MAGENTA, BOLD) + style(seg.slice(1), CYAN);
    out += part.text.slice(localEnd);
    pos += len;
  }
  return out;
}

/**
 * Input alanının başındaki işaret (">>> ").
 *
 * Rengi aktif moda göre değişir: plan sari, build yesil, auto turkuaz.
 * `setPromptColor()` ile güncellenir; başlangıçta turkuaz (auto) kullanılır.
 */
let promptColor = CYAN;

/** ">>> " işaretinin rengini değiştirir (mod değişiminde çağrılır). */
export function setPromptColor(color: string): void {
  promptColor = color;
}

/** ">>> " işaretini aktif renkle biçimlendirir. */
export function promptMark(): string {
  return style(">>> ", promptColor, BOLD);
}

/** ">>> " işaretinin görünür genişliği (terminal sütunu). */
export const PROMPT_WIDTH = 4;

/**
 * Metnin başlayacağı sol boşluk (gutter).
 *
 * ">>> " işareti bu boşluğun yerine geçer: pi-tui metni bu boşluktan
 * sonra başlayacak şekilde sarar, böylece işaret eklendiğinde satır
 * ekranı taşmaz. Aksi halde (işaret render sonrası eklenirken) ilk satır
 * 4 sütun taşar ve yazılan karakterler alt satıra düzgün geçmez.
 */
export const PROMPT_GUTTER = PROMPT_WIDTH;

export class SlashCommandEditor extends Editor {
  /**
   * Metin tam olarak "/" iken Enter'a basılırsa çağrılır.
   *
   * pi-tui, Enter'da otomatik tamamlama listesini onaylar; bu yüzden "/"'ın
   * tek başına gönderilmesi normal akışa girmez. Bu geri çağrı, tüm
   * komutların listelendiği komut penceresini açmak için kullanılır.
   */
  onSlashOnly?: () => void;

  /**
   * Otomatik tamamlama listesinde seçili komut Enter ile onaylandığında
   * çağrılır.
   *
   * Parametre, komut adıdır (ör. "tools", "/" öneki olmadan). Kullanıcı ok
   * tuşlarıyla bir komutun üzerine gelip Enter'a bastığında o komutun
   * penceresi açılır.
   */
  onSlashCommandSelected?: (commandName: string) => void;

  /**
   * Komut geçmişi (eskiden yeniye sıralı).
   *
   * Dizi paylaşılır: uygulama her gönderimde üstüne ekler, editör de
   * aynı diziyi okur. Böylece geçmişin tek kaynağı (TuiState.inputHist)
   * olur ve düz REPL ile TUI aynı listeyi paylaşır.
   *
   * Not: pi-tui Editor'ın kendi `history` alanı private olduğu için burada
   * farklı adlar kullanılır (derleme hatası vermesin diye).
   */
  private cmdHistory: string[] = [];

  /**
   * Geçmiş gezinme indeksi.
   *
   * -1 → geçmişte gezinilmiyor (normal yazım). 0 → en eski kayıt.
   * `cmdHistory.length - 1` → en yeni kayıt.
   */
  private cmdHistoryIndex = -1;

  /**
   * Geçmişte gezinmeye başlarken editörde bulunan metin.
   *
   * Kullanıcı en yeni kaydın ötesine (aşağı) geçtiğinde bu taslak geri
   * yüklenir; böylece yazılan metin kaybolmaz.
   */
  private cmdHistoryDraft = "";

  /**
   * Geçmişten metin uygulanırken `setText`in kendi sıfırlamasını engeller.
   *
   * Gezinme sırasında `setText` çağrılır; sıfırlama yapılırsa indeks
   * kaybolur ve gezinme bozulur.
   */
  private applyingHistory = false;

  /** Son render genişliği (sarmalanma kontrolü için). */
  private lastRenderWidth = 0;

  /**
   * Son render'da kullanılan gerçek genişlik.
   *
   * Metin ">>> " işareti için gutter kadar daraltıldığı için çerçeve
   * çiziminde bu değer kullanılır: çerçeve ekranın tamamını kaplar.
   */
  private fullWidth = 0;

  constructor(tui: TUI, theme: EditorTheme, options?: EditorOptions) {
    super(tui, theme, options);
  }

  /**
   * Geçmiş listesini bağlar.
   *
   * Dizi referansı paylaşılır: uygulama gönderilen girdileri aynı diziye
   * eklediği için editör güncel listeyi görür.
   */
  setHistory(entries: string[]): void {
    this.cmdHistory = entries;
  }

  /** Geçmiş gezinme durumunu sıfırlar (yazmaya başlayınca). */
  private resetHistoryNav(): void {
    this.cmdHistoryIndex = -1;
    this.cmdHistoryDraft = "";
  }

  setText(text: string): void {
    // Programatik metin değişimi gezinmeyi bitirir; geçmişten uygulanan
    // metin ise (applyingHistory) gezinmeyi korumalıdır.
    if (!this.applyingHistory) this.resetHistoryNav();
    super.setText(text);
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    // "/" tek başına + Enter → komut penceresi.
    //
    // Önemli: otomatik tamamlama listesi AÇIKKEN Enter önce listeyi onaylar
    // (pi-tui davranışı) ve seçili komutun adına tamamlar. Kullanıcı ok
    // tuşlarıyla bir komutun üzerine gelip Enter'a bastığında o komut
    // ÇALIŞMALIDIR — palet açılmamalıdır. Bu yüzden onSlashOnly yalnızca
    // tamamlama listesi kapalıyken (ya da tamamlanacak bir seçim yokken)
    // tetiklenir.
    if (this.getText() === "/" && kb.matches(data, "tui.input.submit")) {
      // Tamamlama listesi açıkken seçili komutun adı elde edilir; kullanıcı
      // onun üzerine gelip Enter'a bastıysa doğrudan çalıştırılır.
      const selected = this.selectedAutocompleteValue();
      if (selected) {
        this.onSlashCommandSelected?.(selected);
        return;
      }
      this.onSlashOnly?.();
      return;
    }
    // Ok tuşları → komut geçmişi.
    if (this.tryHistoryNav(data)) return;

    const before = this.getText();
    super.handleInput(data);
    // Kullanıcı metni değiştirdiyse (yazma, silme, gönderme) geçmişte
    // gezinme biter; aksi halde "aşağı" tuşu eski kayda dönerdi.
    if (this.getText() !== before) this.resetHistoryNav();
  }

  /**
   * Otomatik tamamlama listesinde seçili olan komutun adı.
   *
   * pi-tui `autocompleteList`'i private tutar; bu yüzden çalışma zamanında
   * erişiliyor. Liste açık değilse veya seçim yoksa `null` döner.
   */
  private selectedAutocompleteValue(): string | null {
    const list = (this as unknown as {
      autocompleteList?: { getSelectedItem?: () => { value?: string } | undefined };
    }).autocompleteList;
    if (!list?.getSelectedItem) return null;
    const item = list.getSelectedItem();
    const value = item?.value;
    return typeof value === "string" && value ? value : null;
  }

  /**
   * Ok tuşlarıyla komut geçmişinde gezinir.
   *
   * Up = daha eski komut, Down = daha yeni komut. En yeni kaydın ötesine
   * inildiğinde gezinmeden önceki metin (taslak) geri yüklenir.
   *
   * @returns Tuş işlendiyse true, yoksa false (pi-tui'ye bırakılır).
   */
  private tryHistoryNav(data: string): boolean {
    const kb = getKeybindings();
    const up = kb.matches(data, "tui.editor.cursorUp");
    const down = kb.matches(data, "tui.editor.cursorDown");
    if (!up && !down) return false;
    // Öneri listesi açıkken ok tuşları listeye aittir.
    if (this.isShowingAutocomplete()) return false;
    if (!this.cmdHistory.length) return false;
    // Gezinme dışındayken "aşağı" tuşu bir şey yapmaz; pi-tui'ye bırakılır
    // (imleç satır sonuna gider).
    if (down && this.cmdHistoryIndex < 0) return false;
    // Çok satırlı/sarmalanmış girdide ok tuşları imleci taşır.
    if (this.cmdHistoryIndex < 0 && !this.isSingleLine()) return false;
    if (up) this.showPrevious();
    else this.showNext();
    return true;
  }

  /** Daha eski komutu gösterir. */
  private showPrevious(): void {
    const hist = this.cmdHistory;
    if (this.cmdHistoryIndex < 0) {
      // Gezinme başlıyor: mevcut metin taslak olarak saklanır.
      this.cmdHistoryDraft = this.getText();
      this.cmdHistoryIndex = hist.length - 1;
    } else if (this.cmdHistoryIndex > 0) {
      this.cmdHistoryIndex -= 1;
    }
    this.applyHistoryText(hist[this.cmdHistoryIndex] ?? "");
  }

  /** Daha yeni komutu gösterir; en yeniden sonra taslağa döner. */
  private showNext(): void {
    const hist = this.cmdHistory;
    if (this.cmdHistoryIndex < hist.length - 1) {
      this.cmdHistoryIndex += 1;
      this.applyHistoryText(hist[this.cmdHistoryIndex] ?? "");
      return;
    }
    // En yeni kaydın ötesi: yazılmaya devam edilen taslak geri gelir.
    this.applyHistoryText(this.cmdHistoryDraft);
    this.resetHistoryNav();
  }

  /** Geçmişten gelen metni editöre uygular. */
  private applyHistoryText(text: string): void {
    this.applyingHistory = true;
    try {
      this.setText(text);
    } finally {
      this.applyingHistory = false;
    }
  }

  /**
   * Girdi tek satırda mı?
   *
   * Sarmalanmış (çok görsel satıra yayılmış) tek satırlık girdilerde ok
   * tuşları imleci görsel satır arasında taşır; geçmiş gezinmesi yapılmaz.
   */
  private isSingleLine(): boolean {
    const lines = this.getLines();
    if (lines.length !== 1) return false;
    if (!this.lastRenderWidth) return true;
    const paddingX = this.getPaddingX();
    // Metin, ">>> " işareti için ayrılan gutter düşülerek sarılır.
    const gutter = Math.min(PROMPT_GUTTER, Math.max(0, this.lastRenderWidth - 1));
    const contentWidth = Math.max(1, this.lastRenderWidth - gutter - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    return visibleWidth(lines[0] ?? "") <= layoutWidth;
  }

  /**
   * Render sonucundaki içerik satırı sayısı.
   *
   * pi-tui'nin Editor'ı bu sayıyı `renderedVisibleLineCount` alanında tutar
   * (private). Üst çerçeve, içerik satırları, alt çerçeve ve otomatik
   * tamamlama listesi sırayla geldiği için bu sayı, içerik satırlarının
   * aralığını belirlemeye yeter.
   */
  private visibleContentLines(): number {
    const n = (this as unknown as { renderedVisibleLineCount?: number })
      .renderedVisibleLineCount;
    return typeof n === "number" && n > 0 ? n : 1;
  }

  /**
   * Üst çerçeve, tam genişlikte çizilir.
   *
   * Metin gutter kadar daraltıldığı için çerçeve de daralırdı; bu
   * override onu tekrar tam genişliğe döndürür.
   */
  protected renderTopBorder(width: number, hiddenLineCount: number): string {
    return super.renderTopBorder(this.fullWidth, hiddenLineCount);
  }

  /** Alt çerçeve, tam genişlikte çizilir (üst çerçeveyle aynı neden). */
  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    return super.renderBottomBorder(this.fullWidth, hiddenLineCount);
  }

  render(width: number): string[] {
    this.lastRenderWidth = width;
    this.fullWidth = width;

    // ">>> " işareti, metnin başlayacağı gutter boşluğunun yerine geçer.
    //
    // ÖNEMLİ: İşaret render SONRASINDA eklenirse, pi-tui metni tam genişlikte
    // sarar; işaret eklenince ilk satır 4 sütun taşar ve yazılan karakterler
    // alt satıra düzgün geçmez (kaybolur). Bu yüzden metin, gutter
    // çıkarılmış genişlikte sarılır ve işaret gutter'ın yerine konur.
    const gutter = Math.min(PROMPT_GUTTER, Math.max(0, width - 1));
    const lines = super.render(width - gutter);

    // super.render() çerçeveleri dar çizer; renderTopBorder/renderBottomBorder
    // override'ı onları tam genişliğe döndürür.
    //
    // Satır yapısı: [0] üst çerçeve, [1..N] içerik satırları, [N+1] alt
    // çerçeve, sonrası otomatik tamamlama listesi.
    const visible = this.visibleContentLines();
    for (let i = 1; i <= visible; i++) {
      // İlk satırda işaret, sonraki satırlarda hizalama boşluğu: metin her
      // satırda aynı sütundan başlar.
      lines[i] = `${i === 1 ? promptMark() : " ".repeat(gutter)}${lines[i]}`;
    }
    for (let i = visible + 2; i < lines.length; i++) {
      // Otomatik tamamlama listesi de metinle aynı hizada başlar.
      lines[i] = `${" ".repeat(gutter)}${lines[i]}`;
    }

    if (!supportsColor()) return lines;

    const text = this.getText();
    const range = slashCommandRange(text);
    if (!range) return lines;

    // Slash komutu tek satırda olmalıdır; sarmalanmış çok satırlı girdilerde
    // renklendirme uygulanmaz.
    const firstLineText = text.split("\n")[0] ?? "";
    if (range.end > firstLineText.length) return lines;
    const cmd = firstLineText.slice(0, range.end);
    if (!cmd) return lines;

    // Komutun bulunduğu satırı bul. İmleç işaretleri metni böldüğü için
    // düz metin üzerinden arama yapılır.
    for (let i = 0; i < lines.length; i++) {
      const flat = plainText(lines[i]);
      const at = flat.indexOf(cmd);
      if (at === -1) continue;
      lines[i] = colorizeRange(lines[i], at, at + cmd.length);
      return lines;
    }
    return lines;
  }
}
