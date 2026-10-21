// API hata mesajlarını kullanıcıya anlaşılır biçime çevirir.
//
// Hem düz REPL (src/cli.ts) hem de TUI (src/tui/app.ts) kullanır; böylece
// sağlayıcıya özgü durumlar (kota, bakiye, anahtar) her iki yüzeyde de
// aynı şekilde bildirilir.

/**
 * Ham API hatasını kullanıcıya anlaşılır bir mesaja çevirir.
 *
 * Sağlayıcıya özgü durumlar (kota, bakiye, anahtar) sık karşılaşılan
 * sorunlardır; ham "HTTP 429" yerine ne yapılması gerektiğini söylemek
 * kullanıcıya zaman kazandırır.
 *
 * @param e Hata nesnesi (veya mesajı).
 * @param code ADK'nin event üzerinde verdiği hata kodu (varsa). Sağlayıcı
 *   gövdesi saf JSON değilse ADK kodu "UNKNOWN_ERROR" olarak bırakır; bu
 *   durumda koddan değil mesajdan tespit yapılır.
 */
export function describeError(e: unknown, code?: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  // HTTP durum kodunu mesajdan veya ayrı kod alanından bul.
  const status = /\b(?:HTTP\s*)?(4\d\d|5\d\d)\b/.exec(msg)?.[1]
    ?? (/^\d{3}$/.test(code ?? "") ? code : undefined);

  switch (status) {
    case "429":
      return "Model kotası doldu (HTTP 429). Sağlayıcının ücretsiz katot "
        + "sınırı tükenmiş olabilir; birkaç dakika bekleyip tekrar deneyin "
        + "veya /provider ile bakiyeli bir model seçin.";
    case "402":
      return "Bakiye yetersiz (HTTP 402). /provider ile bakiyesi olan bir "
        + "sağlayıcı seçin.";
    case "401":
      return "API anahtarı geçersiz (HTTP 401). /provider ile anahtarınızı "
        + "yenileyin.";
    case "403":
      return "Erişim reddedildi (HTTP 403). API anahtarının bu modele veya "
        + "bu sağlayıcıya yetkisi yok; /provider ile başka bir sağlayıcı veya "
        + "model seçin.";
    case "404":
      // Bazı sağlayıcılar (ör. Google) 404 gövdesinde hangi modelin
      // kullanılması gerektiğini yazar. Bu ipucu genel mesajda kaybolursa
      // kullanıcı doğru modeli bulamaz; gövdedeki öneri öne çıkarılır.
      if (/no longer available|use models\/([\w.-]+)/i.test(msg)) {
        const alt = /use models\/([\w.-]+)/i.exec(msg)?.[1];
        return `Model artık kullanılamıyor (HTTP 404)`
          + (alt ? `; "${alt}" modelini kullanın.` : ".")
          + " /provider ile listeden geçerli bir model seçin.";
      }
      return "Model bulunamadı (HTTP 404). /provider ile listeden geçerli bir "
        + "model seçin.";
    case "400":
      return "İstek geçersiz (HTTP 400). Model adı veya istek biçimi "
        + "sağlayıcıya uymuyor; /provider ile modeli yeniden seçin.";
    case "500":
    case "502":
    case "503":
    case "504":
      return `Sağlayıcı geçici olarak hata veriyor (HTTP ${status}). `
        + "Birkaç saniye sonra tekrar deneyin.";
    default:
      return `Hata: ${msg}`;
  }
}
