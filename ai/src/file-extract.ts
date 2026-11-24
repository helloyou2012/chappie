/**
 * 文件文本提取：文本 / PDF / DOCX / XLSX（ExcelJS）。
 * 供 file.read 工具与自动附件上下文共用；调用方负责大小与字符数上限。
 */
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractText as extractPdfText } from 'unpdf';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function looksText(mime: string, name: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime.endsWith('+json') ||
    /\.(txt|md|markdown|json|csv|tsv|xml|ya?ml|log|html?)$/i.test(name)
  );
}

export function isPdf(mime: string, name: string): boolean {
  return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}

export function isDocx(mime: string, name: string): boolean {
  return mime === DOCX_MIME || name.toLowerCase().endsWith('.docx');
}

export function isSheet(mime: string, name: string): boolean {
  return mime === XLSX_MIME || name.toLowerCase().endsWith('.xlsx');
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function extractFileText(input: {
  mime: string;
  name: string;
  bytes: Uint8Array;
}): Promise<{ text: string } | { error: string }> {
  const { mime, name, bytes } = input;
  try {
    if (isPdf(mime, name)) {
      const parsed = await extractPdfText(bytes, { mergePages: true });
      return {
        text: Array.isArray(parsed.text) ? parsed.text.join('\n') : String(parsed.text ?? ''),
      };
    }
    if (isDocx(mime, name)) {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: result.value };
    }
    if (isSheet(mime, name)) {
      const workbook = new ExcelJS.Workbook();
      // ExcelJS 自带的 Buffer 类型与当前 @types/node 的泛型 Buffer 不一致，仅做类型收窄
      await workbook.xlsx.load(
        Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
      const parts: string[] = [];
      workbook.eachSheet((sheet) => {
        parts.push(`## ${sheet.name}`);
        let rowCount = 0;
        sheet.eachRow({ includeEmpty: false }, (row) => {
          if (rowCount >= 5000) return;
          rowCount += 1;
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => cells.push(csvCell(cell.text ?? '')));
          parts.push(cells.join(','));
        });
      });
      return { text: parts.join('\n\n') };
    }
    if (looksText(mime, name)) {
      return { text: new TextDecoder().decode(bytes) };
    }
    if (mime.startsWith('image/')) {
      return { error: `「${name}」是图片（${mime}），图片内容由多模态识别处理。` };
    }
    return { error: `暂不支持读取 ${mime || name} 类型的文件（支持文本、PDF、DOCX、XLSX）。` };
  } catch (e) {
    return { error: `文件解析失败：${String(e).slice(0, 200)}` };
  }
}
