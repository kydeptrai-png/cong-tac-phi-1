import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Support large image payloads for receipts
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Explicit PWA routes with CORS for PWABuilder and browser compliance
app.get(['/manifest.json', '/manifest.webmanifest'], (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.resolve(__dirname, 'public/manifest.json'));
});

app.get('/sw.js', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.resolve(__dirname, 'public/sw.js'));
});

// API: Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Test Gemini Key
app.post('/api/test-key', async (req: Request, res: Response) => {
  try {
    const apiKey = getEffectiveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, error: 'Chưa cung cấp khóa API' });
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Ping',
    });
    if (response.text) {
      return res.json({ success: true, message: 'Khóa API hợp lệ' });
    }
    return res.status(500).json({ success: false, error: 'Không nhận được phản hồi từ Gemini' });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err?.message || 'Khóa API không hợp lệ' });
  }
});

// Helper to resolve Gemini API key from request headers (user key) or environment
function getEffectiveApiKey(req: Request): string | undefined {
  const headerKey = req.headers['x-gemini-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  return process.env.GEMINI_API_KEY;
}

/**
 * Sanitizes and pads a base64 string or data URL on the server so inlineData.data is always valid base64.
 */
function sanitizeServerBase64(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw || /^(https?:|blob:)/i.test(raw)) return null;

  if (raw.startsWith('data:')) {
    const commaIdx = raw.indexOf(',');
    if (commaIdx === -1) return null;
    raw = raw.slice(commaIdx + 1);
  }

  let cleaned = raw
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '')
    .replace(/=+$/, '');

  if (cleaned.length < 4 || cleaned.length % 4 === 1) {
    return null;
  }

  while (cleaned.length % 4 !== 0) {
    cleaned += '=';
  }

  return cleaned;
}

// API: Proxy external cloud receipt image (Firebase Storage / Google Drive) to Data URL for Excel/PDF export & AI OCR
app.get('/api/proxy-image', async (req: Request, res: Response) => {
  try {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return res.status(400).json({ success: false, error: 'Invalid URL' });
    }

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SoChiTieuProxy/1.0)',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, error: `Upstream HTTP ${upstream.status}` });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';
    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    if (!base64 || base64.length < 4) {
      return res.status(422).json({ success: false, error: 'Empty image payload' });
    }

    return res.json({
      success: true,
      mimeType,
      dataUrl: `data:${mimeType};base64,${base64}`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Proxy fetch failed' });
  }
});

// API: Gemini OCR / Smart Receipt Scanner
app.post('/api/scan-receipt', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu hình ảnh' });
    }

    const apiKey = getEffectiveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Chưa có khóa Gemini API. Bạn có thể vào Cài đặt để thêm khóa API của riêng bạn.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const cleanBase64 = sanitizeServerBase64(String(imageBase64));
    if (!cleanBase64) {
      return res.status(400).json({
        success: false,
        error: 'Dữ liệu hình ảnh chứng từ không hợp lệ (bad base64 content).',
      });
    }

    const promptText = `
Bạn là chuyên gia phân tích hóa đơn, phiếu thu, phiếu chi, biên lai, vé tàu xe và chứng từ thanh toán tiếng Việt.
Hãy phân tích hình ảnh chứng từ và trích xuất các thông tin sau:
1. amount: Tổng số tiền thanh toán cuối cùng (kiểu số nguyên VNĐ, ví dụ: 45000, 150000, 2500000; bỏ qua ký hiệu đ, VNĐ, dấu phẩy/chấm).
2. description: Diễn giải ngắn gọn, chuẩn xác nội dung chi tiêu kèm tên cửa hàng/đơn vị nếu có (ví dụ: "Ăn trưa cơm văn phòng", "Xăng xe Petrolimex", "Cà phê Highlands gặp đối tác", "Taxi Xanh SM").
3. date: Ngày trên hóa đơn định dạng DD/MM/YYYY (ví dụ: "15/03/2026"; nếu trên hóa đơn ghi YYYY-MM-DD thì đổi sang DD/MM/YYYY; nếu không rõ ngày thì để rỗng "").
4. merchant: Tên nhà hàng/cửa hàng/đơn vị thu tiền nếu có (hoặc để rỗng "").
Nếu ảnh mờ hoặc không phải hóa đơn, hãy cố gắng đọc các thông tin nhìn thấy được hoặc trả về số tiền 0 và mô tả ngắn.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType || 'image/jpeg',
            },
          },
          {
            text: promptText,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            amount: {
              type: Type.NUMBER,
              description: 'Tổng số tiền thanh toán bằng VNĐ',
            },
            description: {
              type: Type.STRING,
              description: 'Diễn giải ngắn gọn nội dung chi tiêu',
            },
            date: {
              type: Type.STRING,
              description: 'Ngày phát sinh định dạng DD/MM/YYYY',
            },
            merchant: {
              type: Type.STRING,
              description: 'Tên cửa hàng hoặc nhà cung cấp',
            },
          },
          required: ['amount', 'description'],
        },
      },
    });

    const outputText = response.text?.trim() || '{}';
    let parsedData = {};
    try {
      parsedData = JSON.parse(outputText);
    } catch {
      parsedData = {
        amount: 0,
        description: 'Khoản chi từ ảnh chứng từ',
      };
    }

    return res.json({
      success: true,
      data: parsedData,
    });
  } catch (error: any) {
    console.error('Scan receipt error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Không thể nhận diện hóa đơn',
    });
  }
});

// API: Parse Natural Language Expense using Gemini
app.post('/api/parse-natural-expense', async (req: Request, res: Response) => {
  try {
    const { text, currentDate } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập câu mô tả khoản chi' });
    }

    const apiKey = getEffectiveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Chưa có khóa Gemini API. Bạn có thể vào Cài đặt để thêm khóa API của riêng bạn.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const now = currentDate ? new Date(currentDate) : new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const todayFormatted = `${dd}/${mm}/${yyyy}`;

    const promptText = `
