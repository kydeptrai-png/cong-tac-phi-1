import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { ExpenseItem, MonthGroup } from '../types';
import { saveOrDownloadFile } from './fileSaver';

export type AmountUnitMode = 'thousand' | 'vnd' | 'auto_k';

export type WarningType =
  | 'missing_initial_day'
  | 'day_decreased'
  | 'missing_month'
  | 'invalid_day';

export interface RawCell {
  value: any;
  text: string;
  comment: string;
}

export interface SheetColumnOption {
  colIdx: number;
  colLetter: string;
  sampleValues: string[];
}

export interface SheetColumnMapping {
  dateColIdx: number;
  amountColIdx: number;
  descColIdx: number;
}

export interface RawSheetData {
  sheetName: string;
  rows: RawCell[][];
  availableColumns: SheetColumnOption[];
  detectedMapping: SheetColumnMapping;
}

export interface RawWorkbookData {
  fileName: string;
  sheets: RawSheetData[];
}

export interface PreviewExpenseItem extends ExpenseItem {
  rowIndex: number; // 1-based Excel row number
  monthNum: number | null; // 1..12
  year: number; // e.g. 2026
  day: number | null; // 1..31 or null
  rawAmount: number;
  isDateCellEmpty: boolean;
  hasManualDayEdit?: boolean;
  warnings: string[];
  warningTypes: WarningType[];
}

export interface ParsedSheetInfo {
  sheetName: string;
  rowCount: number;
  items: PreviewExpenseItem[];
  availableColumns: SheetColumnOption[];
  mapping: SheetColumnMapping;
  detectedMapping: SheetColumnMapping;
}

export interface ExcelImportResult {
  fileName: string;
  totalExpenses: number;
  sheets: ParsedSheetInfo[];
  items: PreviewExpenseItem[];
  monthsFound: string[];
  unitModeUsed: AmountUnitMode;
  startYearUsed: number;
  warningCount: number;
}

/**
 * Regex nhận diện dòng mốc tháng:
 * - "t" + số + "/" + năm        → ví dụ: t4/2026, t12/2025
 * - "t" + số (không năm)        → ví dụ: t1, t2, t3
 * - số tháng + "." + năm         → ví dụ: 9.2025, 10.2025, 11.2025
 * - "Tháng" + số (có thể có năm) → ví dụ: Tháng 9, Tháng 9/2025
 */
export const MONTH_MARKER_REGEX = /^(t|tháng|thang)?\s*(\d{1,2})\s*([./]\s*(\d{4}))?$/i;

/**
 * Rule 1 & Rule 2:
 * Kiểm tra cell ở cột "ngày" (kết hợp kiểm tra cell ở cột "số tiền" cùng dòng nếu truyền vào):
 * 1. Nếu cell ở cột "ngày" match MONTH_MARKER_REGEX VÀ cell ở cột "số tiền" cùng dòng
 *    đang TRỐNG (không có giá trị) → đây là dòng mốc tháng, không phải khoản chi.
 *    Lấy nhóm số đầu (\d{1,2}) làm "tháng" (1..12), nhóm năm (\d{4}, nếu có) làm "năm".
 * 2. Nếu KHÔNG match các dạng trên, hoặc cell "số tiền" cùng dòng CÓ giá trị
 *    → đây vẫn là 1 khoản chi bình thường, không phải mốc tháng.
 */
export function matchMonthHeader(
  text: string | number | null | undefined,
  amountCellValue?: string | number | null
): {
  isMonth: boolean;
  monthNum?: number;
  explicitYear?: number;
  monthLabel?: string;
  hasPrefixOrYear?: boolean;
} {
  // Rule 2: Nếu cell "số tiền" cùng dòng CÓ giá trị -> không phải mốc tháng
  if (
    amountCellValue !== undefined &&
    amountCellValue !== null &&
    String(amountCellValue).trim() !== ''
  ) {
    return { isMonth: false };
  }

  if (text === null || text === undefined) return { isMonth: false };
  const clean = String(text).trim();
  if (!clean) return { isMonth: false };

  const match = clean.match(MONTH_MARKER_REGEX);
  if (!match) return { isMonth: false };

  const num = parseInt(match[2], 10);
  if (isNaN(num) || num < 1 || num > 12) {
    return { isMonth: false };
  }

  const explicitYear = match[4] ? parseInt(match[4], 10) : undefined;
  const hasPrefixOrYear = Boolean(match[1] || match[4]);

  // Nếu không truyền amountCellValue (kiểm tra chuỗi đơn lẻ), yêu cầu phải có tiền tố (t/tháng) hoặc hậu tố năm (.YYYY / /YYYY)
  // để tránh nhầm số ngày/số tiền đơn lẻ "10" là mốc tháng khi gọi độc lập
  if (amountCellValue === undefined && !hasPrefixOrYear) {
    return { isMonth: false };
  }

  return {
    isMonth: true,
    monthNum: num,
    explicitYear,
    monthLabel: explicitYear ? `Tháng ${num}/${explicitYear}` : `Tháng ${num}`,
    hasPrefixOrYear,
  };
}

/**
 * Clean and parse raw numeric value (supporting negative numbers like -158 or (158))
 */
export function parseRawNumber(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }

  const str = String(val).trim();
  if (!str) return null;

  // Do not treat explicit month headers like "t1", "t4/2026", "9.2025", "Tháng 9" as numbers
  const mHeader = matchMonthHeader(str);
  if (mHeader.isMonth && mHeader.hasPrefixOrYear) return null;

  // Reject strings that contain letters (except trailing 'k', 'đ', 'vnd', 'd')
  const strippedCurrency = str.replace(/(?:vn[đd]|[đd]|k)\s*$/i, '').trim();
  if (/[a-zA-ZÀ-ỹ]/.test(strippedCurrency)) {
    return null;
  }

  // Check negative sign: "-158", "−158", "–158", "(158)"
  const isParenNeg = /^\([\d.,\s]+\)$/.test(strippedCurrency);
  const isMinusNeg = /^[-−–]\s*[\d.,]+/.test(strippedCurrency);
  const isNegative = isParenNeg || isMinusNeg;

  let cleaned = strippedCurrency.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  // Format handling: "116.000" vs "116,000" vs "17.5"
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '');
  } else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;
  return isNegative ? -Math.abs(parsed) : parsed;
}

/**
 * Rule 6 & Rule 7: Convert raw number to VNĐ according to selected unitMode,
 * preserving negative numbers (e.g. -158 -> -158000).
 */
export function parseAmount(val: any, unitMode: AmountUnitMode = 'thousand'): number {
  if (val === null || val === undefined || val === '') return 0;

  const str = typeof val === 'string' ? val.trim() : '';
  const isExplicitK = /[0-9]\s*k$/i.test(str);
  const rawNum = parseRawNumber(val);
  if (rawNum === null || rawNum === 0) return 0;

  if (isExplicitK) {
    return Math.round(rawNum * 1000);
  }

  if (unitMode === 'thousand') {
    return Math.round(rawNum * 1000);
  }

  if (unitMode === 'vnd') {
    return Math.round(rawNum);
  }

  // 'auto_k' fallback
  if (Math.abs(rawNum) > 0 && Math.abs(rawNum) < 1000) {
    return Math.round(rawNum * 1000);
  }

  return Math.round(rawNum);
}

/**
 * Parse a day of month (1..31) from a cell in the Date column
 */
