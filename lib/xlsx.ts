// Minimal, dependency-free .xlsx writer: a handful of XML parts packed into an
// uncompressed ZIP. Supports multiple sheets, a bold header row, column widths,
// and string / number / boolean cells.

export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  rows: Cell[][]; // first row is treated as the header
}

const enc = new TextEncoder();

function escapeXml(s: string): string {
  return s
    // Characters that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Excel sheet names: max 31 chars, no []:*?/\ and unique. */
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = s.name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(value: Cell, ref: string, header: boolean): string {
  const style = header ? ' s="1"' : "";
  if (value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  // Excel caps a cell at 32,767 characters.
  const text = escapeXml(String(value).slice(0, 32767));
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const colCount = Math.max(1, ...sheet.rows.map((r) => r.length));
  const widths = Array.from({ length: colCount }, (_, c) =>
    Math.min(80, Math.max(8, ...sheet.rows.map((r) => String(r[c] ?? "").length + 2))),
  );
  const cols = widths
    .map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const rows = sheet.rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((v, c) => cellXml(v, `${columnName(c)}${r + 1}`, r === 0)).join("")}</row>`,
    )
    .join("");
  const freeze =
    sheet.rows.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : "";
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${freeze}<cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`
  );
}

function workbookFiles(sheets: Sheet[]): [string, string][] {
  const names = sheetNames(sheets);
  const ns = "http://schemas.openxmlformats.org";
  return [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Types xmlns="${ns}/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        "</Types>",
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="${ns}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        "</Relationships>",
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets></workbook>",
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="${ns}/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ],
    [
      "xl/styles.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<styleSheet xmlns="${ns}/spreadsheetml/2006/main">` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        "</styleSheet>",
    ],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
}

// ---------- ZIP (store only, no compression) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: [string, string][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (2020 - 1980) << 9 | 1 << 5 | 1; // 2020-01-01

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true); // local header offset (other fields zero)

    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  return zip(workbookFiles(sheets));
}

export function downloadXlsx(filename: string, sheets: Sheet[]) {
  const blob = new Blob([buildXlsx(sheets) as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Reading ----------
// Handles files written by buildXlsx and the same files after being re-saved
// by Excel / Google Sheets / LibreOffice (deflated ZIP, shared strings, etc).

async function unzip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not an .xlsx file (no ZIP directory found). Old .xls files must be re-saved as .xlsx.");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("Corrupt .xlsx file.");
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (!/\.(xml|rels)$/.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) {
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`Unsupported compression in .xlsx file (method ${method}).`);
    files.set(name, dec.decode(data));
  }
  return files;
}

const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS("*", tag));
const textOf = (node: Element) => byTag(node, "t").map((t) => t.textContent ?? "").join("");

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export async function readXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const files = await unzip(buffer);
  const parse = (name: string) => {
    const xml = files.get(name);
    return xml ? new DOMParser().parseFromString(xml, "application/xml") : null;
  };

  const workbook = parse("xl/workbook.xml");
  if (!workbook) throw new Error("Not a spreadsheet: xl/workbook.xml is missing.");

  const targets = new Map<string, string>();
  for (const rel of byTag(parse("xl/_rels/workbook.xml.rels") ?? workbook, "Relationship")) {
    const target = rel.getAttribute("Target") ?? "";
    targets.set(rel.getAttribute("Id") ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const shared = byTag(parse("xl/sharedStrings.xml") ?? workbook, "si").map(textOf);
  const ridNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  return byTag(workbook, "sheet").map((sheet, i) => {
    const rid = sheet.getAttributeNS(ridNs, "id") ?? sheet.getAttribute("r:id") ?? "";
    const doc = parse(targets.get(rid) ?? `xl/worksheets/sheet${i + 1}.xml`);
    const rows: Cell[][] = [];
    if (doc) {
      byTag(doc, "row").forEach((rowEl, r) => {
        const rowNum = Number(rowEl.getAttribute("r")) || r + 1;
        const row: Cell[] = [];
        byTag(rowEl, "c").forEach((c, ci) => {
          const ref = c.getAttribute("r");
          const col = ref ? columnIndex(ref) : ci;
          const v = byTag(c, "v")[0]?.textContent ?? null;
          const type = c.getAttribute("t");
          let value: Cell;
          if (type === "s") value = v === null ? null : shared[Number(v)] ?? null;
          else if (type === "inlineStr") value = textOf(c);
          else if (type === "b") value = v === "1";
          else if (type === "str") value = v;
          else if (type === "e") value = null;
          else value = v === null || v === "" ? null : Number(v);
          row[col] = value;
        });
        rows[rowNum - 1] = Array.from(row, (x) => x ?? null);
      });
    }
    return { name: sheet.getAttribute("name") ?? `Sheet${i + 1}`, rows: Array.from(rows, (r) => r ?? []) };
  });
}
