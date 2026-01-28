import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

type TranslatePrompt = {
  id: string;
  name: string;
  content: string;
};

const DEFAULT_TRANSLATION_PROMPTS: TranslatePrompt[] = [
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

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function parsePrompts(raw: string): TranslatePrompt[] {
  const list = parseJsonArray<TranslatePrompt>(raw, DEFAULT_TRANSLATION_PROMPTS);
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

function resolveSelectedPromptId(
  prompts: TranslatePrompt[],
  current: string,
): string {
  if (current && prompts.some((p) => p.id === current)) return current;
  return prompts.length > 0 ? prompts[0].id : "";
}

function renderPromptSelect(
  select: HTMLSelectElement,
  preview: HTMLTextAreaElement | null,
  prompts: TranslatePrompt[],
  selectedId: string,
) {
  select.textContent = "";
  const doc = select.ownerDocument;
  if (!doc) return;
  for (const prompt of prompts) {
    const option = doc.createElement("option");
    option.value = prompt.id;
    option.textContent = `${prompt.name} (${prompt.id})`;
    select.appendChild(option);
  }
  select.value = selectedId;
  if (preview) {
    const match = prompts.find((p) => p.id === selectedId);
    preview.value = match ? match.content : "";
  }
}

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  bindPrefEvents(_window);
}

function bindPrefEvents(window: Window) {
  const doc = window.document;
  const showAlert = (msg: string) => window.alert(msg);

  const htmlBlocklist = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-html-blocklist`,
  ) as HTMLTextAreaElement | null;
  if (htmlBlocklist) {
    const prefValue = getPref("htmlBlocklist");
    if (typeof prefValue === "string") {
      htmlBlocklist.value = prefValue;
    }
    htmlBlocklist.addEventListener("change", (e: Event) => {
      setPref("htmlBlocklist", (e.target as HTMLTextAreaElement).value);
    });
  }

  const apiBaseInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-api-base`,
  ) as HTMLInputElement | null;
  if (apiBaseInput) {
    const prefValue = getPref("translationApiBaseUrl");
    if (typeof prefValue === "string") {
      apiBaseInput.value = prefValue;
    }
    apiBaseInput.addEventListener("change", (e: Event) => {
      setPref("translationApiBaseUrl", (e.target as HTMLInputElement).value);
    });
  }

  const modelInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-model`,
  ) as HTMLInputElement | null;
  if (modelInput) {
    const prefValue = getPref("translationModel");
    if (typeof prefValue === "string") {
      modelInput.value = prefValue;
    }
    modelInput.addEventListener("change", (e: Event) => {
      setPref("translationModel", (e.target as HTMLInputElement).value);
    });
  }

  const rpmInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-rpm`,
  ) as HTMLInputElement | null;
  if (rpmInput) {
    const prefValue = getPref("translationRPM");
    if (typeof prefValue === "number" || typeof prefValue === "string") {
      rpmInput.value = String(prefValue);
    }
    rpmInput.addEventListener("change", (e: Event) => {
      const value = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(value) || value <= 0) {
        showAlert("RPM 需要是正数。");
        return;
      }
      setPref("translationRPM", Math.floor(value));
    });
  }

  const apiKeyInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-api-key`,
  ) as HTMLInputElement | null;
  if (apiKeyInput) {
    const prefValue = getPref("translationApiKey");
    if (typeof prefValue === "string") {
      apiKeyInput.value = prefValue;
    }
    apiKeyInput.addEventListener("change", (e: Event) => {
      setPref("translationApiKey", (e.target as HTMLInputElement).value);
    });
  }

  const promptSelect = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-prompt-select`,
  ) as HTMLSelectElement | null;
  const promptPreview = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-prompt-preview`,
  ) as HTMLTextAreaElement | null;
  const promptName = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-prompt-name`,
  ) as HTMLInputElement | null;
  const promptContent = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-prompt-content`,
  ) as HTMLTextAreaElement | null;
  const promptAdd = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-prompt-add`,
  ) as HTMLButtonElement | null;

  let promptsCache: TranslatePrompt[] = [];
  if (promptSelect) {
    promptsCache = parsePrompts(getPref("translationPrompts") || "");
    setPref("translationPrompts", JSON.stringify(promptsCache));
    let selectedId = String(getPref("translationPromptSelection") || "");
    if (!selectedId) {
      const legacy = Zotero.Prefs.get(
        `${config.prefsPrefix}.translationPromptSelections`,
        true,
      ) as string;
      const legacySelections = parseSelections(legacy || "");
      selectedId = legacySelections[0] || "";
    }
    selectedId = resolveSelectedPromptId(promptsCache, selectedId);
    setPref("translationPromptSelection", selectedId);
    renderPromptSelect(promptSelect, promptPreview, promptsCache, selectedId);
    promptSelect.addEventListener("change", () => {
      const newId = promptSelect.value;
      setPref("translationPromptSelection", newId);
      renderPromptSelect(promptSelect, promptPreview, promptsCache, newId);
    });
  }

  if (promptAdd && promptSelect && promptName && promptContent) {
    promptAdd.addEventListener("click", () => {
      const name = promptName.value.trim();
      const content = promptContent.value.trim();
      if (!name || !content) {
        showAlert("名称和内容不能为空。");
        return;
      }

      const prompts = parsePrompts(getPref("translationPrompts") || "");
      const id = `custom-${Date.now().toString(36)}`;
      prompts.push({ id, name, content });
      promptsCache = prompts;
      setPref("translationPrompts", JSON.stringify(prompts));
      setPref("translationPromptSelection", id);
      renderPromptSelect(promptSelect, promptPreview, prompts, id);
      promptName.value = "";
      promptContent.value = "";
    });
  }
}
