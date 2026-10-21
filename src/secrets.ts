// Gizli değerler (API anahtarları) için maskeleme.
//
// Ajanın `get_api_key` aracı sağlayıcı anahtarlarını okuyabilir; bu değerler
// konuşma bağlamına girdiği için oturum dosyalarına düz metin yazılmamalıdır.
// `redactSecrets` bilinen tüm anahtarları maskeleyerek diske yazılan içeriği
// temizler.
//
// Not: Buradaki liste "bilinen" anahtarlardır; ajanın ürettiği tamamen yeni
// bir anahtar (örn. kullanıcının sohbette yazdığı bir anahtar) maskelenmez.
// Bu bir sızıntı önleme katmanıdır, garanti değil.
import { listProviderKeys } from "./providers.js";

/** Maskelenmiş değerin yerine geçen metin. */
export const SECRET_MASK = "[api-anahtari-gizlendi]";

/** Bilinen gizli değerlerin listesi. */
export function knownSecretValues(): string[] {
  const out = new Set<string>();
  for (const p of listProviderKeys()) {
    if (p.apiKey && p.apiKey.length >= 8) out.add(p.apiKey);
  }
  return [...out];
}

/** Metindeki bilinen gizli değerleri maskeler. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of knownSecretValues()) {
    out = out.split(secret).join(SECRET_MASK);
  }
  return out;
}
