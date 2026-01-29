pref(
  "extensions.zotero.arxiv-reader.htmlBlocklist",
  "header.desktop_header\nbutton#openForm",
);
pref("extensions.zotero.arxiv-reader.inlineCss", false);
pref(
  "extensions.zotero.arxiv-reader.translationApiBaseUrl",
  "https://api.openai.com/v1",
);
pref("extensions.zotero.arxiv-reader.translationApiKey", "");
pref("extensions.zotero.arxiv-reader.translationModel", "gpt-4o-mini");
pref("extensions.zotero.arxiv-reader.translationRPM", 2000);
pref(
  "extensions.zotero.arxiv-reader.translationProviders",
  '[{"id":"openai","name":"OpenAI","apiBaseUrl":"https://api.openai.com/v1","apiKey":"","model":"gpt-4o-mini","rpm":2000}]',
);
pref("extensions.zotero.arxiv-reader.translationProviderSelection", "openai");
pref("extensions.zotero.arxiv-reader.translationParallelEnabled", false);
pref("extensions.zotero.arxiv-reader.translationParallelProviders", "[]");
pref(
  "extensions.zotero.arxiv-reader.translationPrompts",
  '[{"id":"academic-translate","name":"学术翻译","content":"1. 你的名字是学术翻译，你是一个非常了解研究和学术写作的研究者。\\n2. 你可以将英语学术文本翻译成中文，同时确保翻译符合中文的语言习惯。\\n3. 你擅长重新排序和重组源材料，使其对中文听众来说更自然流畅，而不改变原意。\\n4. 这个GPT去除了已发表文献中的引用编号，以提高中文版本的可读性。\\n5. 识别数据单位，并保持英文单位，遵守学术语言标准。\\n6. 翻译输出旨在在语法和风格上适合中文学术环境，尊重专业规范，避免使用随意表达。"},{"id":"translate-zh","name":"翻译为中文","content":"请将以下内容翻译为中文，保持术语准确。"},{"id":"summary-zh","name":"中文要点摘要","content":"请用中文给出要点列表（不超过5条）。"}]',
);
pref(
  "extensions.zotero.arxiv-reader.translationPromptSelection",
  "academic-translate",
);
