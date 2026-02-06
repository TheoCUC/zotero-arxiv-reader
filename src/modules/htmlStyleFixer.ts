const AR5IV_CSS_URL =
  "https://raw.githubusercontent.com/dginev/ar5iv-css/main/css/ar5iv.css";
const AR5IV_STYLE_ID = "zotero-ar5iv-css";

type FixResult =
  | { status: "fixed"; title: string }
  | { status: "skipped"; title: string; reason: string }
  | { status: "failed"; title: string; reason: string };

let cachedAr5ivCss: string | null = null;

function isHtmlAttachment(item: Zotero.Item): boolean {
  const contentType = (item.attachmentContentType || "").toLowerCase();
  const filename = (item.attachmentFilename || "").toLowerCase();
  return (
    contentType.startsWith("text/html") ||
    filename.endsWith(".html") ||
    filename.endsWith(".htm")
  );
}

function serializeDocument(doc: Document, originalHtml: string): string {
  const doctypeMatch = originalHtml.match(/<!doctype[^>]*>/i);
  const doctype = doctypeMatch ? `${doctypeMatch[0]}\n` : "";
  const html = doc.documentElement?.outerHTML || originalHtml;
  return `${doctype}${html}`;
}

function ensureHead(doc: Document): HTMLElement {
  const existing = doc.head || doc.querySelector("head");
  if (existing) return existing as HTMLElement;
  const head = doc.createElement("head");
  if (doc.documentElement) {
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  } else {
    doc.appendChild(head);
  }
  return head;
}

async function fetchAr5ivCss(): Promise<string> {
  if (cachedAr5ivCss) return cachedAr5ivCss;
  const xhr = await Zotero.HTTP.request("GET", AR5IV_CSS_URL, {
    successCodes: false,
  });
  if (xhr.status < 200 || xhr.status >= 300) {
    throw new Error(`CSS 下载失败：HTTP ${xhr.status}`);
  }
  const text = xhr.responseText || "";
  if (!text.trim()) {
    throw new Error("CSS 内容为空。");
  }
  cachedAr5ivCss = text;
  return text;
}

async function applyAr5ivCss(item: Zotero.Item): Promise<FixResult> {
  if (!item.isAttachment() || !isHtmlAttachment(item)) {
    const title = (item.getField("title") as string) || `Item ${item.id}`;
    return { status: "skipped", title, reason: "非 HTML 附件" };
  }
  const title = (item.getField("title") as string) || `Item ${item.id}`;
  const filePath = await item.getFilePathAsync();
  if (!filePath) {
    return { status: "failed", title, reason: "未找到文件路径" };
  }

  const cssText = await fetchAr5ivCss();
  const html = (await Zotero.File.getContentsAsync(filePath)) as string;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const head = ensureHead(doc);
  const existing = doc.getElementById(AR5IV_STYLE_ID);
  if (existing) existing.remove();
  const style = doc.createElement("style");
  style.id = AR5IV_STYLE_ID;
  style.setAttribute("data-zotero-ar5iv-css", "true");
  style.textContent = cssText;
  head.appendChild(style);

  const updated = serializeDocument(doc, html);
  await Zotero.File.putContentsAsync(filePath, updated, "utf-8");
  return { status: "fixed", title };
}

export async function applyAr5ivCssForSelection(): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
  if (!items || items.length === 0) {
    alert("未选中条目。");
    return;
  }

  const results = await Promise.all(
    items.map((item) =>
      applyAr5ivCss(item).catch((error: any) => {
        const title = (item.getField("title") as string) || `Item ${item.id}`;
        return {
          status: "failed",
          title,
          reason: error?.message ? String(error.message) : String(error),
        } as FixResult;
      }),
    ),
  );

  const fixed = results.filter((r) => r.status === "fixed") as Array<
    Extract<FixResult, { status: "fixed" }>
  >;
  const skipped = results.filter((r) => r.status === "skipped") as Array<
    Extract<FixResult, { status: "skipped" }>
  >;
  const failed = results.filter((r) => r.status === "failed") as Array<
    Extract<FixResult, { status: "failed" }>
  >;

  const messages: string[] = [];
  if (fixed.length > 0) {
    messages.push(`已修复样式：\n${fixed.map((r) => r.title).join("\n")}`);
  }
  if (skipped.length > 0) {
    messages.push(
      `已跳过：\n${skipped.map((r) => `${r.title}（${r.reason}）`).join("\n")}`,
    );
  }
  if (failed.length > 0) {
    messages.push(
      `修复失败：\n${failed.map((r) => `${r.title}（${r.reason}）`).join("\n")}`,
    );
  }

  alert(messages.join("\n\n"));
}
