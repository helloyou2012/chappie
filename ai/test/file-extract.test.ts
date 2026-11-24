/** 文件文本提取：文本 / XLSX / 不支持类型。 */
import { describe, expect, test } from 'bun:test';
import ExcelJS from 'exceljs';
import { extractFileText } from '../src/file-extract';

const enc = new TextEncoder();

describe('extractFileText', () => {
  test('文本文件', async () => {
    const result = await extractFileText({
      mime: 'text/plain',
      name: '周报.txt',
      bytes: enc.encode('销售额：12345 元'),
    });
    expect('text' in result && result.text).toContain('12345');
  });

  test('XLSX 转 CSV 文本', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('预算表');
    sheet.addRow(['项目', '预算']);
    sheet.addRow(['市场', 8888]);
    sheet.addRow(['研发', 6666]);
    const raw = await book.xlsx.writeBuffer();
    const result = await extractFileText({
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: '预算表.xlsx',
      bytes: new Uint8Array(raw),
    });
    expect('text' in result && result.text).toContain('预算表');
    expect('text' in result && result.text).toContain('8888');
    expect('text' in result && result.text).toContain('研发');
  });

  test('不支持的二进制类型返回错误', async () => {
    const result = await extractFileText({
      mime: 'application/zip',
      name: 'a.zip',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect('error' in result).toBe(true);
  });
});
