// Token tüketimi takibi.
//
// ADK, model yanıtını `LlmResponse.usageMetadata` ile birlikte döndürür ve bu
// alan event'e kopyalanır. Bu modül o alanı toplayıp biriktirir; böylece
// kullanıcı gerçek tüketimini görür (bakiye takibi için önemli).
//
// Not: usageMetadata yoksa ADK token sayısını karakter/4 ile tahmin eder.
// Tahmin, gerçek sayaçla karıştırılmamalı diye yalnızca gelen metadata
// sayılır.

/** Birikmiş token tüketimi. */
export interface TokenUsage {
  /** Giren (prompt) token. */
  prompt: number;
  /** Çıkan (completion) token. */
  completion: number;
  /** Toplam token. */
  total: number;
  /** Model çağrısı sayısı. */
  calls: number;
}

/** Sıfır kullanım. */
export function emptyUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0, calls: 0 };
}

/** Birikmiş kullanıma yeni bir çağrının kullanımını ekler. */
export function addUsage(current: TokenUsage, usage: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}): TokenUsage {
  const prompt = usage.promptTokenCount ?? 0;
  const completion = usage.candidatesTokenCount ?? 0;
  const total = usage.totalTokenCount ?? prompt + completion;
  return {
    prompt: current.prompt + prompt,
    completion: current.completion + completion,
    total: current.total + total,
    calls: current.calls + 1,
  };
}

/** Token sayısını kısa biçimde gösterir (1234 → "1.2k"). */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