Bạn là trợ lý tài chính thông minh tiếng Việt, chuyên phân tích câu nói/văn bản mô tả khoản chi tiêu để trích xuất dữ liệu có cấu trúc.
Hôm nay là ngày: ${todayFormatted} (${yyyy}-${mm}-${dd}).

Phân tích câu người dùng nhập: "${text.trim()}"

Nhiệm vụ trích xuất:
1. "so_tien": số tiền bằng VNĐ dạng số nguyên (NUMBER).
   - Quy đổi đơn vị: "k" hoặc "nghìn" hoặc "ngàn" = nhân 1.000 (ví dụ: "150k" -> 150000, "35 nghìn" -> 35000).
   - "tr" hoặc "triệu" = nhân 1.000.000 (ví dụ: "1tr2" -> 1200000, "1.5 triệu" -> 1500000, "2tr" -> 2000000).
   - Nếu không tìm thấy số tiền hoặc số tiền = 0, trả về 0.
2. "dien_giai": mô tả ngắn gọn khoản chi (STRING), viết hoa chữ cái đầu (ví dụ: "Mua phở", "Đi chợ mua rau", "Thuốc ho", "Tiền thuê nhà"). Bỏ bớt các từ chỉ giá tiền ở cuối như "hết 150k".
3. "ngay": ngày phát sinh chi tiêu định dạng "DD/MM/YYYY" (STRING).
   - Nếu câu có nhắc thời gian tương đối như "hôm qua", "hôm kia", "hôm nay", "ngày 15", "hôm 12/03", hãy tính ra đúng ngày đó theo mốc ngày hôm nay (${todayFormatted}).
   - Nếu không có thông tin ngày thì mặc định là ngày hôm nay: "${todayFormatted}".
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            so_tien: {
              type: Type.NUMBER,
              description: 'Số tiền bằng VNĐ (đã quy đổi k=1.000, tr=1.000.000)',
            },
            dien_giai: {
              type: Type.STRING,
              description: 'Mô tả ngắn gọn nội dung chi tiêu',
            },
            ngay: {
              type: Type.STRING,
              description: 'Ngày phát sinh dạng DD/MM/YYYY',
            },
          },
          required: ['so_tien', 'dien_giai', 'ngay'],
        },
      },
    });

    const outputText = response.text?.trim() || '{}';
    let parsedData: any = {};
    try {
      parsedData = JSON.parse(outputText);
    } catch {
      parsedData = null;
    }

    if (!parsedData) {
      return res.status(500).json({ success: false, error: 'Không thể phân tích dữ liệu từ Gemini' });
    }

    return res.json({
      success: true,
      data: parsedData,
    });
  } catch (error: any) {
    console.error('Parse natural expense error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Lỗi khi gọi AI phân tích câu văn bản',
    });
  }
});

