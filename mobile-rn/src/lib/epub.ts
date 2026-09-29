/**
 * EPUB 打包（纯函数，不依赖任何原生模块，可在 Node 中直接测试）。
 *
 * 产出结构为 EPUB 3，并额外附一份 NCX 目录以兼容旧阅读器：
 *   mimetype                      （必须第一个条目且不压缩）
 *   META-INF/container.xml
 *   OEBPS/content.opf
 *   OEBPS/nav.xhtml / toc.ncx
 *   OEBPS/chapter-N.xhtml
 *   OEBPS/cover.(jpg|png)         （可选）
 *
 * 说明：只做「能正常打开、目录可跳转、正文可读」这一档，
 * 不做字体嵌入、CSS 排版与注释脚注——那些属于排版精修，超出导出范围。
 */
import { strToU8, zipSync } from "fflate";

export interface EpubChapter {
  title: string;
  content: string;
  /** 所属卷名；用于生成两级目录。 */
  volumeTitle?: string;
}

export interface EpubCover {
  bytes: Uint8Array;
  /** 扩展名小写，用于判定媒体类型：png / jpg / jpeg / webp 之外一律按 jpeg 处理。 */
  extension: string;
}

export interface EpubInput {
  title: string;
  description?: string;
  chapters: EpubChapter[];
  cover?: EpubCover | null;
  /** 打包时间，用于 dcterms:modified；缺省取当前时间。 */
  modifiedAt?: Date;
}

const XML_ESCAPES: Array<[RegExp, string]> = [
  [/&/g, "&amp;"],
  [/</g, "&lt;"],
  [/>/g, "&gt;"],
  [/"/g, "&quot;"],
  [/'/g, "&apos;"],
];

function escapeXml(value: string): string {
  let out = value;
  for (const [pattern, replacement] of XML_ESCAPES) out = out.replace(pattern, replacement);
  // 剔除 XML 1.0 不允许的控制字符，避免阅读器解析失败
  return out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** 把章节正文转成 XHTML 段落：空行分段，行内空白保留一个空格。 */
function contentToXhtml(content: string): string {
  const paragraphs = content
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "<p>（本章暂无正文）</p>";
  return paragraphs.map((line) => `    <p>${escapeXml(line)}</p>`).join("\n");
}

function chapterFileName(index: number): string {
  return `chapter-${index + 1}.xhtml`;
}

function chapterXhtml(chapter: EpubChapter): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" lang="zh">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(chapter.title)}</title>
  </head>
  <body>
    <h1>${escapeXml(chapter.title)}</h1>
${contentToXhtml(chapter.content)}
  </body>
</html>
`;
}

/** 由标题与时间拼一个稳定的 urn:uuid（不依赖平台的 crypto 实现）。 */
function buildIdentifier(title: string, modifiedAt: Date): string {
  let hash = 0x811c9dc5;
  const seed = `${title}|${modifiedAt.toISOString()}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  const stamp = modifiedAt.getTime().toString(16).padStart(12, "0").slice(-12);
  return `urn:uuid:${hex}-${stamp.slice(0, 4)}-4${stamp.slice(4, 7)}-a${stamp.slice(7, 10)}-${stamp}${hex}`;
}

/** 按卷分组后的目录结构：[{ volumeTitle, chapters: [{chapter, index}] }] */
function groupByVolume(chapters: EpubChapter[]): Array<{ volumeTitle: string | null; items: Array<{ chapter: EpubChapter; index: number }> }> {
  const groups: Array<{ volumeTitle: string | null; items: Array<{ chapter: EpubChapter; index: number }> }> = [];
  chapters.forEach((chapter, index) => {
    const volumeTitle = chapter.volumeTitle?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.volumeTitle === volumeTitle) last.items.push({ chapter, index });
    else groups.push({ volumeTitle, items: [{ chapter, index }] });
  });
  return groups;
}

function navXhtml(groups: ReturnType<typeof groupByVolume>): string {
  const items = groups.map((group) => {
    const links = group.items
      .map(({ chapter, index }) => `          <li><a href="${chapterFileName(index)}">${escapeXml(chapter.title)}</a></li>`)
      .join("\n");
    if (!group.volumeTitle) return links;
    return `        <li><span>${escapeXml(group.volumeTitle)}</span>\n          <ol>\n${links}\n          </ol>\n        </li>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh" lang="zh">
  <head>
    <meta charset="utf-8"/>
    <title>目录</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function tocNcx(title: string, identifier: string, groups: ReturnType<typeof groupByVolume>): string {
  let playOrder = 0;
  const points = groups.map((group) => {
    const children = group.items.map(({ chapter, index }) => {
      playOrder += 1;
      return `      <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
        <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
        <content src="${chapterFileName(index)}"/>
      </navPoint>`;
    }).join("\n");
    if (!group.volumeTitle) return children;
    playOrder += 1;
    return `    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${escapeXml(group.volumeTitle)}</text></navLabel>
      <content src="${chapterFileName(group.items[0].index)}"/>
${children}
    </navPoint>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

function coverMediaType(extension: string): string {
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/jpeg";
}

function coverFileName(extension: string): string {
  return `cover.${extension === "jpeg" ? "jpg" : extension}`;
}

export function buildEpub(input: EpubInput): Uint8Array {
  const title = input.title.trim() || "未命名作品";
  const modifiedAt = input.modifiedAt ?? new Date();
  const identifier = buildIdentifier(title, modifiedAt);
  const groups = groupByVolume(input.chapters);
  const coverName = input.cover ? coverFileName(input.cover.extension) : null;
  const coverType = input.cover ? coverMediaType(input.cover.extension) : null;

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // mimetype 必须是压缩包里的第一个条目且不压缩，否则阅读器会判定为非合法 EPUB
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`),
  };

  const manifest: string[] = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  const spine: string[] = [];

  input.chapters.forEach((chapter, index) => {
    const name = chapterFileName(index);
    files[`OEBPS/${name}`] = strToU8(chapterXhtml(chapter));
    manifest.push(`    <item id="chap${index + 1}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`    <itemref idref="chap${index + 1}"/>`);
  });

  if (coverName && coverType && input.cover) {
    files[`OEBPS/${coverName}`] = input.cover.bytes;
    manifest.push(`    <item id="cover-image" href="${coverName}" media-type="${coverType}" properties="cover-image"/>`);
    manifest.push('    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    files["OEBPS/cover.xhtml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" lang="zh">
  <head>
    <meta charset="utf-8"/>
    <title>封面</title>
  </head>
  <body>
    <div><img src="${coverName}" alt="封面"/></div>
  </body>
</html>
`);
    spine.unshift('    <itemref idref="cover"/>');
  }

  const description = input.description?.trim();
  files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh</dc:language>
${description ? `    <dc:description>${escapeXml(description)}</dc:description>\n` : ""}    <meta property="dcterms:modified">${modifiedAt.toISOString().replace(/\.\d+Z$/, "Z")}</meta>
${coverName ? '    <meta name="cover" content="cover-image"/>\n' : ""}  </metadata>
  <manifest>
${manifest.join("\n")}
  </manifest>
  <spine toc="ncx">
${spine.join("\n")}
  </spine>
</package>
`);
  files["OEBPS/nav.xhtml"] = strToU8(navXhtml(groups));
  files["OEBPS/toc.ncx"] = strToU8(tocNcx(title, identifier, groups));

  return zipSync(files);
}
