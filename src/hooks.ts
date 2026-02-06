import {
  registerTranslationEditPopup,
  registerTranslationEditContextMenu,
  registerTranslationEditDblClick,
  unregisterTranslationEditPopup,
  unregisterTranslationEditContextMenu,
  unregisterTranslationEditDblClick,
} from "./modules/translationEditor";
import {
  registerItemMenus,
  registerPreferencePane,
  registerToolsMenus,
} from "./modules/menus";
import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  try {
    Zotero.debug("[arXiv Reader] Registering preference pane...");
    registerPreferencePane();
    Zotero.debug("[arXiv Reader] Preference pane registered.");
  } catch (error: any) {
    Zotero.logError(error);
    Zotero.debug(
      `[arXiv Reader] Preference pane registration failed: ${
        error?.message ? String(error.message) : String(error)
      }`,
    );
  }

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(_win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  registerItemMenus();
  registerToolsMenus();

  registerTranslationEditPopup();
  registerTranslationEditContextMenu();
  registerTranslationEditDblClick();
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  unregisterTranslationEditPopup();
  unregisterTranslationEditContextMenu();
  unregisterTranslationEditDblClick();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {
  return;
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      try {
        Zotero.debug("[arXiv Reader] Preference pane loaded.");
        registerPrefsScripts(data.window);
        Zotero.debug("[arXiv Reader] Preference pane scripts initialized.");
      } catch (error: any) {
        Zotero.logError(error);
        Zotero.debug(
          `[arXiv Reader] Preference pane init failed: ${
            error?.message ? String(error.message) : String(error)
          }`,
        );
      }
      break;
    default:
      return;
  }
}

function onShortcuts(_type: string) {
  return;
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
};