// API: Parse Bulk Multi-line Message (e.g. Zalo / Notes) into multiple expenses using Gemini
app.post('/api/parse-bulk-expenses', async (req: Request, res: Response) => {
  try {
    const { text, currentDate } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Vui lòng dán đoạn văn bản hoặc tin nhắn chứa các khoản chi',
      });
    }

    const apiKey = getEffectiveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Chưa cấu hình khóa Gemini API. Bạn có thể vào Cài đặt để thêm khóa API của riêng bạn.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const now = currentDate ? new Date(currentDate) : new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const todayFormatted = `${dd}/${mm}/${yyyy}`;

    const promptText = `
Bạn là chuyên gia kế toán và trợ lý tài chính thông minh tiếng Việt.
Hôm nay là ngày: ${todayFormatted} (${yyyy}-${mm}-${dd}).

Người dùng vừa dán một đoạn tin nhắn dài (ví dụ copy từ Zalo, ghi chú điện thoại, báo cáo công tác phí gồm nhiều dòng hoặc nhiều khoản chi trong cùng 1 câu).
Nội dung văn bản:
"""
${text.trim()}
"""

Nhiệm vụ của bạn:
Tách toàn bộ các khoản chi (hoặc khoản hoàn/thu lại nếu là số âm) có trong đoạn văn bản trên thành danh sách JSON.
Quy tắc:
1. "ngay": định dạng "DD/MM/YYYY" (ví dụ: "17/03/2026").
   - Nếu một dòng có ghi mốc ngày (VD: "Ngày 15/3:", "17/3", "Hôm qua", "18/03/2026") thì tất cả các khoản chi bên dưới thuộc ngày đó cho đến khi gặp mốc ngày mới (forward-fill).
   - Nếu chỉ ghi ngày (VD: "ngày 17") mà không ghi tháng/năm thì lấy tháng ${mm}/${yyyy}.
   - Nếu không nhắc tới ngày nào thì mặc định dùng ngày hôm nay "${todayFormatted}".
2. "so_tien": số tiền tính bằng VNĐ (kiểu số nguyên NUMBER).
   - Nếu ghi "150k", "150 nghìn", "150 ngàn" hoặc số nhỏ kiểu ghi tắt nghìn đồng (VD: "ăn sáng 35, cà phê 25, taxi 120") -> nhân 1.000 thành 35000, 25000, 120000.
   - Nếu ghi "1tr2", "1.2 triệu", "1,2tr" -> 1200000.
   - Nếu là khoản hoàn lại / trả lại / số âm (VD: "-158k", "hoàn lại -200k") -> giữ dấu âm (-158000, -200000).
3. "dien_giai": nội dung chi tiêu ngắn gọn, rõ ràng, viết hoa chữ cái đầu, đã lược bỏ phần số tiền và ngày tháng thừa.
4. Bỏ qua các dòng tiêu đề trống, câu chào hỏi hoặc dòng "Tổng cộng" (không phải là khoản chi).
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: 'Danh sách các khoản chi tách được từ đoạn tin nhắn',
          items: {
            type: Type.OBJECT,
            properties: {
              ngay: {
                type: Type.STRING,
                description: 'Ngày phát sinh định dạng DD/MM/YYYY',
              },
              so_tien: {
                type: Type.NUMBER,
                description: 'Số tiền bằng VNĐ (đã quy đổi đơn vị nghìn/triệu)',
              },
              dien_giai: {
                type: Type.STRING,
                description: 'Diễn giải ngắn gọn nội dung khoản chi',
              },
            },
            required: ['ngay', 'so_tien', 'dien_giai'],
          },
        },
      },
    });

    const outputText = response.text?.trim() || '[]';
    let parsedList: any[] = [];
    try {
      const parsed = JSON.parse(outputText);
      if (Array.isArray(parsed)) {
        parsedList = parsed;
      }
    } catch {
      parsedList = [];
    }

    return res.json({
      success: true,
      data: parsedList,
    });
  } catch (error: any) {
    console.error('Parse bulk expenses error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Lỗi khi gọi AI tách nhiều khoản chi',
    });
  }
});

// API: Parse Pasted Excel Table Image using Gemini Vision
app.post('/api/parse-excel-image', async (req: Request, res: Response) => {
  try {
    const {
      imageBase64,
      mimeType = 'image/png',
      defaultMonthNum,
      defaultYear,
      unitMode = 'thousand',
    } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'Không nhận diện được nội dung, vui lòng dán lại hoặc nhập tay',
      });
    }

    const apiKey = getEffectiveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Chưa cấu hình khóa Gemini API. Bạn có thể vào Cài đặt để thêm khóa API của riêng bạn.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const cleanBase64 = sanitizeServerBase64(String(imageBase64));
    if (!cleanBase64) {
      return res.status(400).json({
        success: false,
        error: 'Không nhận diện được nội dung hình ảnh, vui lòng dán lại hoặc nhập tay',
      });
    }
    const fallbackMonth = Number(defaultMonthNum) >= 1 && Number(defaultMonthNum) <= 12
      ? Number(defaultMonthNum)
      : new Date().getMonth() + 1;
    const fallbackYear = Number(defaultYear) >= 2000 && Number(defaultYear) <= 2100
      ? Number(defaultYear)
      : new Date().getFullYear();

    const promptText = `
