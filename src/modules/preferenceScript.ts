import { config } from "../../package.json";
import { getString } from "../utils/locale";
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

function renderPromptList(
  container: HTMLElement,
  prompts: TranslatePrompt[],
  selections: Set<string>,
) {
  container.textContent = "";
  for (const prompt of prompts) {
    const row = container.ownerDocument.createElement("div");
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.margin = "6px 0";

    const labelRow = container.ownerDocument.createElement("div");
    labelRow.style.display = "flex";
    labelRow.style.alignItems = "center";
    labelRow.style.gap = "6px";

    const checkbox = container.ownerDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selections.has(prompt.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selections.add(prompt.id);
      } else {
        selections.delete(prompt.id);
      }
      setPref(
        "translationPromptSelections",
        JSON.stringify(Array.from(selections)),
      );
    });

    const name = container.ownerDocument.createElement("span");
    name.textContent = prompt.name;
    name.style.fontWeight = "600";

    const id = container.ownerDocument.createElement("span");
    id.textContent = `(${prompt.id})`;
    id.style.color = "#666";

    const content = container.ownerDocument.createElement("pre");
    content.textContent = prompt.content;
    content.style.margin = "4px 0 0 22px";
    content.style.whiteSpace = "pre-wrap";
    content.style.fontSize = "12px";
    content.style.color = "#444";

    labelRow.appendChild(checkbox);
    labelRow.appendChild(name);
    labelRow.appendChild(id);
    row.appendChild(labelRow);
    row.appendChild(content);
    container.appendChild(row);
  }
}

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [
        {
          dataKey: "title",
          label: getString("prefs-table-title"),
          fixedWidth: true,
          width: 100,
        },
        {
          dataKey: "detail",
          label: getString("prefs-table-detail"),
        },
      ],
      rows: [
        {
          title: "Orange",
          detail: "It's juicy",
        },
        {
          title: "Banana",
          detail: "It's sweet",
        },
        {
          title: "Apple",
          detail: "I mean the fruit APPLE",
        },
      ],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  // You can initialize some UI elements on prefs window
  // with addon.data.prefs.window.document
  // Or bind some events to the elements
  const renderLock = ztoolkit.getGlobal("Zotero").Promise.defer();
  if (addon.data.prefs?.window == undefined) return;
  const tableHelper = new ztoolkit.VirtualizedTable(addon.data.prefs?.window)
    .setContainerId(`${config.addonRef}-table-container`)
    .setProp({
      id: `${config.addonRef}-prefs-table`,
      // Do not use setLocale, as it modifies the Zotero.Intl.strings
      // Set locales directly to columns
      columns: addon.data.prefs?.columns,
      showHeader: true,
      multiSelect: true,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => addon.data.prefs?.rows.length || 0)
    .setProp(
      "getRowData",
      (index) =>
        addon.data.prefs?.rows[index] || {
          title: "no data",
          detail: "no data",
        },
    )
    // Show a progress window when selection changes
    .setProp("onSelectionChange", (selection) => {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({
          text: `Selected line: ${addon.data.prefs?.rows
            .filter((v, i) => selection.isSelected(i))
            .map((row) => row.title)
            .join(",")}`,
          progress: 100,
        })
        .show();
    })
    // When pressing delete, delete selected line and refresh table.
    // Returning false to prevent default event.
    .setProp("onKeyDown", (event: KeyboardEvent) => {
      if (event.key == "Delete" || (Zotero.isMac && event.key == "Backspace")) {
        addon.data.prefs!.rows =
          addon.data.prefs?.rows.filter(
            (v, i) => !tableHelper.treeInstance.selection.isSelected(i),
          ) || [];
        tableHelper.render();
        return false;
      }
      return true;
    })
    // For find-as-you-type
    .setProp(
      "getRowString",
      (index) => addon.data.prefs?.rows[index].title || "",
    )
    // Render the table.
    .render(-1, () => {
      renderLock.resolve();
    });
  await renderLock.promise;
  ztoolkit.log("Preference table rendered!");
}

function bindPrefEvents() {
  addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-enable`,
    )
    ?.addEventListener("command", (e: Event) => {
      ztoolkit.log(e);
      addon.data.prefs!.window.alert(
        `Successfully changed to ${(e.target as XUL.Checkbox).checked}!`,
      );
    });

  addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-input`,
    )
    ?.addEventListener("change", (e: Event) => {
      ztoolkit.log(e);
      addon.data.prefs!.window.alert(
        `Successfully changed to ${(e.target as HTMLInputElement).value}!`,
      );
    });

  const htmlBlocklist = addon.data
    .prefs!.window.document?.querySelector(
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

  const apiBaseInput = addon.data
    .prefs!.window.document?.querySelector(
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

  const modelInput = addon.data
    .prefs!.window.document?.querySelector(
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

  const rpmInput = addon.data
    .prefs!.window.document?.querySelector(
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
        addon.data.prefs!.window.alert("RPM 需要是正数。");
        return;
      }
      setPref("translationRPM", Math.floor(value));
    });
  }

  const apiKeyInput = addon.data
    .prefs!.window.document?.querySelector(
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

  const promptList = addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-translate-prompts`,
    ) as HTMLDivElement | null;
  const promptName = addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-translate-prompt-name`,
    ) as HTMLInputElement | null;
  const promptContent = addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-translate-prompt-content`,
    ) as HTMLTextAreaElement | null;
  const promptAdd = addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-translate-prompt-add`,
    ) as HTMLButtonElement | null;

  if (promptList) {
    const prompts = parsePrompts(getPref("translationPrompts") || "");
    const selections = new Set(
      parseSelections(getPref("translationPromptSelections") || ""),
    );
    setPref("translationPrompts", JSON.stringify(prompts));
    setPref(
      "translationPromptSelections",
      JSON.stringify(Array.from(selections)),
    );
    renderPromptList(promptList, prompts, selections);
  }

  if (promptAdd && promptList && promptName && promptContent) {
    promptAdd.addEventListener("click", () => {
      const name = promptName.value.trim();
      const content = promptContent.value.trim();
      if (!name || !content) {
        addon.data.prefs!.window.alert("名称和内容不能为空。");
        return;
      }

      const prompts = parsePrompts(getPref("translationPrompts") || "");
      const selections = new Set(
        parseSelections(getPref("translationPromptSelections") || ""),
      );
      const id = `custom-${Date.now().toString(36)}`;
      prompts.push({ id, name, content });
      setPref("translationPrompts", JSON.stringify(prompts));
      renderPromptList(promptList, prompts, selections);
      promptName.value = "";
      promptContent.value = "";
    });
  }
}