export function parseDayFromCell(cell: RawCell | undefined): {
  isEmpty: boolean;
  day: number | null;
  explicitMonth?: number;
  explicitYear?: number;
  isInvalid: boolean;
} {
  if (!cell || (cell.value === '' && cell.text === '')) {
    return { isEmpty: true, day: null, isInvalid: false };
  }

  // Check if numeric
  if (typeof cell.value === 'number' && !isNaN(cell.value)) {
    if (Number.isInteger(cell.value) && cell.value >= 1 && cell.value <= 31) {
      return { isEmpty: false, day: cell.value, isInvalid: false };
    }
    // Check if Excel date serial number (e.g. > 20000)
    if (cell.value > 20000 && cell.value < 80000) {
      try {
        const dObj = XLSX.SSF.parse_date_code(cell.value);
        if (dObj && dObj.d >= 1 && dObj.d <= 31) {
          return {
            isEmpty: false,
            day: dObj.d,
            explicitMonth: dObj.m >= 1 && dObj.m <= 12 ? dObj.m : undefined,
            explicitYear: dObj.y >= 1990 && dObj.y <= 2100 ? dObj.y : undefined,
            isInvalid: false,
          };
        }
      } catch {
        // ignore
      }
    }
    return { isEmpty: false, day: null, isInvalid: true };
  }

  const s = cell.text.trim();
  if (!s) {
    return { isEmpty: true, day: null, isInvalid: false };
  }

  // Plain integer "1".."31" or "01".."31"
  if (/^\d{1,2}$/.test(s)) {
    const d = parseInt(s, 10);
    if (d >= 1 && d <= 31) {
      return { isEmpty: false, day: d, isInvalid: false };
    }
    return { isEmpty: false, day: null, isInvalid: true };
  }

  // Date string like "17/03", "17/03/2026", "17-3"
  const dmMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (dmMatch) {
    const d = parseInt(dmMatch[1], 10);
    const m = parseInt(dmMatch[2], 10);
    let y = dmMatch[3] ? parseInt(dmMatch[3], 10) : undefined;
    if (y !== undefined && y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return {
        isEmpty: false,
        day: d,
        explicitMonth: m,
        explicitYear: y,
        isInvalid: false,
      };
    }
  }

  // ISO Date string like "2026-03-17"
  const ymdMatch = s.match(/^(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10);
    const d = parseInt(ymdMatch[3], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return {
        isEmpty: false,
        day: d,
        explicitMonth: m,
        explicitYear: y,
        isInvalid: false,
      };
    }
  }

  return { isEmpty: false, day: null, isInvalid: true };
}

/**
 * Format DD/MM/YYYY from day, monthNum, year
 */
export function formatDayMonthYear(
  day: number | null | undefined,
  monthNum: number | null | undefined,
  year: number
): string {
  const mStr = monthNum && monthNum >= 1 && monthNum <= 12 ? String(monthNum).padStart(2, '0') : '??';
  if (day !== null && day !== undefined && !isNaN(day) && day >= 1 && day <= 31) {
    const dStr = String(Math.floor(day)).padStart(2, '0');
    return `${dStr}/${mStr}/${year}`;
  }
  return `??/${mStr}/${year}`;
}

/**
 * Check if row is a total/summary row
 */
export function isTotalRow(rowTexts: string[]): boolean {
  if (!Array.isArray(rowTexts)) return false;
  return rowTexts.some((cell) => {
    if (typeof cell !== 'string') return false;
    const lower = cell.toLowerCase().trim();
    return (
      lower === 'tổng' ||
      lower === 'tong' ||
      lower.startsWith('tổng cộng') ||
      lower.startsWith('tong cong') ||
      lower.startsWith('tổng tháng') ||
      lower.startsWith('tổng chi') ||
      lower === 'total' ||
      lower.startsWith('total ') ||
      lower === 'cộng' ||
      lower === 'cong'
    );
  });
}

/**
 * Check if row is a table header row (Ngày, Số tiền, Diễn giải...)
 */
function isHeaderRow(rowTexts: string[]): boolean {
  let matches = 0;
  for (const raw of rowTexts) {
    const s = (raw || '').toLowerCase().trim();
    if (!s) continue;
    if (s === 'ngày' || s === 'ngay' || s === 'date') matches++;
    else if (s === 'số tiền' || s === 'so tien' || s === 'tiền' || s === 'thành tiền' || s === 'amount') matches++;
    else if (s === 'diễn giải' || s === 'dien giai' || s === 'nội dung' || s === 'mô tả') matches++;
    else if (s === 'stt') matches++;
  }
  return matches >= 2;
}

/**
 * Rule 8: Extract clean comment text from SheetJS cell object
 */
function extractCommentFromSheetJSCell(cell: XLSX.CellObject | undefined): string {
  if (!cell || !cell.c || !Array.isArray(cell.c) || cell.c.length === 0) return '';
  const parts: string[] = [];

  for (const comment of cell.c) {
    if (!comment || typeof comment.t !== 'string') continue;
    let text = comment.t.replace(/\r\n/g, '\n').trim();
    if (!text) continue;

    // Strip threaded comment boilerplate if present
    const threadedMarker = 'Comment:\n';
    const markerIdx = text.indexOf(threadedMarker);
    if (markerIdx !== -1) {
      text = text.slice(markerIdx + threadedMarker.length).trim();
    }

    // Strip author prefix like "Author:\n" if author matches comment.a
    if (comment.a && typeof comment.a === 'string') {
      const author = comment.a.trim();
      if (author) {
        const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefixRegex = new RegExp(`^${escaped}\\s*:\\s*`, 'i');
        const stripped = text.replace(prefixRegex, '').trim();
        if (stripped.length > 0) {
          text = stripped;
        }
      }
    }

    if (text && !parts.includes(text)) {
      parts.push(text);
    }
  }

  return parts.join(' | ');
}

/**
 * Clean ExcelJS cell note if available
 */
function extractCommentFromExcelJSNote(note: any): string {
  if (!note) return '';
  let text = '';
  if (typeof note === 'string') {
    text = note.trim();
  } else if (typeof note === 'object' && Array.isArray(note.texts)) {
    text = note.texts
      .map((t: any) => (typeof t?.text === 'string' ? t.text : ''))
      .join('')
      .trim();
  }
  if (!text) return '';
  text = text.replace(/\r\n/g, '\n').trim();
  // If first line ends with ":" and there is a second line (typical Excel author line "Author:\nNote"), strip it if short
  const lines = text.split('\n');
  if (lines.length >= 2 && /^[^:]{1,25}:$/.test(lines[0].trim())) {
    const rest = lines.slice(1).join('\n').trim();
    if (rest) return rest;
  }
  return text;
}

/**
 * Rule 4: Auto-detect which column is Date, Amount, and Description in a sheet.
 * - Cột Ngày: chứa các mốc "t1, t2..." và số ngày (1-31)
 * - Cột Số tiền: chứa số lớn hơn (và cả số âm)
 * - Cột Diễn giải: chứa chữ dài nhất
 */
