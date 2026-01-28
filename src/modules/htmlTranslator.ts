import { translateText } from "./translationService";

const TRANSLATION_CLASS = "zr-translation-block";
const TRANSLATION_ATTR = "data-zotero-translation";
const TRANSLATION_STYLE_ID = "zotero-arxiv-translation-style";
const TRANSLATION_STYLE = `
.${TRANSLATION_CLASS} {
  margin: 6px 0 10px 0;
  padding: 6px 10px;
  background: #f4f6fa;
  border-left: 3px solid #4a6cf7;
  color: #333333;
  font-size: 0.95em;
  line-height: 1.5;
}
`;

type TranslateResult =
  | { status: "translated"; title: string; count: number }
  | { status: "partial"; title: string; count: number; reason: string }
  | { status: "skipped"; title: string; reason: string }
  | { status: "failed"; title: string; reason: string };

function isHtmlAttachment(item: Zotero.Item): boolean {
  const contentType = (item.attachmentContentType || "").toLowerCase();
  const filename = (item.attachmentFilename || "").toLowerCase();
  return (
    contentType.startsWith("text/html") ||
    filename.endsWith(".html") ||
    filename.endsWith(".htm")
  );
}

function ensureStyle(doc: Document) {
  if (doc.getElementById(TRANSLATION_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = TRANSLATION_STYLE_ID;
  style.textContent = TRANSLATION_STYLE.trim();
  const head = doc.head || doc.querySelector("head");
  if (head) {
    head.appendChild(style);
  } else if (doc.documentElement) {
    doc.documentElement.insertBefore(style, doc.documentElement.firstChild);
  }
}

function serializeDocument(doc: Document, originalHtml: string): string {
  const doctypeMatch = originalHtml.match(/<!doctype[^>]*>/i);
  const doctype = doctypeMatch ? `${doctypeMatch[0]}\n` : "";
  const html = doc.documentElement?.outerHTML || originalHtml;
  return `${doctype}${html}`;
}

function getParagraphs(doc: Document): HTMLParagraphElement[] {
  return Array.from(doc.querySelectorAll("p")) as HTMLParagraphElement[];
}

function alreadyTranslated(paragraph: Element): boolean {
  const next = paragraph.nextElementSibling;
  if (!next) return false;
  if (next.classList.contains(TRANSLATION_CLASS)) return true;
  return paragraph.getAttribute(TRANSLATION_ATTR) === "true";
}

function insertTranslation(paragraph: Element, text: string) {
  const block = paragraph.ownerDocument.createElement("div");
  block.className = TRANSLATION_CLASS;
  block.setAttribute(TRANSLATION_ATTR, "true");
  block.textContent = text;
  paragraph.insertAdjacentElement("afterend", block);
  paragraph.setAttribute(TRANSLATION_ATTR, "true");
}

async function translateHtmlAttachment(
  item: Zotero.Item,
): Promise<TranslateResult> {
  if (!item.isAttachment() || !isHtmlAttachment(item)) {
    const title = (item.getField("title") as string) || `Item ${item.id}`;
    return { status: "skipped", title, reason: "非 HTML 附件" };
  }

  const title = (item.getField("title") as string) || `Item ${item.id}`;
  const filePath = await item.getFilePathAsync();
  if (!filePath) {
    return { status: "failed", title, reason: "未找到文件路径" };
  }

  const html = (await Zotero.File.getContentsAsync(filePath)) as string;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  ensureStyle(doc);

  const paragraphs = getParagraphs(doc);
  if (paragraphs.length === 0) {
    return { status: "skipped", title, reason: "未找到段落" };
  }

  let translatedCount = 0;
  let errorReason = "";
  for (const paragraph of paragraphs) {
    if (alreadyTranslated(paragraph)) continue;
    const text = paragraph.textContent?.trim() || "";
    if (!text) continue;
    try {
      const translated = await translateText(text);
      if (!translated) continue;
      insertTranslation(paragraph, translated);
      translatedCount += 1;
    } catch (error: any) {
      errorReason = error?.message ? String(error.message) : String(error);
      break;
    }
  }

  if (translatedCount === 0 && errorReason) {
    return { status: "failed", title, reason: errorReason };
  }
  if (translatedCount === 0) {
    return { status: "skipped", title, reason: "未产生翻译内容" };
  }

  const updated = serializeDocument(doc, html);
  await Zotero.File.putContentsAsync(filePath, updated, "utf-8");

  if (errorReason) {
    return {
      status: "partial",
      title,
      count: translatedCount,
      reason: errorReason,
    };
  }
  return { status: "translated", title, count: translatedCount };
}

export async function translateHtmlForSelection(): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
  if (!items || items.length === 0) {
    alert("未选中条目。");
    return;
  }

  const results: TranslateResult[] = [];
  for (const item of items) {
    results.push(await translateHtmlAttachment(item));
  }

  const translated = results.filter((r) => r.status === "translated") as Array<
    Extract<TranslateResult, { status: "translated" }>
  >;
  const partial = results.filter((r) => r.status === "partial") as Array<
    Extract<TranslateResult, { status: "partial" }>
  >;
  const skipped = results.filter((r) => r.status === "skipped") as Array<
    Extract<TranslateResult, { status: "skipped" }>
  >;
  const failed = results.filter((r) => r.status === "failed") as Array<
    Extract<TranslateResult, { status: "failed" }>
  >;

  const messages: string[] = [];
  if (translated.length > 0) {
    messages.push(
      `已翻译：\n${translated
        .map((r) => `${r.title}（${r.count} 段）`)
        .join("\n")}`,
    );
  }
  if (partial.length > 0) {
    messages.push(
      `部分完成：\n${partial
        .map((r) => `${r.title}（${r.count} 段，${r.reason}）`)
        .join("\n")}`,
    );
  }
  if (skipped.length > 0) {
    messages.push(
      `已跳过：\n${skipped
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }
  if (failed.length > 0) {
    messages.push(
      `翻译失败：\n${failed
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }

  alert(messages.join("\n\n"));
}
