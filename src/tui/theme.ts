// TUI tema tanımları.
//
// Renk paleti src/colors.ts'den gelir; burada yalnızca pi-tui bileşenlerinin
// beklediği tema arayüzleri tanımlanır.
import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@earendil-works/pi-tui";
import {
  BOLD,
  CYAN,
  DIM,
  GREEN,
  ITALIC,
  UNDERLINE,
  YELLOW,
  style,
} from "../colors.js";

export const selectListTheme: SelectListTheme = {
  // Seçili öğe (ok tuşuyla üstüne gelinen ya da yazıyla en iyi eşleşen)
  // belirgin biçimde vurgulanır: önek ve metin farklı renklerdedir.
  selectedPrefix: (t) => style(t, GREEN, BOLD),
  selectedText: (t) => style(t, CYAN, BOLD),
  description: (t) => style(t, DIM),
  scrollInfo: (t) => style(t, DIM),
  noMatch: (t) => style(t, DIM, ITALIC),
};

export const editorTheme: EditorTheme = {
  borderColor: (t) => style(t, DIM),
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (t) => style(t, GREEN, BOLD),
  link: (t) => style(t, CYAN, UNDERLINE),
  linkUrl: (t) => style(t, DIM),
  code: (t) => style(t, YELLOW),
  codeBlock: (t) => t,
  codeBlockBorder: (t) => style(t, DIM),
  quote: (t) => style(t, ITALIC),
  quoteBorder: (t) => style(t, DIM),
  hr: (t) => style(t, DIM),
  listBullet: (t) => style(t, CYAN),
  bold: (t) => style(t, BOLD),
  italic: (t) => style(t, ITALIC),
  strikethrough: (t) => style(t, DIM),
  underline: (t) => style(t, UNDERLINE),
};
