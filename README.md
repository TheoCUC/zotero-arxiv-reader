# arXiv Reader (Zotero Plugin)

A Zotero 7 plugin that fetches arXiv HTML, cleans clutter, provides bilingual translation with in-reader editing, and adds a translation progress panel plus Google Scholar search.

## Features

- Fetch arXiv HTML attachments from item URL/DOI/extra/archive fields, with duplicate handling.
- Clean HTML by hiding elements via configurable CSS selectors.
- Bilingual translation: translate paragraphs and insert translation blocks.
- Translation progress dialog with status and logs.
- In-reader translation editing via popup, context menu, and double-click.
- Google Scholar search based on item title.

## Settings

- HTML blocklist (CSS selectors, one per line).
- Inline external CSS (disabled by default).
- Translation providers: store multiple API services and select one.
- Parallel translation: optionally distribute paragraphs across multiple providers.
- Prompt management: select, preview, and add prompts.

## Development

```sh
npm start
```

## Build

```sh
npm run build
```

## Tests

```sh
npm test
```

## Release

```sh
npm run release
```

## Tech Stack

- TypeScript
- zotero-plugin-scaffold
- zotero-plugin-toolkit
- OpenAI-compatible translation API (default: https://api.openai.com/v1)

## Structure

- `src/index.ts`: plugin entry and global instance.
- `src/hooks.ts`: lifecycle hooks and registration.
- `src/modules/`: feature modules (fetch, clean, translate, edit, progress, menus).
- `addon/`: manifest, preferences UI, and locales.
