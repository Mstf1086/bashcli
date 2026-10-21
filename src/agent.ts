// Kodlama ajanı (Python agent.py'nin TS karşılığı): LlmAgent + 6 araç + modlar.
import { FunctionTool, LlmAgent } from "@google/adk";
import { z } from "zod";
import { currentLlmKwargs, providerKeyReport } from "./providers.js";
import {
  APPROVAL_REQUIRED_TOOLS, deniedMessage, describeToolCall, requestApproval,
} from "./approval.js";
import { OpenAiCompatibleLlm } from "./openai_compatible_llm.js";
import { projectRulesSection } from "./project-config.js";
import {
  editFile, listFiles, readFile, runCommand, searchFiles, writeFile,
} from "./coding_tools.js";

export const CODING_INSTRUCTION = `You are an expert autonomous coding agent (like Cline / Claude Code) operating \
in a terminal. You help the user by directly reading, writing, and editing \
files and running shell commands inside the workspace.

## Tools
- list_files: list a directory (use recursive=true to explore).
- read_file: read a file with line numbers (use offset/limit for big files).
- write_file: create a file or OVERWRITE it entirely (new files, full rewrites).
- edit_file: replace an exact, unique text block inside an existing file \
(prefer this over write_file for small changes; old_str must appear exactly once).
- search_files: regex search across the workspace (grep-like).
- run_command: run a shell command in the workspace (tests, builds, scripts).
- get_api_key: read the API keys bashcli uses for its LLM providers. Use it \
only when you need a provider key (e.g. to call a provider API yourself); \
never write a key into a file.

## Workflow
1. Understand the request. If critical details are missing, ask ONE concise \
question; otherwise proceed.
2. Explore before editing: list_files / read_file / search_files so edits are \
based on the real current code, never guesses.
3. Make the smallest coherent change (prefer edit_file; use write_file for \
brand-new files or full rewrites).
4. Verify: run the relevant command (tests, linter, the script itself) with \
run_command. Fix errors until green or clearly explain blockers.
5. Summarize at the end: what changed, which files, how it was verified.

## Rules
- All paths are relative to the workspace root; never try to escape it.
- Never invent file contents — read first, then edit.
- Keep answers in the user's language (Turkish by default).
- For destructive or irreversible actions, confirm with the user first.
- If a tool fails, read the error and retry with a corrected call; do not \
loop the same failing call more than twice.
`;

export const MODE_ORDER = ["plan", "build", "auto"] as const;
export type AgentMode = (typeof MODE_ORDER)[number];

export const MODE_INSTRUCTION: Record<AgentMode, string> = {
  plan: "\n\n## MODE: PLAN (read-only)\n"
    + "You are in PLAN mode. Do NOT create/edit/delete files and do NOT run "
    + "commands. Explore with list_files / read_file / search_files only, then "
    + "produce a clear, step-by-step implementation plan (which files to change "
    + "and why). Stop after the plan and wait for the user to switch to build/auto.",
  build: "\n\n## MODE: BUILD\n"
    + "Implement the requested changes, verify with run_command, and summarize "
    + "what you changed. Ask before destructive/irreversible actions.",
  auto: "\n\n## MODE: AUTO\n"
    + "Work fully autonomously: explore, implement, and verify without stopping "
    + "to ask. Iterate until the task is complete, then summarize. Only ask if "
    + "truly blocked by missing information.",
};

export const DEFAULT_MODE: AgentMode =
  (["plan", "build", "auto"] as string[]).includes(process.env.AGENT_MODE ?? "")
    ? (process.env.AGENT_MODE as AgentMode)
    : "build";

