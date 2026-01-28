import type { DialogHelper } from "zotero-plugin-toolkit";

type ProgressState = {
  total: number;
  done: number;
  status: string;
  logs: string[];
};

const state: ProgressState = {
  total: 0,
  done: 0,
  status: "等待中",
  logs: [],
};

let dialogHelper: DialogHelper | null = null;
let dialogWindow: Window | null = null;

function formatProgressText() {
  if (state.total <= 0) return "0/0 (0%)";
  const percent = Math.round((state.done / state.total) * 100);
  return `${state.done}/${state.total} (${percent}%)`;
}

function updateDialogUI() {
  if (!dialogWindow || dialogWindow.closed) return;
  const doc = dialogWindow.document;
  const statusEl = doc.getElementById("zr-translation-status");
  if (statusEl) statusEl.textContent = state.status;

  const progressEl = doc.getElementById(
    "zr-translation-progress",
  ) as HTMLProgressElement | null;
  if (progressEl) {
    progressEl.max = state.total > 0 ? state.total : 1;
    progressEl.value = Math.min(state.done, progressEl.max);
  }
  const progressText = doc.getElementById("zr-translation-progress-text");
  if (progressText) progressText.textContent = formatProgressText();

  const logEl = doc.getElementById("zr-translation-log");
  if (logEl) {
    logEl.textContent = state.logs.join("\n");
  }
}

export function startTranslationProgress(total: number) {
  state.total = total;
  state.done = 0;
  state.status = total > 0 ? "翻译中" : "无可翻译段落";
  state.logs = [];
  updateDialogUI();
}

export function setTranslationStatus(status: string) {
  state.status = status;
  updateDialogUI();
}

export function incrementTranslationProgress(step = 1) {
  state.done = Math.min(state.total, state.done + step);
  updateDialogUI();
}

export function addTranslationLog(message: string) {
  state.logs.push(message);
  if (state.logs.length > 200) {
    state.logs.shift();
  }
  updateDialogUI();
}

export function finishTranslationProgress(status: string) {
  state.status = status;
  updateDialogUI();
}

export function openTranslationProgressDialog() {
  if (dialogWindow && !dialogWindow.closed) {
    dialogWindow.focus();
    updateDialogUI();
    return;
  }

  const dialogData: { [key: string]: any } = {
    loadCallback: () => {
      dialogWindow = dialogHelper?.window ?? null;
      updateDialogUI();
    },
    unloadCallback: () => {
      dialogWindow = null;
      dialogHelper = null;
    },
  };

  dialogHelper = new ztoolkit.Dialog(6, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      properties: { innerHTML: "<h2>翻译进度</h2>" },
    })
    .addCell(1, 0, {
      tag: "div",
      namespace: "html",
      attributes: { id: "zr-translation-status" },
      properties: { textContent: state.status },
      styles: { marginBottom: "6px" },
    })
    .addCell(2, 0, {
      tag: "div",
      namespace: "html",
      attributes: { id: "zr-translation-progress-row" },
      properties: {
        innerHTML:
          '<progress id="zr-translation-progress" value="0" max="1" style="width: 100%;"></progress><div id="zr-translation-progress-text" style="margin-top: 4px;">0/0 (0%)</div>',
      },
      styles: { marginBottom: "8px" },
    })
    .addCell(3, 0, {
      tag: "div",
      namespace: "html",
      properties: { innerHTML: "<strong>日志</strong>" },
      styles: { margin: "6px 0 4px 0" },
    })
    .addCell(4, 0, {
      tag: "pre",
      namespace: "html",
      attributes: { id: "zr-translation-log" },
      styles: {
        maxHeight: "240px",
        overflow: "auto",
        background: "#f7f7f7",
        padding: "6px",
        border: "1px solid #ddd",
        whiteSpace: "pre-wrap",
      },
    })
    .addButton("关闭", "close")
    .setDialogData(dialogData);

  dialogHelper.open("翻译进度", {
    width: 520,
    height: 420,
    resizable: true,
    noDialogMode: true,
  });
}
