// Sohbet geçmişi (transcript) bileşeni.
//
// Mesajları alt alta yazar; TuiAltScreen'da ScrollView içinde "follow: end"
// ile en sona otomatik kayar.
import { Container, Markdown, Text, type Component } from "@earendil-works/pi-tui";
import { BOLD, CYAN, DIM, RED, YELLOW, style } from "../../colors.js";
import { markdownTheme } from "../theme.js";

export interface TranscriptOptions {
  /** Markdown render'ı için yatay boşluk. */
  paddingX?: number;
}

export class Transcript extends Container {
  private readonly paddingX: number;
  /** Eklenen mesaj bileşenleri (temizleme için). */
  private entries: Component[] = [];

  constructor(options: TranscriptOptions = {}) {
    super();
    this.paddingX = options.paddingX ?? 1;
  }

  /** Tüm geçmişi temizler. */
  override clear(): void {
    for (const child of this.entries) this.removeChild(child);
    this.entries = [];
  }

  /** Mesaj sayısı. */
  get length(): number {
    return this.entries.length;
  }

  private push(component: Component): void {
    this.entries.push(component);
    this.addChild(component);
  }


  /** Kullanıcı mesajı. */
  addUser(text: string): void {
    this.push(new Text(`${style("›", CYAN, BOLD)} ${text}`, this.paddingX, 0));
  }

  /** Ajanın düz metin yanıtı. */
  addAssistant(text: string): void {
    this.push(new Markdown(text, this.paddingX, 0, markdownTheme));
  }

  /** Araç çağrısı satırı. */
  addToolCall(name: string, args?: unknown): void {
    let a = JSON.stringify(args ?? {});
    if (a.length > 300) a = a.slice(0, 300) + "…";
    this.push(new Text(`${style("⚙", YELLOW)} ${style(name, BOLD)}(${style(a, DIM)})`, this.paddingX, 0));
  }

  /** Araç yanıtı (kısaltılmış). */
  addToolResponse(response: unknown): void {
    let text = typeof response === "string" ? response : JSON.stringify(response ?? "", null, 0);
    if (text.length > 800) text = text.slice(0, 800) + "…";
    this.push(new Text(`${style("└", DIM)} ${style(text, DIM)}`, this.paddingX, 0));
  }

  /** Bilgi/hata satırı. */
  addNotice(text: string, kind: "info" | "warn" | "error" = "info"): void {
    const prefix = kind === "error"
      ? style("✖", RED)
      : kind === "warn"
        ? style("!", YELLOW, BOLD)
        : style("•", DIM);
    this.push(new Text(`${prefix} ${text}`, this.paddingX, 0));
  }

  /** Boş satır ayırıcı. */
  addSpacer(): void {
    this.push(new Text("", 0, 0));
  }
}