Bạn là chuyên gia kế toán đọc dữ liệu bảng tính Excel được chụp hoặc copy-paste dưới dạng HÌNH ẢNH.
Hãy đọc hình ảnh này như một bảng dữ liệu các khoản chi tiêu (thường gồm các cột: Ngày, Số tiền, Diễn giải/Nội dung) và trích xuất từng dòng khoản chi nhìn thấy trong ảnh.

Quy tắc đọc bảng bắt buộc:
1. Mốc tháng ("t1", "t2", ..., "t12", "T 3", "Tháng 3", "Tháng 4/2026"):
   - Nếu có dòng ghi mốc tháng (ví dụ "t3", "T4", "Tháng 3") thì các dòng bên dưới thuộc tháng đó.
   - Nếu mốc tháng giảm (ví dụ từ t12 sang t1) thì năm tăng thêm 1.
   - Nếu trong ảnh KHÔNG có dòng mốc tháng nào, sử dụng tháng mặc định là Tháng ${String(fallbackMonth).padStart(2, '0')}/${fallbackYear}.
2. Cột Ngày (Forward-fill):
   - Ô ngày thường ghi số ngày từ 1 đến 31 (hoặc DD/MM, DD/MM/YYYY).
   - Nếu một dòng có ô Ngày ĐỂ TRỐNG, hãy lấy theo Ngày của dòng gần nhất phía trên nó (forward-fill).
   - Nếu những dòng đầu tiên chưa có ngày nào phía trên, dùng ngày "01".
   - Kết quả trường "ngay" luôn định dạng chuẩn "DD/MM/YYYY" (ví dụ: "17/03/${fallbackYear}").
3. Cột Số tiền ("so_tien"):
   - Đọc chính xác con số (giữ nguyên dấu âm nếu là khoản hoàn/trừ như -158, -200).
   - Chế độ đơn vị tiền hiện tại: "${unitMode === 'vnd' ? 'Đồng VNĐ (giữ nguyên số)' : 'Nghìn đồng (nhân 1.000 nếu số nhỏ dưới 100.000, ví dụ 116 -> 116000, -158 -> -158000; nếu số đã ghi đầy đủ như 116.000 hoặc 116,000 thì là 116000)'}".
   - Trả về "so_tien" là số nguyên VNĐ.
4. Cột Diễn giải ("dien_giai"):
   - Nội dung chi tiêu của dòng đó (kèm ghi chú nếu có).
