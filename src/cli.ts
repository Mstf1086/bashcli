#!/usr/bin/env node
// bashcli — Cline tarzı interaktif kodlama ajanı (Node.js + TS-ADK).
//   npx tsx src/cli.ts                 # REPL (workspace = CWD)
//   npx tsx src/cli.ts "görev"         # tek seferlik görev
//   npx tsx src/cli.ts -w /yol -m plan # hedef + mod
// REPL: [mod] alan> · TAB=mod döngüsü · /=komut penceresi · ↑/↓=geçmiş
//
// TTY oturumlarında varsayılan olarak pi-tui tabanlı TUI açılır; düz REPL
// korunur. Düz REPL'i zorlamak için --plain bayrağı kullanın.
import { InMemorySessionService, LlmAgent, Runner } from "@google/adk";
import { basename, resolve } from "node:path";
import { createAgent, currentLlmKwargs, workspaceRoot, type AgentMode } from "./index.js";
import { loadAgentEnv, loadWorkspaceEnv } from "./agent-env.js";
import { describeError } from "./errors.js";
import { setApprovalHook } from "./approval.js";
import { listSavedSessions, loadSavedEvents, saveSession } from "./session-store.js";
import { addUsage, emptyUsage, formatTokens, type TokenUsage } from "./token-usage.js";
import {
  BOLD,
  CYAN,
  DIM,
  GREEN,
  MAGENTA,
  RED,
  RESET,
  YELLOW,
  clearTerminal,
  colorizeSlashCommand,
  padVisible,
} from "./colors.js";
import {
  COMMANDS as COMMAND_LIST,
  resolveCommand,
  withSlash,
} from "./commands.js";
import { version as VERSION } from "./version.js";

const USER_ID = "cli_user";
const APP_NAME = "bashcli";
const MODES: AgentMode[] = ["plan", "build", "auto"];

interface CliArgs {
  task: string;
  workspace?: string;
  mode?: AgentMode;
  plain: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let workspace: string | undefined;
  let mode: AgentMode | undefined;
  let plain = false;
  let help = false;
  let version = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plain") plain = true;
    else if (a === "-h" || a === "--help") help = true;
    else if (a === "-v" || a === "--version") version = true;
    else if ((a === "-w" || a === "--workspace") && argv[i + 1]) workspace = argv[++i];
    else if ((a === "-m" || a === "--mode") && argv[i + 1]) {
      const m = argv[++i];
      if (m === "plan" || m === "build" || m === "auto") mode = m;
    } else rest.push(a);
  }
  return { task: rest.join(" ").trim(), workspace, mode, plain, help, version };
}

