import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

type TranslatePrompt = {
  id: string;
  name: string;
  content: string;
};

type TranslateProvider = {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  rpm: number;
  temperature?: number;
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
  const list = parseJsonArray<TranslatePrompt>(
    raw,
    DEFAULT_TRANSLATION_PROMPTS,
  );
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

function parseParallelProviders(raw: string): string[] {
  const list = parseJsonArray<string>(raw, []);
  return list.map((item) => String(item)).filter((item) => item.length > 0);
}

function parseProviders(raw: string): TranslateProvider[] {
  const list = parseJsonArray<TranslateProvider>(raw, []);
  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const provider = item as TranslateProvider;
      return {
        id: String(provider.id ?? "").trim(),
        name: String(provider.name ?? "").trim(),
        apiBaseUrl: String(provider.apiBaseUrl ?? "").trim(),
        apiKey: String(provider.apiKey ?? "").trim(),
        model: String(provider.model ?? "").trim(),
        rpm: Number(provider.rpm ?? 0),
        temperature:
          typeof provider.temperature === "number"
            ? provider.temperature
            : Number(provider.temperature ?? 0),
      };
    })
    .filter((provider) => provider.id && provider.name && provider.apiBaseUrl);
}

function resolveSelectedProviderId(
  providers: TranslateProvider[],
  current: string,
): string {
  if (current && providers.some((p) => p.id === current)) return current;
  return providers.length > 0 ? providers[0].id : "";
}

function renderProviderSelect(
  select: HTMLSelectElement,
  providers: TranslateProvider[],
  selectedId: string,
) {
  select.textContent = "";
  const doc = select.ownerDocument;
  if (!doc) return;
  for (const provider of providers) {
    const option = doc.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    select.appendChild(option);
  }
  select.value = selectedId;
}

function renderParallelProvidersList(
  container: HTMLElement,
  providers: TranslateProvider[],
  selectedIds: string[],
  onChange: (next: string[]) => void,
) {
  container.textContent = "";
  const doc = container.ownerDocument;
  if (!doc) return;
  const list = doc.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "4px";
  for (const provider of providers) {
    const row = doc.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = provider.id;
    checkbox.checked = selectedIds.includes(provider.id);
    checkbox.addEventListener("change", () => {
      const next = Array.from(list.querySelectorAll("input[type=checkbox]"))
        .filter((input) => (input as HTMLInputElement).checked)
        .map((input) => (input as HTMLInputElement).value);
      onChange(next);
    });
    const name = doc.createElement("span");
    name.textContent = provider.name;
    row.appendChild(checkbox);
    row.appendChild(name);
    list.appendChild(row);
  }
  container.appendChild(list);
}

function setParallelProvidersVisible(
  labelContainer: HTMLElement | null,
  listContainer: HTMLElement | null,
  visible: boolean,
) {
  const display = visible ? "" : "none";
  if (labelContainer) labelContainer.style.display = display;
  if (listContainer) listContainer.style.display = display;
}

function fillProviderFields(
  provider: TranslateProvider | null,
  nameInput: HTMLInputElement,
  apiBaseInput: HTMLInputElement,
  apiKeyInput: HTMLInputElement,
  modelInput: HTMLInputElement,
  temperatureInput: HTMLInputElement,
  rpmInput: HTMLInputElement,
) {
  if (!provider) {
    nameInput.value = "";
    apiBaseInput.value = "";
    apiKeyInput.value = "";
    modelInput.value = "";
    temperatureInput.value = "";
    rpmInput.value = "";
    return;
  }
  nameInput.value = provider.name;
  apiBaseInput.value = provider.apiBaseUrl;
  apiKeyInput.value = provider.apiKey;
  modelInput.value = provider.model;
  if (typeof provider.temperature === "number") {
    temperatureInput.value = String(provider.temperature);
  } else {
    temperatureInput.value = "";
  }
  rpmInput.value = provider.rpm ? String(provider.rpm) : "";
}

