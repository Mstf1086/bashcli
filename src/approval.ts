// Araç onay mekanizması.
//
// "Oto onay" açıkken (varsayılan) dosya yazma ve komut çalıştırma doğrudan
// yapılır. Kapatıldığında (TUI'de Ctrl+Tab) bu araçlar çalışmadan önce
// kullanıcıya onay sorulur.
//
// Onay soran araçlar: write_file, edit_file, run_command.
//
// Onay kapısı ADK'nın `beforeToolCallback` mekanizması üzerinden kurulur:
// ajana tek bir kapı verilir, kapı hangi araçların onay istediğine ve
// kullanıcıya ne gösterileceğine karar verir. Böylece yeni bir araç eklendiğinde
// onay mantığı araç gövdesine kopyalanmaz; onay kuralı tek yerde durur.

/** Onay isteği. */
export interface ApprovalRequest {
  /** Aracın adı. */
  tool: string;
  /** Kullanıcıya gösterilecek kısa açıklama. */
  summary: string;
}

/** Onay soran fonksiyon; true dönerse işlem yapılır. */
export type ApprovalFn = (req: ApprovalRequest) => Promise<boolean>;

let hook: ApprovalFn | null = null;

/** Onay hook'unu ayarlar (null → onay sorma). */
export function setApprovalHook(fn: ApprovalFn | null): void {
  hook = fn;
}

/**
 * Onay isteyen araçların adları.
 *
 * Bu liste kapının tek kaynağıdır: listedeki araçlar çalıştırılmadan önce
 * onay ister, listedeki olmayanlar doğrudan çalışır.
 */
export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "run_command",
]);

/** Onay reddedildiğinde modele döndürülecek mesaj (araç adına göre). */
const DENIED_MESSAGES: Record<string, string> = {
  write_file: "Kullanıcı onaylamadı; dosya yazılmadı.",
  edit_file: "Kullanıcı onaylamadı; dosya değiştirilmedi.",
  run_command: "Kullanıcı onaylamadı; komut çalıştırılmadı.",
};

/** Onay reddi mesajını döndürür. */
export function deniedMessage(tool: string): string {
  return DENIED_MESSAGES[tool] ?? `Kullanıcı onaylamadı; ${tool} çalıştırılmadı.`;
}

/**
 * Kullanıcıya gösterilecek onay özetini üretir.
 *
 * Özet, aracın ne yapacağını somutlaştırır (hangi dosya, ne kadar içerik,
 * hangi komut) — kullanıcı neye onay verdiğini görebilmelidir.
 */
export function describeToolCall(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "write_file": {
      const content = typeof args.content === "string" ? args.content.length : 0;
      return `Dosya yazılacak: ${String(args.path ?? "?")} (${content} karakter)`;
    }
    case "edit_file":
      return `Dosya düzenlenecek: ${String(args.path ?? "?")}`;
    case "run_command":
      return `Komut çalıştırılacak: ${String(args.command ?? "?")}`;
    default:
      return `${tool} çalıştırılacak`;
  }
}

/**
 * Aracın çalıştırılması için onay ister.
 *
 * Hook tanımlı değilse işlem onaylanmış sayılır (headless kullanım).
 */
export async function requestApproval(tool: string, summary: string): Promise<boolean> {
  if (!hook) return true;
  try {
    return await hook({ tool, summary });
  } catch {
    return false;
  }
}

/** Onay hook'u var mı? */
export function hasApprovalHook(): boolean {
  return hook !== null;
}
