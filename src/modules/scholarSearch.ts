function buildScholarQuery(item: Zotero.Item): string {
  const doi = (item.getField("DOI") as string) || "";
  if (doi) return doi;

  const title =
    (item.getField("title") as string) ||
    (item.getField("shortTitle") as string) ||
    "";
  const creator = item.firstCreator || "";
  const query = [title, creator].filter((v) => v && v.trim().length > 0).join(" ");
  return query || `Zotero Item ${item.id}`;
}

export function openScholarForSelection(): void {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const alert = ztoolkit.getGlobal("alert") as (msg: string) => void;
  if (!items || items.length === 0) {
    alert("未选中条目。");
    return;
  }

  const item = items[0];
  const query = buildScholarQuery(item);
  const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(
    query,
  )}`;
  Zotero.launchURL(url);

  if (items.length > 1) {
    alert("已打开第一个选中条目的 Google Scholar 搜索。");
  }
}
