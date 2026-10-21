// Ortak ortam değişkeni yükleyici.
//
// Neden gerekli: `import "dotenv/config"` yalnızca **cwd'deki** .env dosyasını
// okur. Global kurulan `bashcli` başka bir projede çalıştığında ajanın kendi
// API anahtarı (PROVIDER, AGENT_MODEL, *_API_KEY) yüklenmezdi ve her istek
// "API anahtarı yok" hatasıyla düşerdi. Ayrıca `providers.saveProvider()`
// ayarları ajan kökündeki .env'e yazıyordu; okuma ve yama farklı dosyalara
// gidiyordu.
//
// Çözüm: iki dosyayı belirli bir sırayla yüklüyoruz.
//   1) Ajanın kendi .env'i (ajan kökü)  → PROVIDER, AGENT_MODEL, API anahtarları
//   2) Hedef projenin .env'i (cwd)      → proje-özeli ek ayarlar
//
// dotenv'in `override` varsayılanı `false` olduğu için **önce yüklenen değer
// korunur**: ajanın ayarları hedef projenin .env'i tarafından ezilmez.
// Gerçekten ezmek isteyenler `override: true` ile `reloadAgentEnv()` çağırır.
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ENV_PATH } from "./providers.js";

/** Ajanın kökündeki .env dosyası yüklendi mi? */
let agentEnvLoaded = false;

/**
 * Ajanın kendi .env'ini yükler. Idempotenttir: ikinci çağrı bir şey yapmaz.
 */
export function loadAgentEnv(): void {
  if (agentEnvLoaded) return;
  agentEnvLoaded = true;
  if (!existsSync(ENV_PATH)) return;
  // Hata durumunda süreci düşürmüyoruz: eksik anahtar daha sonra
  // /provider sihirbazında daha anlamlı bir mesajla bildirilir.
  try {
    // Ajanın .env'i çalışılan projeye ait olmayan bir workspace dayatabilir.
    // Workspace hedef projeye aittir, bu yüzden ajanın değerini geçici olarak
    // saklayıp yükleme sonrası geri koyuyoruz.
    const saved = process.env.CODING_WORKSPACE;
    config({ path: ENV_PATH, quiet: true });
    if (saved === undefined) delete process.env.CODING_WORKSPACE;
    else process.env.CODING_WORKSPACE = saved;
  } catch {
    // yok say
  }
}

/**
 * Hedef projenin .env dosyasını da yükler.
 *
 * Ajanın .env'i zaten yüklendiyse bu dosya yalnızca ajanın tanımlamadığı
 * değişkenleri ekler (dotenv override:false). Böylece hedef proje kendi
 * ek ayarlarını verebilir, ajanın sağlayıcı/model ayarları ise korunur.
 */
export function loadWorkspaceEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return;
  try {
    config({ path, quiet: true });
  } catch {
    // yok say
  }
}

/**
 * Ajan .env'ini yeniden yükler (var olan değerleri de ezer).
 * /provider sihirbazı kaydettikten sonra ayarların hemen geçerli olması için.
 */
export function reloadAgentEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  try {
    config({ path: ENV_PATH, quiet: true, override: true });
  } catch {
    // yok say
  }
}
