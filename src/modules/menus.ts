import { config } from "../../package.json";
import { attachArxivHtmlForSelection } from "./arxivDebug";
import { cleanHtmlAttachmentsForSelection } from "./htmlCleaner";
import { translateHtmlForSelection } from "./htmlTranslator";
import { openTranslationProgressDialog } from "./translationProgress";
import { openScholarForSelection } from "./scholarSearch";
import { getString } from "../utils/locale";

let prefsRegistered = false;
let itemMenusRegistered = false;
let toolsMenusRegistered = false;

function isHtmlAttachment(item: Zotero.Item): boolean {
  if (!item.isAttachment()) return false;
  const contentType = (item.attachmentContentType || "").toLowerCase();
  const filename = (item.attachmentFilename || "").toLowerCase();
  return (
    contentType.startsWith("text/html") ||
    filename.endsWith(".html") ||
    filename.endsWith(".htm")
  );
}

function shouldShowHtmlMenus(): boolean {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  if (!items || items.length === 0) return false;
  return items.every((item: Zotero.Item) => isHtmlAttachment(item));
}

export function registerPreferencePane() {
  if (prefsRegistered) return;
  prefsRegistered = true;
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}

export function registerItemMenus() {
  if (itemMenusRegistered) return;
  itemMenusRegistered = true;
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-arxiv-debug",
    label: "抓取arXiv网页",
    commandListener: () => attachArxivHtmlForSelection(),
    icon: menuIcon,
    isHidden: () => shouldShowHtmlMenus(),
  });
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-arxiv-html",
    label: "屏蔽无关元素",
    icon: menuIcon,
    isHidden: () => !shouldShowHtmlMenus(),
    commandListener: () => cleanHtmlAttachmentsForSelection(),
  });
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-arxiv-html-translate",
    label: "双语沉浸式翻译",
    icon: menuIcon,
    isHidden: () => !shouldShowHtmlMenus(),
    commandListener: () => translateHtmlForSelection(),
  });
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-google-scholar",
    label: "Google Scholar 搜索",
    icon: menuIcon,
    commandListener: () => openScholarForSelection(),
  });
}

export function registerToolsMenus() {
  if (toolsMenusRegistered) return;
  toolsMenusRegistered = true;
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "zotero-menu-translation-progress",
    label: "翻译进度",
    commandListener: () => openTranslationProgressDialog(),
  });
}