5. Bỏ qua các dòng tiêu đề cột ("STT", "Ngày", "Số tiền", "Diễn giải") và bỏ qua các dòng "Tổng", "Tổng cộng", "Cộng".
6. Nếu bức ảnh hoàn toàn KHÔNG phải là bảng dữ liệu hay danh sách chi tiêu (ví dụ ảnh phong cảnh, ảnh trống không có chữ/số), hãy trả về mảng rỗng [].
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType || 'image/png',
            },
          },
          {
            text: promptText,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: 'Danh sách các dòng khoản chi đọc được từ ảnh bảng Excel',
          items: {
            type: Type.OBJECT,
            properties: {
              ngay: {
                type: Type.STRING,
                description: 'Ngày phát sinh định dạng DD/MM/YYYY',
              },
              so_tien: {
                type: Type.NUMBER,
                description: 'Số tiền bằng VNĐ (đã quy đổi theo đơn vị)',
              },
              dien_giai: {
                type: Type.STRING,
                description: 'Nội dung diễn giải của dòng chi tiêu',
              },
            },
            required: ['ngay', 'so_tien', 'dien_giai'],
          },
        },
      },
    });

    const outputText = response.text?.trim() || '[]';
    let parsedList: any[] = [];
    try {
      const parsed = JSON.parse(outputText);
      if (Array.isArray(parsed)) {
        parsedList = parsed;
      }
    } catch {
      parsedList = [];
    }

    return res.json({
      success: true,
      data: parsedList,
    });
  } catch (error: any) {
    console.error('Parse excel image error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Không nhận diện được nội dung, vui lòng dán lại hoặc nhập tay',
    });
  }
});

