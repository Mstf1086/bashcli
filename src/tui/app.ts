// Etkileşimli TUI uygulaması (pi-tui tabanlı).
//
// Düz REPL'in (`src/cli.ts`) yerini TTY oturumlarında alır; pipe/--plain
// modunda düz REPL çalışmaya devam eder.
//
// Düzen:
//   ┌ başlık (model · mod · alan)
//   ├ konuşma (ScrollView, follow: end)
//   ├ durum satırı / loader
//   └ giriş editörü (odaklı)
//
// Tuşlar:
//   Tab         → mod döngüsü (plan → build → auto)
//   Shift+Tab   → dosya tamamlama
//   Esc         → çalışan isteği iptal et
//   Ctrl+C      → çıkış
//   "/"         → slash komut önerileri (otomatik tamamlama)
import {
  CombinedAutocompleteProvider,
  Loader,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  getKeybindings,
  isViewportTUI,
  type SelectItem,
  type SelectListLayoutOptions,
  type TUI,
} from "@earendil-works/pi-tui";
import { InMemorySessionService, Runner, type LlmAgent } from "@google/adk";
import { basename } from "node:path";
import { createAgent, currentLlmKwargs, workspaceRoot, type AgentMode } from "../index.js";
import { describeError } from "../errors.js";
import { InfoList, OverlayPanel } from "./components/overlay_panel.js";
import { SearchableSelect } from "./components/searchable_select.js";
import { SecretInput } from "./components/secret_input.js";
import { Transcript } from "./components/transcript.js";
import { resolveCommand, toSelectItems, toSlashCommands, withSlash } from "../commands.js";
import { BOLD, CYAN, DIM, GREEN, MAGENTA, RESET, YELLOW, style } from "../colors.js";
import { editorTheme, selectListTheme } from "./theme.js";
import { setPromptColor, SlashCommandEditor } from "./editor.js";
import {
  isCtrlC,
  isCtrlT,
  isCtrlTab,
  isDown,
  isEscape,
  isShiftTab,
  isTermux,
  isUp,
} from "./keys.js";
import { setApprovalHook } from "../approval.js";
import { version } from "../version.js";
import { addUsage, emptyUsage, formatTokens, type TokenUsage } from "../token-usage.js";
import { listSavedSessions, loadSavedEvents, saveSession } from "../session-store.js";

const USER_ID = "cli_user";
const APP_NAME = "bashcli";
const MODES: AgentMode[] = ["plan", "build", "auto"];

// Mod renkleri: plan = sarı, build = yeşil, auto = turkuaz.
const MODE_COLOR: Record<AgentMode, string> = { plan: YELLOW, build: GREEN, auto: CYAN };

export interface TuiState {
  svc: InMemorySessionService;
  runner: Runner;
  agent: LlmAgent;
  sessionId: string;
  mode: AgentMode;
  summary: string | null;
  inputHist: string[];
  /**
   * Birikmiş token tüketimi (ADK usageMetadata'ından).
   *
   * İsteğe bağlı: testler TuiState'i elle kurarken bu alanı vermeyebilir;
   * eksikse sıfır sayacı kullanılır.
   */
  tokens?: TokenUsage;
}

export interface TuiOptions {
  /** Başlangıç görevi (tek seferlik çalıştırma). */
  task?: string;
  /**
   * Çıkışta ekranı temizle (varsayılan: true).
   *
   * Kapatıldığında TUI içeriği ekranda kalır; kullanıcı kabuk istemine
   * dönerken konuşma geçmişini görebilir.
   */
  clearOnExit?: boolean;
}

/** TUI'yi başlatan sınıf. */
export class TuiApp {
  private readonly tui: TUI;
  private readonly terminal: ProcessTerminal;
  private readonly transcript = new Transcript({ paddingX: 1 });
  private readonly scroll: ScrollView;
  private readonly editor: SlashCommandEditor;
  /** Açık olan menü (arama kutulu seçim listesi). */
  private overlayMenu: SearchableSelect | null = null;
  /** Otomatik onay açık mı? (Kapalıysa araç çalıştırılmadan önce sorulur.) */
  private autoApprove = true;
  private readonly header: Text;
  private readonly status: Text;
  private readonly loader: Loader;
  /** Loader görünürken durum satırını gizler. */
  private loading = false;
  private readonly state: TuiState;
  private readonly options: TuiOptions;
  /** Aktif çalışma isteğinin iptal denetleyicisi. */
  private abortController: AbortController | null = null;
  private running = false;

  constructor(state: TuiState, options: TuiOptions = {}) {
    this.state = state;
    this.options = options;

    this.terminal = new ProcessTerminal();
    this.tui = new TuiAltScreen(this.terminal);

    this.header = new Text("", 1, 0);
    this.status = new Text("", 1, 0);
    this.loader = new Loader(
      this.tui,
      (s) => style(s, CYAN),
      (s) => style(s, DIM),
      "",
    );
    this.scroll = new ScrollView(this.transcript, {
      follow: "end",
      primary: true,
      overscroll: "chain",
      scrollbar: "auto",
    });

    this.editor = new SlashCommandEditor(this.tui, editorTheme, { paddingX: 1 });
    // ">>> " işareti başlangıç modunun renginde olur.
    setPromptColor(MODE_COLOR[this.state.mode]);
    // Komut adları "/" öneki olmadan verilir; pi-tui öneki kendisi ekler.
    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(toSlashCommands(), workspaceRoot()),
    );
    // Up/Down ok tuşları komut geçmişinde gezinir. Geçmiş dizisi paylaşılır:
    // handleSubmit her gönderimde aynı diziye ekler, editör de onu okur.
    this.editor.setHistory(this.state.inputHist);
    this.editor.onSubmit = (text) => { void this.handleSubmit(text); };
    // "/" tek başına + Enter → tüm komutların listelendiği komut penceresi.
    this.editor.onSlashOnly = () => {
      this.editor.setText("");
      void this.showCommandPalette();
    };
    // Otomatik tamamlama listesinde seçili komut Enter ile onaylandığında
    // o komut doğrudan çalıştırılır (palet açılmaz).
    this.editor.onSlashCommandSelected = (commandName) => {
      this.editor.setText("");
      void this.runCommand(commandName);
    };
    // Oto onay kapalıyken araç çalıştırmadan önce onay iste.
    setApprovalHook(async (req) => {
      if (this.autoApprove) return true;
      const picked = await this.selectOverlay(
        [
          { value: "yes", label: "Onayla", description: req.summary },
          { value: "no", label: "Reddet", description: req.summary },
        ],
        `Onay: ${req.tool}`,
        { maxPrimaryColumnWidth: 14 },
      );
      return picked?.value === "yes";
    });

