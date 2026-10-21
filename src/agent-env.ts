// Ortak ortam değişkeni yükleyici.
//
// `.env` dosyaları yalnızca SAĞLAYICI DIŞI ayarlar içindir (AGENT_MODE,
// AGENT_MAX_TOKENS, AGENT_NUM_RETRIES, ...). Sağlayıcı ayarları (PROVIDER,
// AGENT_MODEL, *_API_KEY, *_API_BASE, OPENAI_BASE_URL, ...) yalnızca
// ~/.bashcli/providers.json dosyasında saklanır; `.env` içinde bulunsalar bile
// YÜKLENMEZ (bkz. providers.ts isProviderEnvKey). Böylece anahtar tek bir
// yerde durur ve güvenilmeyen bir projenin .env'i base URL'i değiştirerek
// anahtarı başka bir sunucuya yönlendiremez.
//
// Yükleme sırası (global kullanımda da çalışması için cwd'den bağımsız):
//   1) Ajanın kendi .env'i (ajan kökü)
//   2) Hedef projenin .env'i (cwd)
// Önce yüklenen / zaten tanımlı olan değer korunur (override:false), yani
// ajanın ve shell'in ayarları hedef proje tarafından ezilmez.
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENV_PATH, isProviderEnvKey } from "./providers.js";

/** Ajanın kökündeki .env dosyası yüklendi mi? */
let agentEnvLoaded = false;

/**
 * Bir .env dosyasını sağlayıcı değişkenlerini atlayarak process.env'e uygular.
 * Hata durumunda süreci düşürmez.
 */
function applyEnvFile(path: string, opts: { override: boolean; skip?: string[] }): void {
  try {
    const parsed = parse(readFileSync(path));
    for (const [key, value] of Object.entries(parsed)) {
      if (isProviderEnvKey(key)) continue;
      if (opts.skip?.includes(key)) continue;
      if (!opts.override && process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  } catch {
    // yok say
  }
}

/**
 * Ajanın kendi .env'ini yükler. Idempotenttir: ikinci çağrı bir şey yapmaz.
 */
export function loadAgentEnv(): void {
  if (agentEnvLoaded) return;
  agentEnvLoaded = true;
  if (!existsSync(ENV_PATH)) return;
  // Workspace hedef projeye aittir; ajanın .env'i bir workspace dayatamaz.
  applyEnvFile(ENV_PATH, { override: false, skip: ["CODING_WORKSPACE"] });
}

/**
 * Hedef projenin .env dosyasını da yükler (yalnızca tanımlı olmayan,
 * sağlayıcı dışı değişkenleri ekler).
 */
export function loadWorkspaceEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return;
  applyEnvFile(path, { override: false });
}

/** Ajan .env'ini yeniden yükler (var olan değerleri de ezer; sağlayıcı değişkenleri hariç). */
export function reloadAgentEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  applyEnvFile(ENV_PATH, { override: true, skip: ["CODING_WORKSPACE"] });
}