// API: Summarize Expenses in Natural Vietnamese using Gemini
app.post('/api/summarize-expenses', async (req: Request, res: Response) => {
  try {
    const { summaryPayload } = req.body;

    const apiKey = getEffectiveApiKey(req);
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Chưa cấu hình khóa Gemini API. Bạn có thể vào Cài đặt để thêm khóa API của riêng bạn.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const promptText = `
Bạn là trợ lý kế toán công tác phí chuyên nghiệp.
Dựa trên dữ liệu tổng hợp chi tiêu dưới đây, hãy viết một bản tóm tắt ngắn gọn bằng lời (khoảng 4-6 gạch đầu dòng ngắn gọn, súc tích, lịch sự bằng tiếng Việt) để người dùng có thể đọc nhanh hoặc copy gửi báo cáo qua Zalo/Email.
Lưu ý: Không phân loại theo Danh mục. Chỉ tập trung vào:
- Tổng chi tiêu và số lượng khoản chi trong kỳ/tháng đang xem.
- So sánh tăng/giảm so với tháng trước (nếu có).
- Tình hình Tạm ứng & Hoàn ứng (Tổng tạm ứng, tổng thực chi, số tiền còn dư phải hoàn lại hoặc số tiền chi vượt cần thanh toán thêm).
- Các khoản chi lớn nhất nổi bật.
- Nhắc nhở nhẹ nếu còn khoản chi chưa có ảnh chứng từ.

Dữ liệu JSON:
${JSON.stringify(summaryPayload, null, 2)}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: promptText,
    });

    const summaryText = response.text?.trim() || '';

    return res.json({
      success: true,
      data: { summary: summaryText },
    });
  } catch (error: any) {
    console.error('Summarize expenses error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Không thể tạo tóm tắt bằng AI',
    });
  }
});

// In-memory font cache for PDF export without storing binary .ttf files in source tree
const fontBufferCache: Record<string, Buffer> = {};
const FONT_CDN_URLS: Record<string, string> = {
  'Roboto-Regular.ttf': 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.18/build/fonts/Roboto/Roboto-Regular.ttf',
  'Roboto-Bold.ttf': 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.18/build/fonts/Roboto/Roboto-Medium.ttf',
};

app.get('/fonts/:fontName', async (req: Request, res: Response) => {
  const fontName = String(req.params.fontName || '');
  const cdnUrl = FONT_CDN_URLS[fontName];
  if (!cdnUrl) {
    return res.status(404).send('Font not found');
  }
  try {
    if (!fontBufferCache[fontName]) {
      const response = await fetch(cdnUrl);
      if (!response.ok) {
        return res.status(502).send('Failed to fetch font from upstream');
      }
      const arrayBuf = await response.arrayBuffer();
      fontBufferCache[fontName] = Buffer.from(arrayBuf);
    }
    res.setHeader('Content-Type', 'font/ttf');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(fontBufferCache[fontName]);
  } catch (err) {
    console.error('Error serving font:', err);
    return res.status(500).send('Font proxy error');
  }
});

// Static files from public folder (icons, manifest, sw)
app.use(express.static(path.resolve(__dirname, 'public')));

// ============================================================================
// REAL-TIME LAN / P2P SYNC SIGNALING & RELAY ROOMS (/api/lan-sync/*)
// ============================================================================
interface ServerLanPeer {
  peerId: string;
  deviceName: string;
  deviceType: 'pc' | 'mobile';
  joinedAt: number;
  lastSeen: number;
  sseRes?: Response;
}

interface ServerLanRoom {
  roomCode: string;
  peers: Map<string, ServerLanPeer>;
  messages: Array< any >;
}

const lanRooms = new Map<string, ServerLanRoom>();

function setLanCors(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

app.options('/api/lan-sync/*', (_req: Request, res: Response) => {
  setLanCors(res);
  res.status(204).end();
});

function getOrCreateLanRoom(roomCode: string): ServerLanRoom {
  let room = lanRooms.get(roomCode);
  if (!room) {
    room = {
      roomCode,
      peers: new Map(),
      messages: [],
    };
    lanRooms.set(roomCode, room);
  }
  return room;
}

function getSerializablePeers(room: ServerLanRoom) {
  const now = Date.now();
  const list: Array<{
    peerId: string;
    deviceName: string;
    deviceType: 'pc' | 'mobile';
    joinedAt: number;
    lastSeen: number;
  }> = [];
  for (const [peerId, p] of room.peers.entries()) {
    // Prune peers silent for > 25s without active SSE
    if (!p.sseRes && now - p.lastSeen > 25000) {
      room.peers.delete(peerId);
      continue;
    }
    list.push({
      peerId: p.peerId,
      deviceName: p.deviceName,
      deviceType: p.deviceType,
      joinedAt: p.joinedAt,
      lastSeen: p.lastSeen,
    });
  }
  return list;
}

function broadcastToLanRoom(room: ServerLanRoom, payload: any, excludePeerId?: string) {
  const str = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [peerId, peer] of room.peers.entries()) {
    if (excludePeerId && peerId === excludePeerId) continue;
    if (peer.sseRes) {
      try {
        peer.sseRes.write(str);
      } catch {
        peer.sseRes = undefined;
      }
    }
  }
}

app.get('/api/lan-sync/info', (_req: Request, res: Response) => {
  setLanCors(res);
  const ips: string[] = [];
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          ips.push(net.address);
        }
      }
    }
  } catch {
    // ignore
  }
  return res.json({
    success: true,
    port: PORT,
    lanIps: ips,
  });
});

app.get('/api/lan-sync/stream', (req: Request, res: Response) => {
  setLanCors(res);
  const roomCode = String(req.query.roomCode || '').trim();
  const peerId = String(req.query.peerId || '').trim();
  const deviceName = String(req.query.deviceName || 'Thiết bị LAN').trim();
  const deviceType = req.query.deviceType === 'mobile' ? 'mobile' : 'pc';

  if (!roomCode || !peerId) {
    return res.status(400).json({ error: 'Missing roomCode or peerId' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const room = getOrCreateLanRoom(roomCode);
  const now = Date.now();
  const existing = room.peers.get(peerId);
  const peerObj: ServerLanPeer = {
    peerId,
    deviceName,
    deviceType,
    joinedAt: existing?.joinedAt || now,
    lastSeen: now,
    sseRes: res,
  };
  room.peers.set(peerId, peerObj);

  // Send initial room state to newly connected peer
  res.write(
    `data: ${JSON.stringify({
      type: 'room:state',
      peers: getSerializablePeers(room),
    })}\n\n`
  );

  // Notify other peers in room
  broadcastToLanRoom(
    room,
    {
      type: 'peer:joined',
      peer: {
        peerId,
        deviceName,
        deviceType,
        joinedAt: peerObj.joinedAt,
        lastSeen: now,
      },
    },
    peerId
  );

  const heartbeat = setInterval(() => {
    try {
      peerObj.lastSeen = Date.now();
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const current = room.peers.get(peerId);
    if (current && current.sseRes === res) {
      current.sseRes = undefined;
      current.lastSeen = Date.now();
      // Give 5s grace period in case of quick reconnect or poll mode
      setTimeout(() => {
        const check = room.peers.get(peerId);
        if (check && !check.sseRes && Date.now() - check.lastSeen >= 4500) {
          room.peers.delete(peerId);
          broadcastToLanRoom(room, { type: 'peer:left', peerId }, peerId);
          if (room.peers.size === 0 && room.messages.length === 0) {
            lanRooms.delete(roomCode);
          }
        }
      }, 5000);
    }
  });
});

app.get('/api/lan-sync/poll', (req: Request, res: Response) => {
  setLanCors(res);
  const roomCode = String(req.query.roomCode || '').trim();
  const peerId = String(req.query.peerId || '').trim();
  const deviceName = String(req.query.deviceName || 'Thiết bị LAN').trim();
  const deviceType = req.query.deviceType === 'mobile' ? 'mobile' : 'pc';
  const since = Number(req.query.since || 0);

  if (!roomCode || !peerId) {
    return res.status(400).json({ error: 'Missing roomCode or peerId' });
  }

  const room = getOrCreateLanRoom(roomCode);
  const now = Date.now();
  const existing = room.peers.get(peerId);
  if (!existing) {
    const newPeer: ServerLanPeer = {
      peerId,
      deviceName,
      deviceType,
      joinedAt: now,
      lastSeen: now,
    };
    room.peers.set(peerId, newPeer);
    broadcastToLanRoom(
      room,
      {
        type: 'peer:joined',
        peer: {
          peerId,
          deviceName,
          deviceType,
          joinedAt: now,
          lastSeen: now,
        },
      },
      peerId
    );
  } else {
    existing.lastSeen = now;
    existing.deviceName = deviceName || existing.deviceName;
  }

  // Prune messages older than 60s
  room.messages = room.messages.filter((m) => now - m.timestamp < 60000);

  const pending = room.messages.filter(
    (m) =>
      m.timestamp > since &&
      m.senderPeerId !== peerId &&
      (!m.targetPeerId || m.targetPeerId === peerId)
  );

  return res.json({
    success: true,
    peers: getSerializablePeers(room),
    messages: pending,
  });
});

app.post('/api/lan-sync/send', (req: Request, res: Response) => {
  setLanCors(res);
  const { roomCode, envelope } = req.body || {};
  if (!roomCode || !envelope || !envelope.messageId) {
    return res.status(400).json({ error: 'Invalid LAN sync payload' });
  }

  const cleanRoomCode = String(roomCode).trim();
  const room = getOrCreateLanRoom(cleanRoomCode);
  const now = Date.now();
  envelope.timestamp = now;

  // Keep rolling message buffer (max 40 recent messages, < 60s)
  room.messages.push(envelope);
  if (room.messages.length > 40) {
    room.messages.shift();
  }

  // Update sender lastSeen
  const sender = room.peers.get(envelope.senderPeerId);
  if (sender) {
    sender.lastSeen = now;
  }

  // Push immediately over SSE to matching peers
  for (const [peerId, peer] of room.peers.entries()) {
    if (peerId === envelope.senderPeerId) continue;
    if (envelope.targetPeerId && envelope.targetPeerId !== peerId) continue;
    if (peer.sseRes) {
      try {
        peer.sseRes.write(
          `data: ${JSON.stringify({
            type: 'envelope',
            envelope,
          })}\n\n`
        );
      } catch {
        peer.sseRes = undefined;
      }
    }
  }

  return res.json({ success: true, timestamp: now });
});

app.post('/api/lan-sync/leave', (req: Request, res: Response) => {
  setLanCors(res);
  const { roomCode, peerId } = req.body || {};
  if (roomCode && peerId) {
    const room = lanRooms.get(String(roomCode).trim());
    if (room) {
      room.peers.delete(String(peerId));
      broadcastToLanRoom(room, { type: 'peer:left', peerId: String(peerId) }, String(peerId));
    }
  }
  return res.json({ success: true });
});

// Setup Vite in Dev or static files in Production
async function startServer() {
  const isDevScript = process.env.npm_lifecycle_event === 'dev';
  const distPath = path.resolve(__dirname, 'dist');
  const distIndex = path.resolve(distPath, 'index.html');

  const isProduction =
    !isDevScript &&
    (process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start') &&
    fs.existsSync(distIndex);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(distIndex);
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