export function detectSheetColumns(
  rows: RawCell[][],
  nonEmptyColIndices: number[]
): SheetColumnMapping {
  if (nonEmptyColIndices.length === 0) {
    return { dateColIdx: 0, amountColIdx: 1, descColIdx: 2 };
  }
  if (nonEmptyColIndices.length === 1) {
    const c = nonEmptyColIndices[0];
    return { dateColIdx: c, amountColIdx: c + 1, descColIdx: c + 2 };
  }

  interface ColStats {
    colIdx: number;
    monthMarkers: number;
    dayNumbers: number; // integers 1..31
    otherNumbers: number; // < 1 (negative) or > 31 or decimals
    allNumbers: number;
    sumAbsNumbers: number;
    maxAbsNumber: number;
    textCells: number;
    totalTextLength: number;
    avgTextLength: number;
    isDateHeader: boolean;
    isAmountHeader: boolean;
    isDescHeader: boolean;
    isSttHeader: boolean;
  }

  const statsMap = new Map<number, ColStats>();

  for (const colIdx of nonEmptyColIndices) {
    const st: ColStats = {
      colIdx,
      monthMarkers: 0,
      dayNumbers: 0,
      otherNumbers: 0,
      allNumbers: 0,
      sumAbsNumbers: 0,
      maxAbsNumber: 0,
      textCells: 0,
      totalTextLength: 0,
      avgTextLength: 0,
      isDateHeader: false,
      isAmountHeader: false,
      isDescHeader: false,
      isSttHeader: false,
    };

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const rowTexts = row.map((c) => c?.text || '');
      if (isTotalRow(rowTexts)) continue;

      const cell = row[colIdx];
      if (!cell || (cell.text === '' && cell.value === '')) continue;

      const txt = cell.text.trim();
      const lower = txt.toLowerCase();

      // Check header keywords in early rows
      if (r < 10) {
        if (lower === 'ngày' || lower === 'ngay' || lower === 'date') {
          st.isDateHeader = true;
          continue;
        }
        if (
          lower === 'số tiền' ||
          lower === 'so tien' ||
          lower === 'tiền' ||
          lower === 'thành tiền' ||
          lower.startsWith('số tiền') ||
          lower === 'amount'
        ) {
          st.isAmountHeader = true;
          continue;
        }
        if (
          lower === 'diễn giải' ||
          lower === 'dien giai' ||
          lower === 'nội dung' ||
          lower === 'mô tả' ||
          lower === 'chi tiết'
        ) {
          st.isDescHeader = true;
          continue;
        }
        if (lower === 'stt') {
          st.isSttHeader = true;
          continue;
        }
      }

      // 1. Check month marker ("t1".."t12", "T 3", "Tháng 3")
      if (matchMonthHeader(txt).isMonth) {
        st.monthMarkers++;
        continue;
      }

      // 2. Check numeric value
      const num = parseRawNumber(cell.value !== '' ? cell.value : txt);
      if (num !== null) {
        st.allNumbers++;
        const abs = Math.abs(num);
        st.sumAbsNumbers += abs;
        if (abs > st.maxAbsNumber) st.maxAbsNumber = abs;

        if (Number.isInteger(num) && num >= 1 && num <= 31) {
          st.dayNumbers++;
        } else {
          st.otherNumbers++;
        }
        continue;
      }

      // 3. Check if date formatted string like "17/03"
      if (/^\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?$/.test(txt)) {
        st.dayNumbers++;
        st.allNumbers++;
        continue;
      }

      // 4. Otherwise it's a text description cell
      if (txt.length > 0) {
        st.textCells++;
        st.totalTextLength += txt.length;
      }
    }

    st.avgTextLength = st.textCells > 0 ? st.totalTextLength / st.textCells : 0;
    statsMap.set(colIdx, st);
  }

  // Handle 2-column tables (either [Date, Amount] or [Amount, Description])
  if (nonEmptyColIndices.length === 2) {
    const c0 = nonEmptyColIndices[0];
    const c1 = nonEmptyColIndices[1];
    const st0 = statsMap.get(c0)!;
    const st1 = statsMap.get(c1)!;
    const emptyColIdx = [0, 1, 2].find((idx) => !nonEmptyColIndices.includes(idx)) ?? Math.max(c0, c1) + 1;

    // If neither column has description text (or one column clearly has monthMarkers / Date header while the other is numeric Amount)
    const hasDescText = st0.textCells > 0 || st1.textCells > 0 || st0.isDescHeader || st1.isDescHeader;
    if (!hasDescText) {
      const c0DateScore = st0.monthMarkers * 350 + st0.dayNumbers * 12 - st0.otherNumbers * 30 + (st0.isDateHeader ? 600 : 0);
      const c1DateScore = st1.monthMarkers * 350 + st1.dayNumbers * 12 - st1.otherNumbers * 30 + (st1.isDateHeader ? 600 : 0);
      if (c0DateScore >= c1DateScore) {
        return { dateColIdx: c0, amountColIdx: c1, descColIdx: emptyColIdx };
      } else {
        return { dateColIdx: c1, amountColIdx: c0, descColIdx: emptyColIdx };
      }
    } else {
      // [Amount, Description]
      if (st0.allNumbers >= st1.allNumbers) {
        return { dateColIdx: emptyColIdx, amountColIdx: c0, descColIdx: c1 };
      } else {
        return { dateColIdx: emptyColIdx, amountColIdx: c1, descColIdx: c0 };
      }
    }
  }

  // 1. Pick Description Column: column with longest text ("cột chứa chữ dài nhất là Diễn giải")
  let descColIdx = nonEmptyColIndices[nonEmptyColIndices.length - 1];
  let bestDescScore = -Infinity;

  for (const colIdx of nonEmptyColIndices) {
    const st = statsMap.get(colIdx)!;
    const score =
      st.totalTextLength * 2.5 +
      st.avgTextLength * 12 +
      st.textCells * 8 +
      (st.isDescHeader ? 600 : 0) -
      st.allNumbers * 4 -
      st.monthMarkers * 100 -
      (st.isDateHeader || st.isAmountHeader || st.isSttHeader ? 500 : 0);

    if (score > bestDescScore) {
      bestDescScore = score;
      descColIdx = colIdx;
    }
  }

  // 2. Pick Date Column: column containing "t1, t2..." markers and day numbers (1..31)
  const remainingForDate = nonEmptyColIndices.filter((c) => c !== descColIdx);
  let dateColIdx = remainingForDate[0] ?? 0;
  let bestDateScore = -Infinity;

  for (const colIdx of remainingForDate) {
    const st = statsMap.get(colIdx)!;
    const avgNum = st.allNumbers > 0 ? st.sumAbsNumbers / st.allNumbers : 0;
    const validDayRatio = st.allNumbers > 0 ? st.dayNumbers / st.allNumbers : 0;

    const score =
      st.monthMarkers * 350 +
      st.dayNumbers * 12 +
      (validDayRatio >= 0.85 && st.dayNumbers > 0 ? 120 : 0) +
      (avgNum > 0 && avgNum <= 31 ? 60 : 0) -
      st.otherNumbers * 30 -
      (avgNum > 35 ? 100 : 0) +
      (st.isDateHeader ? 600 : 0) -
      (st.isAmountHeader ? 600 : 0) -
      (st.isSttHeader ? 500 : 0);

    if (score > bestDateScore) {
      bestDateScore = score;
      dateColIdx = colIdx;
    }
  }

  // 3. Pick Amount Column: column containing larger numbers (and negative numbers)
  const remainingForAmount = nonEmptyColIndices.filter(
    (c) => c !== descColIdx && c !== dateColIdx
  );
  let amountColIdx = remainingForAmount[0] ?? (dateColIdx + 1);
  let bestAmountScore = -Infinity;

  for (const colIdx of remainingForAmount) {
    const st = statsMap.get(colIdx)!;
    const avgNum = st.allNumbers > 0 ? st.sumAbsNumbers / st.allNumbers : 0;

    const score =
      st.allNumbers * 12 +
      st.otherNumbers * 30 +
      Math.min(avgNum, 2000) * 0.4 +
      (st.maxAbsNumber > 31 ? 120 : 0) +
      (st.isAmountHeader ? 600 : 0) -
      (st.isSttHeader ? 400 : 0);

    if (score > bestAmountScore) {
      bestAmountScore = score;
      amountColIdx = colIdx;
    }
  }

  return {
    dateColIdx,
    amountColIdx,
    descColIdx,
  };
}

/**
 * Step 1: Read raw Excel file into memory including cell comments and auto-detected columns per sheet
 */
export async function readRawExcelWorkbook(file: File): Promise<RawWorkbookData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
  });

  // Also try reading notes via ExcelJS for .xlsx files in case comments are stored as ExcelJS rich text notes
  const excelJSNotesMap = new Map<string, string>();
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    try {
      const ejWorkbook = new ExcelJS.Workbook();
      await ejWorkbook.xlsx.load(buffer);
      ejWorkbook.eachSheet((worksheet) => {
        const sName = worksheet.name;
        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            if (cell.note) {
              const noteText = extractCommentFromExcelJSNote(cell.note);
              if (noteText) {
                excelJSNotesMap.set(`${sName}!R${rowNumber - 1}C${colNumber - 1}`, noteText);
              }
            }
          });
        });
      });
    } catch {
      // Ignore if ExcelJS fails on older formats; SheetJS handles .xls and .xlsx
    }
  }

  const sheets: RawSheetData[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const maxCol = Math.min(range.e.c, 25);
    const maxRow = Math.min(range.e.r, 5000);

    const rows: RawCell[][] = [];
    const nonEmptyColsSet = new Set<number>();

    for (let r = 0; r <= maxRow; r++) {
      const rowCells: RawCell[] = [];
      let rowHasContent = false;

      for (let c = 0; c <= maxCol; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cellObj = sheet[addr] as XLSX.CellObject | undefined;

        let value: any = '';
        let text = '';
        if (cellObj && cellObj.v !== undefined && cellObj.v !== null) {
          value = cellObj.v;
          text = String(cellObj.v).trim();
          // If formatted text is cleaner for strings or month markers (e.g. "9.2020"), keep formatted text
          if (typeof cellObj.v === 'string') {
            text = cellObj.v.trim();
          } else if (cellObj.w) {
            const wTrim = String(cellObj.w).trim();
            if (typeof cellObj.v !== 'number' || MONTH_MARKER_REGEX.test(wTrim)) {
              text = wTrim;
            }
          }
        }

        let comment = extractCommentFromSheetJSCell(cellObj);
        const ejNote = excelJSNotesMap.get(`${sheetName}!R${r}C${c}`);
        if (!comment && ejNote) {
          comment = ejNote;
        }

        if (text !== '' || comment !== '') {
          rowHasContent = true;
          nonEmptyColsSet.add(c);
        }

        rowCells.push({ value, text, comment });
      }

      // Keep row in array at exact index r so 1-based Excel row number (r + 1) is preserved
      if (rowHasContent) {
        rows[r] = rowCells;
      } else {
        rows[r] = [];
      }
    }

    const nonEmptyCols = Array.from(nonEmptyColsSet).sort((a, b) => a - b);
    if (nonEmptyCols.length === 0) continue;

    // Build column options for user preview & manual override
    const maxColIdx = Math.max(...nonEmptyCols, 2);
    const availableColumns: SheetColumnOption[] = [];
    for (let c = 0; c <= maxColIdx; c++) {
      const colLetter = XLSX.utils.encode_col(c);
      const samples: string[] = [];
      for (let r = 0; r < rows.length && samples.length < 4; r++) {
        const cell = rows[r]?.[c];
        if (cell && cell.text !== '') {
          const short = cell.text.length > 18 ? cell.text.slice(0, 18) + '…' : cell.text;
          samples.push(short);
        }
      }
      if (samples.length > 0 || nonEmptyColsSet.has(c)) {
        availableColumns.push({
          colIdx: c,
          colLetter,
          sampleValues: samples,
        });
      }
    }

    const detectedMapping = detectSheetColumns(rows, nonEmptyCols);

    sheets.push({
      sheetName,
      rows,
      availableColumns,
      detectedMapping,
    });
  }

  return {
    fileName: file.name,
    sheets,
  };
}

