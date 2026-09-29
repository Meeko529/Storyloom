/**
 * Word（.docx）正文提取。
 *
 * .docx 本质是 zip 压缩包，正文在 `word/document.xml`。这里只取文字：
 * 段落转行、制表符与换行保留；样式、图片、批注、页眉页脚一律丢弃。
 * 旧版二进制 .doc 不适用（不是 zip 结构），调用方需给出提示。
 *
 * 纯函数、不依赖原生模块，可在 Node 中直接测试。
 */
import { strFromU8, unzipSync } from "fflate";

const XML_ENTITIES: Array<[RegExp, string]> = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, "\""],
  [/&apos;/g, "'"],
  [/&amp;/g, "&"],
];

/** 还原 `&#123;` 与 `&#x1F600;` 这类数字实体（Word 会用它表示部分符号）。 */
function decodeNumericEntities(value: string): string {
  return value.replace(/&#(x?)([0-9a-fA-F]+);/g, (match, hex: string, digits: string) => {
    const code = Number.parseInt(digits, hex ? 16 : 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export function docxXmlToText(xml: string): string {
  let text = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  for (const [pattern, replacement] of XML_ENTITIES) text = text.replace(pattern, replacement);
  text = decodeNumericEntities(text);
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 解出 docx 正文文字；文件损坏或不是有效的 Word 文档时抛出可读错误。 */
export function readDocxText(bytes: Uint8Array): string {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error("这个文件不是有效的 Word 文档（.docx）。若它其实是旧版 .doc，请先在 Word 里另存为 .docx 或纯文本");
  }
  const entryName = Object.keys(archive).find((name) => name === "word/document.xml")
    ?? Object.keys(archive).find((name) => name.endsWith("document.xml"));
  if (!entryName) throw new Error("这个 Word 文档里没有找到正文（可能是空白文档）");
  const text = docxXmlToText(strFromU8(archive[entryName]));
  if (!text) throw new Error("这个 Word 文档的正文是空的");
  return text;
}