    this.configureKeybindings();

    const layout = new VStack([
      { component: this.header, basis: "auto" as const, shrink: 0, minSize: 1 },
      { component: this.scroll, basis: 0, grow: 1, minSize: 1 },
      {
        component: this.status,
        basis: "auto" as const,
        shrink: 0,
        minSize: 1,
        visible: () => !this.loading,
      },
      {
        component: this.loader,
        basis: "auto" as const,
        shrink: 0,
        minSize: 1,
        visible: () => this.loading,
      },
      { component: this.editor, basis: "auto" as const, shrink: 1, minSize: 1 },
    ]);
    // TuiAltScreen sabit yükseklikli düzen sahiplenir; layoutRoot verildiğinde
    // addChild ile eklenen çocuklar render edilmez.
    if (isViewportTUI(this.tui)) this.tui.setLayoutRoot(layout);
    else this.tui.addChild(layout);

    this.tui.setFocus(this.editor);
    this.tui.addInputListener((data) => this.handleGlobalKey(data));
  }

  /** TUI'yi başlatır; kapanana kadar bekler. */
  async run(): Promise<void> {
    this.running = true;
    this.updateHeader();
    this.updateStatus();
    this.tui.start();
    // Termux Ctrl+Tab'ı gönderemediği için orada Ctrl+T yazılır.
    const onayTusu = isTermux() ? "CTRL+T" : "CTRL+TAB";
    this.transcript.addNotice(
      `TAB mod değiştirir · ${onayTusu} oto onay · ESC iptal eder · / komutlar`
      + " · ↑/↓ komut geçmişi",
    );
    this.transcript.addSpacer();
    this.tui.requestRender();

    if (this.options.task) {
      await this.handleSubmit(this.options.task);
    }

    while (this.running) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // Loader'ın setInterval'ı ve stdin okuması süreci ayakta tutabilir;
    // ikisini de serbest bırakıp terminali düzeltiyoruz.
    this.loader.stop();
    // preserveScreen: true → alt ekrandan çıkarken TUI içeriği ekrana
    // yeniden yazılmaz (varsayılan davranış içeriği kalıcı bırakıyordu).
    // Aşağıdaki clearScreen() ile ekran temizlenir; böylece kullanıcı
    // kabuk istemine döner.
    this.tui.stop({ preserveScreen: true });
    // Varsayılan: ekran temizlenir (kullanıcı kabuk istemine döner).
    if (this.options.clearOnExit !== false) this.clearScreen();
    process.stdin.pause();
  }

  /**
   * Terminal ekranını temizler ve imleci sol üste alır.
   *
   * ESC[2J (tüm ekran), ESC[3J (kaydırma tamponu) ve ESC[H (imleç) kullanılır.
   * Çıkışta TUI içeriğinin ekranda kalmasını engeller.
   */
  private clearScreen(): void {
    this.terminal.write("\x1b[2J\x1b[3J\x1b[H");
  }

  /** Uygulamayı kapatır (dışarıdan veya Ctrl+C ile). */
  shutdown(): void {
    this.running = false;
  }

  /**
   * Tuş bağlamalarını yapılandırır.
   *
   * "tui.input.tab" varsayılan olarak yalnızca "tab" idi. Onu hem "tab" hem
   * "shift+tab" yapıyoruz:
   *   - Öneri listesi kapalıyken düz Tab global işleyiciye (mod döngüsü) gider,
   *     Shift+Tab ise Editor'ın dosya tamamlama yolunu çalıştırır.
   *   - Öneri listesi açıkken düz Tab seçimi onaylar (Editor'ın kendi yolu).
   */
  private configureKeybindings(): void {
    const kb = getKeybindings();
    kb.setUserBindings({
      ...kb.getUserBindings(),
      // Shift+Tab kaldırıldı: dosya tamamlama artık yok.
      "tui.input.tab": ["tab"],
    });
  }

  /** Global tuş işleyicisi: ok tuşları, Tab (mod), Ctrl+Tab (onay), Esc, Ctrl+C. */
  private handleGlobalKey(data: string): { consume?: boolean } | undefined {
    // Overlay (menü) açıkken:
    //  - Ok tuşları menüdeki seçimi biz yönetiyoruz. Kitty protokolü
    //    etkinleştirilemeyen terminallerde legacy diziler eşleşmediği için
    //    seçim değiştirilemiyordu ("her seçimde aynı menü" belirtisi).
    //  - Diğer tuşlar (yazı, Enter/Esc/Ctrl+C) overlay'e gitsin.
    if (this.tui.hasOverlay()) {
      if (this.overlayMenu && this.overlayMenu.visibleCount > 0) {
        if (isUp(data)) {
          this.overlayMenu.move(-1);
          this.tui.requestRender();
          return { consume: true };
        }
        if (isDown(data)) {
          this.overlayMenu.move(1);
          this.tui.requestRender();
          return { consume: true };
        }
      }
      return undefined;
    }
    // Ctrl+C: uygulamayı kapat.
    if (isCtrlC(data)) {
      this.shutdown();
      return { consume: true };
    }
    // Ctrl+Tab: otomatik onayı aç/kapa.
    // Termux Ctrl+Tab'ı düz Tab olarak gönderdiği için (Kitty protokolü yok)
    // ayırt edilemez; orada Ctrl+T alias'ı devreye girer.
    if (isCtrlTab(data) || isCtrlT(data)) {
      this.toggleAutoApprove();
      return { consume: true };
    }
    // Shift+Tab artık kullanılmıyor (dosya tamamlama kaldırıldı).
    if (isShiftTab(data)) {
      return { consume: true };
    }
    // Esc: çalışan isteği iptal et.
    if (isEscape(data)) {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
        this.transcript.addNotice("İstek iptal edildi.", "error");
        this.hideLoader();
        this.updateStatus();
        this.tui.requestRender();
      }
      return undefined;
    }
    // Tab: mod döngüsü. Autocomplete açıkken Editor kendi yolunu kullanır,
    // bu yüzden yalnızca autocomplete kapalıyken yakalıyoruz.
    if (data === "\t") {
      if (this.editor.isShowingAutocomplete()) return undefined;
      this.cycleMode();
      return { consume: true };
    }
    return undefined;
  }

  /** Otomatik onayı aç/kapa ve durumu bildirir. */
  private toggleAutoApprove(): void {
    this.setAutoApprove(!this.autoApprove);
  }

  /** Otomatik onayı belirtilen değere ayarlar ve durumu bildirir. */
  private setAutoApprove(value: boolean): void {
    this.autoApprove = value;
    this.transcript.addNotice(
      this.autoApprove
        ? "Oto onay: AÇIK — araçlar doğrudan çalışır."
        : "Oto onay: KAPALI — dosya yazma ve komut çalıştırma onay ister.",
    );
    this.updateStatus();
    this.tui.requestRender();
  }

  /** Mod döngüsü: plan → build → auto → plan. */
  private cycleMode(): void {
    const next = MODES[(MODES.indexOf(this.state.mode) + 1) % MODES.length];
    this.setMode(next);
    this.transcript.addNotice(`Mod: ${style(next, MODE_COLOR[next], BOLD)}`);
    this.updateHeader();
    this.updateStatus();
    this.tui.requestRender();
  }

  /** Modu değiştirir ve runner'ı yeniden kurar. */
  private setMode(mode: AgentMode): void {
    this.state.mode = mode;
    // ">>> " işareti aktif modun rengine döner.
    setPromptColor(MODE_COLOR[mode]);
    const agent = createAgent(mode);
    this.state.agent = agent;
    this.state.runner = new Runner({
      agent,
      sessionService: this.state.svc,
      appName: APP_NAME,
    });
  }

  /** Editörden gelen gönderim. */
  private async handleSubmit(raw: string): Promise<void> {
    const input = raw.trim();
    if (!input) return;
    const h = this.state.inputHist;
    if (!h.length || h[h.length - 1] !== input) h.push(input);
    this.editor.setText("");

    if (input.startsWith("/")) {
      // "/" tek başına → tüm komutlar komut penceresinde açılır.
      if (input === "/") {
        await this.showCommandPalette();
        return;
      }
      // Kısaltmalar da çalışır: "/prov" → "/provider".
      const res = resolveCommand(input);
      if (res.kind === "exact" || res.kind === "prefix") {
        const cmd = withSlash(res.command!.name);
        // Argümanlı komutlar (ör. "/mode plan") tüm girdiyi almalı.
        await this.dispatch(cmd, cmd === "/mode" ? input : cmd);
        return;
      }
      if (res.kind === "ambiguous") {
        // Birden fazla komut eşleşiyor: eşleşenleri seçim menüsünde göster.
        await this.showCommandPalette(res.candidates!.map((c) => c.name));
        return;
      }
      this.transcript.addNotice(`Bilinmeyen komut: ${input}`, "error");
      this.tui.requestRender();
      return;
    }

    await this.runTurn(input);
  }

  /**
   * Komut adını (ör. "tools") çalıştırır.
   *
   * Otomatik tamamlama listesinden seçilen komutlar bu yolla çalıştırılır:
   * kullanıcı ok tuşlarıyla bir komuta gelip Enter'a bastığında o komutun
   * penceresi açılır.
   */
  private async runCommand(commandName: string): Promise<void> {
    const cmd = withSlash(commandName);
    // Geçmişe eklenir: ↑/↓ ile geri çağrılabilsin.
    const h = this.state.inputHist;
    if (!h.length || h[h.length - 1] !== cmd) h.push(cmd);
    await this.dispatch(cmd, cmd);
  }

  /** Ajan turu: isteği gönderir, olayları transcript'e yazar. */
  private async runTurn(text: string): Promise<void> {
    let message = text;
    if (this.state.summary) {
      message =
        `[Oturum özeti — önceki konuşmanın sıkıştırılmış hali]\n${this.state.summary}\n`
        + `[/Oturum özeti]\n\n${message}`;
      this.state.summary = null;
    }

    this.transcript.addUser(text);
    this.showLoader("Düşünüyor…");

    const controller = new AbortController();
    this.abortController = controller;
    try {
      for await (const event of this.state.runner.runAsync({
        userId: USER_ID,
        sessionId: this.state.sessionId,
        newMessage: { role: "user", parts: [{ text: message }] },
        abortSignal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        // ADK, model hatasını fırlatmak yerine errorCode/errorMessage
        // içeren bir event üretir. Bu alanlar kontrol edilmezse hata sessizce
        // yutulur ve kullanıcı hiçbir geri bildirim görmez.
        if (event.errorCode) {
          this.transcript.addNotice(
            describeError(new Error(event.errorMessage ?? event.errorCode), event.errorCode),
            "error",
          );
          this.tui.requestRender();
          continue;
        }
        // Token tüketimi: ADK usageMetadata'sını biriktir.
        if (event.usageMetadata) {
          this.state.tokens = addUsage(
            this.state.tokens ?? emptyUsage(),
            event.usageMetadata,
          );
        }
        for (const p of event.content?.parts ?? []) {
          const part = p as {
            functionCall?: { name: string; args?: unknown };
            functionResponse?: unknown;
            text?: string;
          };
          if (part.functionCall) {
            this.transcript.addToolCall(part.functionCall.name, part.functionCall.args);
          } else if (part.functionResponse) {
            this.transcript.addToolResponse(
              (part.functionResponse as { response?: unknown }).response ?? part.functionResponse,
            );
          } else if (typeof part.text === "string" && part.text.trim()) {
            this.transcript.addAssistant(part.text.trim());
          }
        }
        this.tui.requestRender();
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        this.transcript.addNotice(describeError(e), "error");
      }
    } finally {
      this.abortController = null;
      this.hideLoader();
      this.updateStatus();
      // Tur sonunda oturumu diske yaz: "/history" önceki oturumları listeleyip
      // geri yükleyebilsin.
      await this.persistCurrentSession();
      this.tui.requestRender();
    }
  }

  /** Slash komutunu yürütür. false dönerse uygulama kapanmalı. */
  private async dispatch(cmd: string, fullInput: string): Promise<boolean> {
    switch (cmd) {
      case "/quit":
        this.transcript.addNotice("Görüşürüz!");
        this.shutdown();
        return false;
      case "/help":
        await this.showCommandPalette();
        return true;
      case "/tools": {
        const lines: string[] = [];
        for (const t of this.state.agent.tools ?? []) {
          const tool = t as { name?: string; description?: string };
          lines.push(style(tool.name ?? "?", BOLD, CYAN));
          lines.push(`  ${(tool.description ?? "").split("\n")[0]}`);
          lines.push("");
        }
        await this.showInfoOverlay("Araçlar", lines);
        return true;
      }
      case "/history":
        await this.showHistory();
        return true;
      case "/compact":
        await this.compact();
        return true;
      case "/clear":
        // Ekranı temizle, mevcut oturumu diske kaydet ve yeni bir oturum
        // (yeni bağlam) başlat.
        await this.persistCurrentSession();
        this.transcript.clear();
        this.state.sessionId = (
          await this.state.svc.createSession({ appName: APP_NAME, userId: USER_ID })
        ).id;
        this.state.summary = null;
        this.transcript.addNotice(
          `Yeni bağlam oluşturuldu (mod: ${this.state.mode}).`,
        );
        this.updateStatus();
        this.tui.requestRender();
        return true;
      case "/provider":
        await this.runProviderSetup();
        return true;
      case "/model":
        await this.runModelSetup();
        return true;
      case "/settings":
        await this.showSettings();
        return true;
      case "/rules":
        await this.showRules();
        return true;
      case "/keys":
        await this.showKeys();
        return true;
      case "/tokens":
        await this.showTokens();
        return true;
      case "/approve": {
        // Otomatik onayı aç/kapa. Termux gibi terminallerde Ctrl+Tab
        // gönderilemediği için bu komut birincil alternatiftir.
        const arg = fullInput.slice("/approve".length).trim().toLowerCase();
        if (arg === "on") this.setAutoApprove(true);
        else if (arg === "off") this.setAutoApprove(false);
        else this.toggleAutoApprove();
        return true;
      }
      case "/mode": {
        const arg = fullInput.slice("/mode".length).trim();
        if ((["plan", "build", "auto"] as string[]).includes(arg)) {
          const mode = arg as AgentMode;
          this.setMode(mode);
          this.transcript.addNotice(`Mod: ${style(mode, MODE_COLOR[mode], BOLD)}`);
          this.updateHeader();
          this.updateStatus();
        } else if (!arg) {
          this.cycleMode();
        } else {
          this.transcript.addNotice("Kullanım: /mode plan|build|auto", "error");
        }
        this.tui.requestRender();
        return true;
      }
      default:
        this.transcript.addNotice("Bilinmeyen komut; / yazın.", "error");
        this.tui.requestRender();
        return true;
    }
  }

  /**
   * Bir seçim menüsü gösterir ve seçim döner.
   *
   * Menünün üstünde arama kutusu bulunur; yazılan metne göre sonuçlar fuzzy
   * eşleşmeyle süzülür. Escape veya iptal seçilirse null döner.
   */
  private async selectOverlay(
    items: SelectItem[],
    title: string,
    layout?: SelectListLayoutOptions,
  ): Promise<SelectItem | null> {
    if (!items.length) return null;
    // Menü yüksekliği: başlık + arama kutusu + alt bilgi = 3 satır. Liste
    // kalan yere sığacak kadar kısaltılır, aksi halde alt bilgi ekrandan
    // taşar.
    const maxVisible = Math.max(3, this.overlayMaxHeight() - 3);
    const menu = new SearchableSelect({
      items,
      maxVisible,
      theme: selectListTheme,
      layout,
    });
    const panel = new OverlayPanel(
      new Text(style(title, BOLD, CYAN), 1, 0),
      menu,
      new Text(style("↑/↓ gez · Enter seç · Esc kapat", DIM), 1, 0),
    );
    const promise = new Promise<SelectItem | null>((resolve) => {
      menu.onSelect = (item) => { handle.hide(); resolve(item); };
      menu.onCancel = () => { handle.hide(); resolve(null); };
    });
    const handle = this.tui.showOverlay(panel, {
      // Menü yatayda tam ekran: tüm genişlik.
      width: "100%",
      minWidth: 20,
      maxHeight: this.overlayMaxHeight(),
      // Menü ekranın altında, durum satırının (TAB ipuçları) hemen üstünde
      // durur; başlık satırı ve konuşma geçmişi görünür kalır.
      anchor: "bottom-center",
      offsetY: -this.overlayBottomOffset(),
    });
    // Ok tuşlarını biz yönetiyoruz: Kitty etkinleştirilemeyen terminallerde
    // legacy diziler eşleşmiyor ve seçim değiştirilemiyor.
    this.overlayMenu = menu;
    this.tui.requestRender();
    return promise;
  }

  /**
   * Salt-okunur bilgi penceresi açar.
   *
   * `/tools`, `/rules`, `/keys` gibi komutların çıktısı transcript'e dökülmek
   * yerine bu pencerede gösterilir: başlık + kaydırılabilir satırlar.
   * Esc/Enter ile kapatılır.
   */
  private async showInfoOverlay(title: string, lines: string[]): Promise<void> {
    if (!lines.length) {
      this.transcript.addNotice("(bilgi yok)");
      this.tui.requestRender();
      return;
    }
    // Başlık + alt bilgi için iki satır ayrılır.
    const maxVisible = Math.max(3, this.overlayMaxHeight() - 2);
    const list = new InfoList(lines, maxVisible, () => this.tui.requestRender());
    const panel = new OverlayPanel(
      new Text(style(title, BOLD, CYAN), 1, 0),
      list,
      new Text(style("↑/↓ kaydır · Esc kapat", DIM), 1, 0),
    );
    const promise = new Promise<void>((resolve) => {
      const close = () => { handle.hide(); resolve(); };
      // Esc ve Enter pencereyi kapatır; ok tuşları kaydırır.
      const onKey = (data: string) => {
        if (data === "\x1b" || data === "\r" || data === "\n") {
          this.tui.removeInputListener(onKey);
          close();
          return { consume: true };
        }
        return undefined;
      };
      this.tui.addInputListener(onKey);
    });
    const handle = this.tui.showOverlay(panel, {
      width: "100%",
      minWidth: 20,
      maxHeight: this.overlayMaxHeight(),
      anchor: "bottom-center",
      offsetY: -this.overlayBottomOffset(),
    });
    this.tui.requestRender();
    await promise;
  }

  /**
   * Ekranın alt bölümünü kaplayan satır sayısı (durum satırı + girdi editörü).
   *
   * Düzen (yukarıdan aşağı): başlık · konuşma · durum satırı · girdi editörü.
   * Overlay menüsü bu bloğun hemen üstüne oturmalı.
   *
   * pi-tui overlay'ı `satır = (termYükseklik - menüYüksekliği) + offsetY`
   * biçiminde konumlandırır; yani `offsetY`, alt bloğun yüksekliğine eşit
   * olmalıdır. Değerler her çağrıda yeniden ölçülür: durum satırı dar
   * ekranlarda sarmalanarak iki satıra çıkabiliyor ve editörün yüksekliği
   * (otomatik tamamlama listesi açıkken) satır satır değişebiliyor.
   */
  private bottomChromeHeight(): number {
    const width = Math.max(1, this.terminal.columns);
    // Durum satırı ile loader'ın ikisi de görünür durumda biri seçili
    // olduğundan, o an görünen olanın yüksekliği ölçülür.
    const statusHeight = this.loading
      ? this.loader.render(width).length
      : this.status.render(width).length;
    const editorHeight = this.editor.render(width).length;
    return statusHeight + Math.max(1, editorHeight);
  }

  /**
   * Overlay menüsünün ekranın altından ne kadar yukarıda duracağı (satır).
   *
   * Menü, durum satırının (TAB ipuçları) hemen üstünde açılmalı.
   */
  private overlayBottomOffset(): number {
    return this.bottomChromeHeight();
  }

  /**
   * Overlay menüsünün azami yüksekliği (satır).
   *
   * Menü durum satırının üstünde kalmalı ve başlık satırını ezmemeli.
   */
  private overlayMaxHeight(): number {
    const rows = this.terminal.rows;
    const usable = rows - this.overlayBottomOffset() - 1; // -1: başlık satırı
    return Math.max(3, usable);
  }

  /** Komut paleti (SelectList overlay). */
  /**
   * Komut penceresini açar.
   *
   * @param only Yalnızca bu komut adlarını gösterir. Belirsiz kısaltmalarda
   *   (ör. "/m" → "/model" ve "/mode") eşleşenlerle sınırlanır.
   */
  private async showCommandPalette(only?: string[]): Promise<void> {
    const all: SelectItem[] = toSelectItems();
    const items = only
      ? all.filter((i) => only.includes(String(i.value)))
      : all;
    // Komut adları kısa; açıklamaya daha çok yer bırakmak için primary kolon
    // sınırlanıyor.
    const picked = await this.selectOverlay(items, "Komutlar", { maxPrimaryColumnWidth: 16 });
    if (!picked) return;
    // Seçim değeri "/" öneki olmadan gelir (ör. "quit"); dispatch ise
    // "/quit" bekliyor — bu yüzden önek eklenir.
    await this.dispatch(withSlash(picked.value), withSlash(picked.value));
  }

  /** Ayarlar menüsü. */
  private async showSettings(): Promise<void> {
    const llm = currentLlmKwargs();
    const items: SelectItem[] = [
      { value: "mode:plan", label: "Mod: plan", description: "Yalnızca plan; dosya değiştirmez" },
      { value: "mode:build", label: "Mod: build", description: "Kod yazar ve düzenler" },
      { value: "mode:auto", label: "Mod: auto", description: "Otomatik onay" },
      {
        value: "info",
        label: "Bilgi",
        description: `Model: ${llm.model} · Alan: ${workspaceRoot()}`,
      },
      { value: "provider", label: "Sağlayıcı/model değiştir", description: "/provider ile aynı" },
      {
        value: "approve",
        label: `Oto onay: ${this.autoApprove ? "AÇIK" : "KAPALI"}`,
        description: "Kapalıyken dosya yazma ve komut çalıştırma onay ister",
      },
    ];
    const picked = await this.selectOverlay(items, "Ayarlar");
    if (!picked) return;
    if (picked.value.startsWith("mode:")) {
      const mode = picked.value.slice(5) as AgentMode;
      this.setMode(mode);
      this.transcript.addNotice(`Mod: ${style(mode, MODE_COLOR[mode], BOLD)}`);
      this.updateHeader();
      this.updateStatus();
    } else if (picked.value === "provider") {
      await this.runProviderSetup();
    } else if (picked.value === "approve") {
      this.toggleAutoApprove();
    } else if (picked.value === "info") {
      this.transcript.addNotice(`Model: ${llm.model}`);
      this.transcript.addNotice(`Alan: ${workspaceRoot()}`);
    }
    this.tui.requestRender();
  }

  /** Proje kurallarını ve ignore listesini gösterir. */
  private async showRules(): Promise<void> {
    const {
      loadProjectRules, loadIgnorePatterns, ignoreFilePath, CONFIG_DIR,
    } = await import("../project-config.js");
    const rules = loadProjectRules();
    const lines: string[] = [];
    if (rules.length) {
      lines.push(style(`Proje kuralları (${CONFIG_DIR}/rules)`, BOLD));
      for (const r of rules) lines.push(`  ${style("·", GREEN)} ${r.name}`);
    } else {
      lines.push(
        `Proje kuralı yok (${CONFIG_DIR}/rules/ veya ${CONFIG_DIR}/rules.md).`,
      );
    }
    lines.push("");
    const patterns = loadIgnorePatterns();
    lines.push(style("Ignore listesi", BOLD));
    lines.push(`  ${DIM}${ignoreFilePath()}${RESET}`);
    if (patterns.length) {
      for (const p of patterns) lines.push(`  ${style("·", YELLOW)} ${p}`);
    } else {
      lines.push(`  ${DIM}(boş)${RESET}`);
    }
    await this.showInfoOverlay("Proje kuralları", lines);
  }

  /** Sağlayıcı API anahtarlarını gösterir. */
  private async showKeys(): Promise<void> {
    const { listProviderKeys } = await import("../providers.js");
    const rows = listProviderKeys().filter((p) => p.apiKey);
    if (!rows.length) {
      this.transcript.addNotice(
        "Kayıtlı API anahtarı yok; /provider ile ekleyin.",
        "error",
      );
      this.tui.requestRender();
      return;
    }
    const lines: string[] = [];
    for (const p of rows) {
      const mark = p.active ? style("●", GREEN) : style("○", DIM);
      lines.push(
        `${mark} ${style(p.provider, p.active ? GREEN : DIM)}${p.active ? " (aktif)" : ""}`
        + `  ${style(p.label, DIM)}`,
      );
      lines.push(`    api_key: ${p.apiKey}`);
      lines.push(`    ${style(`base_url: ${p.baseUrl ?? "-"} · model: ${p.model ?? "-"}`, DIM)}`);
      lines.push("");
    }
    await this.showInfoOverlay("Sağlayıcı API anahtarları", lines);
  }

  /** Token tüketimini gösterir. */
  private async showTokens(): Promise<void> {
    const t = this.state.tokens ?? emptyUsage();
    if (t.calls === 0) {
      this.transcript.addNotice("Henüz model çağrısı yapılmadı.");
      this.tui.requestRender();
      return;
    }
    const lines = [
      `${style("Token tüketimi", BOLD)} ${DIM}(${t.calls} model çağrısı)${RESET}`,
      `  giriş (prompt) : ${t.prompt}`,
      `  çıkış         : ${t.completion}`,
      `  toplam        : ${style(String(t.total), BOLD)}`,
    ];
    await this.showInfoOverlay("Token tüketimi", lines);
  }

  /**
   * Sağlayıcı kurulumu: sağlayıcı seçimi → API anahtarı (gizli) → model listesi.
   * API anahtarı hiçbir zaman ekrana basılmaz.
   */
  private async runProviderSetup(): Promise<void> {
    const { PROVIDERS, fetchModels, saveProvider } = await import("../providers.js");
    const { readUserProvider } = await import("../user-config.js");

    // Aktif sağlayıcı listede işaretlenir: yanlış sağlayıcı seçimi (ve
    // dolayısıyla "anahtar başka sağlayıcıya ait" uyarısı) önlenir.
    const activeKey = readUserProvider()?.provider
      ?? process.env.PROVIDER
      ?? "zenmux";
    const picked = await this.selectOverlay(
      PROVIDERS.map((p) => ({
        value: p.key,
        label: p.key === activeKey ? `${p.label} (aktif)` : p.label,
        description: p.note ?? `[${p.key}]`,
      })),
      "Sağlayıcı seç",
    );
    if (!picked) return;
    const spec = PROVIDERS.find((p) => p.key === picked.value);
    if (!spec) return;

    let apiKey: string | null = null;
    if (spec.needsKey !== false) {
      const key = await this.promptSecret(`API anahtarı (${spec.keyEnv})`);
      if (key === null) {
        this.transcript.addNotice("İptal edildi.");
        this.tui.requestRender();
        return;
      }
      apiKey = key.trim();
      if (!apiKey) {
        this.transcript.addNotice("API anahtarı boş; iptal.", "error");
        this.tui.requestRender();
        return;
      }
    } else {
      this.transcript.addNotice("Bu sağlayıcı API anahtarı gerektirmez.");
    }

    let baseUrl: string | null = null;
    // Base URL yalnızca özel endpoint'te sorulur; hazır sağlayıcılarda
    // varsayılan kullanılır (akış: sağlayıcı → anahtar → model listesi).
    if (spec.key === "custom") {
      baseUrl = await this.promptLine("Base URL");
      if (!baseUrl) {
        this.transcript.addNotice("Base URL boş; iptal.", "error");
        this.tui.requestRender();
        return;
      }
    }

    // Anahtarı doğrula: yanlış sağlayıcıya ait bir anahtar kaydedilirse
    // tüm istekler sessizce reddedilir ve kullanıcı ne olduğunu anlamaz.
    // Uyarılar (yanlış sağlayıcı, ağ/kota) akışı kesmez; yalnızca bilgilendirir.
    if (apiKey) {
      this.transcript.addNotice("Anahtar doğrulanıyor…");
      this.tui.requestRender();
      const { verifyApiKey } = await import("../providers.js");
      const check = await verifyApiKey(spec.key, apiKey, baseUrl);
      if (!check.ok) {
        this.transcript.addNotice(check.message, check.fatal ? "error" : "warn");
        if (check.likelyProvider) {
          const other = PROVIDERS.find((p) => p.key === check.likelyProvider);
          this.transcript.addNotice(
            `İpucu: ${other?.label ?? check.likelyProvider} sağlayıcısını seçip `
            + "tekrar deneyin.",
          );
        }
        if (check.fatal) {
          this.tui.requestRender();
          return;
        }
      } else {
        this.transcript.addNotice("Anahtar doğrulandı.");
      }
      this.tui.requestRender();
    }

    this.transcript.addNotice("Model listesi alınıyor…");
    this.tui.requestRender();

    let modelId: string;
    try {
      const models = await fetchModels(spec.key, apiKey, baseUrl);
      if (!models.length) {
        this.transcript.addNotice("Liste boş döndü.", "error");
        this.tui.requestRender();
        return;
      }
      const pickedModel = await this.selectOverlay(
        models.slice(0, 200).map((m) => ({ value: m, label: m })),
        "Model seç",
      );
      if (!pickedModel) {
        this.transcript.addNotice("İptal edildi.");
        this.tui.requestRender();
        return;
      }
      modelId = pickedModel.value;
    } catch (e) {
      this.transcript.addNotice(
        `Liste alınamadı: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
      const manual = await this.promptLine("Model adını elle girin (boş=iptal)");
      if (!manual) {
        this.tui.requestRender();
        return;
      }
      modelId = manual;
    }

    const full = modelId.startsWith(spec.litellmPrefix)
      ? modelId
      : spec.litellmPrefix + modelId;
    saveProvider(spec.key, apiKey, baseUrl, full);
    this.setMode(this.state.mode); // yeni modelle runner'ı yenile
    this.transcript.addNotice(
      `Kaydedildi → ${spec.key} · ${full} ${style("(kullanıcı cihazına yazıldı)", DIM)}`,
    );
    this.updateHeader();
    this.updateStatus();
    this.tui.requestRender();
  }

  /**
   * Aktif sağlayıcının model listesini getirir ve seçim yapar.
   *
   * Sağlayıcı daha önce eklendiyse anahtarı ve base URL'i kayıtlı
   * ayarlardan okunur; bu yüzden yalnızca model seçmek gerekir.
   */
  private async runModelSetup(): Promise<void> {
    const { PROVIDERS, fetchModels, saveProvider } = await import("../providers.js");
    const { readUserProvider } = await import("../user-config.js");

    const user = readUserProvider();
    const providerKey = user?.provider ?? process.env.PROVIDER ?? "zenmux";
    const spec = PROVIDERS.find((p) => p.key === providerKey);
    if (!spec) {
      this.transcript.addNotice("Aktif sağlayıcı bulunamadı; /provider ile ekleyin.", "error");
      this.tui.requestRender();
      return;
    }

    const apiKey = user?.apiKey
      ?? (spec.keyEnv ? process.env[spec.keyEnv] : undefined)
      ?? null;
    const baseUrl = user?.baseUrl
      ?? (spec.baseEnv ? process.env[spec.baseEnv] : undefined)
      ?? spec.defaultBase
      ?? null;

    this.transcript.addNotice(`${spec.label} modelleri alınıyor…`);
    this.tui.requestRender();

    let models: string[];
    try {
      models = await fetchModels(spec.key, apiKey, baseUrl);
    } catch (e) {
      this.transcript.addNotice(
        `Model listesi alınamadı: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
      this.tui.requestRender();
      return;
    }
    if (!models.length) {
      this.transcript.addNotice("Model listesi boş döndü.", "error");
      this.tui.requestRender();
      return;
    }

    const picked = await this.selectOverlay(
      models.slice(0, 300).map((m) => ({ value: m, label: m })),
      `${spec.label} · model seç`,
      { maxPrimaryColumnWidth: 40 },
    );
    if (!picked) {
      this.transcript.addNotice("İptal edildi.");
      this.tui.requestRender();
      return;
    }

    const full = picked.value.startsWith(spec.litellmPrefix)
      ? picked.value
      : spec.litellmPrefix + picked.value;
    saveProvider(spec.key, apiKey, baseUrl, full);
    this.setMode(this.state.mode);
    this.transcript.addNotice(`Model değiştirildi → ${full}`);
    this.updateHeader();
    this.updateStatus();
    this.tui.requestRender();
  }

  /**
   * Gizli (maskeli) metin girişi. Gerçek değer ekrana asla basılmaz.
   * Escape ile iptal edilirse null döner.
   */
  private async promptSecret(label: string): Promise<string | null> {
    const input = new SecretInput({ prompt: `${label}: ` });
    const panel = new OverlayPanel(
      new Text(style(label, BOLD, CYAN), 1, 0),
      input,
      new Text(style("Enter: kaydet · Esc: iptal", DIM), 1, 0),
    );
    const promise = new Promise<string | null>((resolve) => {
      input.onSubmit = (value) => { handle.hide(); resolve(value); };
      input.onEscape = () => { handle.hide(); resolve(null); };
    });
    const handle = this.tui.showOverlay(panel, {
      width: "100%",
      minWidth: 20,
      anchor: "center",
    });
    this.tui.requestRender();
    return promise;
  }

  /** Normal tek satır metin girişi (overlay içinde, maskesiz). */
  private async promptLine(label: string): Promise<string | null> {
    const input = new SecretInput({ prompt: `${label}: `, mask: "" });
    const panel = new OverlayPanel(
      new Text(style(label, BOLD, CYAN), 1, 0),
      input,
      new Text(style("Enter: onayla · Esc: iptal", DIM), 1, 0),
    );
    const promise = new Promise<string | null>((resolve) => {
      input.onSubmit = (value) => { handle.hide(); resolve(value); };
      input.onEscape = () => { handle.hide(); resolve(null); };
    });
    const handle = this.tui.showOverlay(panel, {
      width: "100%",
      minWidth: 20,
      anchor: "center",
    });
    this.tui.requestRender();
    return promise;
  }

  /** Sohbet geçmişini transcript'e yazar. */
  /**
   * Mevcut oturumu diske kaydeder.
   *
   * Böylece "/clear" sonrasında bile önceki oturum "/history" ile
   * listelenebilir ve geri yüklenebilir.
   */
  private async persistCurrentSession(): Promise<void> {
    try {
      const sess = await this.state.svc.getSession({
        appName: APP_NAME,
        userId: USER_ID,
        sessionId: this.state.sessionId,
      });
      if (!sess) return;
      saveSession({
        id: sess.id,
        appName: sess.appName,
        userId: sess.userId,
        lastUpdateTime: sess.lastUpdateTime ?? Date.now(),
        events: sess.events as unknown[],
      });
    } catch {
      // kayıt kritik değil
    }
  }

  /**
   * Oturum geçmişini gösterir ve seçilen oturumu yükler.
   *
   * Kaydedilmiş oturumlar bir listede sunulur; seçilen oturumun mesajları
   * mevcut oturuma eklenir ve ajan o bağlamı görür.
   */
  private async showHistory(): Promise<void> {
    // Güncel oturumu önce diske yaz (listede görünsün).
    await this.persistCurrentSession();

    const saved = listSavedSessions();
    if (!saved.length) {
      this.transcript.addNotice("Kayıtlı oturum yok.");
      this.tui.requestRender();
      return;
    }

    const picked = await this.selectOverlay(
      saved.map((s) => ({
        value: s.id,
        label: new Date(s.lastUpdateTime).toLocaleString("tr-TR"),
        description: `${s.messageCount} mesaj · ${s.preview || "(boş)"}`,
      })),
      "Oturum geçmişi",
      // Tarih kolonuna fazla yer verilirse önizleme sığmaz; primary kolonu
      // sınırlayıp açıklamaya yer bırakıyoruz.
      { maxPrimaryColumnWidth: 22 },
    );
    if (!picked) return;

    await this.restoreSession(picked.value);
  }

  /** Kaydedilmiş bir oturumu mevcut oturuma yükler. */
  private async restoreSession(sessionId: string): Promise<void> {
    const events = loadSavedEvents(sessionId);
    if (!events.length) {
      this.transcript.addNotice("Bu oturumda mesaj yok.", "error");
      this.tui.requestRender();
      return;
    }

    // Yeni bir oturum oluşturup eski event'leri ekle: bağlam temiz başlar,
    // ancak ajan önceki konuşmayı görebilir.
    const session = await this.state.svc.createSession({
      appName: APP_NAME,
      userId: USER_ID,
    });
    let restored = 0;
    const agentName = this.state.agent.name;
    for (const ev of events) {
      const e = ev as {
        author?: string;
        content?: { role?: string; parts?: unknown[] };
        invocationId?: string;
        timestamp?: number;
      };
      // Yalnızca konuşma mesajları (user/assistant) geri yüklenir; araç
      // çağrıları bağlam için gereksiz.
      const role = e.content?.role;
      if (role !== "user" && role !== "model" && role !== "assistant") continue;
      const parts = e.content?.parts ?? [];
      if (!parts.length) continue;
      try {
        await this.state.svc.appendEvent({
          session,
          event: {
            // id zorunlu: ADK event'leri id ile ayırt ediyor; id'siz
            // event'ler birbirinin yerine geçiyor ve geçmiş kayboluyor.
            id: `restored-${session.id}-${restored}-${Date.now()}`,
            invocationId: e.invocationId ?? "restored",
            // ADK, geçmişi "author" üzerinden sınıflandırıyor: kullanıcı
            // mesajlarının author'ı sabit "user" olmalı (aksi halde event
            // "başka ajan" sayılıp içeriği dönüştürülür).
            author: role === "user" ? "user" : agentName,
            content: { role: role === "user" ? "user" : "model", parts },
            actions: {},
            timestamp: e.timestamp ?? Date.now(),
          } as never,
        });
        restored++;
      } catch {
        // tekil event eklenemezse atla
      }
    }

    this.state.sessionId = session.id;
    this.state.summary = null;
    this.transcript.addNotice(
      `Geçmiş yüklendi: ${restored} mesaj (${new Date().toLocaleTimeString("tr-TR")}).`,
    );
    this.updateStatus();
    this.tui.requestRender();
  }

  /** Geçmişi özetleyip bağlamı sıkıştırır. */
  private async compact(): Promise<void> {
    const sess = await this.state.svc.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: this.state.sessionId,
    });
    const lines: string[] = [];
    for (const ev of sess?.events ?? []) {
      for (const p of ev.content?.parts ?? []) {
        const part = p as { text?: string; functionCall?: { name: string } };
        if (part.text?.trim()) {
          lines.push(
            `${ev.content?.role === "user" ? "Kullanıcı" : "Asistan"}: ${part.text.trim()}`,
          );
        } else if (part.functionCall) {
          lines.push(`[araç çağrısı: ${part.functionCall.name}]`);
        }
      }
    }
    if (!lines.length) {
      this.transcript.addNotice("Sıkıştırılacak geçmiş yok.");
      this.tui.requestRender();
      return;
    }
    this.transcript.addNotice(`Geçmiş sıkıştırılıyor (${lines.length} parça)…`);
    this.tui.requestRender();

    const tmpRunner = new Runner({
      agent: createAgent("build"),
      sessionService: this.state.svc,
      appName: APP_NAME,
    });
    const tmp = await this.state.svc.createSession({ appName: APP_NAME, userId: USER_ID });
    let summary = "";
    for await (const event of tmpRunner.runAsync({
      userId: USER_ID,
      sessionId: tmp.id,
      newMessage: {
        role: "user",
        parts: [{
          text: "Aşağıdaki kodlama-ajanı sohbetini, devam eden iş için gerekli tüm bağlamı "
            + "(dosya adları, kararlar, yapılan değişiklikler, açık görevler) koruyacak şekilde "
            + "kısa bir özet haline getir. Yalnızca özeti yaz.\n\n"
            + lines.join("\n"),
        }],
      },
    })) {
      for (const p of event.content?.parts ?? []) {
        const t = (p as { text?: string }).text;
        if (t) summary += t;
      }
    }
    this.state.summary = summary.trim();
    this.state.sessionId = (
      await this.state.svc.createSession({ appName: APP_NAME, userId: USER_ID })
    ).id;
    this.transcript.addNotice("Özet hazır; oturum sıkıştırıldı.");
    this.tui.requestRender();
  }

  /** Üst bilgi satırını günceller. */
  private updateHeader(): void {
    const llm = currentLlmKwargs();
    const mode = this.state.mode;
    this.header.setText(
      `${style("bashcli", BOLD, CYAN)} ${style(`v${version}`, DIM)} ${style("·", DIM)} `
      + `${style(llm.model ?? "", DIM)} ${style("·", DIM)} `
      + `${style(`[${mode}]`, BOLD, MODE_COLOR[mode])} ${style("·", DIM)} `
      + `${style(basename(workspaceRoot()), DIM)}`,
    );
  }

  /** Durum satırını günceller. */
  private updateStatus(): void {
    const onay = this.autoApprove
      ? style("AÇIK", GREEN, BOLD)
      : style("KAPALI", YELLOW, BOLD);
    // Termux Ctrl+Tab'ı gönderemediği için orada Ctrl+T gösterilir.
    const onayTusu = isTermux() ? "CTRL+T" : "CTRL+TAB";
    // Token sayacı: ADK'nın usageMetadata'ından gelen gerçek tüketim.
    // Dar ekranlarda (Termux) sıfırlanır yerine kısa biçimde gösterilir.
    const total = this.state.tokens?.total ?? 0;
    const tokenText = total > 0
      ? ` · ${style(formatTokens(total), DIM)}`
      : "";
    this.status.setText(
      `${style("TAB", BOLD)} ${style("mod", DIM)}`
      + ` · ${style(onayTusu, BOLD)} ${style("oto onay", DIM)} (${onay})`
      + ` · ${style("ESC", BOLD)} ${style("iptal", DIM)}`
      + ` · ${style("/", BOLD)} ${style("komutlar", DIM)}`
      + tokenText,
    );
  }

  /** Loader'ı gösterir. */
  private showLoader(message: string): void {
    this.loader.setMessage(message);
    this.loader.start();
    this.loading = true;
    this.tui.requestRender();
  }

  /** Loader'ı gizler, durum satırını geri getirir. */
  private hideLoader(): void {
    if (!this.loading) return;
    this.loader.stop();
    this.loading = false;
    this.tui.requestRender();
  }
}
