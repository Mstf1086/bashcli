// Uygulamanın ortak giriş noktası (barrel).
//
// Yalnızca gerçekten dışarıdan kullanılan semboller dışa aktarılır: her
// export, dışa aktarılmazsa kodun bir yerinde bozulur. Kullanılmayan bir
// export, "bu kütüphane olarak kullanılabilir" yanılgısı yaratır ve
// bakım yükü getirir.
//
// Not: Bu dosya bir paket giriş noktası DEĞİLDİR (package.json'da `exports`
// alanı yok); uygulama `bin/bashcli.mjs` üzerinden çalışır. Bu yüzden yüzey
// minimal tutulur.

export { OpenAiCompatibleLlm } from "./openai_compatible_llm.js";
export type { OpenAiCompatibleParams } from "./openai_compatible_llm.js";

export {
  PROVIDERS,
  currentLlmKwargs,
  fetchModels,
  listProviderKeys,
  providerKeyReport,
  saveProvider,
} from "./providers.js";

export { createAgent } from "./agent.js";
export type { AgentMode } from "./agent.js";

export { workspaceRoot } from "./workspace.js";