/**
 * Re-validate preview items (Rule 9) whenever the user edits Month, Day, Amount, or Description in the preview table.
 */
export function revalidatePreviewItems(items: PreviewExpenseItem[]): PreviewExpenseItem[] {
  // Group items by sheetName in their current order to validate sequential days within each month
  const bySheet = new Map<string, PreviewExpenseItem[]>();
  for (const it of items) {
    const s = it.sheetName || 'Sheet1';
    if (!bySheet.has(s)) bySheet.set(s, []);
    bySheet.get(s)!.push(it);
  }

  const updatedMap = new Map<string, PreviewExpenseItem>();

  bySheet.forEach((sheetItems) => {
    let prevMonthKey = '';
    let prevDayInMonth: number | null = null;

    for (const item of sheetItems) {
      const monthNum = item.monthNum;
      const year = item.year;
      const day = item.day;

      const monthLabel =
        monthNum && monthNum >= 1 && monthNum <= 12
          ? `Tháng ${monthNum}/${year}`
          : item.month || `Chưa rõ tháng (${year})`;

      const dateStr = formatDayMonthYear(day, monthNum, year);

      const currentMonthKey = `${monthNum ?? 'none'}_${year}`;
      if (currentMonthKey !== prevMonthKey) {
        prevDayInMonth = null;
        prevMonthKey = currentMonthKey;
      }

      const warnings: string[] = [];
      const warningTypes: WarningType[] = [];

      // Check missing month
      if (!monthNum || monthNum < 1 || monthNum > 12) {
        warnings.push('Khoản chi xuất hiện trước khi có mốc tháng (t1..t12)');
        warningTypes.push('missing_month');
      }

      // Check day validity and order within the month
      if (day === null || day === undefined || isNaN(day)) {
        warnings.push(`Khoản chi xuất hiện trước khi có ngày nào trong ${monthLabel}`);
        warningTypes.push('missing_initial_day');
      } else if (day < 1 || day > 31) {
        warnings.push(`Ngày ${day} không hợp lệ (cần từ 1 đến 31)`);
        warningTypes.push('invalid_day');
      } else {
        if (prevDayInMonth !== null && day < prevDayInMonth) {
          warnings.push(
            `Ngày ${day} nhỏ hơn ngày liền trước (${prevDayInMonth}) trong cùng ${monthLabel} mà không có mốc tháng xen giữa (có thể là lỗi gõ liệu hoặc thiếu mốc tháng)`
          );
          warningTypes.push('day_decreased');
        }
        prevDayInMonth = day;
      }

      updatedMap.set(item.id, {
        ...item,
        month: monthLabel,
        date: dateStr,
        warnings,
        warningTypes,
      });
    }
  });

  return items.map((it) => updatedMap.get(it.id) || it);
}

/**
 * Step 2: Build the full import preview from RawWorkbookData using user options
 * (startYear, unitMode, and per-sheet column mappings)
 */
