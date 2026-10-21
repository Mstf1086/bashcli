// Slash komut tanımları ve otomatik tamamlama sağlayıcısı.
//
// Hem düz REPL (src/cli.ts) hem de TUI (src/tui/*) bu listeyi kullanır.
//
// Komut adları "/" öneki olmadan tutulur: pi-tui'nin otomatik tamamlama
// sağlayıcısı öneki kendisi ekler ("/help" + "/" -> "//help" olurdu).
// Kullanıcıya gösterilecek metin için `withSlash()` kullanılır.
import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";

export interface CommandDef {
  /** Komut adı ("/" olmadan). */
  name: string;
  /** Kısa açıklama. */
  desc: string;
  /** Argüman ipucu (varsa). */
  argumentHint?: string;
  /** Alternatif adlar (aynı komutu çalıştırır). */
  aliases?: string[];
}

/** TUI'da ve düz REPL'de kullanılan komut listesi. */
export const COMMANDS: CommandDef[] = [
  { name: "provider", desc: "Sağlayıcı seç → API anahtarı → model listesi" },
  { name: "model", desc: "Aktif sağlayıcının modellerini listele ve seç" },
  { name: "settings", desc: "Ayarlar: modu değiştir, bilgiler" },
  { name: "history", desc: "Önceki oturum geçmişini listele ve yükle" },
  { name: "compact", desc: "Geçmişi özetleyip bağlamı sıkıştır" },
  { name: "clear", desc: "Ekranı temizle, oturumu sıfırla (yeni bağlam)" },
  { name: "tools", desc: "Ajan araçlarını listele" },
  { name: "mode", desc: "Modu değiştir", argumentHint: "plan|build|auto" },
  { name: "approve", desc: "Otomatik onayı aç/kapa", argumentHint: "on|off" },
  { name: "rules", desc: "Proje kurallarını ve ignore listesini göster" },
  { name: "keys", desc: "Sağlayıcı API anahtarlarını göster" },
  { name: "tokens", desc: "Token tüketimini göster" },
  { name: "help", desc: "Bu komut penceresi" },
  { name: "quit", desc: "Çık" },
];

/**
 * Komut adına (veya alias'ına) göre tanım bulur; alias'ları da kapsar.
 *
 * @param name "/" önekli olabilir ("/quit" veya "quit").
 */
export function findCommand(name: string): CommandDef | undefined {
  const n = name.startsWith("/") ? name.slice(1) : name;
  return COMMANDS.find(
    (c) => c.name === n || c.aliases?.some((a) => a === n),
  );
}

/**
 * Bir girdi için komut çözümlemesi.
 *
 * - `exact`: tam eşleşen tek komut (ör. "/provider").
 * - `prefix`: tek komut eşleşiyor ama ad tam değil (ör. "/prov" → "/provider").
 * - `ambiguous`: birden fazla komut eşleşiyor (ör. "/m" → "/model" ve "/mode").
 * - `none`: eşleşen yok.
 */
export interface CommandResolution {
  kind: "exact" | "prefix" | "ambiguous" | "none";
  /** Kesinleşen komut (exact/prefix durumunda). */
  command?: CommandDef;
  /** Belirsiz durumda eşleşen tüm komutlar. */
  candidates?: CommandDef[];
  /** Girdinin normalize hâli ("/prov" → "prov"). */
  input: string;
}

/**
 * Slash komut girdisini çözer: tam eşleşme, tek prefix eşleşmesi veya
 * belirsiz eşleşme.
 *
 * Kısaltmalar kullanıcıya hız kazandırır: "/prov" yazıp Enter'a basmak
 * "/provider" ile aynıdır. Birden fazla komut eşleşirse (ör. "/m" → "/model"
 * ve "/mode") belirsiz olarak işaretlenir; çağıran taraf eşleşenleri
 * kullanıcıya gösterip seçim ister.
 */
export function resolveCommand(input: string): CommandResolution {
  const raw = input.trim();
  const withoutSlash = raw.startsWith("/") ? raw.slice(1) : raw;
  // Yalnızca komut adı çözülür; argümanlar ("/mode plan") komut adından
  // ayrılır ve çağıran tarafta işlenir.
  const name = withoutSlash.split(/\s/)[0] ?? "";
  if (!name) return { kind: "none", input: raw };

  const exact = findCommand(name);
  if (exact) return { kind: "exact", command: exact, input: raw };

  const lower = name.toLowerCase();
  const candidates = COMMANDS.filter(
    (c) => c.name.toLowerCase().startsWith(lower)
      || c.aliases?.some((a) => a.toLowerCase().startsWith(lower)),
  );
  if (candidates.length === 1) {
    return { kind: "prefix", command: candidates[0], input: raw };
  }
  if (candidates.length > 1) {
    return { kind: "ambiguous", candidates, input: raw };
  }
  return { kind: "none", input: raw };
}

/**
 * Adı (veya alias'ı) bilinen bir komut mu?
 *
 * Girdi hem "/" önekli hem de öneksiz kabul edilir. Kısaltmalar da geçerlidir
 * (ör. "/prov" → "/provider").
 */
export function isKnownCommand(name: string): boolean {
  const r = resolveCommand(name);
  return r.kind === "exact" || r.kind === "prefix";
}

/** Komut adını kullanıcıya gösterilecek biçime getirir: "help" -> "/help". */
export function withSlash(name: string): string {
  return name.startsWith("/") ? name : `/${name}`;
}

/**
 * Slash komutlarını pi-tui'nin CombinedAutocompleteProvider'ına verir.
 * Sağlayıcı, hem "/" ile komut önerisi hem "@" ile dosya önerisi yapar.
 *
 * Alias'lar (ör. "quit") ayrı birer öneri olarak listelenir; böylece
 * "/qu" yazdığında öneri çıkar.
 */
export function toSlashCommands(): SlashCommand[] {
  const out: SlashCommand[] = [];
  for (const c of COMMANDS) {
    out.push({
      name: c.name,
      description: c.desc,
      ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
    });
    for (const alias of c.aliases ?? []) {
      out.push({
        name: alias,
        description: `${c.desc} (${withSlash(c.name)} ile aynı)`,
        ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
      });
    }
  }
  return out;
}

/** SelectList öğelerine dönüştürür (etiketler "/" ile gösterilir). */
export function toSelectItems(): AutocompleteItem[] {
  const out: AutocompleteItem[] = [];
  for (const c of COMMANDS) {
    out.push({
      value: c.name,
      label: withSlash(c.name),
      description: c.desc,
    });
    for (const alias of c.aliases ?? []) {
      out.push({
        value: alias,
        label: withSlash(alias),
        description: `${c.desc} (${withSlash(c.name)} ile aynı)`,
      });
    }
  }
  return out;
}
