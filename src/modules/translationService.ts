import { getPref } from "../utils/prefs";

type TranslatePrompt = {
  id: string;
  name: string;
  content: string;
};

type TranslateOptions = {
  promptIds?: string[];
};

const DEFAULT_PROMPTS: TranslatePrompt[] = [
  {
    id: "translate-zh",
    name: "翻译为中文",
    content: "请将以下内容翻译为中文，保持术语准确。",
  },
  {
    id: "summary-zh",
    name: "中文要点摘要",
    content: "请用中文给出要点列表（不超过5条）。",
  },
];

const recentRequests: number[] = [];

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

async function sleep(ms: number) {
  if (Zotero?.Promise?.delay) {
    await Zotero.Promise.delay(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(rpm: number) {
  if (!Number.isFinite(rpm) || rpm <= 0) return;
  const now = Date.now();
  const windowMs = 60_000;
  while (recentRequests.length > 0 && now - recentRequests[0] >= windowMs) {
    recentRequests.shift();
  }
  if (recentRequests.length >= rpm) {
    const waitMs = windowMs - (now - recentRequests[0]);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
  recentRequests.push(Date.now());
}

function parseJsonObject<T>(raw: string): T {
  if (!raw) {
    throw new Error("翻译接口返回为空。");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("翻译接口返回 JSON 解析失败。");
  }
}

function parsePrompts(raw: string): TranslatePrompt[] {
  const list = parseJsonArray<TranslatePrompt>(raw, DEFAULT_PROMPTS);
  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String((item as TranslatePrompt).id ?? ""),
      name: String((item as TranslatePrompt).name ?? ""),
      content: String((item as TranslatePrompt).content ?? ""),
    }))
    .filter((item) => item.id && item.name && item.content);
}

function parseSelections(raw: string): string[] {
  const list = parseJsonArray<string>(raw, []);
  return list.map((item) => String(item)).filter((item) => item.length > 0);
}

function buildSystemPrompt(prompts: TranslatePrompt[]): string {
  return prompts
    .map((prompt) => `【${prompt.name}】\n${prompt.content}`)
    .join("\n\n");
}

function getTranslationConfig() {
  const baseUrlRaw =
    (getPref("translationApiBaseUrl") as string) ||
    "https://api.openai.com/v1";
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  const apiKey = (getPref("translationApiKey") as string) || "";
  const model = (getPref("translationModel") as string) || "gpt-4o-mini";
  const rpmRaw = getPref("translationRPM");
  const rpm =
    typeof rpmRaw === "number"
      ? rpmRaw
      : typeof rpmRaw === "string"
        ? Number(rpmRaw)
        : 0;
  if (!apiKey) {
    throw new Error("translationApiKey 未配置。");
  }
  return { baseUrl, apiKey, model, rpm };
}

function getSelectedPrompts(promptIds?: string[]): TranslatePrompt[] {
  const prompts = parsePrompts((getPref("translationPrompts") as string) || "");
  const selections =
    promptIds && promptIds.length > 0
      ? promptIds
      : parseSelections((getPref("translationPromptSelections") as string) || "");
  if (selections.length === 0) {
    return prompts.length > 0 ? [prompts[0]] : DEFAULT_PROMPTS.slice(0, 1);
  }
  const selectionSet = new Set(selections);
  const selected = prompts.filter((prompt) => selectionSet.has(prompt.id));
  return selected.length > 0 ? selected : DEFAULT_PROMPTS.slice(0, 1);
}

function extractResponseContent(data: any): string {
  const content =
    data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
  if (!content || typeof content !== "string") {
    const errorMessage = data?.error?.message;
    if (errorMessage) {
      throw new Error(String(errorMessage));
    }
    throw new Error("翻译接口返回内容为空。");
  }
  return content;
}

function isRateLimitError(
  status: number,
  data: any,
  responseText: string,
): boolean {
  if (status === 429) return true;
  const message =
    (data?.error?.message as string) ||
    (typeof responseText === "string" ? responseText : "");
  if (!message) return false;
  return /rate\s*limit|too\s+many\s+requests|rpm/i.test(message);
}

export async function translateText(
  text: string,
  options: TranslateOptions = {},
): Promise<string> {
  const { baseUrl, apiKey, model, rpm } = getTranslationConfig();
  const prompts = getSelectedPrompts(options.promptIds);
  const systemPrompt = buildSystemPrompt(prompts);
  const messages = systemPrompt
    ? [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ]
    : [{ role: "user", content: text }];

  const url = `${baseUrl}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages,
    temperature: 0.2,
  });

  while (true) {
    await waitForRateLimit(rpm);
    const xhr = await Zotero.HTTP.request("POST", url, {
      body,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      successCodes: false,
    });

    const responseText = xhr.responseText || "";
    let data: any = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      if (!data) {
        throw new Error("翻译接口返回为空。");
      }
      return extractResponseContent(data);
    }

    if (isRateLimitError(xhr.status, data, responseText)) {
      await sleep(60_000);
      continue;
    }

    const errorMessage =
      data?.error?.message ||
      `HTTP ${xhr.status}: ${xhr.statusText || "请求失败"}`;
    throw new Error(String(errorMessage));
  }
}