export function buildImportPreview(
  rawWorkbook: RawWorkbookData,
  options: {
    startYear: number;
    unitMode: AmountUnitMode;
    sheetMappings?: Record<string, SheetColumnMapping>;
    defaultMonthNum?: number | null;
    defaultDay?: number | null;
  }
): ExcelImportResult {
  const { startYear, unitMode, sheetMappings, defaultMonthNum = null, defaultDay = null } = options;
  const allItems: PreviewExpenseItem[] = [];
  const sheetsInfo: ParsedSheetInfo[] = [];
  const monthsFoundSet = new Set<string>();

  let currentYear = startYear;
  let lastMonthNum: number | null = null;

  for (const sheet of rawWorkbook.sheets) {
    const mapping = sheetMappings?.[sheet.sheetName] || sheet.detectedMapping;
    const { dateColIdx, amountColIdx, descColIdx } = mapping;

    // Check if the sheet has any month marker rows inside it
    let sheetHasInternalMonthMarkers = false;
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row || row.length === 0) continue;
      const dCell = row[dateColIdx];
      const aCell = row[amountColIdx];
      const dStr = dCell ? (dCell.text !== '' ? dCell.text : String(dCell.value ?? '')) : '';
      const aStr = aCell ? (aCell.text !== '' ? aCell.text : String(aCell.value ?? '')) : '';
      if (matchMonthHeader(dStr, aStr).isMonth) {
        sheetHasInternalMonthMarkers = true;
        break;
      }
    }

    let currentMonthNum: number | null =
      defaultMonthNum && defaultMonthNum >= 1 && defaultMonthNum <= 12
        ? defaultMonthNum
        : null;
    let currentDay: number | null =
      defaultDay && defaultDay >= 1 && defaultDay <= 31 ? defaultDay : null;

    // If sheet has no internal month markers, check if the sheet name itself is a month marker (e.g. "t3")
    if (!sheetHasInternalMonthMarkers) {
      const sheetMonthMatch = matchMonthHeader(sheet.sheetName);
      if (sheetMonthMatch.isMonth && sheetMonthMatch.monthNum) {
        if (sheetMonthMatch.explicitYear !== undefined) {
          currentYear = sheetMonthMatch.explicitYear;
        }
        lastMonthNum = sheetMonthMatch.monthNum;
        currentMonthNum = sheetMonthMatch.monthNum;
      }
    }

    const rawSheetItems: PreviewExpenseItem[] = [];

    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row || row.length === 0) continue;

      const dateCell: RawCell = row[dateColIdx] || { value: '', text: '', comment: '' };
      const amountCell: RawCell = row[amountColIdx] || { value: '', text: '', comment: '' };
      const descCell: RawCell = row[descColIdx] || { value: '', text: '', comment: '' };

      const dateCellStr =
        dateCell.text !== '' ? dateCell.text.trim() : String(dateCell.value ?? '').trim();
      const amountCellStr =
        amountCell.text !== '' ? amountCell.text.trim() : String(amountCell.value ?? '').trim();
      const descCellStr = descCell.text.trim();
      const isAmountCellEmpty = amountCellStr === '';

      // Rule 3: Completely empty row (no date, no amount, no description) -> skip without affecting currentDay
      if (dateCellStr === '' && isAmountCellEmpty && descCellStr === '') {
        // Check if another cell on this row is a standalone month header
        let standaloneMonth: ReturnType<typeof matchMonthHeader> | null = null;
        for (let c = 0; c < row.length; c++) {
          if (row[c]?.text) {
            const mCheck = matchMonthHeader(row[c].text);
            if (mCheck.isMonth) {
              standaloneMonth = mCheck;
              break;
            }
          }
        }
        if (standaloneMonth && standaloneMonth.monthNum) {
          if (standaloneMonth.explicitYear !== undefined) {
            currentYear = standaloneMonth.explicitYear;
          }
          lastMonthNum = standaloneMonth.monthNum;
          currentMonthNum = standaloneMonth.monthNum;
          currentDay = null; // Reset day when entering new month
        }
        continue;
      }

      const rowTexts = [dateCellStr, amountCellStr, descCellStr];
      if (isTotalRow(rowTexts) || isHeaderRow(rowTexts)) {
        continue;
      }

      // Rule 1 & Rule 2:
      // 1. Nếu cell ở cột "ngày" match regex VÀ cell ở cột "số tiền" cùng dòng đang TRỐNG
      //    -> đây là dòng mốc tháng, không phải khoản chi.
      // 2. Nếu KHÔNG match, hoặc cell "số tiền" cùng dòng CÓ giá trị
      //    -> đây vẫn là 1 khoản chi bình thường, không phải mốc tháng.
      const dateMonthCheck = isAmountCellEmpty
        ? matchMonthHeader(dateCellStr, amountCellStr)
        : { isMonth: false };
      // Nếu cột ngày có số đơn lẻ (không có "t"/"tháng" và không có năm) nhưng cột diễn giải có nội dung thì đó là khoản chi thiếu tiền, không phải mốc tháng
      const isValidDateColMonthMarker =
        dateMonthCheck.isMonth &&
        (dateMonthCheck.hasPrefixOrYear || descCellStr === '');

      const descMonthCheck =
        dateCellStr === '' && isAmountCellEmpty
          ? matchMonthHeader(descCellStr)
          : { isMonth: false };

      const activeMonthCheck = isValidDateColMonthMarker
        ? dateMonthCheck
        : descMonthCheck.isMonth && descMonthCheck.hasPrefixOrYear
        ? descMonthCheck
        : { isMonth: false };

      if (activeMonthCheck.isMonth && activeMonthCheck.monthNum) {
        const mNum = activeMonthCheck.monthNum;
        // Lấy nhóm số đầu làm "tháng", nhóm năm (nếu có) làm "năm";
        // nếu dòng không ghi năm thì giữ nguyên năm đang parse ở dòng mốc liền trước.
        if (activeMonthCheck.explicitYear !== undefined) {
          currentYear = activeMonthCheck.explicitYear;
        }
        lastMonthNum = mNum;
        currentMonthNum = mNum;
        // Reset day when entering a new month marker
        currentDay = null;
        continue;
      }

      // Parse amount & description
      const rawNum = parseRawNumber(amountCell.value !== '' ? amountCell.value : amountCell.text);
      const descVal = descCell.text.trim();

      // If row ONLY has a day number in Date column and no amount & no description, update currentDay and continue
      if (rawNum === null && descVal === '') {
        const dayOnly = parseDayFromCell(dateCell);
        if (dayOnly.day !== null) {
          currentDay = dayOnly.day;
          if (dayOnly.explicitMonth) {
            currentMonthNum = dayOnly.explicitMonth;
          }
          if (dayOnly.explicitYear) {
            currentYear = dayOnly.explicitYear;
          }
        }
        continue;
      }

      // Rule 2: Determine day of expense (explicit day 1-31 or forward-fill from currentDay)
      const dayParsed = parseDayFromCell(dateCell);
      let itemDay: number | null = null;
      const isDateCellEmpty = dayParsed.isEmpty;

      if (!isDateCellEmpty) {
        if (dayParsed.day !== null) {
          currentDay = dayParsed.day;
          itemDay = dayParsed.day;
          if (dayParsed.explicitMonth) {
            currentMonthNum = dayParsed.explicitMonth;
            lastMonthNum = dayParsed.explicitMonth;
          }
          if (dayParsed.explicitYear) {
            currentYear = dayParsed.explicitYear;
          }
        } else {
          // Invalid non-empty text in Date cell (e.g. "35" or "abc")
          itemDay = -1;
        }
      } else {
        // Forward-fill from nearest day above in the same month
        itemDay = currentDay;
      }

      // Rule 6 & Rule 7: Calculate amount according to unitMode, keeping negative amounts intact
      const numericRaw = rawNum ?? 0;
      const finalAmount = parseAmount(
        amountCell.value !== '' ? amountCell.value : amountCell.text,
        unitMode
      );

      // Skip if both amount is 0 and description is empty, or in clipboard mode when row has no numeric amount
      if (
        (finalAmount === 0 && descVal === '') ||
        (rawWorkbook.fileName === 'Clipboard_Excel' && (rawNum === null || finalAmount === 0))
      ) {
        continue;
      }

      // Rule 8: Extract cell comments (prioritizing Diễn giải cell, plus any comment on Date/Amount cell)
      const commentParts: string[] = [];
      if (descCell.comment) commentParts.push(descCell.comment);
      if (amountCell.comment && !commentParts.includes(amountCell.comment)) {
        commentParts.push(amountCell.comment);
      }
      if (dateCell.comment && !commentParts.includes(dateCell.comment)) {
        commentParts.push(dateCell.comment);
      }
      const notes = commentParts.length > 0 ? commentParts.join(' | ') : undefined;

      const monthLabel = currentMonthNum
        ? `Tháng ${currentMonthNum}/${currentYear}`
        : `Chưa rõ tháng (${currentYear})`;
      if (currentMonthNum) {
        monthsFoundSet.add(monthLabel);
      }

      const previewItem: PreviewExpenseItem = {
        id: `exp_${r}_${sheet.sheetName}_${Math.random().toString(36).substring(2, 8)}`,
        rowIndex: r + 1,
        month: monthLabel,
        monthNum: currentMonthNum,
        year: currentYear,
        day: itemDay,
        date: formatDayMonthYear(itemDay, currentMonthNum, currentYear),
        rawAmount: numericRaw,
        amount: finalAmount,
        description: descVal || (finalAmount < 0 ? 'Khoản hoàn/thu lại' : 'Khoản chi không tiêu đề'),
        images: [],
        sheetName: sheet.sheetName,
        notes,
        isDateCellEmpty,
        warnings: [],
        warningTypes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      rawSheetItems.push(previewItem);
    }

    const validatedSheetItems = revalidatePreviewItems(rawSheetItems);
    validatedSheetItems.forEach((it) => allItems.push(it));

    sheetsInfo.push({
      sheetName: sheet.sheetName,
      rowCount: validatedSheetItems.length,
      items: validatedSheetItems,
      availableColumns: sheet.availableColumns,
      mapping,
      detectedMapping: sheet.detectedMapping,
    });
  }

  const warningCount = allItems.filter((it) => it.warnings.length > 0).length;

  return {
    fileName: rawWorkbook.fileName,
    totalExpenses: allItems.length,
    sheets: sheetsInfo,
    items: allItems,
    monthsFound: Array.from(monthsFoundSet),
    unitModeUsed: unitMode,
    startYearUsed: startYear,
    warningCount,
  };
}

/**
 * Build a RawWorkbookData from a 2D array of cell values (useful for tests & direct programmatic parsing)
 */
export function createRawWorkbookFromRows(
  rawRows: (string | number | null | undefined)[][],
  fileName = 'TestWorkbook.xlsx',
  sheetName = 'Sheet1'
): RawWorkbookData {
  let maxCols = 0;
  for (const r of rawRows) {
    if (r && r.length > maxCols) maxCols = r.length;
  }
  const colCount = Math.max(maxCols, 3);
  const rows: RawCell[][] = [];
  const nonEmptyColsSet = new Set<number>();

  for (let r = 0; r < rawRows.length; r++) {
    const srcRow = rawRows[r] || [];
    const rowCells: RawCell[] = [];
    let rowHasContent = false;

    for (let c = 0; c < colCount; c++) {
      const cellVal = srcRow[c];
      const txt = cellVal !== null && cellVal !== undefined ? String(cellVal).trim() : '';
      const numVal = parseRawNumber(txt);
      const value: any =
        typeof cellVal === 'number'
          ? cellVal
          : numVal !== null && /^-?\d+(?:[.,]\d+)?$/.test(txt)
          ? numVal
          : txt;

      if (txt !== '') {
        rowHasContent = true;
        nonEmptyColsSet.add(c);
      }

      rowCells.push({
        value,
        text: txt,
        comment: '',
      });
    }

    rows[r] = rowHasContent ? rowCells : [];
  }

  const nonEmptyCols = Array.from(nonEmptyColsSet).sort((a, b) => a - b);
  const availableColumns: SheetColumnOption[] = [];
  for (let c = 0; c < colCount; c++) {
    const colLetter = XLSX.utils.encode_col(c);
    const samples: string[] = [];
    for (let r = 0; r < rows.length && samples.length < 4; r++) {
      const cell = rows[r]?.[c];
      if (cell && cell.text !== '') {
        const short = cell.text.length > 18 ? cell.text.slice(0, 18) + '…' : cell.text;
        samples.push(short);
      }
    }
    availableColumns.push({
      colIdx: c,
      colLetter,
      sampleValues: samples,
    });
  }

  const detectedMapping = detectSheetColumns(rows, nonEmptyCols);

  return {
    fileName,
    sheets: [
      {
        sheetName,
        rows,
        availableColumns,
        detectedMapping,
      },
    ],
  };
}