function parseRpm(input: string, showAlert: (msg: string) => void): number {
  if (!input) return 0;
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    showAlert("RPM 需要是正数。");
    throw new Error("Invalid RPM");
  }
  return Math.floor(value);
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

  const providerSelect = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-provider-select`,
  ) as HTMLSelectElement | null;
  const providerName = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-provider-name`,
  ) as HTMLInputElement | null;
  const apiBaseInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-api-base`,
  ) as HTMLInputElement | null;
  const apiKeyInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-api-key`,
  ) as HTMLInputElement | null;
  const modelInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-model`,
  ) as HTMLInputElement | null;
  const temperatureInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-temperature`,
  ) as HTMLInputElement | null;
  const rpmInput = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-rpm`,
  ) as HTMLInputElement | null;
  const providerNew = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-provider-new`,
  ) as HTMLButtonElement | null;
  const providerSave = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-provider-save`,
  ) as HTMLButtonElement | null;
  const providerDelete = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-provider-delete`,
  ) as HTMLButtonElement | null;
  const parallelToggle = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-parallel-enabled`,
  ) as HTMLInputElement | null;
  const parallelReassignToggle = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-parallel-reassign`,
  ) as HTMLInputElement | null;
  const parallelProvidersContainer = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-translate-parallel-providers`,
  ) as HTMLElement | null;
  const parallelProvidersLabel =
    parallelProvidersContainer?.previousElementSibling || null;

  let providersCache: TranslateProvider[] = [];
  let selectedProviderId = "";
  let selectedParallelProviders: string[] = [];
  if (
    providerSelect &&
    providerName &&
    apiBaseInput &&
    apiKeyInput &&
    modelInput &&
    temperatureInput &&
    rpmInput
  ) {
    providersCache = parseProviders(getPref("translationProviders") || "");
    if (providersCache.length === 0) {
      const baseUrl =
        (getPref("translationApiBaseUrl") as string) ||
        "https://api.openai.com/v1";
      const apiKey = (getPref("translationApiKey") as string) || "";
      const model = (getPref("translationModel") as string) || "gpt-4o-mini";
      const rpmRaw = getPref("translationRPM");
      const rpm =
        typeof rpmRaw === "number"
          ? rpmRaw
          : typeof rpmRaw === "string"
            ? Number(rpmRaw)
            : 0;
      providersCache = [
        {
          id: "default",
          name: "Default",
          apiBaseUrl: baseUrl,
          apiKey,
          model,
          rpm: Number.isFinite(rpm) ? rpm : 0,
          temperature: 0.2,
        },
      ];
      setPref("translationProviders", JSON.stringify(providersCache));
      setPref("translationProviderSelection", "default");
    }
    selectedProviderId = String(getPref("translationProviderSelection") || "");
    selectedProviderId = resolveSelectedProviderId(
      providersCache,
      selectedProviderId,
    );
    setPref("translationProviderSelection", selectedProviderId);
    renderProviderSelect(providerSelect, providersCache, selectedProviderId);
    selectedParallelProviders = parseParallelProviders(
      getPref("translationParallelProviders") || "",
    );
    if (parallelProvidersContainer) {
      renderParallelProvidersList(
        parallelProvidersContainer,
        providersCache,
        selectedParallelProviders,
        (next) => {
          selectedParallelProviders = next;
          setPref("translationParallelProviders", JSON.stringify(next));
        },
      );
    }
    const selected =
      providersCache.find((p) => p.id === selectedProviderId) || null;
    fillProviderFields(
      selected,
      providerName,
      apiBaseInput,
      apiKeyInput,
      modelInput,
      temperatureInput,
      rpmInput,
    );

    providerSelect.addEventListener("change", () => {
      selectedProviderId = providerSelect.value;
      setPref("translationProviderSelection", selectedProviderId);
      const match =
        providersCache.find((p) => p.id === selectedProviderId) || null;
      fillProviderFields(
        match,
        providerName,
        apiBaseInput,
        apiKeyInput,
        modelInput,
        temperatureInput,
        rpmInput,
      );
    });
  }

  if (parallelToggle) {
    const prefValue = getPref("translationParallelEnabled");
    parallelToggle.checked = Boolean(prefValue);
    setParallelProvidersVisible(
      parallelProvidersLabel as HTMLElement | null,
      parallelProvidersContainer,
      parallelToggle.checked,
    );
    parallelToggle.addEventListener("change", () => {
      setPref("translationParallelEnabled", parallelToggle.checked);
      setParallelProvidersVisible(
        parallelProvidersLabel as HTMLElement | null,
        parallelProvidersContainer,
        parallelToggle.checked,
      );
    });
  }

  if (parallelReassignToggle) {
    const prefValue = getPref("translationParallelReassignOnFailure");
    parallelReassignToggle.checked = Boolean(prefValue);
    parallelReassignToggle.addEventListener("change", () => {
      setPref(
        "translationParallelReassignOnFailure",
        parallelReassignToggle.checked,
      );
    });
  }

  if (
    providerNew &&
    providerName &&
    apiBaseInput &&
    apiKeyInput &&
    modelInput &&
    temperatureInput &&
    rpmInput &&
    providerSelect
  ) {
    providerNew.addEventListener("click", () => {
      selectedProviderId = "";
      providerSelect.selectedIndex = -1;
      fillProviderFields(
        null,
        providerName,
        apiBaseInput,
        apiKeyInput,
        modelInput,
        temperatureInput,
        rpmInput,
      );
    });
  }

  if (
    providerSave &&
    providerName &&
    apiBaseInput &&
    apiKeyInput &&
    modelInput &&
    temperatureInput &&
    rpmInput &&
    providerSelect
  ) {
    providerSave.addEventListener("click", () => {
      const name = providerName.value.trim();
      const apiBaseUrl = apiBaseInput.value.trim();
      const apiKey = apiKeyInput.value.trim();
      const model = modelInput.value.trim();
      const temperature = Number(temperatureInput.value.trim());
      if (!name || !apiBaseUrl) {
        showAlert("名称和 API Base URL 不能为空。");
        return;
      }
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        showAlert("温度需要在 0 到 2 之间。");
        return;
      }
      let rpm = 0;
      try {
        rpm = parseRpm(rpmInput.value.trim(), showAlert);
      } catch {
        return;
      }

      const index = providersCache.findIndex(
        (p) => p.id === selectedProviderId,
      );
      if (index >= 0) {
        providersCache[index] = {
          ...providersCache[index],
          name,
          apiBaseUrl,
          apiKey,
          model,
          rpm,
          temperature,
        };
      } else {
        const id = `provider-${Date.now().toString(36)}`;
        providersCache.push({
          id,
          name,
          apiBaseUrl,
          apiKey,
          model,
          rpm,
          temperature,
        });
        selectedProviderId = id;
      }

      setPref("translationProviders", JSON.stringify(providersCache));
      setPref("translationProviderSelection", selectedProviderId);
      renderProviderSelect(providerSelect, providersCache, selectedProviderId);
      if (parallelProvidersContainer) {
        selectedParallelProviders = selectedParallelProviders.filter((id) =>
          providersCache.some((provider) => provider.id === id),
        );
        renderParallelProvidersList(
          parallelProvidersContainer,
          providersCache,
          selectedParallelProviders,
          (next) => {
            selectedParallelProviders = next;
            setPref("translationParallelProviders", JSON.stringify(next));
          },
        );
      }
    });
  }

  if (providerDelete && providerSelect) {
    providerDelete.addEventListener("click", () => {
      if (!selectedProviderId) return;
      const nextProviders = providersCache.filter(
        (p) => p.id !== selectedProviderId,
      );
      providersCache = nextProviders;
      selectedProviderId = nextProviders.length > 0 ? nextProviders[0].id : "";
      setPref("translationProviders", JSON.stringify(providersCache));
      setPref("translationProviderSelection", selectedProviderId);
      renderProviderSelect(providerSelect, providersCache, selectedProviderId);
      if (parallelProvidersContainer) {
        selectedParallelProviders = selectedParallelProviders.filter((id) =>
          providersCache.some((provider) => provider.id === id),
        );
        renderParallelProvidersList(
          parallelProvidersContainer,
          providersCache,
          selectedParallelProviders,
          (next) => {
            selectedParallelProviders = next;
            setPref("translationParallelProviders", JSON.stringify(next));
          },
        );
      }
      if (
        providerName &&
        apiBaseInput &&
        apiKeyInput &&
        modelInput &&
        temperatureInput &&
        rpmInput
      ) {
        const selected =
          providersCache.find((p) => p.id === selectedProviderId) || null;
        fillProviderFields(
          selected,
          providerName,
          apiBaseInput,
          apiKeyInput,
          modelInput,
          temperatureInput,
          rpmInput,
        );
      }
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
