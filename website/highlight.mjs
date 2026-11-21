import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import yaml from "highlight.js/lib/languages/yaml";
for (const [name, grammar] of Object.entries({
  typescript,
  javascript,
  json,
  bash,
  xml,
  css,
  yaml,
}))
  hljs.registerLanguage(name, grammar);
const aliases = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  sh: "bash",
  shell: "bash",
  html: "xml",
  svg: "xml",
  yml: "yaml",
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function highlightCode(code, language = "") {
  const name = language.trim().toLowerCase();
  const resolved = aliases[name] ?? name;
  if (!hljs.getLanguage(resolved)) return `<code>${escape(code)}</code>`;
  return `<code class="hljs language-${resolved}">${hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value}</code>`;
}