/**
 * Convenience wrapper to parse an Excel File directly
 */
export async function parseExcelWorkbook(
  file: File,
  unitMode: AmountUnitMode = 'thousand',
  startYear: number = new Date().getFullYear()
): Promise<ExcelImportResult> {
  const rawWorkbook = await readRawExcelWorkbook(file);
  return buildImportPreview(rawWorkbook, { startYear, unitMode });
}

/**
 * Split TSV (Tab-Separated Values) copied from Excel into 2D string cells,
 * properly handling multi-line quoted cells that Excel generates when a cell has Alt+Enter.
 */
function parseTSVRows(tsvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  const text = tsvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"' && currentCell === '') {
        inQuotes = true;
      } else if (ch === '\t') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Extract 2D table cells from HTML clipboard string (when copying from Excel / Google Sheets / WPS)
 */
function parseHTMLTableRows(htmlText: string): string[][] | null {
  if (!htmlText || typeof DOMParser === 'undefined') return null;
  if (!/<table/i.test(htmlText) || !/<tr/i.test(htmlText)) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;

    const trList = Array.from(table.querySelectorAll('tr'));
    if (trList.length === 0) return null;

    const matrix: string[][] = [];
    for (const tr of trList) {
      const cells = Array.from(tr.querySelectorAll('td, th'));
      if (cells.length === 0) continue;
      const rowValues: string[] = [];
      for (const td of cells) {
        // Replace <br> with space so multiline cell text stays clean
        const clone = td.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
        const cellText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        const colspan = Math.max(1, Math.min(10, parseInt(td.getAttribute('colspan') || '1', 10) || 1));
        rowValues.push(cellText);
        for (let k = 1; k < colspan; k++) {
          rowValues.push('');
        }
      }
      matrix.push(rowValues);
    }

    return matrix.length > 0 ? matrix : null;
  } catch {
    return null;
  }
}

/**
 * Quick check if clipboard text/html looks like tabular Excel data
 */
export function isClipboardTableLike(plainText: string, htmlText?: string): boolean {
  if (htmlText && /<table[\s>]/i.test(htmlText) && /<td[\s>]/i.test(htmlText)) {
    return true;
  }
  if (!plainText || !plainText.trim()) return false;
  if (plainText.includes('\t')) return true;

  // Check if multiple lines have pipe or 2+ spaces separating columns with numbers
  const lines = plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  let tabularLineCount = 0;
  for (const line of lines) {
    if (matchMonthHeader(line).isMonth) {
      tabularLineCount++;
      continue;
    }
    const parts = line.includes('|')
      ? line.split('|').map((s) => s.trim())
      : line.split(/\s{2,}/).map((s) => s.trim());
    if (parts.length >= 2 && parts.some((p) => parseRawNumber(p) !== null)) {
      tabularLineCount++;
    }
  }

  return tabularLineCount > 0 && tabularLineCount >= Math.ceil(lines.length * 0.5);
}

/**
 * Parse clipboard plain text (TSV) or HTML table into RawWorkbookData
 * so it uses the exact same column mapping, t1..t12 month markers, and forward-fill Day logic as Excel import.
 * Returns null if the content is not recognizable as a table.
 */
export function parseClipboardToRawWorkbook(
  plainText: string,
  htmlText?: string
): RawWorkbookData | null {
  let rawStringRows: string[][] | null = null;

  // 1. Prefer HTML table if available AND plainText doesn't have more rows
  const htmlRows = htmlText ? parseHTMLTableRows(htmlText) : null;
  const hasTabs = Boolean(plainText && plainText.includes('\t'));

  if (hasTabs) {
    rawStringRows = parseTSVRows(plainText);
  } else if (htmlRows && htmlRows.length > 0) {
    rawStringRows = htmlRows;
  } else if (plainText && plainText.trim()) {
    // Check if separated by '|' or 2+ spaces
    const lines = plainText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const splitRows: string[][] = [];
    let hasMultiCol = false;

    for (const line of lines) {
      if (matchMonthHeader(line).isMonth) {
        splitRows.push([line, '', '']);
        continue;
      }
      if (line.includes('|')) {
        const cols = line
          .split('|')
          .map((c) => c.trim())
          .filter((_, idx, arr) => !( (idx === 0 || idx === arr.length - 1) && arr[idx] === '' ));
        if (cols.length >= 2) hasMultiCol = true;
        splitRows.push(cols);
      } else if (/\s{2,}/.test(line)) {
        const cols = line.split(/\s{2,}/).map((c) => c.trim());
        if (cols.length >= 2) hasMultiCol = true;
        splitRows.push(cols);
      } else {
        // Also support simple "Day Amount Description" or "Amount Description" row if part of a pasted table
        const m3 = line.match(/^(\d{1,2}(?:[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)?)\s+(-?\d[\d.,]*k?)\s+(.+)$/i);
        if (m3) {
          hasMultiCol = true;
          splitRows.push([m3[1], m3[2], m3[3]]);
        } else {
          const m2 = line.match(/^(-?\d[\d.,]*k?)\s+(.+)$/i);
          if (m2 && parseRawNumber(m2[1]) !== null) {
            hasMultiCol = true;
            splitRows.push(['', m2[1], m2[2]]);
          } else {
            splitRows.push([line]);
          }
        }
      }
    }

    if (hasMultiCol) {
      rawStringRows = splitRows;
    }
  }

  if (!rawStringRows || rawStringRows.length === 0) {
    return null;
  }

  // Filter out trailing/leading completely empty rows and find max columns
  let maxCols = 0;
  for (const r of rawStringRows) {
    if (r.length > maxCols) maxCols = r.length;
  }

  if (maxCols === 0) return null;

  // Ensure at least 3 columns so Date / Amount / Description always have distinct slots
  const colCount = Math.max(maxCols, 3);
  const rows: RawCell[][] = [];
  const nonEmptyColsSet = new Set<number>();

  for (let r = 0; r < rawStringRows.length; r++) {
    const srcRow = rawStringRows[r];
    const rowCells: RawCell[] = [];
    let rowHasContent = false;

    for (let c = 0; c < colCount; c++) {
      const txt = (srcRow[c] ?? '').trim();
      const numVal = parseRawNumber(txt);
      // Keep raw numeric value if it's a pure number without currency suffix or slashes
      const value: any =
        numVal !== null && /^-?\d+(?:[.,]\d+)?$/.test(txt) ? numVal : txt;

      if (txt !== '') {
        rowHasContent = true;
        nonEmptyColsSet.add(c);
      }

      rowCells.push({
        value,
        text: txt,
        comment: '',
      });
    }

    rows[r] = rowHasContent ? rowCells : [];
  }

  const nonEmptyCols = Array.from(nonEmptyColsSet).sort((a, b) => a - b);
  if (nonEmptyCols.length === 0) return null;

  // Build availableColumns
  const availableColumns: SheetColumnOption[] = [];
  for (let c = 0; c < colCount; c++) {
    const colLetter = XLSX.utils.encode_col(c);
    const samples: string[] = [];
    for (let r = 0; r < rows.length && samples.length < 4; r++) {
      const cell = rows[r]?.[c];
      if (cell && cell.text !== '') {
        const short = cell.text.length > 18 ? cell.text.slice(0, 18) + '…' : cell.text;
        samples.push(short);
      }
    }
    availableColumns.push({
      colIdx: c,
      colLetter,
      sampleValues: samples,
    });
  }

  const detectedMapping = detectSheetColumns(rows, nonEmptyCols);

  return {
    fileName: 'Clipboard_Excel',
    sheets: [
      {
        sheetName: 'Vùng dán Excel',
        rows,
        availableColumns,
        detectedMapping,
      },
    ],
  };
}

/**
 * Chronological sort key for month labels like "Tháng 12/2025", "Tháng 1/2026", "Tháng 3"
 */
export function parseMonthYearSortKey(monthStr: string): number {
  if (!monthStr) return 99999999;
  const myMatch = monthStr.match(/0?([1-9]|1[0-2])\s*[\/\-]\s*(20\d{2}|\d{2})/);
  if (myMatch) {
    const m = parseInt(myMatch[1], 10);
    let y = parseInt(myMatch[2], 10);
    if (y < 100) y += 2000;
    return y * 100 + m;
  }
  const ymMatch = monthStr.match(/(20\d{2})\s*[\/\-]\s*0?([1-9]|1[0-2])/);
  if (ymMatch) {
    const y = parseInt(ymMatch[1], 10);
    const m = parseInt(ymMatch[2], 10);
    return y * 100 + m;
  }
  const mOnly = monthStr.match(/0?([1-9]|1[0-2])/);
  if (mOnly) {
    const m = parseInt(mOnly[1], 10);
    return 2026 * 100 + m;
  }
  return 99999999;
}

/**
 * Chronological sort key for date strings like "17/03/2026" or "2026-03-17"
 */
export function parseDateSortKey(dateStr: string): number {
  if (!dateStr) return 0;
  const dmy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (dmy) {
    const d = parseInt(dmy[1], 10) || 0;
    const m = parseInt(dmy[2], 10) || 0;
    let y = dmy[3] ? parseInt(dmy[3], 10) : 2026;
    if (y < 100) y += 2000;
    return y * 10000 + m * 100 + d;
  }
  const ymd = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10) || 2026;
    const m = parseInt(ymd[2], 10) || 0;
    const d = parseInt(ymd[3], 10) || 0;
    return y * 10000 + m * 100 + d;
  }
  return 0;
}

