import { getPref } from "../utils/prefs";

const ARXIV_URL_RE =
  /https?:\/\/(?:www\.)?arxiv\.org\/(abs|pdf|format)\/([^?#\s]+)(?:\.pdf)?/i;
const ARXIV_ABS_RE = /https?:\/\/(?:www\.)?arxiv\.org\/abs\/([^?#\s]+)/i;
const ARXIV_ID_RE = /\b(?:arxiv:)?([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(v\d+)?\b/i;
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

function serializeDocument(doc: Document, originalHtml: string): string {
  const doctypeMatch = originalHtml.match(/<!doctype[^>]*>/i);
  const doctype = doctypeMatch ? `${doctypeMatch[0]}\n` : "";
  const html = doc.documentElement?.outerHTML || originalHtml;
  return `${doctype}${html}`;
}

function ensureDirectoryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/")) return parsed.toString();
    const lastSegment = parsed.pathname.split("/").pop() || "";
    if (lastSegment.includes(".")) return parsed.toString();
    parsed.pathname += "/";
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchText(url: string): Promise<string | null> {
  const xhr = await Zotero.HTTP.request("GET", url, {
    successCodes: false,
  });
  if (xhr.status < 200 || xhr.status >= 300) return null;
  return xhr.responseText || "";
}

function resolveCssUrls(cssText: string, cssUrl: string): string {
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const importRe = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi;
  const rewrite = (raw: string) => {
    if (
      raw.startsWith("data:") ||
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("//") ||
      raw.startsWith("#")
    ) {
      return raw;
    }
    try {
      return new URL(raw, cssUrl).toString();
    } catch {
      return raw;
    }
  };
  let result = cssText.replace(urlRe, (_m, _q, url) => {
    const resolved = rewrite(String(url));
    return `url("${resolved}")`;
  });
  result = result.replace(importRe, (_m, url) => {
    const resolved = rewrite(String(url));
    return `@import url("${resolved}");`;
  });
  return result;
}

async function inlineCssImports(
  cssText: string,
  baseUrl: string,
  visited: Set<string>,
): Promise<string> {
  const importRe =
    /@import\s+(?:url\()?\s*(['"]?)([^'")\s]+)\1\s*\)?\s*([^;]*);/gi;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(cssText))) {
    result += cssText.slice(lastIndex, match.index);
    lastIndex = importRe.lastIndex;
    const importPath = String(match[2] || "");
    let importUrl = "";
    try {
      importUrl = new URL(importPath, baseUrl).toString();
    } catch {
      result += match[0];
      continue;
    }
    let importedText: string | null = null;
    if (!visited.has(importUrl)) {
      importedText = await fetchText(importUrl);
    }
    if (!importedText) {
      const dirBase = ensureDirectoryUrl(baseUrl);
      if (dirBase !== baseUrl) {
        try {
          const altUrl = new URL(importPath, dirBase).toString();
          if (!visited.has(altUrl)) {
            importedText = await fetchText(altUrl);
            if (importedText) importUrl = altUrl;
          }
        } catch {
          // fall through to keep original @import
        }
      }
    }
    if (!importedText) {
      result += match[0];
      continue;
    }
    visited.add(importUrl);
    const inlined = await inlineCssImports(importedText, importUrl, visited);
    const resolved = resolveCssUrls(inlined, importUrl);
    result += `\n/* inlined: ${importUrl} */\n${resolved}\n`;
  }
  result += cssText.slice(lastIndex);
  return resolveCssUrls(result, baseUrl);
}

async function inlineStyleTagImports(
  htmlUrl: string,
  doc: Document,
): Promise<boolean> {
  const styles = Array.from(
    doc.querySelectorAll("style"),
  ) as HTMLStyleElement[];
  if (styles.length === 0) return false;
  const visited = new Set<string>();
  let changed = false;
  for (const style of styles) {
    const text = style.textContent || "";
    if (!text.includes("@import")) continue;
    const inlined = await inlineCssImports(text, htmlUrl, visited);
    if (inlined !== text) changed = true;
    style.textContent = inlined;
  }
  return changed;
}

async function inlineStylesheets(htmlUrl: string, attachment: Zotero.Item) {
  const filePath = await attachment.getFilePathAsync();
  if (!filePath) return;
  const htmlBaseUrl = ensureDirectoryUrl(htmlUrl);
  const html = (await Zotero.File.getContentsAsync(
    filePath,
    "utf-8",
  )) as string;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rawLinks = Array.from(
    doc.querySelectorAll("link[rel][href]"),
  ) as HTMLLinkElement[];
  const links = rawLinks.filter((link) => {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    if (rel.includes("stylesheet")) return true;
    if (rel.includes("preload")) {
      const as = (link.getAttribute("as") || "").toLowerCase();
      return as === "style";
    }
    return false;
  });
  const visited = new Set<string>();
  if (links.length === 0) {
    const styleChanged = await inlineStyleTagImports(htmlBaseUrl, doc);
    if (styleChanged) {
      const updated = serializeDocument(doc, html);
      await Zotero.File.putContentsAsync(filePath, updated, "utf-8");
    }
    return;
  }

  let changed = false;
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    let cssUrl: string;
    try {
      cssUrl = new URL(href, htmlBaseUrl).toString();
    } catch {
      continue;
    }
    let cssText = await fetchText(cssUrl);
    if (!cssText) {
      const altBase = ensureDirectoryUrl(htmlUrl);
      if (altBase !== htmlBaseUrl) {
        try {
          const altUrl = new URL(href, altBase).toString();
          cssText = await fetchText(altUrl);
          if (cssText) cssUrl = altUrl;
        } catch {
          // ignore
        }
      }
    }
    if (!cssText) continue;
    const inlinedText = await inlineCssImports(cssText, cssUrl, visited);
    const style = doc.createElement("style");
    style.setAttribute("data-zotero-inline-css", "true");
    style.textContent = inlinedText;
    link.parentNode?.insertBefore(style, link);
    link.remove();
    changed = true;
  }

  const styleChanged = await inlineStyleTagImports(htmlBaseUrl, doc);
  changed = changed || styleChanged;

  if (changed) {
    const updated = serializeDocument(doc, html);
    await Zotero.File.putContentsAsync(filePath, updated, "utf-8");
  }
}

function shouldInlineCss(): boolean {
  return Boolean(getPref("inlineCss"));
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

async function getHtmlAttachments(
  parentItem: Zotero.Item,
): Promise<Zotero.Item[]> {
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

function promptDuplicateAction(title: string, count: number): DuplicateAction {
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

type ProgressReporter = (message: string) => void;

async function attachArxivHtml(
  item: Zotero.Item,
  report?: ProgressReporter,
): Promise<AttachResult> {
  const parentItem = resolveParentItem(item);
  const title =
    (parentItem.getField("title") as string) || `Item ${parentItem.id}`;
  report?.(`准备抓取：${title}`);
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

  try {
    report?.(`下载 HTML：${title}`);
    const attachment = await Zotero.Attachments.importFromURL({
      libraryID: parentItem.libraryID,
      url: htmlUrl,
      parentItemID: parentItem.id,
      title: attachmentTitle,
      fileBaseName,
      contentType: "text/html",
    });
    if (shouldInlineCss()) {
      report?.(`内嵌 CSS：${title}`);
      await inlineStylesheets(htmlUrl, attachment);
    }
    report?.(`完成：${title}`);
    return { status: "attached", title, url: htmlUrl };
  } catch (error: any) {
    return {
      status: "failed",
      title,
      reason: error?.message ? String(error.message) : String(error),
    };
  }
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

  const total = uniqueParents.size;
  const progressWin =
    total > 0
      ? new ztoolkit.ProgressWindow(addon.data.config.addonName, {
          closeOnClick: true,
          closeTime: -1,
        })
          .createLine({
            text: `抓取进度：0/${total} (0%)`,
            type: "default",
            progress: 0,
          })
          .show()
      : null;
  let done = 0;
  const report = (message: string) => {
    if (!progressWin || total === 0) return;
    const percent = Math.round((done / total) * 100);
    progressWin.changeLine({
      progress: percent,
      text: `抓取进度：${done}/${total} (${percent}%)\n${message}`,
    });
  };

  const results: AttachResult[] = [];
  for (const item of uniqueParents.values()) {
    results.push(await attachArxivHtml(item, (message) => report(message)));
    done += 1;
    report("下一项");
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
      `已取消：\n${skipped.map((r) => `${r.title}（${r.reason}）`).join("\n")}`,
    );
  }

  if (progressWin) {
    progressWin.changeLine({
      progress: 100,
      text: `抓取完成：${done}/${total} (100%)`,
    });
    progressWin.startCloseTimer(4000);
  }

  alert(messages.join("\n\n"));
}
