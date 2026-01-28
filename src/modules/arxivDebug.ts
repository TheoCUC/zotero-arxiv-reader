const ARXIV_URL_RE =
  /https?:\/\/(?:www\.)?arxiv\.org\/(abs|pdf|format)\/([^?#\s]+)(?:\.pdf)?/i;
const ARXIV_ABS_RE =
  /https?:\/\/(?:www\.)?arxiv\.org\/abs\/([^?#\s]+)/i;
const ARXIV_ID_RE =
  /\b(?:arxiv:)?([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(v\d+)?\b/i;
const ARXIV_DOI_RE = /10\.48550\/arXiv\.(\d{4}\.\d{4,5})(v\d+)?/i;

function normalizeArxivUrl(url: string): string | null {
  const match = ARXIV_URL_RE.exec(url);
  if (!match) return null;
  const rawId = match[2].replace(/\.pdf$/i, "");
  return `https://arxiv.org/abs/${rawId}`;
}

function extractArxivId(text: string): string | null {
  const match = ARXIV_ID_RE.exec(text);
  if (!match) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

function extractArxivIdFromDoi(doi: string): string | null {
  const match = ARXIV_DOI_RE.exec(doi);
  if (!match) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

function buildAbsUrlFromId(id: string): string {
  return `https://arxiv.org/abs/${id}`;
}

function buildHtmlUrlFromAbs(absUrl: string): string | null {
  const match = ARXIV_ABS_RE.exec(absUrl);
  if (!match) return null;
  return `https://arxiv.org/html/${match[1]}`;
}

function getArxivIdFromAbs(absUrl: string): string | null {
  const match = ARXIV_ABS_RE.exec(absUrl);
  if (!match) return null;
  return match[1];
}

function sanitizeFileBaseName(id: string): string {
  return id.replace(/\//g, "_");
}

function findArxivUrlInItem(item: Zotero.Item): string | null {
  const urlField = (item.getField("url") as string) || "";
  const normalizedUrl = normalizeArxivUrl(urlField);
  if (normalizedUrl) return normalizedUrl;

  const doiField = (item.getField("DOI") as string) || "";
  const doiId = extractArxivIdFromDoi(doiField) || extractArxivId(doiField);
  if (doiId) return buildAbsUrlFromId(doiId);

  const archiveField = (item.getField("archiveLocation") as string) || "";
  const archiveId = extractArxivId(archiveField);
  if (archiveId) return buildAbsUrlFromId(archiveId);

  const extraField = (item.getField("extra") as string) || "";
  const extraId = extractArxivId(extraField);
  if (extraId) return buildAbsUrlFromId(extraId);

  return null;
}

async function findArxivUrl(item: Zotero.Item): Promise<string | null> {
  const direct = findArxivUrlInItem(item);
  if (direct) return direct;

  if (item.isAttachment() && item.parentItem) {
    const parentUrl = findArxivUrlInItem(item.parentItem);
    if (parentUrl) return parentUrl;
  }

  if (item.isRegularItem()) {
    const attachmentIds = item.getAttachments?.() || [];
    for (const id of attachmentIds) {
      const attachment = await Zotero.Items.getAsync(id);
      const attachmentUrl = findArxivUrlInItem(attachment);
      if (attachmentUrl) return attachmentUrl;
    }
  }

  return null;
}

function resolveParentItem(item: Zotero.Item): Zotero.Item {
  if (item.isAttachment() && item.parentItem) return item.parentItem;
  return item.topLevelItem || item;
}

function isHtmlAttachment(item: Zotero.Item): boolean {
  const contentType = (item.attachmentContentType || "").toLowerCase();
  const filename = (item.attachmentFilename || "").toLowerCase();
  return (
    contentType.startsWith("text/html") ||
    filename.endsWith(".html") ||
    filename.endsWith(".htm")
  );
}

async function getHtmlAttachments(parentItem: Zotero.Item): Promise<Zotero.Item[]> {
  const attachmentIds = parentItem.getAttachments?.() || [];
  if (attachmentIds.length === 0) return [];
  const attachments = await Zotero.Items.getAsync(attachmentIds);
  const list = Array.isArray(attachments) ? attachments : [attachments];
  return list.filter((item) => item.isAttachment() && isHtmlAttachment(item));
}

function getExistingFileNames(attachments: Zotero.Item[]): Set<string> {
  const names = new Set<string>();
  for (const attachment of attachments) {
    const filename = attachment.attachmentFilename;
    if (filename) names.add(filename);
  }
  return names;
}

function getUniqueFileName(baseName: string, existing: Set<string>): string {
  if (!existing.has(baseName)) return baseName;
  const dotIndex = baseName.lastIndexOf(".");
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : "";
  let i = 1;
  let candidate = `${stem}-${i}${ext}`;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${stem}-${i}${ext}`;
  }
  return candidate;
}

type DuplicateAction = "overwrite" | "rename" | "cancel";

function promptDuplicateAction(
  title: string,
  count: number,
): DuplicateAction {
  const Services = ztoolkit.getGlobal("Services") as any;
  const promptSvc = Services?.prompt;
  if (!promptSvc) return "cancel";

  const flags =
    promptSvc.BUTTON_POS_0 * promptSvc.BUTTON_TITLE_IS_STRING +
    promptSvc.BUTTON_POS_1 * promptSvc.BUTTON_TITLE_IS_STRING +
    promptSvc.BUTTON_POS_2 * promptSvc.BUTTON_TITLE_IS_STRING +
    promptSvc.BUTTON_POS_2_DEFAULT;
  const checkState = { value: false };
  const choice = promptSvc.confirmEx(
    Zotero.getMainWindow(),
    "HTML 附件已存在",
    `条目「${title}」下已有 ${count} 个 HTML 附件。\n请选择处理方式：`,
    flags,
    "覆盖",
    "重命名",
    "取消",
    "",
    checkState,
  );
  if (choice === 0) return "overwrite";
  if (choice === 1) return "rename";
  return "cancel";
}

type AttachResult =
  | { status: "attached"; title: string; url: string }
  | { status: "missing"; title: string; reason: string }
  | { status: "failed"; title: string; reason: string }
  | { status: "skipped"; title: string; reason: string };

async function attachArxivHtml(item: Zotero.Item): Promise<AttachResult> {
  const parentItem = resolveParentItem(item);
  const title = (parentItem.getField("title") as string) || `Item ${parentItem.id}`;
  const absUrl = await findArxivUrl(item);
  if (!absUrl) {
    return { status: "missing", title, reason: "未找到 arXiv URL" };
  }

  const htmlUrl = buildHtmlUrlFromAbs(absUrl);
  if (!htmlUrl) {
    return { status: "missing", title, reason: "无法生成 arXiv HTML URL" };
  }

  const existingHtml = await getHtmlAttachments(parentItem);
  let fileBaseName: string | undefined = undefined;
  if (existingHtml.length > 0) {
    const action = promptDuplicateAction(title, existingHtml.length);
    if (action === "cancel") {
      return { status: "skipped", title, reason: "用户取消" };
    }
    if (action === "overwrite") {
      for (const attachment of existingHtml) {
        await attachment.eraseTx();
      }
    }
    if (action === "rename") {
      const existingNames = getExistingFileNames(existingHtml);
      const arxivId = getArxivIdFromAbs(absUrl);
      const baseName = arxivId
        ? `arxiv-${sanitizeFileBaseName(arxivId)}.html`
        : "arxiv-html.html";
      fileBaseName = getUniqueFileName(baseName, existingNames);
    }
  }

  const arxivId = getArxivIdFromAbs(absUrl);
  if (!fileBaseName && arxivId) {
    fileBaseName = `arxiv-${sanitizeFileBaseName(arxivId)}.html`;
  }
  const attachmentTitle = arxivId ? `arXiv HTML (${arxivId})` : "arXiv HTML";

  return Zotero.Attachments.importFromURL({
    libraryID: parentItem.libraryID,
    url: htmlUrl,
    parentItemID: parentItem.id,
    title: attachmentTitle,
    fileBaseName,
    contentType: "text/html",
  }).then(
    () => ({ status: "attached", title, url: htmlUrl }),
    (error) => ({
      status: "failed",
      title,
      reason: error?.message ? String(error.message) : String(error),
    }),
  );
}

export async function attachArxivHtmlForSelection(): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
  if (!items || items.length === 0) {
    alert("未选中条目。");
    return;
  }

  const uniqueParents = new Map<number, Zotero.Item>();
  for (const item of items) {
    const parentItem = resolveParentItem(item);
    if (!uniqueParents.has(parentItem.id)) {
      uniqueParents.set(parentItem.id, parentItem);
    }
  }

  const results: AttachResult[] = [];
  for (const item of uniqueParents.values()) {
    results.push(await attachArxivHtml(item));
  }
  const attached = results.filter((r) => r.status === "attached") as Array<
    Extract<AttachResult, { status: "attached" }>
  >;
  const missing = results.filter((r) => r.status === "missing") as Array<
    Extract<AttachResult, { status: "missing" }>
  >;
  const failed = results.filter((r) => r.status === "failed") as Array<
    Extract<AttachResult, { status: "failed" }>
  >;
  const skipped = results.filter((r) => r.status === "skipped") as Array<
    Extract<AttachResult, { status: "skipped" }>
  >;

  const messages: string[] = [];
  if (attached.length > 0) {
    messages.push(
      `已添加 HTML 附件：\n${attached
        .map((r) => `${r.title}\n${r.url}`)
        .join("\n\n")}`,
    );
  }
  if (missing.length > 0) {
    messages.push(
      `未找到 arXiv URL：\n${missing
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }
  if (failed.length > 0) {
    messages.push(
      `下载失败：\n${failed
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }
  if (skipped.length > 0) {
    messages.push(
      `已取消：\n${skipped
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }

  alert(messages.join("\n\n"));
}