function buildTools() {
  const listFilesTool = new FunctionTool({
    name: "list_files",
    description: "Bir dizindeki dosya ve alt dizinleri listeler.",
    parameters: z.object({
      directory: z.string().optional().describe("Dizin (varsayılan .)"),
      recursive: z.boolean().optional().describe("Alt dizinleri gez"),
    }),
    execute: async ({ directory, recursive }) =>
      listFiles(directory ?? ".", recursive ?? false),
  });
  const readFileTool = new FunctionTool({
    name: "read_file",
    description: "Bir dosyanın içeriğini satır numaralarıyla okur.",
    parameters: z.object({
      path: z.string().describe("Dosya yolu"),
      offset: z.number().optional().describe("Başlangıç satırı (1 tabanlı)"),
      limit: z.number().optional().describe("En fazla satır"),
    }),
    execute: async ({ path, offset, limit }) =>
      readFile(path, offset ?? 1, limit ?? 2000),
  });
  const writeFileTool = new FunctionTool({
    name: "write_file",
    description: "Bir dosyayı oluşturur veya tüm içeriğini değiştirir.",
    parameters: z.object({
      path: z.string().describe("Dosya yolu"),
      content: z.string().describe("Yeni içerik"),
    }),
    execute: async ({ path, content }) => writeFile(path, content),
  });
  const editFileTool = new FunctionTool({
    name: "edit_file",
    description: "Dosyada birebir metin değişimi yapar (benzersiz blok).",
    parameters: z.object({
      path: z.string().describe("Dosya yolu"),
      old_str: z.string().describe("Değişecek benzersiz metin"),
      new_str: z.string().describe("Yeni metin"),
    }),
    execute: async ({ path, old_str, new_str }) => editFile(path, old_str, new_str),
  });
  const searchFilesTool = new FunctionTool({
    name: "search_files",
    description: "Dosya içeriklerinde regex araması yapar (grep benzeri).",
    parameters: z.object({
      pattern: z.string().describe("Regex deseni"),
      directory: z.string().optional().describe("Dizin (varsayılan .)"),
    }),
    execute: async ({ pattern, directory }) => searchFiles(pattern, directory ?? "."),
  });
  const runCommandTool = new FunctionTool({
    name: "run_command",
    description: "Shell komutu çalıştırır (test/build/çalıştırma).",
    parameters: z.object({ command: z.string().describe("Komut") }),
    // toolContext.abortSignal: ADK'nın iptal sinyali. ESC'ye basıldığında
    // çalışan komut da durur (süreç sonuna kadar beklemez).
    execute: async ({ command }, toolContext) =>
      runCommand(command, 120, toolContext?.abortSignal),
  });
  const getApiKeyTool = new FunctionTool({
    name: "get_api_key",
    description:
      "BashCLI'nin kullandığı sağlayıcı API anahtarlarını okur. "
      + "provider verilmezse anahtarı olan tüm sağlayıcılar listelenir. "
      + "Anahtarları dosyaya yazma; yalnızca kullanacağın yerde kullan.",
    parameters: z.object({
      provider: z.string().optional().describe(
        "Sağlayıcı anahtarı (örn. openrouter, zenmux). Boş bırakılırsa tümü.",
      ),
    }),
    execute: async ({ provider }) => providerKeyReport(provider),
  });
  return {
    listFilesTool, readFileTool, writeFileTool,
    editFileTool, searchFilesTool, runCommandTool, getApiKeyTool,
  };
}

/**
 * Onay kapısı: ADK'nın `beforeToolCallback` mekanizması.
 *
 * Callback bir yanıt döndürürse araç **çalıştırılmaz** ve dönen yanıt tool
 * cevabı olur. Böylece onay kuralı araç gövdelerinde değil, tek yerde durur:
 * yeni bir araç eklemek için gövdeye onay kodu yazmak gerekmez, sadece
 * `APPROVAL_REQUIRED_TOOLS` listesine adı eklenir.
 */
async function approvalGate(params: {
  tool: { name: string };
  args: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: unknown;
}): Promise<Record<string, unknown> | undefined> {
  const { tool, args } = params;
  if (!APPROVAL_REQUIRED_TOOLS.has(tool.name)) return undefined;
  const ok = await requestApproval(tool.name, describeToolCall(tool.name, args));
  if (ok) return undefined;
  // Reddedildi: araç çalışmaz, modele neden çalışmadığı bildirilir.
  return { result: deniedMessage(tool.name) };
}

/** Env'deki sağlayıcı/model + mod ile yeni bir LlmAgent kurar. */
export function createAgent(mode?: AgentMode): LlmAgent {
  const m: AgentMode = mode ?? DEFAULT_MODE;
  const t = buildTools();
  const tools = m === "plan"
    ? [t.listFilesTool, t.readFileTool, t.searchFilesTool, t.getApiKeyTool]
    : [t.listFilesTool, t.readFileTool, t.writeFileTool,
       t.editFileTool, t.searchFilesTool, t.runCommandTool, t.getApiKeyTool];
  const kwargs = currentLlmKwargs();
  const numRetries = parseInt(process.env.AGENT_NUM_RETRIES ?? "5", 10);
  // Base URL yoksa istek HİÇBİR yere gönderilmemeli. Önceden ZenMux adresi
  // varsayılıyordu; bu durumda Gemini/Anthropic anahtarı ZenMux'e gönderilip
  // kullanıcıya anlamsız bir "HTTP 403" dönüyordu. Artık açık hata verilir.
  if (!kwargs.apiBase) {
    throw new Error(
      "Sağlayıcı için temel URL (base URL) tanımlı değil. "
      + "/provider ile sağlayıcıyı yeniden seçin.",
    );
  }
  return new LlmAgent({
    name: "bashcli",
    model: new OpenAiCompatibleLlm({
      model: kwargs.model,
      apiBase: kwargs.apiBase,
      apiKey: kwargs.apiKey,
      maxRetries: Number.isNaN(numRetries) ? 5 : numRetries,
    }),
    // Talimat bir fonksiyon olarak verilir: ADK her istekte çözer. Böylece
    // .bashcli/rules dosyaları oturum ortasında düzenlense bile bir sonraki
    // turda yeni kurallar geçerli olur (yeniden başlatma gerekmez).
    instruction: () => CODING_INSTRUCTION + MODE_INSTRUCTION[m] + projectRulesSection(),
    tools,
    // Onay kapısı: onay isteyen araçlar çalıştırılmadan önce kullanıcıya
    // sorulur. Araç gövdeleri onay kodu içermez (tek kapı).
    beforeToolCallback: approvalGate,
  });
}

