import { GoogleGenAI, Type } from '@google/genai';
import { NaturalExpenseParsed, ReceiptScanResult } from '../types';

export const USER_GEMINI_KEY_STORAGE = 'user_gemini_api_key';

/**
 * Retrieves user-configured Gemini API Key from local device storage
 */
export function getUserApiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(USER_GEMINI_KEY_STORAGE)?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Saves or clears user's Gemini API Key in local device storage
 */
export function setUserApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(USER_GEMINI_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(USER_GEMINI_KEY_STORAGE);
    }
  } catch (err) {
    console.warn('Failed to save API key to localStorage:', err);
  }
}

/**
 * Checks if user has provided an API key on device
 */
export function hasUserApiKey(): boolean {
  return getUserApiKey().length > 0;
}

/**
 * Requirement 6: Test Gemini API key to confirm it works
 */
export async function testGeminiApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { success: false, message: 'Khóa API không được để trống.' };
  }

  // 1. Try server test endpoint if reachable
  try {
    const res = await fetch('/api/test-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': cleanKey,
      },
      body: JSON.stringify({ ping: true }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        return { success: true, message: 'Khóa API hoạt động chính xác!' };
      }
    }
  } catch {
    // If server not running (e.g. static APK), proceed to direct client test
  }

  // 2. Direct client SDK test using GoogleGenAI
  try {
    const ai = new GoogleGenAI({ apiKey: cleanKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Ping: trả lời OK nếu nhận được',
    });

    if (response.text) {
      return { success: true, message: 'Kết nối thành công! Khóa API Gemini hoạt động tốt.' };
    }
    return { success: false, message: 'Không nhận được phản hồi từ mô hình Gemini.' };
  } catch (err: any) {
    const msg = err?.message || 'Khóa API không hợp lệ';
    if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('403')) {
      return { success: false, message: 'Khóa API không hợp lệ hoặc chưa được kích hoạt trên Google AI Studio.' };
    }
    return { success: false, message: `Lỗi kết nối: ${msg}` };
  }
}

/**
 * Requirement 1: Compress an image file or Blob before saving:
 * - Scales the longest edge down to at most ~1280px
 * - Preserves exact original aspect ratio
 * - Exports JPEG with quality ~0.7 so Excel & JSON backup files remain lightweight
 */
