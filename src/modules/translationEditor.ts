const TRANSLATION_CLASS = "zr-translation-block";
const TRANSLATION_ATTR = "data-zotero-translation";

type ReaderSelectionPopupEvent =
  _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">;

let selectionHandler:
  | ((event: ReaderSelectionPopupEvent) => void | Promise<void>)
  | null = null;
let contextMenuHandler:
  | ((
      event:
        | _ZoteroTypes.Reader.EventParams<"createViewContextMenu">
        | _ZoteroTypes.Reader.EventParams<"createSelectorContextMenu">,
    ) => void | Promise<void>)
  | null = null;
let dblClickHandler:
  | ((event: _ZoteroTypes.Reader.EventParams<"renderToolbar">) => void)
  | null = null;
const boundDocs = new WeakSet<Document>();

function getSelectionElement(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
): Element | null {
  const win = reader._iframeWindow || doc.defaultView;
  const selection = win?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const node = selection.anchorNode || selection.focusNode;
  if (!node) return null;
  const element =
    node instanceof Element ? node : (node.parentElement as Element | null);
  if (!element) return null;
  return element.closest(
    `.${TRANSLATION_CLASS}, [${TRANSLATION_ATTR}="true"]`,
  );
}

function serializeDocument(doc: Document, originalHtml: string): string {
  const doctypeMatch = originalHtml.match(/<!doctype[^>]*>/i);
  const doctype = doctypeMatch ? `${doctypeMatch[0]}\n` : "";
  const html = doc.documentElement?.outerHTML || originalHtml;
  return `${doctype}${html}`;
}

async function updateTranslationText(
  reader: _ZoteroTypes.ReaderInstance,
  element: Element,
  newText: string,
) {
  const item = reader._item;
  const filePath = await item.getFilePathAsync();
  if (!filePath) {
    ztoolkit.getGlobal("alert")("未找到文件路径，无法保存修改。");
    return;
  }
  const doc = reader._iframeWindow?.document || element.ownerDocument;
  element.textContent = newText;
  element.setAttribute(TRANSLATION_ATTR, "true");
  const html = (await Zotero.File.getContentsAsync(filePath)) as string;
  const updated = serializeDocument(doc, html);
  await Zotero.File.putContentsAsync(filePath, updated, "utf-8");
}

function getDocTypeString(doc: Document): string {
  const doctype = doc.doctype;
  if (!doctype) return "";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId ? ` "${doctype.systemId}"` : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>\n`;
}

function saveDocument(reader: _ZoteroTypes.ReaderInstance, doc: Document) {
  const doctype = getDocTypeString(doc);
  const html = doc.documentElement?.outerHTML || "";
  return doctype + html;
}

function attachDblClickEditor(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
) {
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);
  doc.addEventListener(
    "dblclick",
    (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      const block = target.closest(`.${TRANSLATION_CLASS}`) as HTMLElement | null;
      if (!block) return;
      if (block.querySelector("textarea")) return;

      const original = block.textContent || "";
      block.textContent = "";
      const textarea = doc.createElement("textarea");
      textarea.value = original;
      textarea.style.width = "100%";
      textarea.style.minHeight = "120px";
      textarea.style.boxSizing = "border-box";
      textarea.style.fontSize = "0.95em";
      textarea.style.lineHeight = "1.5";
      block.appendChild(textarea);
      textarea.focus();
      textarea.select();

      let saved = false;
      const commit = async () => {
        if (saved) return;
        saved = true;
        const newText = textarea.value.trim() || original;
        block.textContent = newText;
        block.setAttribute(TRANSLATION_ATTR, "true");
        const item = reader._item;
        const filePath = await item.getFilePathAsync();
        if (!filePath) {
          ztoolkit.getGlobal("alert")("未找到文件路径，无法保存修改。");
          return;
        }
        const updated = saveDocument(reader, doc);
        await Zotero.File.putContentsAsync(filePath, updated, "utf-8");
      };

      textarea.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          block.textContent = original;
          saved = true;
        }
      });
      textarea.addEventListener("blur", () => {
        void commit();
      });
    },
    true,
  );
}

function openEditDialog(
  reader: _ZoteroTypes.ReaderInstance,
  element: Element,
) {
  const dialogData: { [key: string]: any } = {
    textValue: element.textContent || "",
  };
  const dialogHelper = new ztoolkit.Dialog(4, 1)
    .addCell(0, 0, {
      tag: "h2",
      properties: { innerHTML: "编辑翻译" },
    })
    .addCell(1, 0, {
      tag: "textarea",
      namespace: "html",
      attributes: {
        "data-bind": "textValue",
        "data-prop": "value",
        rows: "10",
      },
      styles: {
        width: "100%",
        minWidth: "420px",
      },
    })
    .addButton("保存", "save", {
      noClose: true,
      callback: async () => {
        const newText = String(dialogData.textValue || "").trim();
        if (!newText) {
          dialogHelper.window?.alert("内容不能为空。");
          return;
        }
        await updateTranslationText(reader, element, newText);
        dialogHelper.window?.close();
      },
    })
    .addButton("取消", "cancel")
    .setDialogData(dialogData);

  dialogHelper.open("编辑翻译", {
    width: 520,
    height: 360,
    resizable: true,
    noDialogMode: true,
  });
}

export function registerTranslationEditPopup() {
  if (selectionHandler) return;
  selectionHandler = (event: ReaderSelectionPopupEvent) => {
    const { reader, doc, append } = event;
    const element = getSelectionElement(reader, doc);
    if (!element) return;
    const button = doc.createElement("button");
    button.textContent = "编辑翻译";
    button.style.marginLeft = "6px";
    button.style.padding = "2px 6px";
    button.addEventListener("click", (e) => {
      e.preventDefault();
      openEditDialog(reader, element);
    });
    append(button);
  };
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    selectionHandler,
    addon.data.config.addonID,
  );
}

export function unregisterTranslationEditPopup() {
  if (!selectionHandler) return;
  Zotero.Reader.unregisterEventListener(
    "renderTextSelectionPopup",
    selectionHandler,
  );
  selectionHandler = null;
}

export function registerTranslationEditContextMenu() {
  if (contextMenuHandler) return;
  contextMenuHandler = (event) => {
    const { reader, doc, append } = event;
    const element = getSelectionElement(reader, doc);
    if (!element) return;
    append({
      label: "编辑翻译",
      onCommand: () => openEditDialog(reader, element),
    });
  };
  Zotero.Reader.registerEventListener(
    "createViewContextMenu",
    contextMenuHandler,
    addon.data.config.addonID,
  );
  Zotero.Reader.registerEventListener(
    "createSelectorContextMenu",
    contextMenuHandler,
    addon.data.config.addonID,
  );
}

export function unregisterTranslationEditContextMenu() {
  if (!contextMenuHandler) return;
  Zotero.Reader.unregisterEventListener(
    "createViewContextMenu",
    contextMenuHandler,
  );
  Zotero.Reader.unregisterEventListener(
    "createSelectorContextMenu",
    contextMenuHandler,
  );
  contextMenuHandler = null;
}

export function registerTranslationEditDblClick() {
  if (dblClickHandler) return;
  dblClickHandler = (event) => {
    const { reader, doc } = event;
    attachDblClickEditor(reader, doc);
  };
  Zotero.Reader.registerEventListener(
    "renderToolbar",
    dblClickHandler,
    addon.data.config.addonID,
  );
}

export function unregisterTranslationEditDblClick() {
  if (!dblClickHandler) return;
  Zotero.Reader.unregisterEventListener("renderToolbar", dblClickHandler);
  dblClickHandler = null;
}