/** Yardım metni. */
function helpText(): string {
  return [
    `${BOLD}bashcli${RESET} — kodlama ajanı (Node.js + TypeScript ADK)`,
    "",
    `${BOLD}Kullanım:${RESET}`,
    "  bashcli                       etkileşimli TUI (workspace = bulunulan dizin)",
    "  bashcli \"görevi yap\"          tek seferlik görev",
    "",
    `${BOLD}Seçenekler:${RESET}`,
    "  -w, --workspace <yol>  çalışılacak dizin (varsayılan: bulunulan dizin)",
    "  -m, --mode <mod>       başlangıç modu: plan | build | auto",
    "      --plain            TUI yerine düz REPL kullan",
    "  -h, --help             bu yardım metni",
    "  -v, --version          sürüm bilgisi",
    "",
    `${BOLD}Komutlar (TUI içinde):${RESET}`,
    ...Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(12)} ${v.desc}`),
    "",
    `${BOLD}Tuşlar:${RESET}`,
    "  TAB          mod döngüsü (plan → build → auto)",
    "  CTRL+TAB    otomatik onayı aç/kapa",
    "  /            komut penceresi (↑/↓ gez, Enter seç)",
    "  ESC          çalışan isteği iptal et",
    "  Ctrl+C       çıkış",
  ].join("\n");
}

const ARGS = parseArgs(process.argv.slice(2));

// Ortam değişkenleri: önce ajanın kendi .env'i, sonra çalışılan projenin
// .env'i (yalnızca sağlayıcı DIŞI ayarlar; sağlayıcı bilgisi sadece
// ~/.bashcli/providers.json'dan gelir). Önce tanımlı olan değer kazanır.
loadAgentEnv();
loadWorkspaceEnv();

// Workspace kökü önceliği: -w argümanı > CODING_WORKSPACE env'i > CWD.
process.env.CODING_WORKSPACE = ARGS.workspace
  ? resolve(ARGS.workspace)
  : (process.env.CODING_WORKSPACE
    ? resolve(process.env.CODING_WORKSPACE)
    : process.cwd());

// --- renkler (pipe/NO_COLOR/dumb'da kapalı) ---------------------------------
// Mod renkleri: plan = sarı, build = yeşil, auto = turkuaz.
// Renkler src/colors.ts'ten gelir; auto için parlak turkuaz (CYAN) kullanılır.
const MODE_COLOR: Record<AgentMode, string> = { plan: YELLOW, build: GREEN, auto: CYAN };

/** Mod değişimini tek satırda, modun kendi renginde bildirir. */
function modeLine(mode: AgentMode): string {
  return `${MODE_COLOR[mode]}Mod: ${mode}${RESET}`;
}

// --- komut listesi (TUI ile ortak) -----------------------------------------
/**
 * Komut adı → açıklama. Anahtarlar "/" ile başlar.
 * Alias'lar (ör. "/quit") ayrı birer anahtar olarak eklenir.
 */
export const COMMANDS: Record<string, { desc: string }> = Object.fromEntries(
  COMMAND_LIST.flatMap((c) => [
    [withSlash(c.name), { desc: c.desc }],
    ...(c.aliases ?? []).map((a) => [withSlash(a), { desc: `${c.desc} (${withSlash(c.name)} ile aynı)` }] as [string, { desc: string }]),
  ]),
);

interface CliState {
  svc: InMemorySessionService;
  runner: Runner;
  agent: LlmAgent;
  sessionId: string;
  mode: AgentMode;
  summary: string | null;
  inputHist: string[];
  /** Otomatik onay açık mı? (Kapalıysa araç çalıştırmadan önce sorulur.) */
  autoApprove: boolean;
  /** Birikmis token tuketimi (ADK usageMetadata'indan). */
  tokens: TokenUsage;
}

function buildRunner(svc: InMemorySessionService, mode: AgentMode): { runner: Runner; agent: LlmAgent } {
  const agent = createAgent(mode);
  return { runner: new Runner({ agent, sessionService: svc, appName: APP_NAME }), agent };
}

function statePrompt(s: CliState): string {
  // Token sayaci: ADK usageMetadata'indan biriken gercek tuketim.
  const tok = s.tokens.total > 0 ? ` ${DIM}${formatTokens(s.tokens.total)}tok${RESET}` : "";
  // ">>>" isareti aktif modun rengindedir: plan sari, build yesil, auto turkuaz.
  return `${MODE_COLOR[s.mode]}[${s.mode}]${RESET} ${CYAN}${BOLD}${basename(workspaceRoot())}>${RESET}${tok} `
    + `${MODE_COLOR[s.mode]}${BOLD}${">>>"}${RESET} `;
}

function banner(s: CliState): string {
  const llm = currentLlmKwargs();
  const ws = workspaceRoot();
  const mc = MODE_COLOR[s.mode];
  // Kutunun iç genişliği (çerçeve karakterleri hariç).
  const inner = 50;
  const row = (content: string): string => `│${padVisible(content, inner)}│`;
  return (
    `${BOLD}┌${"─".repeat(inner)}┐\n`
    + row(`  bashcli  v${VERSION}  ·  kodlama ajanı (Node.js)`) + "\n"
    + row(`  Model   : ${(llm.model ?? "").slice(0, 36)}`) + "\n"
    + row(`  Alan    : ${ws.slice(0, 36)}`) + "\n"
    + row(`  Mod     : ${mc}${s.mode}${RESET}${BOLD} (TAB ile değiştir)`) + "\n"
    + row(`  Komut   : / → komut penceresi`) + "\n"
    + `${BOLD}└${"─".repeat(inner)}┘${RESET}`
  );
}

function setMode(s: CliState, mode: AgentMode): void {
  s.mode = mode;
  const built = buildRunner(s.svc, mode);
  s.runner = built.runner;
  s.agent = built.agent;
}

function cycleMode(s: CliState): void {
  setMode(s, MODES[(MODES.indexOf(s.mode) + 1) % MODES.length]);
}

function printToolCall(name: string, args?: unknown): void {
  let a = JSON.stringify(args ?? {});
  if (a.length > 300) a = a.slice(0, 300) + "…";
  console.log(`${YELLOW}⚙ ${name}(${a})${RESET}`);
}

function printToolResponse(resp: unknown): void {
  let text = typeof resp === "string" ? resp : JSON.stringify(resp ?? "", null, 0);
  text = text.replace(/\n/g, `\n  ${DIM}`);
  if (text.length > 800) text = text.slice(0, 800) + "…";
  console.log(`${DIM}  └ ${text}${RESET}`);
}

// --- ham terminal satır okuyucu (readline yok: ANSI prompt güvenliği) --------

/**
 * TTY'den gelen baytların ortak kuyruğu. Okuyucu biterken artan baytlar
 * (ör. Enter'dan sonra gelen ok tuşları) atılmasın diye modül seviyesinde
 * tutulur; bir sonraki okuyucu (ör. komut penceresi) bunu devralır.
 */
let inputQueue: Buffer = Buffer.alloc(0);

function pushInput(chunk: Buffer): void {
  inputQueue = Buffer.concat([inputQueue, chunk]);
}

/** Kuyruktan sıradaki tuş/veri öğesini alır; yoksa undefined. */
function takeInput(): InputItem | undefined {
  const item = nextInput(inputQueue);
  if (item) inputQueue = item.rest;
  return item;
}

async function readlineRaw(prompt: string, s: CliState): Promise<string | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const buf: string[] = [];
  let cur = 0;
  const hist = s.inputHist;
  let hidx = hist.length;
  let draft = "";

  const redraw = () => {
    // Slash komutu yazılıyorsa komut bölgesi renklendirilir.
    stdout.write("\r\x1b[K" + prompt + colorizeSlashCommand(buf.join("")));
    const back = buf.length - cur;
    if (back > 0) stdout.write(`\x1b[${back}D`);
  };

  return new Promise((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.resume();
    redraw();

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const done = (v: string | null) => { cleanup(); resolve(v); };
    const fail = (e: unknown) => { cleanup(); reject(e); };

    function onData(chunk: Buffer) {
      try {
        // Escape dizileri (ok tuşları) farklı chunk'lara bölünebilir; ortak
        // kuyruğa ekleyip tam dizileri işleyelim.
        pushInput(chunk);
        for (;;) {
          const item = takeInput();
          if (!item) break;

          if (item.kind === "escape") {
            switch (item.code) {
              case 0x41: // Yukarı
                if (hidx > 0) {
                  if (hidx === hist.length) draft = buf.join("");
                  hidx--; buf.length = 0; buf.push(...hist[hidx]); cur = buf.length;
                  redraw();
                }
                break;
              case 0x42: // Aşağı
                if (hidx < hist.length) {
                  hidx++;
                  const src = hidx === hist.length ? draft : hist[hidx];
                  buf.length = 0; buf.push(...src); cur = buf.length;
                  redraw();
                }
                break;
              case 0x44: if (cur > 0) { cur--; redraw(); } break;
              case 0x43: if (cur < buf.length) { cur++; redraw(); } break;
              case 0x48: cur = 0; redraw(); break;
              case 0x46: cur = buf.length; redraw(); break;
            }
            continue;
          }

          const c = item.code;
          if (c === 0x0d || c === 0x0a) { stdout.write("\r\n"); done(buf.join("")); return; }
          if (c === 0x03) { stdout.write("^C\r\n"); fail(new Error("SIGINT")); return; }
          if (c === 0x04) { if (!buf.length) { stdout.write("\r\n"); done(null); return; } continue; }
          if (c === 0x01) { cur = 0; redraw(); continue; }
          if (c === 0x05) { cur = buf.length; redraw(); continue; }
          if (c === 0x15) { buf.length = 0; cur = 0; redraw(); continue; }
          if (c === 0x7f || c === 0x08) { if (cur > 0) { cur--; buf.splice(cur, 1); } redraw(); continue; }
          if (c === 0x09) {
            // TAB modu değiştirir. Hangi moda geçildiği bildirilir; bildirim
            // satırın başında yazılır, sonra prompt yeniden çizilir.
            cycleMode(s);
            stdout.write("\r\x1b[K" + modeLine(s.mode) + "\r\n");
            prompt = statePrompt(s);
            redraw();
            continue;
          }
          if (c < 0x20) continue;

          // UTF-8 çok baytlı karakterler
          const ch = item.text;
          buf.splice(cur, 0, ...[...ch]);
          cur += [...ch].length;
          redraw();
        }
      } catch (e) { fail(e); }
    }
    stdin.on("data", onData);
    // Önceki okuyucudan kalan tuşlar (ör. Enter'dan sonra gelen ok tuşları)
    // hemen işlenmelidir.
    onData(Buffer.alloc(0));
  });
}

type InputItem =
  | { kind: "char"; code: number; text: string; rest: Buffer }
  | { kind: "escape"; code: number; rest: Buffer };

/**
 * Buffer'dan tek bir tuş/veri öğesi çıkarır. Escape dizisi veya UTF-8
 * çok baytlı karakter henüz tam gelmediyse `undefined` döner; çağıran
 * biriktirmeye devam eder.
 */
function nextInput(buf: Buffer): InputItem | undefined {
  if (!buf.length) return undefined;
  const c = buf[0];
  if (c === 0x1b) {
    if (buf.length === 1) return undefined;                 // ESC henüz tam değil
    if (buf[1] === 0x5b) {
      if (buf.length < 3) return undefined;
      const code = buf[2];
      if (code === 0x33) {                                // Delete: ESC [ 3 ~
        if (buf.length < 4) return undefined;
        return { kind: "escape", code: 0x7f, rest: buf.subarray(4) };
      }
      if (code === 0x5a) {                                // Shift+Tab: kullanilmiyor
        return { kind: "escape", code: 0x1b, rest: buf.subarray(3) };
      }
      return { kind: "escape", code, rest: buf.subarray(3) };
    }
    return { kind: "escape", code: 0x1b, rest: buf.subarray(1) };
  }
  if (c < 0x80) {
    return { kind: "char", code: c, text: String.fromCharCode(c), rest: buf.subarray(1) };
  }
  // UTF-8: 0b10xxxxxx → 2 bayt, 0b1110xxxx → 3 bayt, 0b11110xxx → 4 bayt
  const need = c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
  if (buf.length < need) return undefined;
  const text = buf.subarray(0, need).toString("utf-8");
  return { kind: "char", code: c, text, rest: buf.subarray(need) };
}

async function promptInput(prompt: string, s: CliState): Promise<string | null> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.once("data", (d) => { data += d; });
      process.stdin.once("end", () => resolve(data.split("\n")[0] ?? null));
      process.stdin.once("error", () => resolve(null));
      process.stdin.resume();
    });
  }
  try {
    return await readlineRaw(prompt, s);
  } catch {
    return "";
  }
}

async function runTurn(s: CliState, text: string): Promise<void> {
  if (s.summary) {
    text = `[Oturum özeti — önceki konuşmanın sıkıştırılmış hali]\n${s.summary}\n[/Oturum özeti]\n\n${text}`;
    s.summary = null;
  }
  let printingFinal = false;
  try {
    for await (const event of s.runner.runAsync({
      userId: USER_ID,
      sessionId: s.sessionId,
      newMessage: { role: "user", parts: [{ text }] },
    })) {
      // ADK, model hatasını fırlatmak yerine errorCode/errorMessage içeren
      // bir event üretir. Bu alanlar kontrol edilmezse hata sessizce yutulur.
      if (event.errorCode) {
        console.log(`${RED}${describeError(new Error(event.errorMessage ?? event.errorCode), event.errorCode)}${RESET}`);
        continue;
      }
      // Token tuketimi: ADK usageMetadata'sini biriktir.
      if (event.usageMetadata) {
        s.tokens = addUsage(s.tokens, event.usageMetadata);
      }
      const parts = event.content?.parts ?? [];
      for (const p of parts) {
        const part = p as { functionCall?: unknown; functionResponse?: unknown; text?: string };
        if ((part as { functionCall?: { name?: string } }).functionCall) {
          printingFinal = false;
          const fc = (part as { functionCall: { name: string; args?: unknown } }).functionCall;
          printToolCall(fc.name, fc.args);
        } else if (part.functionResponse) {
          printingFinal = false;
          printToolResponse((part.functionResponse as { response?: unknown }).response ?? part.functionResponse);
        } else if (typeof part.text === "string" && part.text.trim()) {
          if (!printingFinal) {
            console.log(`${DIM}  ~ ${part.text.trim()}${RESET}`);
            printingFinal = true;
          } else {
            console.log(`${GREEN}${part.text.trim()}${RESET}`);
          }
        }
      }
    }
  } catch (e) {
    console.log(`${RED}${describeError(e)}${RESET}`);
  }
  // Tur sonunda oturumu diske yaz: "/history" önceki oturumları listeleyip
  // geri yükleyebilsin.
  await persistSession(s);
  console.log();
}


/** Mevcut oturumu diske kaydeder (geçmiş daha sonra yüklenebilsin diye). */
async function persistSession(s: CliState): Promise<void> {
  try {
    const sess = await s.svc.getSession({ appName: APP_NAME, userId: USER_ID, sessionId: s.sessionId });
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
 * Kaydedilmiş oturumları listeler ve seçilen oturumu yükler.
 */
async function cmdHistory(s: CliState): Promise<void> {
  await persistSession(s);
  const saved = listSavedSessions();
  if (!saved.length) { console.log(`${DIM}Kayıtlı oturum yok.${RESET}`); return; }

  console.log(`${BOLD}Kayıtlı oturumlar:${RESET}`);
  saved.forEach((sess, i) => {
    const when = new Date(sess.lastUpdateTime).toLocaleString("tr-TR");
    console.log(`  ${(i + 1).toString().padStart(2)}) ${CYAN}${when}${RESET}  ${DIM}${sess.messageCount} mesaj · ${sess.preview || "(boş)"}${RESET}`);
  });
  const raw = await linePrompt("Yüklenecek oturum numarası (boş=iptal): ", s);
  if (!raw) return;
  const idx = parseInt(raw, 10) - 1;
  const target = saved[idx];
  if (!target) { console.log(`${RED}Geçersiz seçim.${RESET}`); return; }

  const events = loadSavedEvents(target.id);
  if (!events.length) { console.log(`${RED}Bu oturumda mesaj yok.${RESET}`); return; }

  // Yeni oturum + eski event'ler: bağlam temiz başlar, ajan eski konuşmayı görür.
  const session = await s.svc.createSession({ appName: APP_NAME, userId: USER_ID });
  let restored = 0;
  const agentName = s.agent.name;
  for (const ev of events) {
    const e = ev as {
      author?: string;
      content?: { role?: string; parts?: unknown[] };
      invocationId?: string;
      timestamp?: number;
    };
    const role = e.content?.role;
    if (role !== "user" && role !== "model" && role !== "assistant") continue;
    const parts = e.content?.parts ?? [];
    if (!parts.length) continue;
    try {
      await s.svc.appendEvent({
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
  s.sessionId = session.id;
  s.summary = null;
  console.log(`${GREEN}Geçmiş yüklendi: ${restored} mesaj.${RESET}\n`);
}

async function cmdCompact(s: CliState): Promise<void> {
  if (!process.stdin.isTTY) { console.log(`${DIM}Pipe modunda compact atlandı.${RESET}`); return; }
  const sess = await s.svc.getSession({ appName: APP_NAME, userId: USER_ID, sessionId: s.sessionId });
  const lines: string[] = [];
  for (const ev of sess?.events ?? []) {
    for (const p of ev.content?.parts ?? []) {
      const part = p as { text?: string; functionCall?: { name: string } };
      if (part.text?.trim()) {
        lines.push(`${ev.content?.role === "user" ? "Kullanıcı" : "Asistan"}: ${part.text.trim()}`);
      } else if (part.functionCall) {
        lines.push(`[araç çağrısı: ${part.functionCall.name}]`);
      }
    }
  }
  if (!lines.length) { console.log(`${DIM}Sıkıştırılacak geçmiş yok.${RESET}`); return; }
  console.log(`${DIM}Geçmiş sıkıştırılıyor (${lines.length} parça)...${RESET}`);
  // Özet için doğrudan modele sor (araçsız tek çağrı)
  const tmpRunner = new Runner({ agent: createAgent("build"), sessionService: s.svc, appName: APP_NAME });
  const tmp = await s.svc.createSession({ appName: APP_NAME, userId: USER_ID });
  let summary = "";
  for await (const event of tmpRunner.runAsync({
    userId: USER_ID,
    sessionId: tmp.id,
    newMessage: {
      role: "user",
      parts: [{
        text: "Aşağıdaki kodlama-ajanı sohbetini, devam eden iş için gerekli tüm bağlamı "
          + "(dosya adları, kararlar, yapılan değişiklikler, açık noktalar) koruyarak "
          + "Türkçe özetle. Sadece özeti döndür.\n\n" + lines.join("\n").slice(-24000),
      }],
    },
  })) {
    for (const p of event.content?.parts ?? []) {
      const t = (p as { text?: string }).text;
      if (t) summary += t;
    }
  }
  s.summary = summary.trim();
  s.sessionId = (await s.svc.createSession({ appName: APP_NAME, userId: USER_ID })).id;
  console.log(`${BOLD}Özet hazır; oturum sıkıştırıldı.${RESET}`);
  console.log(`${DIM}${s.summary.slice(0, 600)}${RESET}\n`);
}

// --- TUI komut penceresi -----------------------------------------------------
/**
 * Düz REPL için ok tuşlu seçim penceresi.
 *
 * Çizim mutlak konumlandırma yerine "yaz → geri kaydır" tekniğiyle yapılır.
 * Önemli ayrıntı: raw modda satır sonu `\n` yalnızca LF'dir (CR yok), bu
 * yüzden satır ayırıcı olarak `\r\n` kullanılmalıdır; aksi halde her satır
 * bir öncekinin bittiği sütundan yazılır ve kutu bozulur.
 */
async function tuiPick(
  options: [string, string][], title: string,
): Promise<number | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) return null;
  if (!options.length) return null;
  let idx = 0;
  /** Listede görünen pencere başlangıcı (kaydırma). */
  let scroll = 0;

  // Ekran yüksekliğine göre kaç satır sığar: başlık + liste + alt bilgi + alt
  // kenar + 1 boşluk. Uzun listeler kaydırılır.
  const termRows = Math.max(8, stdout.rows || 24);
  const maxVisible = Math.max(3, termRows - 5);

  const draw = () => {
    // Kutu genişliği terminale sığmalı: sabit 62 sütun dar ekranlarda
    // satırlar sarıp kutu parçalanıyordu.
    const termCols = Math.max(30, stdout.columns || 80);
    const termRows = Math.max(8, stdout.rows || 24);
    const width = Math.min(62, termCols - 2);
    // Komut adı kolonu; kalan yer açıklamaya ayrılır.
    const nameW = Math.min(12, Math.max(8, Math.floor(width / 5)));
    const descW = Math.max(10, width - 2 - nameW - 2);
    const rows: string[] = [];
    // Seçili öğe görünür pencere içinde kalsın.
    if (idx < scroll) scroll = idx;
    if (idx >= scroll + maxVisible) scroll = idx - maxVisible + 1;
    const end = Math.min(options.length, scroll + maxVisible);
    // Pozisyon bilgisi başlıkta: kutu çizgisini bozmaz.
    const head = `${title} ${idx + 1}/${options.length}`;
    rows.push(`${BOLD}┌${head}${"─".repeat(Math.max(0, width - 2 - head.length))}┐${RESET}`);
    for (let i = scroll; i < end; i++) {
      const [rawName, rawDesc] = options[i];
      const name = rawName.length > nameW ? rawName.slice(0, nameW - 1) + "…" : rawName.padEnd(nameW);
      const desc = rawDesc.length > descW ? rawDesc.slice(0, descW - 1) + "…" : rawDesc;
      const pad = " ".repeat(Math.max(0, width - 3 - nameW - desc.length));
      if (i === idx) {
        rows.push(`${BOLD}│${RESET}\x1b[7m ${name} ${desc}${pad}\x1b[0m${BOLD}│${RESET}`);
      } else {
        rows.push(`${BOLD}│${RESET} ${CYAN}${name}${RESET} ${desc}${pad}${BOLD}│${RESET}`);
      }
    }
    const footer = " ↑/↓ gez · Enter seç · 1-9 hızlı · q/Esc kapat ";
    rows.push(`${BOLD}│${RESET}${DIM}${footer}${" ".repeat(Math.max(0, width - 2 - footer.length))}${RESET}${BOLD}│${RESET}`);
    rows.push(`${BOLD}└${"─".repeat(width - 2)}┘${RESET}`);

    // Menü ekranın ALTINDA mutlak konumlandırma ile çizilir.
    // "Yaz → geri kaydır" tekniği ekranı kaydırdığı için (menü satırları
    // ekranın altına taşar) temizlik sırasında ekranı bozuyordu.
    const n = Math.min(rows.length, termRows);
    const start = termRows - n + 1;
    let out = "";
    for (let i = 0; i < n; i++) {
      // DECCUP: satır/sütun konumlandırma; her satır sonunda \x1b[K ile
      // satırın kalanı temizlenir (kutu çizgileri bozulmaz).
      out += `\x1b[${start + i};1H\x1b[2K${rows[i]}`;
    }
    // İmleç menünün hemen üstüne (menü alanı boşaltılacak).
    out += `\x1b[${start};1H`;
    stdout.write(out);
    return { start, count: n };
  };

  return new Promise((resolve) => {
    stdin.setRawMode(true);
    stdin.resume();
    /** Menünün ekrandaki konumu (temizlik için). */
    let placed = { start: 1, count: 0 };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      try {
        // Menü alanını satır satır temizle (kaydırma yapmadan).
        let out = "";
        for (let i = 0; i < placed.count; i++) {
          out += `\x1b[${placed.start + i};1H\x1b[2K`;
        }
        // İmleç menünün başına; sonraki çıktı oradan devam eder.
        out += `\x1b[${placed.start};1H\x1b[?25h`;
        stdout.write(out);
      } catch { /* yoksay */ }
    };
    const done = (v: number | null) => { cleanup(); resolve(v); };
    function onData(chunk: Buffer) {
      try {
        pushInput(chunk);
        for (;;) {
          const item = takeInput();
          if (!item) break;
          if (item.kind === "escape") {
            // Ok tuşları: ESC [ A (yukarı) ve ESC [ B (aşağı).
            if (item.code === 0x41) { idx = (idx - 1 + options.length) % options.length; placed = draw(); continue; }
            if (item.code === 0x42) { idx = (idx + 1) % options.length; placed = draw(); continue; }
            done(null); return;
          }
          const c = item.code;
          if (c === 0x0d || c === 0x0a) { done(idx); return; }
          if (c === 0x03 || c === 0x71 || c === 0x51) { done(null); return; }
          if (c >= 0x31 && c <= 0x39) {
            const k = c - 0x31;
            if (k < options.length) { done(k); return; }
          }
        }
      } catch (e) { done(null); }
    }
    stdout.write("\x1b[?25l");
    placed = draw();
    stdin.on("data", onData);
    // Önceki okuyucudan kalan tuşlar (ör. Enter'dan sonra gelen ok tuşları)
    // hemen işlenmelidir.
    onData(Buffer.alloc(0));
  });
}

/**
 * Komut penceresini açar.
 *
 * @param only Yalnızca bu komut adlarını gösterir (belirsiz kısaltmalarda
 *   eşleşenlerle sınırlanır).
 */
async function commandWindow(s: CliState, only?: string[]): Promise<string | null> {
  const all = Object.keys(COMMANDS);
  const keys = only ? all.filter((k) => only.includes(k.slice(1))) : all;
  if (process.stdin.isTTY) {
    const pick = await tuiPick(keys.map((k) => [k, COMMANDS[k].desc]), ` Komutlar · mod: ${s.mode} `);
    return pick === null ? null : keys[pick];
  }
  console.log(`${BOLD}Komutlar:${RESET}`);
  keys.forEach((k, i) => console.log(`  ${i + 1}) ${k} — ${COMMANDS[k].desc}`));
  return null;
}


async function linePrompt(prompt: string, s: CliState): Promise<string> {
  const r = await promptInput(prompt, s);
  return (r ?? "").trim();
}

async function cmdSettings(s: CliState): Promise<void> {
  const { currentLlmKwargs: kw } = await import("./index.js");
  const llm = kw();
  for (;;) {
    console.log(
      `\n${BOLD}┌─ Ayarlar ─────────────────────────────────────┐${RESET}\n`
      + `${BOLD}│${RESET}  Model   : ${llm.model.slice(0, 38).padEnd(38)}${BOLD}│${RESET}\n`
      + `${BOLD}│${RESET}  Alan    : ${workspaceRoot().slice(0, 38).padEnd(38)}${BOLD}│${RESET}\n`
      + `${BOLD}│${RESET}  Mod     : ${MODE_COLOR[s.mode]}${s.mode.padEnd(9)}${RESET}                             ${BOLD}│${RESET}\n`
      + `${BOLD}│${RESET}  1) Mod: plan  2) Mod: build  3) Mod: auto      ${BOLD}│${RESET}\n`
      + `${BOLD}│${RESET}  4) Sağlayıcı/model değiştir (/provider)     ${BOLD}│${RESET}\n`
      + `${BOLD}│${RESET}  0) Geri                                    ${BOLD}│${RESET}\n`
      + `${BOLD}└──────────────────────────────────────────────┘${RESET}`,
    );
    const sel = await linePrompt(`${DIM}Seçim:${RESET} `, s);
    // Mod seçimi menüyü kapatır: aksi halde her seçimde menü yeniden
    // basılır ve ekrana "Mod: plan / Mod: build / ..." satırları yığılır.
    if (sel === "1") { setMode(s, "plan"); console.log(modeLine("plan")); return; }
    else if (sel === "2") { setMode(s, "build"); console.log(modeLine("build")); return; }
    else if (sel === "3") { setMode(s, "auto"); console.log(modeLine("auto")); return; }
    else if (sel === "4") { await cmdProvider(s); return; }
    else if (["0", "", "q"].includes(sel)) return;
    else console.log(`${RED}Geçersiz seçim.${RESET}`);
  }
}

/**
 * Proje kurallarını ve ignore listesini gösterir.
 */
async function cmdRules(): Promise<void> {
  const {
    loadProjectRules, loadIgnorePatterns, ignoreFilePath, CONFIG_DIR,
  } = await import("./project-config.js");
  const rules = loadProjectRules();
  console.log(`${BOLD}Proje kuralları${RESET} ${DIM}(${CONFIG_DIR}/rules)${RESET}`);
  if (rules.length) {
    for (const r of rules) console.log(`  ${GREEN}·${RESET} ${r.name}`);
  } else {
    console.log(`  ${DIM}(kural yok; ${CONFIG_DIR}/rules/ veya ${CONFIG_DIR}/rules.md)${RESET}`);
  }
  const patterns = loadIgnorePatterns();
  console.log(`\n${BOLD}Ignore listesi${RESET} ${DIM}(${ignoreFilePath()})${RESET}`);
  if (patterns.length) {
    for (const p of patterns) console.log(`  ${YELLOW}·${RESET} ${p}`);
  } else {
    console.log(`  ${DIM}(boş)${RESET}`);
  }
  console.log();
}

/**
 * Token tüketimini gösterir.
 */
async function cmdTokens(s: CliState): Promise<void> {
  const t = s.tokens;
  if (t.calls === 0) {
    console.log(`${DIM}Henüz model çağrısı yapılmadı.${RESET}`);
    return;
  }
  console.log(`${BOLD}Token tüketimi${RESET} ${DIM}(${t.calls} model çağrısı)${RESET}`);
  console.log(`  giriş (prompt) : ${t.prompt}`);
  console.log(`  çıkış         : ${t.completion}`);
  console.log(`  toplam        : ${BOLD}${t.total}${RESET}`);
  console.log();
}

/**
 * Sağlayıcı API anahtarlarını gösterir.
 */
async function cmdKeys(): Promise<void> {
  const { listProviderKeys } = await import("./index.js");
  const rows = listProviderKeys().filter((p) => p.apiKey);
  if (!rows.length) {
    console.log(`${DIM}Kayıtlı API anahtarı yok; /provider ile ekleyin.${RESET}`);
    return;
  }
  console.log(`${BOLD}Sağlayıcı API anahtarları:${RESET}`);
  for (const p of rows) {
    const mark = p.active ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    console.log(
      `  ${mark} ${p.active ? GREEN : DIM}${p.provider}${RESET}`
      + `${p.active ? " (aktif)" : ""}  ${DIM}${p.label}${RESET}`,
    );
    console.log(`    api_key: ${p.apiKey}`);
    console.log(`    ${DIM}base_url: ${p.baseUrl ?? "-"} · model: ${p.model ?? "-"}${RESET}`);
  }
  console.log();
}

/**
 * Aktif sağlayıcının model listesini getirir ve seçim yapar.
 */
async function cmdModel(s: CliState): Promise<void> {
  const { PROVIDERS, fetchModels, saveProvider } = await import("./index.js");
  const { readUserProvider } = await import("./user-config.js");

  const user = readUserProvider();
  const providerKey = user?.provider ?? process.env.PROVIDER ?? "zenmux";
  const spec = PROVIDERS.find((p) => p.key === providerKey);
  if (!spec) {
    console.log(`${RED}Aktif sağlayıcı bulunamadı; /provider ile ekleyin.${RESET}`);
    return;
  }

  const apiKey = user?.apiKey
    ?? (spec.keyEnv ? process.env[spec.keyEnv] : undefined)
    ?? null;
  const baseUrl = user?.baseUrl
    ?? (spec.baseEnv ? process.env[spec.baseEnv] : undefined)
    ?? spec.defaultBase
    ?? null;

  console.log(`${DIM}${spec.label} modelleri alınıyor...${RESET}`);
  let models: string[];
  try {
    models = await fetchModels(spec.key, apiKey, baseUrl);
  } catch (e) {
    console.log(`${RED}Model listesi alınamadı: ${e instanceof Error ? e.message : e}${RESET}`);
    return;
  }
  if (!models.length) { console.log(`${RED}Model listesi boş döndü.${RESET}`); return; }

  console.log(`${BOLD}${spec.label} modelleri (${models.length}):${RESET}`);
  const shown = models.slice(0, 200);
  shown.forEach((m, i) => console.log(`  ${(i + 1).toString().padStart(3)}) ${m}`));
  if (models.length > shown.length) console.log(`  ${DIM}… ve ${models.length - shown.length} model daha${RESET}`);

  const sel = await linePrompt("Model numarası veya adı (boş=iptal): ", s);
  if (!sel) return;
  let modelId: string;
  if (/^\d+$/.test(sel) && +sel >= 1 && +sel <= shown.length) modelId = shown[+sel - 1];
  else if (models.includes(sel)) modelId = sel;
  else { console.log(`${RED}Geçersiz seçim.${RESET}`); return; }

  const full = modelId.startsWith(spec.litellmPrefix)
    ? modelId
    : spec.litellmPrefix + modelId;
  saveProvider(spec.key, apiKey, baseUrl, full);
  setMode(s, s.mode);
  console.log(`${GREEN}Model değiştirildi → ${full}${RESET}\n`);
}

async function cmdProvider(s: CliState): Promise<void> {
  const { PROVIDERS, fetchModels, saveProvider } = await import("./index.js");
  const { readUserProvider } = await import("./user-config.js");
  // Aktif sağlayıcı listede işaretlenir: yanlış sağlayıcı seçimi (ve dolayısıyla
  // "anahtar başka sağlayıcıya ait" uyarısı) önlenir.
  const activeKey = readUserProvider()?.provider
    ?? process.env.PROVIDER
    ?? "zenmux";
  console.log(`${BOLD}1) Sağlayıcı seçimi${RESET} (iptal: boş Enter)\n`);
  PROVIDERS.forEach((p, i) => {
    const note = p.note ? `  ${DIM}${p.note}${RESET}` : "";
    const aktif = p.key === activeKey ? ` ${GREEN}(aktif)${RESET}` : "";
    console.log(`  ${(i + 1).toString().padStart(2)}) ${CYAN}${p.label.padEnd(42)}${RESET} ${DIM}[${p.key}]${RESET}${aktif}${note}`);
  });
  const raw = await linePrompt("Sağlayıcı numarası: ", s);
  if (!raw) { console.log(`${DIM}İptal edildi.${RESET}`); return; }
  const spec = PROVIDERS[parseInt(raw, 10) - 1];
  if (!spec) { console.log(`${RED}Geçersiz seçim.${RESET}`); return; }

  let apiKey: string | null = null;
  if (spec.needsKey !== false) {
    console.log(`\n${BOLD}2) API anahtarı${RESET} (${spec.keyEnv})`);
    process.stdout.write("  Anahtarı yazın (gizli): ");
    apiKey = await new Promise<string>((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf-8");
      let acc = "";
      const onD = (d: string) => {
        if (d === "\r" || d === "\n") {
          stdin.setRawMode?.(false); stdin.pause();
          stdin.removeListener("data", onD);
          process.stdout.write("\n"); resolve(acc);
        } else if (d === "\x7f") acc = acc.slice(0, -1);
        else if (d === "\x03") {
          stdin.setRawMode?.(false); stdin.pause();
          stdin.removeListener("data", onD); resolve("");
        } else if (d >= " ") acc += d;
      };
      stdin.on("data", onD);
    });
    if (!apiKey.trim()) { console.log(`${RED}API anahtarı boş; iptal.${RESET}`); return; }
    apiKey = apiKey.trim();
  } else {
    console.log(`\n${DIM}2) Bu sağlayıcı API anahtarı gerektirmez.${RESET}`);
  }

  let baseUrl: string | null = null;
  if (spec.key === "custom") {
    baseUrl = await linePrompt("Base URL: ", s);
    if (!baseUrl) { console.log(`${RED}Base URL boş; iptal.${RESET}`); return; }
  } else if (spec.defaultBase && !(spec.baseEnv && process.env[spec.baseEnv])) {
    baseUrl = (await linePrompt(`Base URL [${spec.defaultBase}]: `, s)) || null;
  }

  // Anahtarı doğrula: yanlış sağlayıcıya ait bir anahtar kaydedilirse tüm
  // istekler sessizce reddedilir ve kullanıcı ne olduğunu anlamaz.
  if (apiKey) {
    console.log(`\n${DIM}Anahtar doğrulanıyor...${RESET}`);
    const { verifyApiKey } = await import("./providers.js");
    const check = await verifyApiKey(spec.key, apiKey, baseUrl);
    if (!check.ok) {
      // Uyarılar (yanlış sağlayıcı, ağ/kota) akışı kesmez; yalnızca bilgilendirir.
      console.log(`${check.fatal ? RED : YELLOW}${check.message}${RESET}`);
      if (check.likelyProvider) {
        const other = PROVIDERS.find((p) => p.key === check.likelyProvider);
        console.log(`${DIM}İpucu: ${other?.label ?? check.likelyProvider} sağlayıcısını seçip tekrar deneyin.${RESET}`);
      }
      if (check.fatal) return;
    } else {
      console.log(`${GREEN}${check.message}${RESET}`);
    }
  }

  console.log(`\n${BOLD}4) Model seçimi${RESET} ${DIM}(listeleniyor...)${RESET}`);
  let modelId: string;
  try {
    const models = await fetchModels(spec.key, apiKey, baseUrl);
    if (!models.length) { console.log(`${RED}Liste boş döndü.${RESET}`); return; }
    const shown = models.slice(0, 200);
    shown.forEach((m, i) => console.log(`  ${(i + 1).toString().padStart(3)}) ${m}`));
    if (models.length > shown.length) console.log(`  ${DIM}… ve ${models.length - shown.length} model daha${RESET}`);
    const sel = await linePrompt("Model numarası veya adı: ", s);
    if (!sel) { console.log(`${DIM}İptal.${RESET}`); return; }
    if (/^\d+$/.test(sel) && +sel >= 1 && +sel <= shown.length) modelId = shown[+sel - 1];
    else if (models.includes(sel)) modelId = sel;
    else { console.log(`${RED}Geçersiz seçim.${RESET}`); return; }
  } catch (e) {
    console.log(`${RED}Liste alınamadı: ${e instanceof Error ? e.message : e}${RESET}`);
    modelId = await linePrompt("Model adını elle girin (boş=iptal): ", s);
    if (!modelId) return;
  }

  const full = modelId.startsWith(spec.litellmPrefix) ? modelId : spec.litellmPrefix + modelId;
  saveProvider(spec.key, apiKey, baseUrl, full);
  {
    const built = buildRunner(s.svc, s.mode);
    s.runner = built.runner;
    s.agent = built.agent;
  }
  console.log(`\n${GREEN}Kaydedildi → ${spec.key} · ${full}${RESET}\n`);
}


async function dispatch(cmd: string, s: CliState): Promise<boolean> {
  if (cmd === "/quit") {
    // Ekran temizlenir: kullanıcı kabuk istemine temiz bir ekranla döner.
    clearTerminal();
    return false;
  }
  if (cmd === "/help") { await commandWindow(s); return true; }
  if (cmd === "/tools") {
    for (const t of s.agent.tools ?? []) {
      const tool = t as { name?: string; description?: string };
      console.log(`  • ${tool.name ?? "?"}: ${(tool.description ?? "").split("\n")[0]}`);
    }
    return true;
  }
  if (cmd === "/history") { await cmdHistory(s); return true; }
  if (cmd === "/compact") { await cmdCompact(s); return true; }
  if (cmd === "/clear") {
    // Ekranı temizle, mevcut oturumu diske kaydet ve yeni bağlam oluştur.
    await persistSession(s);
    console.clear();
    s.sessionId = (await s.svc.createSession({ appName: APP_NAME, userId: USER_ID })).id;
    s.summary = null;
    console.log(banner(s));
    console.log(`${DIM}Yeni bağlam oluşturuldu (mod: ${s.mode}).${RESET}`);
    return true;
  }
  if (cmd === "/provider") { await cmdProvider(s); return true; }
  if (cmd === "/model") { await cmdModel(s); return true; }
  if (cmd === "/approve") {
    const arg = cmd.slice("/approve".length).trim().toLowerCase();
    if (arg === "on") s.autoApprove = true;
    else if (arg === "off") s.autoApprove = false;
    else s.autoApprove = !s.autoApprove;
    console.log(
      s.autoApprove
        ? `${GREEN}Oto onay: AÇIK — araçlar doğrudan çalışır.${RESET}`
        : `${YELLOW}Oto onay: KAPALI — dosya yazma ve komut çalıştırma onay ister.${RESET}`,
    );
    return true;
  }
  if (cmd === "/settings") { await cmdSettings(s); return true; }
  if (cmd === "/rules") { await cmdRules(); return true; }
  if (cmd === "/keys") { await cmdKeys(); return true; }
  if (cmd === "/tokens") { await cmdTokens(s); return true; }
  if (cmd.startsWith("/mode")) {
    const arg = cmd.slice(5).trim();
    if ((["plan", "build", "auto"] as string[]).includes(arg)) {
      setMode(s, arg as AgentMode);
      console.log(modeLine(arg as AgentMode));
    } else if (!arg) {
      cycleMode(s);
      console.log(modeLine(s.mode));
    } else {
      console.log(`${DIM}Kullanım: /mode plan|build|auto${RESET}`);
    }
    return true;
  }
  console.log(`${DIM}Bilinmeyen komut; / yazın.${RESET}`);
  return true;
}

async function repl(s: CliState): Promise<void> {
  console.log(banner(s));
  for (;;) {
    const raw = await promptInput(statePrompt(s), s);
    if (raw === null) {
      // Ctrl+D (EOF): ekran temizlenir, kabuk istemine dönülür.
      clearTerminal();
      return;
    }
    const input = raw.trim();
    if (!input) continue;
    const h = s.inputHist;
    if (!h.length || h[h.length - 1] !== input) h.push(input);
    if (input === "/") {
      const chosen = await commandWindow(s);
      if (!chosen) continue;
      if (!(await dispatch(chosen, s))) return;
      continue;
    }
    // Kısaltmalar da çalışır: "/prov" → "/provider".
    const res = resolveCommand(input);
    if (res.kind === "exact" || res.kind === "prefix") {
      const cmd = withSlash(res.command!.name);
      // Argümanlı komutlar (ör. "/mode plan") tüm girdiyi almalı.
      if (!(await dispatch(cmd === "/mode" ? input : cmd, s))) return;
      continue;
    }
    if (res.kind === "ambiguous") {
      // Birden fazla komut eşleşiyor: eşleşenler arasından seçim iste.
      const chosen = await commandWindow(s, res.candidates!.map((c) => c.name));
      if (!chosen) continue;
      if (!(await dispatch(chosen, s))) return;
      continue;
    }
    await runTurn(s, input);
  }
}

/**
 * TUI'nin açılıp açılmayacağına karar verir.
 * TTY + --plain yoksa TUI; aksi halde düz REPL.
 */
function shouldUseTui(): boolean {
  if (ARGS.plain) return false;
  if (process.env.AGENT_PLAIN === "1") return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  if ((process.env.TERM ?? "") === "dumb") return false;
  return true;
}

async function main(): Promise<void> {
  // --help / --version: hiçbir şey başlatmadan çık.
  if (ARGS.help) {
    console.log(helpText());
    return;
  }
  if (ARGS.version) {
    console.log(`bashcli ${VERSION}`);
    return;
  }

  const mode: AgentMode = ARGS.mode
    ?? ((["plan", "build", "auto"] as string[]).includes(process.env.AGENT_MODE ?? "")
      ? (process.env.AGENT_MODE as AgentMode) : "build");
  const svc = new InMemorySessionService();
  const built = buildRunner(svc, mode);
  const s: CliState = {
    svc,
    runner: built.runner,
    agent: built.agent,
    sessionId: "",
    mode,
    summary: null,
    inputHist: [],
    autoApprove: true,
    tokens: emptyUsage(),
  };
  s.sessionId = (await svc.createSession({ appName: APP_NAME, userId: USER_ID })).id;

  // Oto onay kapalıyken araç çalıştırmadan önce onay iste.
  setApprovalHook(async (req) => {
    if (s.autoApprove) return true;
    const ans = await linePrompt(`${YELLOW}Onay (${req.tool}): ${req.summary} — e/h: `, s);
    const yes = ["e", "evet", "y", "yes", ""].includes(ans.trim().toLowerCase());
    return yes;
  });

  if (shouldUseTui()) {
    const { TuiApp } = await import("./tui/app.js");
    const app = new TuiApp(
      {
        svc: s.svc,
        runner: s.runner,
        agent: s.agent,
        sessionId: s.sessionId,
        mode: s.mode,
        summary: s.summary,
        inputHist: s.inputHist,
        tokens: s.tokens,
      },
      ARGS.task ? { task: ARGS.task } : {},
    );
    await app.run();
    return;
  }

  if (ARGS.task) {
    console.log(banner(s));
    console.log(`${statePrompt(s)}${ARGS.task}\n`);
    await runTurn(s, ARGS.task);
  } else {
    await repl(s);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