/**
 * Group expenses by month with totals (supporting negative refund items subtracted from total)
 */
export function groupExpensesByMonth(items: ExpenseItem[]): MonthGroup[] {
  const groupsMap = new Map<string, MonthGroup>();

  items.forEach((item) => {
    const monthKey = item.month || 'Chưa phân tháng';
    if (!groupsMap.has(monthKey)) {
      groupsMap.set(monthKey, {
        monthKey,
        monthTitle: monthKey,
        items: [],
        totalAmount: 0,
        count: 0,
      });
    }

    const group = groupsMap.get(monthKey)!;
    group.items.push(item);
    group.totalAmount += item.amount;
    group.count += 1;
  });

  const groups = Array.from(groupsMap.values());
  groups.sort((a, b) => {
    return parseMonthYearSortKey(a.monthKey) - parseMonthYearSortKey(b.monthKey);
  });

  return groups;
}

/**
 * Helper to determine image extension for ExcelJS
 */
function getImageExtension(dataUrl: string): 'jpeg' | 'png' | 'gif' {
  if (dataUrl.includes('image/png')) return 'png';
  if (dataUrl.includes('image/gif')) return 'gif';
  return 'jpeg';
}

/**
 * Helper to extract clean base64 data without data-uri prefix
 */
function extractBase64Data(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx !== -1) {
    return dataUrl.slice(commaIdx + 1);
  }
  return dataUrl;
}

/**
 * Asynchronously read natural dimensions (naturalWidth, naturalHeight) of an image
 */
export function getImageDimensions(dataUrl: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      resolve({ naturalWidth: 200, naturalHeight: 150 });
      return;
    }

    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width || 200;
      const h = img.naturalHeight || img.height || 150;
      resolve({ naturalWidth: w > 0 ? w : 200, naturalHeight: h > 0 ? h : 150 });
    };
    img.onerror = () => {
      resolve({ naturalWidth: 200, naturalHeight: 150 });
    };
    img.src = dataUrl;
  });
}

// Fixed uniform dimensions for receipt image cells:
// Excel column width ~26.5 corresponds to ~200px width
export const EXCEL_IMG_COL_WIDTH = 26.5;
// Excel row height 112.5 pt corresponds to exactly 150px (at 96 DPI: 150 * 72 / 96 = 112.5 pt)
export const EXCEL_IMG_ROW_HEIGHT = 112.5;
export const EXCEL_CELL_WIDTH_PX = 200;
export const EXCEL_CELL_HEIGHT_PX = 150;
export const EXCEL_CELL_PADDING_PX = 6;

/**
 * Export expenses to formatted Excel (.xlsx) file using ExcelJS
 * - Column order: STT, Ngày, Số tiền, Diễn giải, [Ảnh chứng từ 1, 2, ...], Danh mục
 * - Images are placed directly in consecutive horizontal cells on the same row, right after "Diễn giải"
 * - Each image cell has an alternating soft background color per expense item (e.g. soft sky blue vs soft amber/yellow)
 * - Row height (150px) & column widths (200px) are fixed and uniform
 * - Images strictly maintain natural aspect ratio without distortion, centered in the cell
 * - Empty expenses with no images have standard row height and uncolored blank cells
 * - Preserves monthly grouping and subtotal / grand total structure
 */
