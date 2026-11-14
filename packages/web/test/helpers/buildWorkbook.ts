import writeXlsxFile from 'write-excel-file/node';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Cell = string | number | boolean | null | { formula: string };
export interface SheetSpec {
  name: string;
  rows: Cell[][];
  hidden?: boolean;
}

const toCell = (c: Cell) =>
  c !== null && typeof c === 'object' ? { type: 'Formula' as const, value: c.formula } : c;

/**
 * Builds an .xlsx from plain rows. write-excel-file cannot mark a sheet hidden,
 * so hidden sheets are patched into xl/workbook.xml (state="hidden") afterwards.
 * Output is byte-for-byte deterministic (fixed zip mtime).
 */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Uint8Array> {
  const buf = await writeXlsxFile(
    sheets.map((s) => ({ sheet: s.name, data: s.rows.map((r) => r.map(toCell)) })) as never,
  ).toBuffer();
  const files = unzipSync(new Uint8Array(buf));
  let wb = strFromU8(files['xl/workbook.xml']!);
  for (const s of sheets.filter((x) => x.hidden)) {
    const tag = `name="${s.name}"`;
    if (!wb.includes(`<sheet `) || !wb.includes(tag)) throw new Error(`sheet ${s.name} not found in workbook.xml`);
    wb = wb.replace(`${tag}`, `${tag} state="hidden"`);
  }
  files['xl/workbook.xml'] = strToU8(wb);
  return zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') });
}

export const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
