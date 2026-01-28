const ARXIV_URL_RE =
  /https?:\/\/(?:www\.)?arxiv\.org\/(abs|pdf|format)\/([^?#\s]+)(?:\.pdf)?/i;
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

export async function showArxivUrlDebug(): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
  if (!items || items.length === 0) {
    alert("未选中条目。");
    return;
  }

  const results: string[] = [];
  for (const item of items) {
    const url = await findArxivUrl(item);
    if (url) {
      const title = (item.getField("title") as string) || `Item ${item.id}`;
      results.push(`${title}\n${url}`);
    }
  }

  if (results.length === 0) {
    alert("未在所选条目中找到 arXiv URL。");
    return;
  }

  alert(results.join("\n\n"));
}
