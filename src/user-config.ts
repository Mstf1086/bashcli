// Kullanıcı düzeyi yapılandırma.
//
// Sağlayıcı bilgileri (API anahtarı dâhil) ajanın kurulum dizininde değil,
// kullanıcının kendi cihazında saklanır: ~/.bashcli/providers.json
//
// Böylece:
//  - Ajan güncellendiğinde/taşındığında anahtar kaybolmaz
//  - Birden fazla ajan kurulumu aynı ayarları paylaşır
//  - Anahtar yalnızca kullanıcının dosya sisteminde, 0600 izniyle durur
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Kullanıcı yapılandırma dizininin ana kökü.
 *
 * Varsayılan: ev dizini. `BASHCLI_HOME` ile geçici bir dizine alınabilir;
 * bu, testlerin gerçek kullanıcı kaydına (API anahtarı) bakmadan çalışmasını
 * sağlar.
 */
const CONFIG_HOME = process.env.BASHCLI_HOME ?? homedir();

/** Kullanıcı yapılandırma dizini. */
export const USER_DIR = join(CONFIG_HOME, ".bashcli");

/** Sağlayıcı ayarlarının dosyası. */
export const USER_CONFIG_PATH = join(USER_DIR, "providers.json");

/** Kaydedilen sağlayıcı ayarı. */
export interface UserProviderConfig {
  /** Sağlayıcı anahtarı (örn. "zenmux"). */
  provider: string;
  /** API anahtarı. */
  apiKey?: string;
  /** Temel URL. */
  baseUrl?: string;
  /** Model adı (LiteLLM önekiyle birlikte). */
  model?: string;
}

/** Tüm kullanıcı ayarları. */
export interface UserConfig {
  /** Aktif sağlayıcı ayarı. */
  provider?: UserProviderConfig;
}

/** Yapılandırmayı okur; yoksa boş döner. */
export function readUserConfig(): UserConfig {
  try {
    if (!existsSync(USER_CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(USER_CONFIG_PATH, "utf-8")) as UserConfig;
  } catch {
    return {};
  }
}

/**
 * Kullanıcı yapılandırmasını yazar.
 *
 * Dosya sahibine özel izinlerle (0600) oluşturulur; API anahtarı başkaları
 * tarafından okunamaz.
 */
export function writeUserConfig(config: UserConfig): void {
  mkdirSync(USER_DIR, { recursive: true, mode: 0o700 });
  // mode: dosya baştan 0600 oluşturulur (yazma ile chmod arasındaki okunabilir pencere yok).
  writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(USER_CONFIG_PATH, 0o600);
  } catch {
    // izin ayarlanamazsa yoksay
  }
}

/** Aktif sağlayıcı ayarını döner. */
export function readUserProvider(): UserProviderConfig | undefined {
  return readUserConfig().provider;
}

/** Aktif sağlayıcı ayarını yazar. */
export function saveUserProvider(config: UserProviderConfig): void {
  writeUserConfig({ ...readUserConfig(), provider: config });
}