export async function compressImage(
  file: File | Blob,
  maxDimension = 1280,
  quality = 0.7
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;
        let width = naturalW;
        let height = naturalH;

        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.max(1, Math.round((height * maxDimension) / width));
            width = maxDimension;
          } else {
            width = Math.max(1, Math.round((width * maxDimension) / height));
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        // Fill white background for transparent PNGs converted to JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Call Gemini OCR to scan receipt:
 * 1. Checks internet connectivity (fails gracefully with explanation if offline)
 * 2. Tries server-side proxy route with user's key header
 * 3. Falls back to direct client-side SDK if packaged in APK without server
 */
export async function scanReceiptWithAI(imageBase64: string): Promise<{
  success: boolean;
  data?: ReceiptScanResult;
  error?: string;
  needApiKey?: boolean;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      success: false,
      error: 'Thiết bị đang ngoại tuyến. Khi có Internet, AI sẽ tự động đọc hóa đơn. Bạn vẫn có thể đính kèm ảnh và lưu khoản chi bình thường!',
    };
  }

  const userKey = getUserApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (userKey) {
    headers['x-gemini-api-key'] = userKey;
  }

  // 1. Try server proxy endpoint
  try {
    const res = await fetch('/api/scan-receipt', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imageBase64,
        mimeType: 'image/jpeg',
      }),
    });

    if (res.status === 401) {
      return {
        success: false,
        error: 'Chưa cài đặt khóa Gemini API. Vui lòng bấm vào Cài đặt để thêm khóa API miễn phí từ Google AI Studio.',
        needApiKey: true,
      };
    }

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        return {
          success: true,
          data: json.data,
        };
      }
      return {
        success: false,
        error: json.error || 'Không thể nhận diện hóa đơn',
      };
    }
  } catch (netErr) {
    console.warn('Server proxy unavailable, checking client-side SDK...', netErr);
  }

  // 2. Direct client-side SDK execution (for APK or standalone client)
  if (userKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: userKey });
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

      const promptText = `
Bạn là chuyên gia kế toán phân tích hóa đơn, phiếu thu, phiếu chi, biên lai, vé tàu xe và chứng từ thanh toán tiếng Việt.
Trích xuất:
1. amount: Tổng số tiền thanh toán cuối cùng bằng số nguyên VNĐ (ví dụ: 45000, 150000).
2. description: Diễn giải ngắn gọn nội dung chi tiêu kèm tên cửa hàng nếu có (ví dụ: "Ăn trưa cơm văn phòng", "Cà phê gặp đối tác").
3. date: Ngày phát sinh DD/MM/YYYY nếu có.
4. merchant: Tên cửa hàng nếu có.
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            { inlineData: { data: cleanBase64, mimeType: 'image/jpeg' } },
            { text: promptText },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              amount: { type: Type.NUMBER },
              description: { type: Type.STRING },
              date: { type: Type.STRING },
              merchant: { type: Type.STRING },
            },
            required: ['amount', 'description'],
          },
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return {
        success: true,
        data: parsed,
      };
    } catch (clientErr: any) {
      return {
        success: false,
        error: clientErr?.message || 'Không thể nhận diện hóa đơn qua AI',
      };
    }
  }

  return {
    success: false,
    error: 'Chưa có khóa Gemini API. Vui lòng mở Cài đặt (biểu tượng bánh răng) để dán khóa API của bạn.',
    needApiKey: true,
  };
}

/**
 * Fallback parser using regular expressions for amount, date, and description
 * If Gemini API is unavailable, offline, or returns an error.
 */
export function parseNaturalExpenseWithRegex(
  rawText: string,
  refDate = new Date()
): NaturalExpenseParsed {
  let text = rawText.trim();
  const targetDate = new Date(refDate);

  // 1. Parse date keywords
  if (/\bhôm qua\b/i.test(text)) {
    targetDate.setDate(targetDate.getDate() - 1);
    text = text.replace(/\bhôm qua\b/gi, ' ');
  } else if (/\bhôm kia\b/i.test(text)) {
    targetDate.setDate(targetDate.getDate() - 2);
    text = text.replace(/\bhôm kia\b/gi, ' ');
  } else if (/\bhôm nay\b/i.test(text)) {
    text = text.replace(/\bhôm nay\b/gi, ' ');
  } else {
    const dayMatch = text.match(/\bngày\s*(\d{1,2})(?:[\/\-](\d{1,2}))?\b/i);
    if (dayMatch) {
      const d = parseInt(dayMatch[1], 10);
      const m = dayMatch[2] ? parseInt(dayMatch[2], 10) - 1 : targetDate.getMonth();
      if (d >= 1 && d <= 31) {
        targetDate.setDate(d);
        targetDate.setMonth(m);
        text = text.replace(dayMatch[0], ' ');
      }
    }
  }

  // 2. Parse Amount with regex
  let amount = 0;
  let matchedSnippet = '';

  // 2a. Compound (e.g. 1tr2, 2 triệu 5)
  const compoundMatch = text.match(/\b(\d+)\s*(?:tr|triệu|trieu)\s*(\d+)\b/i);
  if (compoundMatch) {
    matchedSnippet = compoundMatch[0];
    const main = parseInt(compoundMatch[1], 10);
    const subStr = compoundMatch[2];
    const sub = parseInt(subStr, 10);
    let subFactor = 100000;
    if (subStr.length === 1) subFactor = 100000;
    else if (subStr.length === 2) subFactor = 10000;
    else if (subStr.length === 3) subFactor = 1000;
    amount = main * 1000000 + sub * subFactor;
  } else {
    // 2b. Standard unit (150k, 35 nghìn, 1.5 triệu, 2tr)
    const unitMatch = text.match(
      /\b(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|k|nghìn|nghin|ngàn|ngan|đ|vnd)\b/i
    );
    if (unitMatch) {
      matchedSnippet = unitMatch[0];
      const numVal = parseFloat(unitMatch[1].replace(',', '.'));
      const unit = unitMatch[2].toLowerCase();
      if (unit.startsWith('tr')) {
        amount = Math.round(numVal * 1000000);
      } else if (
        unit.startsWith('k') ||
        unit.startsWith('ngh') ||
        unit.startsWith('nga')
      ) {
        amount = Math.round(numVal * 1000);
      } else {
        amount = Math.round(numVal);
      }
    } else {
      // 2c. Standalone number (50.000, 150000)
      const numMatch = text.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b/);
      if (numMatch) {
        matchedSnippet = numMatch[0];
        amount = parseInt(numMatch[1].replace(/[.,]/g, ''), 10);
      }
    }
  }

  if (matchedSnippet) {
    text = text.replace(matchedSnippet, ' ');
  }

  // 3. Clean up description
  let desc = text
    .replace(/\b(hết|chi|tổng|khoảng|khoản|giá|là)\b/gi, ' ')
    .replace(/[.,:;!\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Capitalize first letter
  if (desc) {
    desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  } else {
    desc = rawText.trim();
  }

  const dd = String(targetDate.getDate()).padStart(2, '0');
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const yyyy = targetDate.getFullYear();

  return {
    so_tien: amount,
    dien_giai: desc,
    ngay: `${dd}/${mm}/${yyyy}`,
    rawInput: rawText,
    isFallback: true,
  };
}

/**
 * Main function to parse natural language expense:
 * 1. Checks internet and user key
 * 2. Calls server proxy or client SDK
 * 3. Never throws; falls back seamlessly to regex parser
 */
export async function parseNaturalExpense(
  text: string,
  refDate = new Date()
): Promise<{
  success: boolean;
  data?: NaturalExpenseParsed;
  error?: string;
  usedFallback?: boolean;
}> {
  if (!text || !text.trim()) {
    return {
      success: false,
      error: 'Vui lòng nhập câu mô tả khoản chi',
    };
  }

  // If offline, use instant regex fallback without network delay
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const fallback = parseNaturalExpenseWithRegex(text, refDate);
    return {
      success: true,
      data: fallback,
      usedFallback: true,
    };
  }

  const userKey = getUserApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (userKey) {
    headers['x-gemini-api-key'] = userKey;
  }

  try {
    const res = await fetch('/api/parse-natural-expense', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: text.trim(),
        currentDate: refDate.toISOString(),
      }),
    });

    const json = await res.json();
    if (res.ok && json.success && json.data) {
      const data = json.data;
      const amount = Number(data.so_tien) || 0;
      const desc = String(data.dien_giai || '').trim();

      if (amount <= 0 || !desc) {
        const fallback = parseNaturalExpenseWithRegex(text, refDate);
        if (fallback.so_tien > 0 && fallback.dien_giai) {
          return {
            success: true,
            data: fallback,
            usedFallback: true,
          };
        }
      }

      return {
        success: true,
        data: {
          so_tien: amount,
          dien_giai: desc || text.trim(),
          ngay: String(data.ngay || ''),
          rawInput: text,
          isFallback: false,
        },
        usedFallback: false,
      };
    }
  } catch (err: any) {
    console.warn('Network error calling Gemini parser, checking client SDK or regex...', err);
  }

  // Client-side SDK attempt if user has key
  if (userKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: userKey });
      const now = refDate || new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const todayFormatted = `${dd}/${mm}/${yyyy}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Phân tích câu chi tiêu: "${text.trim()}". Hôm nay là ${todayFormatted}. Trích xuất so_tien (number VNĐ), dien_giai (string), ngay (DD/MM/YYYY).`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              so_tien: { type: Type.NUMBER },
              dien_giai: { type: Type.STRING },
              ngay: { type: Type.STRING },
            },
            required: ['so_tien', 'dien_giai', 'ngay'],
          },
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      if (parsed.so_tien && parsed.dien_giai) {
        return {
          success: true,
          data: {
            so_tien: Number(parsed.so_tien),
            dien_giai: String(parsed.dien_giai),
            ngay: String(parsed.ngay || todayFormatted),
            rawInput: text,
            isFallback: false,
          },
          usedFallback: false,
        };
      }
    } catch {
      // ignore, fall back to regex
    }
  }

  // Final fallback to offline regex parser
  const fallbackResult = parseNaturalExpenseWithRegex(text, refDate);
  return {
    success: true,
    data: fallbackResult,
    usedFallback: true,
  };
}

/**
 * Fallback multi-line parser for bulk messages (e.g. Zalo text) when offline or AI unavailable
 */
export function parseBulkExpensesWithRegex(
  rawText: string,
  refDate = new Date()
): NaturalExpenseParsed[] {
  const results: NaturalExpenseParsed[] = [];
  const rawLines = rawText
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  let currentRefDate = new Date(refDate);

  for (const line of rawLines) {
    const standaloneDateMatch = line.match(
      /^(?:ngày\s*)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s*:?$/i
    );
    if (standaloneDateMatch) {
      const d = parseInt(standaloneDateMatch[1], 10);
      const m = parseInt(standaloneDateMatch[2], 10) - 1;
      let y = standaloneDateMatch[3]
        ? parseInt(standaloneDateMatch[3], 10)
        : currentRefDate.getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
        currentRefDate = new Date(y, m, d);
      }
      continue;
    }

    let workingLine = line.replace(/^[\-•*+]\s*/, '').trim();
    const prefixDateMatch = workingLine.match(
      /^(?:ngày\s*)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s*[:\-]\s*(.+)$/i
    );
    if (prefixDateMatch) {
      const d = parseInt(prefixDateMatch[1], 10);
      const m = parseInt(prefixDateMatch[2], 10) - 1;
      let y = prefixDateMatch[3]
        ? parseInt(prefixDateMatch[3], 10)
        : currentRefDate.getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
        currentRefDate = new Date(y, m, d);
      }
      workingLine = prefixDateMatch[4].trim();
    }

    const segments = workingLine.split(/\s*,\s*/);
    const allSegmentsHaveNumbers =
      segments.length > 1 && segments.every((seg) => /\d/.test(seg));

    const itemsToParse = allSegmentsHaveNumbers ? segments : [workingLine];

    for (const seg of itemsToParse) {
      const parsed = parseNaturalExpenseWithRegex(seg, currentRefDate);
      if (parsed.so_tien !== 0 && parsed.dien_giai) {
        results.push(parsed);
      } else {
        const shortMatch = seg.match(/^(.+?)\s+(-?\d{1,3})\s*$/);
        if (shortMatch) {
          const desc = shortMatch[1].replace(/[:\-]+$/, '').trim();
          const num = parseInt(shortMatch[2], 10);
          if (desc && !isNaN(num) && num !== 0) {
            const dd = String(currentRefDate.getDate()).padStart(2, '0');
            const mm = String(currentRefDate.getMonth() + 1).padStart(2, '0');
            const yyyy = currentRefDate.getFullYear();
            results.push({
              so_tien: num * 1000,
              dien_giai: desc.charAt(0).toUpperCase() + desc.slice(1),
              ngay: `${dd}/${mm}/${yyyy}`,
              rawInput: seg,
              isFallback: true,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Requirement 6: Parse a long message (e.g. Zalo text) into multiple expenses
 */
export async function parseBulkExpenses(
  text: string,
  refDate = new Date()
): Promise<{
  success: boolean;
  data: NaturalExpenseParsed[];
  error?: string;
  usedFallback?: boolean;
}> {
  if (!text || !text.trim()) {
    return {
      success: false,
      data: [],
      error: 'Vui lòng dán nội dung tin nhắn cần tách',
    };
  }

  // Offline check -> regex fallback
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const fallbackList = parseBulkExpensesWithRegex(text, refDate);
    return {
      success: fallbackList.length > 0,
      data: fallbackList,
      usedFallback: true,
      error: fallbackList.length === 0 ? 'Không tìm thấy khoản chi nào hợp lệ.' : undefined,
    };
  }

  const userKey = getUserApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (userKey) {
    headers['x-gemini-api-key'] = userKey;
  }

  try {
    const res = await fetch('/api/parse-bulk-expenses', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: text.trim(),
        currentDate: refDate.toISOString(),
      }),
    });

    const json = await res.json();
    if (res.ok && json.success && Array.isArray(json.data) && json.data.length > 0) {
      const cleaned: NaturalExpenseParsed[] = json.data
        .map((item: any) => ({
          ngay: String(item.ngay || '').trim(),
          so_tien: Number(item.so_tien) || 0,
          dien_giai: String(item.dien_giai || '').trim(),
          isFallback: false,
        }))
        .filter((item: NaturalExpenseParsed) => item.so_tien !== 0 && item.dien_giai.length > 0);

      if (cleaned.length > 0) {
        return {
          success: true,
          data: cleaned,
          usedFallback: false,
        };
      }
    }
  } catch (err) {
    console.warn('Bulk parse network error, trying regex fallback:', err);
  }

  const fallbackList = parseBulkExpensesWithRegex(text, refDate);
  if (fallbackList.length > 0) {
    return {
      success: true,
      data: fallbackList,
      usedFallback: true,
    };
  }

  return {
    success: false,
    data: [],
    error: 'Không tìm thấy khoản chi nào hợp lệ. Vui lòng ghi mỗi khoản chi trên 1 dòng kèm số tiền (VD: Ăn trưa 45k).',
  };
}

/**
 * Requirement 8: Summarize spending & advance payment balance in natural Vietnamese
 */
export async function summarizeExpensesWithAI(summaryPayload: any): Promise<{
  success: boolean;
  summary: string;
  usedFallback?: boolean;
}> {
  const userKey = getUserApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (userKey) {
    headers['x-gemini-api-key'] = userKey;
  }

  try {
    const res = await fetch('/api/summarize-expenses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ summaryPayload }),
    });

    const json = await res.json();
    if (res.ok && json.success && json.data?.summary) {
      return {
        success: true,
        summary: json.data.summary,
        usedFallback: false,
      };
    }
  } catch (err) {
    console.warn('Fallback summary used due to network/API error:', err);
  }

  // Local deterministic fallback if offline or API fails
  const lines: string[] = [];
  lines.push(
    `• Kỳ báo cáo (${summaryPayload.period || 'Hiện tại'}): Tổng chi ${summaryPayload.totalSpentFormatted} với ${summaryPayload.expenseCount} khoản chi.`
  );
  if (summaryPayload.comparisonText) {
    lines.push(`• So với tháng trước: ${summaryPayload.comparisonText}.`);
  }
  if (summaryPayload.totalAdvance > 0) {
    lines.push(
      `• Tạm ứng & Hoàn ứng: Tổng tạm ứng ${summaryPayload.totalAdvanceFormatted} — ${summaryPayload.balanceStatusText}.`
    );
  }
  if (Array.isArray(summaryPayload.topExpenses) && summaryPayload.topExpenses.length > 0) {
    const topStr = summaryPayload.topExpenses
      .slice(0, 3)
      .map((t: any) => `${t.description} (${t.amountFormatted})`)
      .join(', ');
    lines.push(`• Các khoản chi lớn nhất: ${topStr}.`);
  }
  if (summaryPayload.missingReceiptsCount > 0) {
    lines.push(
      `• Lưu ý chứng từ: Còn ${summaryPayload.missingReceiptsCount} khoản chi chưa đính kèm ảnh hóa đơn.`
    );
  } else {
    lines.push(`• Chứng từ: 100% các khoản chi đã có đầy đủ ảnh chứng từ.`);
  }

  return {
    success: true,
    summary: lines.join('\n'),
    usedFallback: true,
  };
}
