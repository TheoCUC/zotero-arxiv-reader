import {
  getParallelProviders,
  translateTextWithProvider,
} from "./translationService";
import { getPref } from "../utils/prefs";
import {
  addTranslationLog,
  finishTranslationProgress,
  incrementTranslationProgress,
  openTranslationProgressDialog,
  setTranslationProviderProgress,
  setTranslationStatus,
  startTranslationProgress,
} from "./translationProgress";

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

type ProviderProgress = {
  id: string;
  name: string;
  total: number;
  done: number;
  failed: number;
  error?: string;
};

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
  const doc = paragraph.ownerDocument;
  if (!doc) return;
  const block = doc.createElement("div");
  block.className = TRANSLATION_CLASS;
  block.setAttribute(TRANSLATION_ATTR, "true");
  block.textContent = text;
  paragraph.insertAdjacentElement("afterend", block);
  paragraph.setAttribute(TRANSLATION_ATTR, "true");
}

async function translateHtmlAttachment(
  item: Zotero.Item,
  onTranslated?: () => void,
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
  const providers = getParallelProviders();
  const reassignOnFailure = Boolean(
    getPref("translationParallelReassignOnFailure"),
  );
  const providerProgress: ProviderProgress[] = providers.map((provider) => ({
    id: provider.id,
    name: provider.name || provider.id,
    total: 0,
    done: 0,
    failed: 0,
  }));
  const tasks = paragraphs
    .filter((paragraph) => !alreadyTranslated(paragraph))
    .map((paragraph) => ({
      paragraph,
      text: paragraph.textContent?.trim() || "",
    }))
    .filter((task) => task.text.length > 0);

  if (tasks.length > 0) {
    if (providers.length <= 1) {
      const provider = providers[0];
      if (providerProgress.length > 0) {
        providerProgress[0].total = tasks.length;
        setTranslationProviderProgress(providerProgress);
      }
      for (const task of tasks) {
        try {
          const translated = await translateTextWithProvider(
            task.text,
            provider,
          );
          if (!translated) continue;
          insertTranslation(task.paragraph, translated);
          translatedCount += 1;
          if (providerProgress.length > 0) {
            providerProgress[0].done += 1;
            setTranslationProviderProgress(providerProgress);
          }
          if (onTranslated) onTranslated();
        } catch (error: any) {
          errorReason = error?.message ? String(error.message) : String(error);
          if (providerProgress.length > 0) {
            providerProgress[0].failed += 1;
            providerProgress[0].error = errorReason;
            setTranslationProviderProgress(providerProgress);
          }
          break;
        }
      }
    } else {
      const queue = tasks.slice();
      let aborted = false;
      const workers = providers.map((provider, index) =>
        (async () => {
          while (true) {
            if (aborted) return;
            const task = queue.shift();
            if (!task) return;
            providerProgress[index].total += 1;
            setTranslationProviderProgress(providerProgress);
            try {
              const translated = await translateTextWithProvider(
                task.text,
                provider,
              );
              if (!translated) continue;
              insertTranslation(task.paragraph, translated);
              translatedCount += 1;
              providerProgress[index].done += 1;
              setTranslationProviderProgress(providerProgress);
              if (onTranslated) onTranslated();
            } catch (error: any) {
              const reason = error?.message
                ? String(error.message)
                : String(error);
              if (!errorReason) {
                errorReason = reason;
              }
              providerProgress[index].failed += 1;
              providerProgress[index].error = reason;
              setTranslationProviderProgress(providerProgress);
              if (reassignOnFailure) {
                queue.push(task);
                return;
              }
              aborted = true;
              return;
            }
          }
        })(),
      );
      await Promise.all(workers);
      if (reassignOnFailure && queue.length > 0 && !errorReason) {
        errorReason = "部分段落未完成，所有服务商均失败。";
      }
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

async function countTranslatableParagraphs(item: Zotero.Item): Promise<number> {
  if (!item.isAttachment() || !isHtmlAttachment(item)) {
    return 0;
  }
  const filePath = await item.getFilePathAsync();
  if (!filePath) return 0;
  const html = (await Zotero.File.getContentsAsync(filePath)) as string;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const paragraphs = getParagraphs(doc);
  let count = 0;
  for (const paragraph of paragraphs) {
    if (alreadyTranslated(paragraph)) continue;
    const text = paragraph.textContent?.trim() || "";
    if (!text) continue;
    count += 1;
  }
  return count;
}

export async function translateHtmlForSelection(): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  if (!items || items.length === 0) {
    const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
    alert("未选中条目。");
    return;
  }

  const results: TranslateResult[] = [];
  openTranslationProgressDialog();
  const counts = await Promise.all(
    items.map((item) => countTranslatableParagraphs(item)),
  );
  const total = counts.reduce((sum, value) => sum + value, 0);
  startTranslationProgress(total);
  let done = 0;
  const onTranslated = () => {
    done += 1;
    incrementTranslationProgress(1);
  };

  for (const item of items) {
    const title = (item.getField("title") as string) || `Item ${item.id}`;
    setTranslationStatus(`翻译中：${title}`);
    results.push(await translateHtmlAttachment(item, onTranslated));
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
      `已跳过：\n${skipped.map((r) => `${r.title}（${r.reason}）`).join("\n")}`,
    );
  }
  if (failed.length > 0) {
    messages.push(
      `翻译失败：\n${failed
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }

  if (translated.length > 0) {
    translated.forEach((r) =>
      addTranslationLog(`[完成] ${r.title}（${r.count} 段）`),
    );
  }
  if (partial.length > 0) {
    partial.forEach((r) =>
      addTranslationLog(`[部分] ${r.title}（${r.count} 段，${r.reason}）`),
    );
  }
  if (skipped.length > 0) {
    skipped.forEach((r) =>
      addTranslationLog(`[跳过] ${r.title}（${r.reason}）`),
    );
  }
  if (failed.length > 0) {
    failed.forEach((r) =>
      addTranslationLog(`[失败] ${r.title}（${r.reason}）`),
    );
  }
  finishTranslationProgress(
    failed.length > 0 || partial.length > 0 ? "完成（部分失败）" : "完成",
  );
  if (messages.length > 0) {
    messages.forEach((message) => addTranslationLog(message));
  }
}
