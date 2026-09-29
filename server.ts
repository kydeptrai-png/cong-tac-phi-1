import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
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

    // Strip prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

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

// Static files from public folder (fonts, icons, manifest, sw)
app.use(express.static(path.resolve(__dirname, 'public')));

// Setup Vite in Dev or static files in Production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

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
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
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