export async function exportExpensesToExcel(items: ExpenseItem[], reportTitle = 'Bao_Cao_Cong_Tac_Phi'): Promise<void> {
  const groups = groupExpensesByMonth(items);

  // Pre-load natural dimensions for all unique images asynchronously
  const uniqueImages = new Set<string>();
  items.forEach((item) => {
    item.images?.forEach((url) => {
      if (url) uniqueImages.add(url);
    });
  });

  const dimensionEntries = await Promise.all(
    Array.from(uniqueImages).map(async (url) => {
      const dims = await getImageDimensions(url);
      return [url, dims] as const;
    })
  );
  const imageDimensionsMap = new Map(dimensionEntries);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sổ Chi Tiêu & Công Tác Phí';
  workbook.lastModifiedBy = 'Sổ Chi Tiêu & Công Tác Phí';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Báo Cáo Chi Tiêu', {
    views: [{ showGridLines: true }],
  });

  // Determine the maximum number of images in any single expense
  let maxImages = 0;
  items.forEach((item) => {
    if (item.images && item.images.length > maxImages) {
      maxImages = item.images.length;
    }
  });

  // Base Columns:
  // Col 1 (A): STT (8)
  // Col 2 (B): Ngày (14)
  // Col 3 (C): Số tiền (20)
  // Col 4 (D): Diễn giải (38)
  // Col 5...(4 + maxImages): Ảnh chứng từ 1, 2, ... (width 26.5 each ~200px)
  const columns: Partial<ExcelJS.Column>[] = [
    { key: 'stt', width: 8 },
    { key: 'date', width: 14 },
    { key: 'amount', width: 20 },
    { key: 'description', width: 38 },
  ];

  if (maxImages > 0) {
    for (let i = 1; i <= maxImages; i++) {
      columns.push({
        key: `image_${i}`,
        width: EXCEL_IMG_COL_WIDTH, // ~200px fixed uniform width
      });
    }
  }

  worksheet.columns = columns;

  const totalCols = 4 + maxImages; // STT, Ngày, Số tiền, Diễn giải + maxImages

  // Title Row
  const titleRow = worksheet.addRow(['BÁO CÁO CÔNG TÁC PHÍ & CHI TIÊU CÁ NHÂN']);
  titleRow.height = 32;
  titleRow.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF0F766E' } };
  titleRow.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.mergeCells(1, 1, 1, Math.max(5, totalCols));

  // Subtitle / Date Row
  const dateRow = worksheet.addRow([
    `Ngày xuất báo cáo: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}${
      maxImages > 0 ? ' • (Ảnh chứng từ hiển thị theo từng ô ngang ngay sau Diễn giải)' : ''
    }`,
  ]);
  dateRow.height = 20;
  dateRow.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF64748B' } };
  dateRow.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.mergeCells(2, 1, 2, Math.max(5, totalCols));

  // Blank separation row
  const blankRow1 = worksheet.addRow([]);
  blankRow1.height = 12;

  let grandTotal = 0;
  let expenseItemWithImagesCounter = 0;

  // Alternating background colors for image cells per expense item with images
  // Style 1: Soft Sky/Ice Blue; Style 2: Soft Warm Yellow/Cream
  const imageCellColors = [
    {
      bg: 'FFE0F2FE', // Tailwind sky-100 / soft ice blue
      border: 'FFBAE6FD', // sky-200
    },
    {
      bg: 'FFFEF3C7', // Tailwind amber-100 / soft warm yellow
      border: 'FFFDE68A', // amber-200
    },
  ];

  // Render each Month Group
  for (const group of groups) {
    // 1. Month Header Banner
    const bannerRow = worksheet.addRow([`=== ${group.monthTitle.toUpperCase()} ===`]);
    bannerRow.height = 26;
    bannerRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F766E' } };
    bannerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    bannerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0FDFA' }, // Light teal
    };
    worksheet.mergeCells(bannerRow.number, 1, bannerRow.number, Math.max(5, totalCols));

    // 2. Table Column Headers
    const headerValues: string[] = ['STT', 'Ngày', 'Số tiền (VNĐ)', 'Diễn giải'];
    if (maxImages > 0) {
      for (let i = 1; i <= maxImages; i++) {
        headerValues.push(maxImages === 1 ? 'Ảnh chứng từ' : `Ảnh chứng từ ${i}`);
      }
    }

    const headerRow = worksheet.addRow(headerValues);
    headerRow.height = 28;
    headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    headerRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F766E' }, // Dark teal
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF0D9488' } },
        left: { style: 'thin', color: { argb: 'FF0D9488' } },
        bottom: { style: 'thin', color: { argb: 'FF0D9488' } },
        right: { style: 'thin', color: { argb: 'FF0D9488' } },
      };
      if (colNumber === 4) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else if (colNumber === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });

    // 3. Sort items within month by date chronologically
    const sortedItems = [...group.items].sort(
      (a, b) => parseDateSortKey(a.date || '') - parseDateSortKey(b.date || '')
    );

    for (let index = 0; index < sortedItems.length; index++) {
      const item = sortedItems[index];
      const imgCount = item.images?.length || 0;
      const hasImages = imgCount > 0;

      // Construct row data
      const rowValues: any[] = [
        index + 1,
        item.date,
        item.amount,
        item.description,
      ];

      // Add slots for images (cells immediately after Diễn giải)
      if (maxImages > 0) {
        for (let i = 0; i < maxImages; i++) {
          rowValues.push('');
        }
      }

      const dataRow = worksheet.addRow(rowValues);
      if (item.notes) {
        dataRow.getCell(4).note = item.notes;
      }

      // Height: If has images, set 112.5pt (150px) fixed & uniform for all rows with images
      dataRow.height = hasImages ? EXCEL_IMG_ROW_HEIGHT : 26;

      // Determine alternating color scheme for this row if it has images
      const colorScheme = hasImages
        ? imageCellColors[expenseItemWithImagesCounter % imageCellColors.length]
        : null;

      if (hasImages) {
        expenseItemWithImagesCounter++;
      }

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = { vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        if (colNumber === 1 || colNumber === 2) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (colNumber === 3) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0 "₫"';
          cell.font = { name: 'Arial', size: 10, bold: true };
        } else if (colNumber === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        } else if (colNumber > 4 && colNumber <= totalCols) {
          // Image cells immediately after Diễn giải
          const imgSlotIdx = colNumber - 5; // 0-based image index
          if (hasImages && colorScheme && imgSlotIdx < imgCount) {
            // Apply distinct alternating background color to cells containing photos
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: colorScheme.bg },
            };
            cell.border = {
              top: { style: 'thin', color: { argb: colorScheme.border } },
              left: { style: 'thin', color: { argb: colorScheme.border } },
              bottom: { style: 'thin', color: { argb: colorScheme.border } },
              right: { style: 'thin', color: { argb: colorScheme.border } },
            };
          }
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      });

      // Embed images horizontally in consecutive cells right after Diễn giải (Col 5, 6, ...)
      if (hasImages && item.images) {
        for (let imgIdx = 0; imgIdx < item.images.length; imgIdx++) {
          const imgDataUrl = item.images[imgIdx];
          if (!imgDataUrl) continue;

          try {
            const ext = getImageExtension(imgDataUrl);
            const b64 = extractBase64Data(imgDataUrl);

            const imageId = workbook.addImage({
              base64: b64,
              extension: ext,
            });

            // Read original natural dimensions (naturalWidth, naturalHeight)
            const { naturalWidth, naturalHeight } = imageDimensionsMap.get(imgDataUrl) || {
              naturalWidth: 200,
              naturalHeight: 150,
            };

            // Usable dimensions within the cell (200px x 150px) leaving a clean margin
            const maxContentWidth = EXCEL_CELL_WIDTH_PX - EXCEL_CELL_PADDING_PX * 2; // 188px
            const maxContentHeight = EXCEL_CELL_HEIGHT_PX - EXCEL_CELL_PADDING_PX * 2; // 138px

            // Calculate scale ratio: min(cellWidth / naturalWidth, cellHeight / naturalHeight)
            // Preserves original aspect ratio, never stretches/distorts, never scales up beyond natural size (max 1)
            const scale = Math.min(
              maxContentWidth / naturalWidth,
              maxContentHeight / naturalHeight,
              1
            );

            const imgWidth = Math.max(1, Math.round(naturalWidth * scale));
            const imgHeight = Math.max(1, Math.round(naturalHeight * scale));

            // Center image inside the 200px x 150px cell:
            // Calculate equal left/right and top/bottom offsets
            const offsetX = (EXCEL_CELL_WIDTH_PX - imgWidth) / 2;
            const offsetY = (EXCEL_CELL_HEIGHT_PX - imgHeight) / 2;

            // Express offsets as decimals for col/row in top-left anchor (tl)
            const colOffsetFraction = Number((offsetX / EXCEL_CELL_WIDTH_PX).toFixed(4));
            const rowOffsetFraction = Number((offsetY / EXCEL_CELL_HEIGHT_PX).toFixed(4));

            // Target column index: 0-indexed column 4 + imgIdx (which corresponds to 1-based col 5, 6, ...)
            const targetCol0 = 4 + imgIdx;
            // Target row index: 0-indexed dataRow.number - 1
            const targetRow0 = dataRow.number - 1;

            // Anchor only top-left (tl) with fractional offset and fixed pixel ext { width, height }
            // Do NOT use 'br' anchor (which stretches image to cell), editAs: 'oneCell'
            worksheet.addImage(imageId, {
              tl: {
                col: targetCol0 + colOffsetFraction,
                row: targetRow0 + rowOffsetFraction,
              },
              ext: { width: imgWidth, height: imgHeight },
              editAs: 'oneCell',
            });
          } catch (imgErr) {
            console.warn(`Lỗi khi nhúng ảnh #${imgIdx + 1} của khoản chi "${item.description}":`, imgErr);
          }
        }
      }
    }

    // 4. Month Total Row
    const monthTotalValues: any[] = [
      '',
      `TỔNG CỘNG ${group.monthTitle.toUpperCase()}`,
      group.totalAmount,
      `Tổng số: ${group.count} khoản chi`,
    ];
    if (maxImages > 0) {
      for (let i = 0; i < maxImages; i++) {
        monthTotalValues.push('');
      }
    }

    const monthTotalRow = worksheet.addRow(monthTotalValues);
    monthTotalRow.height = 26;
    monthTotalRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0F766E' } };

    monthTotalRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0FDF4' }, // Light emerald
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF86EFAC' } },
        bottom: { style: 'thin', color: { argb: 'FF86EFAC' } },
      };
      if (colNumber === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else if (colNumber === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0 "₫"';
      } else {
        cell.alignment = { vertical: 'middle' };
      }
    });

    grandTotal += group.totalAmount;

    // Blank row between months
    const monthSepRow = worksheet.addRow([]);
    monthSepRow.height = 14;
  }

  // Grand Total Summary Row
  const grandTotalValues: any[] = [
    '',
    'TỔNG CỘNG TOÀN BỘ CHI PHÍ:',
    grandTotal,
    `Tổng cộng: ${items.length} khoản chi`,
  ];
  if (maxImages > 0) {
    for (let i = 0; i < maxImages; i++) {
      grandTotalValues.push('');
    }
  }

  const grandTotalRow = worksheet.addRow(grandTotalValues);
  grandTotalRow.height = 32;
  grandTotalRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF134E4A' } };

  grandTotalRow.eachCell((cell, colNumber) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFCCFBF1' }, // Teal 100
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0F766E' } },
      bottom: { style: 'double', color: { argb: 'FF0F766E' } },
    };
    if (colNumber === 2) {
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    } else if (colNumber === 3) {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0 "₫"';
    } else {
      cell.alignment = { vertical: 'middle' };
    }
  });

  // Generate binary buffer & trigger download via unified file saver (Requirement 2)
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${reportTitle}_${dateStr}.xlsx`;

  await saveOrDownloadFile({
    blob,
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    title: reportTitle,
    text: 'Báo cáo chi tiêu công tác phí định dạng Excel',
  });
}
