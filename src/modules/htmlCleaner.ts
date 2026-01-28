import { getPref } from "../utils/prefs";

const DEFAULT_HTML_BLOCKLIST = [
  "header.desktop_header",
  "button#openForm",
];

type CleanResult =
  | { status: "cleaned"; title: string; removed: number }
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

function getHtmlBlocklist(): string[] {
  const prefValue = getPref("htmlBlocklist");
  const raw =
    typeof prefValue === "string"
      ? prefValue
      : DEFAULT_HTML_BLOCKLIST.join("\n");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function hideBySelectors(doc: Document, selectors: string[]): number {
  let hidden = 0;
  for (const selector of selectors) {
    const nodes = Array.from(doc.querySelectorAll(selector));
    for (const node of nodes) {
      const element = node as Element;
      const prevStyle = element.getAttribute("style") || "";
      const suffix =
        prevStyle.trim().length === 0 || prevStyle.trim().endsWith(";")
          ? ""
          : ";";
      element.setAttribute(
        "style",
        `${prevStyle}${suffix}display: none !important;`,
      );
      element.setAttribute("hidden", "true");
      element.setAttribute("data-zotero-hidden", "true");
      hidden += 1;
    }
  }
  return hidden;
}

function serializeDocument(doc: Document, originalHtml: string): string {
  const doctypeMatch = originalHtml.match(/<!doctype[^>]*>/i);
  const doctype = doctypeMatch ? `${doctypeMatch[0]}\n` : "";
  const html = doc.documentElement?.outerHTML || originalHtml;
  return `${doctype}${html}`;
}

async function cleanHtmlAttachment(item: Zotero.Item): Promise<CleanResult> {
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
  const selectors = getHtmlBlocklist();
  if (selectors.length === 0) {
    return { status: "skipped", title, reason: "未配置屏蔽列表" };
  }
  const hidden = hideBySelectors(doc, selectors);
  if (hidden === 0) {
    return { status: "skipped", title, reason: "未匹配到目标元素" };
  }

  const updated = serializeDocument(doc, html);
  await Zotero.File.putContentsAsync(filePath, updated, "utf-8");
  return { status: "cleaned", title, removed: hidden };
}

export async function cleanHtmlAttachmentsForSelection(): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
  if (!items || items.length === 0) {
    alert("未选中条目。");
    return;
  }

  const results = await Promise.all(
    items.map((item) => cleanHtmlAttachment(item)),
  );
  const cleaned = results.filter((r) => r.status === "cleaned") as Array<
    Extract<CleanResult, { status: "cleaned" }>
  >;
  const skipped = results.filter((r) => r.status === "skipped") as Array<
    Extract<CleanResult, { status: "skipped" }>
  >;
  const failed = results.filter((r) => r.status === "failed") as Array<
    Extract<CleanResult, { status: "failed" }>
  >;

  const messages: string[] = [];
  if (cleaned.length > 0) {
    messages.push(
      `已处理 HTML：\n${cleaned
        .map((r) => `${r.title}（隐藏 ${r.removed} 个元素）`)
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
      `处理失败：\n${failed
        .map((r) => `${r.title}（${r.reason}）`)
        .join("\n")}`,
    );
  }

  alert(messages.join("\n\n"));
}
