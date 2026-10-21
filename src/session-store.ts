// Oturum geçmişi deposu.
//
// ADK'nın InMemorySessionService'ı oturumları yalnızca bellekte tutar;
// süreç kapanınca her şey kaybolur. Bu modül oturumları diske yazar, böylece
// "/clear" sonrasında bile önceki oturumlar "/history" ile listelenebilir ve
// geri yüklenebilir.
//
// Kayıt yeri: <ajan kökü>/.bashcli/sessions/<sessionId>.json
//
// Not: Kaydedilen veri yalnızca sohbet içeriğidir; API anahtarları burada
// tutulmaz — bilinen anahtar değerleri yazarken maskelenir (bkz. secrets.ts).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./providers.js";
import { redactSecrets } from "./secrets.js";

/** Oturumların saklandığı dizin. */
export const SESSION_DIR = join(PROJECT_ROOT, ".bashcli", "sessions");

/** Kaydedilmiş oturumun özeti. */
export interface SavedSessionInfo {
  id: string;
  /** Son güncelleme zamanı (epoch ms). */
  lastUpdateTime: number;
  /** Mesaj (user/assistant) sayısı. */
  messageCount: number;
  /** İlk kullanıcı mesajının kısaltılmış hâli. */
  preview: string;
}

/** Diske yazılan oturum dosyasının biçimi. */
interface SavedSession {
  id: string;
  appName: string;
  userId: string;
  lastUpdateTime: number;
  events: unknown[];
}

/** Oturum dizinini oluşturur (yoksa). */
function ensureDir(): void {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
}

/** Oturum kimliği dosya adı olarak güvenli mi? (yol geçişini önler) */
function safeId(id: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(id) && id !== "." && id !== "..";
}

/**
 * Bir oturumu diske yazar.
 *
 * Yazma hataları yutulur: oturum geçmişi kaydetmek kritik değil, ajanın
 * çalışmaya devam etmesi önemli.
 */
export function saveSession(session: {
  id: string;
  appName: string;
  userId: string;
  lastUpdateTime?: number;
  events?: unknown[];
}): void {
  try {
    if (!safeId(session.id)) return;
    ensureDir();
    const payload: SavedSession = {
      id: session.id,
      appName: session.appName,
      userId: session.userId,
      lastUpdateTime: session.lastUpdateTime ?? Date.now(),
      events: (session.events ?? []) as unknown[],
    };
    // API anahtarları konuşma bağlamına girebildiği için (get_api_key aracı)
    // diske yazılan içerik maskelenir.
    writeFileSync(
      join(SESSION_DIR, `${session.id}.json`),
      redactSecrets(JSON.stringify(payload)),
      { encoding: "utf-8", mode: 0o600 },
    );
  } catch {
    // yoksay
  }
}

/**
 * Kaydedilmiş oturumları yeni tarihten eskiye doğru listeler.
 *
 * Mesaj içermeyen oturumlar listede yer almaz: bunlar ya yeni açılmış boş
 * oturumlardır ya da "/clear" sonrası kalan artıklardır ve yüklenmeleri
 * kullanıcıya bir şey kazandırmaz.
 */
export function listSavedSessions(): SavedSessionInfo[] {
  try {
    if (!existsSync(SESSION_DIR)) return [];
    const out: SavedSessionInfo[] = [];
    for (const file of readdirSync(SESSION_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(SESSION_DIR, file), "utf-8");
        const data = JSON.parse(raw) as SavedSession;
        const events = data.events ?? [];
        let messageCount = 0;
        let preview = "";
        for (const ev of events) {
          const parts = (ev as { content?: { parts?: { text?: string }[] } }).content?.parts ?? [];
          for (const p of parts) {
            const text = p.text?.trim();
            if (!text) continue;
            messageCount++;
            if (!preview) preview = text.replace(/\n/g, " ").slice(0, 60);
          }
        }
        if (messageCount === 0) continue;
        out.push({
          id: data.id,
          lastUpdateTime: data.lastUpdateTime ?? 0,
          messageCount,
          preview,
        });
      } catch {
        // bozuk dosyayı atla
      }
    }
    return out.sort((a, b) => b.lastUpdateTime - a.lastUpdateTime);
  } catch {
    return [];
  }
}

/** Kaydedilmiş bir oturumun event'lerini okur. */
export function loadSavedEvents(sessionId: string): unknown[] {
  try {
    if (!safeId(sessionId)) return [];
    const path = join(SESSION_DIR, `${sessionId}.json`);
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, "utf-8")) as SavedSession;
    return data.events ?? [];
  } catch {
    return [];
  }
}
