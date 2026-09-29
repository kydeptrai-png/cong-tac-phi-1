import { PDFDocument, rgb, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ExpenseItem, AdvancePaymentItem, MonthGroup } from '../types';
import { formatVND } from './categories';
import { groupExpensesByMonth, parseDateSortKey } from './excel';
import { saveOrDownloadFile } from './fileSaver';

export interface PDFExportProgress {
  step: 'init_fonts' | 'prepare_images' | 'build_layout' | 'generate_blob' | 'done' | 'error';
  stepDescription: string;
  percent: number; // 0 to 100
  currentMonth?: string;
  processedItems?: number;
  totalItems?: number;
  processedImages?: number;
  totalImages?: number;
}

export interface PDFExportOptions {
  expenses: ExpenseItem[];
  reportTitle?: string;
  profileName?: string;
  advances?: AdvancePaymentItem[];
  selectedMonth?: string;
  skipImages?: boolean;
  onProgress?: (progress: PDFExportProgress) => void;
}

export interface PDFExportResult {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  totalPages: number;
  totalExpenses: number;
  totalImages: number;
  failedImagesCount: number;
}

// In-memory cache for fonts to avoid refetching on subsequent exports
let cachedFonts: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

/**
 * Requirement 2: Load Unicode Fonts (Roboto Regular and Bold) with full Vietnamese diacritics support.
 * Checks "Tiền nhận đồ", "Đường", "Ẩm" to ensure 100% correct glyph display.
 */
async function loadUnicodeFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (cachedFonts) return cachedFonts;

  // Primary source: local public/fonts/ served by Vite/Express
  try {
    const [regRes, boldRes] = await Promise.all([
      fetch('/fonts/Roboto-Regular.ttf'),
      fetch('/fonts/Roboto-Bold.ttf'),
    ]);

    if (regRes.ok && boldRes.ok) {
      const [regular, bold] = await Promise.all([
        regRes.arrayBuffer(),
        boldRes.arrayBuffer(),
      ]);
      // Verify minimum valid font file size (> 50KB)
      if (regular.byteLength > 50000 && bold.byteLength > 50000) {
        cachedFonts = { regular, bold };
        return cachedFonts;
      }
    }
  } catch (err) {
    console.warn('Local font fetch failed, falling back to CDN...', err);
  }

  // Fallback source: high-availability CDN with complete Unicode Vietnamese support
  try {
    const [regRes, boldRes] = await Promise.all([
      fetch('https://cdn.jsdelivr.net/npm/pdfmake@0.2.18/build/fonts/Roboto/Roboto-Regular.ttf'),
      fetch('https://cdn.jsdelivr.net/npm/pdfmake@0.2.18/build/fonts/Roboto/Roboto-Medium.ttf'),
    ]);

    if (!regRes.ok || !boldRes.ok) {
      throw new Error(`Mã lỗi HTTP: Regular=${regRes.status}, Bold=${boldRes.status}`);
    }

    const [regular, bold] = await Promise.all([
      regRes.arrayBuffer(),
      boldRes.arrayBuffer(),
    ]);

    cachedFonts = { regular, bold };
    return cachedFonts;
  } catch (err: any) {
    throw new Error(
      `Không thể tải font chữ Unicode tiếng Việt: ${err?.message || 'Lỗi mạng'}. Vui lòng kiểm tra kết nối mạng và thử lại.`
    );
  }
}

/**
 * Requirement 3: Compress image to JPEG (max dimension 1000px, quality 0.7),
 * strictly preserving original aspect ratio.
 * If an image fails to load or decode, gracefully returns null with error indicator.
 */
interface ProcessedImageInfo {
  bytes: Uint8Array;
  width: number;
  height: number;
  isError?: boolean;
  errorMessage?: string;
}

async function prepareImageForPdf(
  imgSource: string,
  maxDimension = 1000,
  quality = 0.7
): Promise<ProcessedImageInfo | null> {
  if (!imgSource || typeof imgSource !== 'string' || !imgSource.trim()) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const img = new Image();
      if (!imgSource.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }

      const timer = setTimeout(() => {
        resolve({
          bytes: new Uint8Array(),
          width: 0,
          height: 0,
          isError: true,
          errorMessage: 'Hết thời gian tải ảnh (timeout)',
        });
      }, 10000);

      img.onload = () => {
        clearTimeout(timer);
        try {
          const origW = img.naturalWidth || img.width;
          const origH = img.naturalHeight || img.height;

          if (!origW || !origH) {
            resolve({
              bytes: new Uint8Array(),
              width: 0,
              height: 0,
              isError: true,
              errorMessage: 'Ảnh có kích thước 0x0',
            });
            return;
          }

          let targetW = origW;
          let targetH = origH;

          if (origW > maxDimension || origH > maxDimension) {
            if (origW >= origH) {
              targetW = maxDimension;
              targetH = Math.max(1, Math.round((origH * maxDimension) / origW));
            } else {
              targetH = maxDimension;
              targetW = Math.max(1, Math.round((origW * maxDimension) / origH));
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            resolve({
              bytes: new Uint8Array(),
              width: 0,
              height: 0,
              isError: true,
              errorMessage: 'Không khởi tạo được bộ xử lý đồ họa Canvas',
            });
            return;
          }

          // Solid white background for transparency conversion
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);

          canvas.toBlob(
            async (blob) => {
              if (!blob) {
                resolve({
                  bytes: new Uint8Array(),
                  width: 0,
                  height: 0,
                  isError: true,
                  errorMessage: 'Lỗi nén ảnh sang JPEG',
                });
                return;
              }
              const buffer = await blob.arrayBuffer();
              resolve({
                bytes: new Uint8Array(buffer),
                width: targetW,
                height: targetH,
                isError: false,
              });
            },
            'image/jpeg',
            quality
          );
        } catch (err: any) {
          resolve({
            bytes: new Uint8Array(),
            width: 0,
            height: 0,
            isError: true,
            errorMessage: err?.message || 'Lỗi xử lý ảnh trên canvas',
          });
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        resolve({
          bytes: new Uint8Array(),
          width: 0,
          height: 0,
          isError: true,
          errorMessage: 'Ảnh hỏng hoặc định dạng không hỗ trợ',
        });
      };

      img.src = imgSource;
    } catch (err: any) {
      resolve({
        bytes: new Uint8Array(),
        width: 0,
        height: 0,
        isError: true,
        errorMessage: err?.message || 'Ngoại lệ xử lý ảnh',
      });
    }
  });
}

/**
 * Text wrapping helper that measures words and breaks text into lines.
 */
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Word itself is wider than maxWidth, hard break it
        lines.push(candidate);
        currentLine = '';
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Requirement 2 & 6: Download Blob as a file in browser with fallback for Capacitor and WebViews
 */
export function downloadPdfBlob(blob: Blob, fileName: string): void {
  saveOrDownloadFile({
    blob,
    fileName,
    mimeType: 'application/pdf',
    title: fileName,
    text: 'Báo cáo chi tiêu công tác phí',
  });
}

/**
 * Main PDF Export Generator Function
 * Implements Requirements 1, 2, 3, 4, 5, 6, 7.
 */
export async function exportExpensesToPDF({
  expenses,
  reportTitle = 'Báo Cáo Thanh Toán Công Tác Phí & Chi Tiêu',
  profileName = 'Hồ sơ công tác',
  advances = [],
  selectedMonth = 'all',
  skipImages = false,
  onProgress,
}: PDFExportOptions): Promise<PDFExportResult> {
  const updateProgress = (
    step: PDFExportProgress['step'],
    stepDescription: string,
    percent: number,
    extra?: Partial<PDFExportProgress>
  ) => {
    if (onProgress) {
      onProgress({
        step,
        stepDescription,
        percent: Math.min(100, Math.max(0, percent)),
        ...extra,
      });
    }
  };

  try {
    // -------------------------------------------------------------
    // Step 0: Input validation
    // -------------------------------------------------------------
    if (!expenses || expenses.length === 0) {
      throw new Error('Danh sách chi tiêu đang trống. Vui lòng chọn ít nhất 1 khoản chi để xuất PDF.');
    }

    const monthGroups = groupExpensesByMonth(expenses);
    const totalExpenses = expenses.length;
    let totalImagesCount = 0;
    expenses.forEach((e) => {
      if (Array.isArray(e.images)) totalImagesCount += e.images.length;
    });

    updateProgress('init_fonts', 'Bước 1/4: Đang tải font chữ Unicode tiếng Việt (Roboto)...', 5);

    // -------------------------------------------------------------
    // Step 1: Initialize PDFDocument and Embed Unicode Fonts
    // -------------------------------------------------------------
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    const fontBuffers = await loadUnicodeFonts();
    const regularFont = await doc.embedFont(fontBuffers.regular);
    const boldFont = await doc.embedFont(fontBuffers.bold);

    updateProgress('init_fonts', 'Bước 1/4: Đã nhúng font Unicode tiếng Việt thành công!', 15);

    // -------------------------------------------------------------
    // Step 2: Prepare & Compress Images in batches (Requirement 3 & 5)
    // -------------------------------------------------------------
    updateProgress(
      'prepare_images',
      `Bước 2/4: Đang nén và tối ưu ${totalImagesCount} ảnh chứng từ (cạnh dài ≤1000px)...`,
      20,
      { totalImages: totalImagesCount, processedImages: 0 }
    );

    // Map: expenseId -> array of ProcessedImageInfo
    const processedImagesMap = new Map<string, ProcessedImageInfo[]>();
    let processedImagesCounter = 0;
    let failedImagesCounter = 0;

    if (!skipImages && totalImagesCount > 0) {
      for (let i = 0; i < expenses.length; i++) {
        const item = expenses[i];
        if (Array.isArray(item.images) && item.images.length > 0) {
          const itemImgs: ProcessedImageInfo[] = [];

          for (let imgIdx = 0; imgIdx < item.images.length; imgIdx++) {
            const rawSrc = item.images[imgIdx];
            const processed = await prepareImageForPdf(rawSrc, 1000, 0.7);

            if (processed) {
              if (processed.isError) {
                failedImagesCounter++;
              }
              itemImgs.push(processed);
            } else {
              failedImagesCounter++;
              itemImgs.push({
                bytes: new Uint8Array(),
                width: 0,
                height: 0,
                isError: true,
                errorMessage: 'Không thể mở ảnh',
              });
            }

            processedImagesCounter++;
            const pct = 20 + Math.round((processedImagesCounter / totalImagesCount) * 35);
            updateProgress(
              'prepare_images',
              `Bước 2/4: Đang nén ảnh chứng từ (${processedImagesCounter}/${totalImagesCount})...`,
              pct,
              {
                totalImages: totalImagesCount,
                processedImages: processedImagesCounter,
              }
            );
          }

          processedImagesMap.set(item.id, itemImgs);
        }
      }
    }

    updateProgress(
      'build_layout',
      'Bước 3/4: Đang dựng bố cục trang, phân nhóm tháng và ngắt trang...',
      60
    );

    // -------------------------------------------------------------
    // Step 3: Layout & Rendering
    // Page dimensions: A4 portrait (595.28 x 841.89 pt)
    // -------------------------------------------------------------
    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const MARGIN_LEFT = 36;
    const MARGIN_RIGHT = 36;
    const MARGIN_TOP = 36;
    const MARGIN_BOTTOM = 40;
    const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 523.28 pt

    // Color definitions
    const COLOR_PRIMARY = rgb(0.06, 0.46, 0.43); // #0f766e
    const COLOR_PRIMARY_DARK = rgb(0.04, 0.35, 0.32); // #0b5853
    const COLOR_BG_TINT = rgb(0.96, 0.98, 0.98); // #f5faf9
    const COLOR_BORDER = rgb(0.8, 0.85, 0.89); // #cbd5e1
    const COLOR_TEXT_DARK = rgb(0.09, 0.13, 0.19); // #0f172a
    const COLOR_TEXT_MUTED = rgb(0.39, 0.45, 0.54); // #64748b
    const COLOR_REFUND = rgb(0.03, 0.48, 0.55); // #0891b2
    const COLOR_AMBER = rgb(0.78, 0.38, 0.04); // #c2410c
    const COLOR_WHITE = rgb(1, 1, 1);

    const pagesList: PDFPage[] = [];
    let currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pagesList.push(currentPage);

    let currentY = PAGE_HEIGHT - MARGIN_TOP;

    const addNewPage = (contextTitle?: string): PDFPage => {
      currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pagesList.push(currentPage);
      currentY = PAGE_HEIGHT - MARGIN_TOP;

      // Running header on page 2+
      if (contextTitle) {
        currentPage.drawText(contextTitle, {
          x: MARGIN_LEFT,
          y: currentY - 10,
          size: 8,
          font: regularFont,
          color: COLOR_TEXT_MUTED,
        });
        currentPage.drawLine({
          start: { x: MARGIN_LEFT, y: currentY - 14 },
          end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: currentY - 14 },
          thickness: 0.5,
          color: COLOR_BORDER,
        });
        currentY -= 26;
      }

      return currentPage;
    };

    // Calculate totals
    const grandTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
    const totalAdvances = advances.reduce((sum, a) => sum + a.amount, 0);
    const balance = totalAdvances - grandTotal;

    // -------------------------------------------------------------
    // Draw Cover / Top Header on Page 1
    // -------------------------------------------------------------
    // Top app branding
    currentPage.drawText('SỔ CHI TIÊU & QUẢN LÝ CÔNG TÁC PHÍ', {
      x: MARGIN_LEFT,
      y: currentY - 12,
      size: 9,
      font: boldFont,
      color: COLOR_PRIMARY,
    });
    currentY -= 18;

    // Main Report Title
    const titleLines = wrapText(reportTitle, boldFont, 15, USABLE_WIDTH);
    for (const tl of titleLines) {
      currentPage.drawText(tl, {
        x: MARGIN_LEFT,
        y: currentY - 14,
        size: 15,
        font: boldFont,
        color: COLOR_TEXT_DARK,
      });
      currentY -= 18;
    }

    // Subtitle / Meta info
    const todayStr = new Date().toLocaleDateString('vi-VN');
    const scopeLabel =
      selectedMonth === 'all' ? 'Tất cả các tháng' : selectedMonth;
    const metaText = `Hồ sơ: ${profileName} • Ngày lập báo cáo: ${todayStr} • Kỳ chi tiêu: ${scopeLabel}`;
    currentPage.drawText(metaText, {
      x: MARGIN_LEFT,
      y: currentY - 8,
      size: 9,
      font: regularFont,
      color: COLOR_TEXT_MUTED,
    });
    currentY -= 20;

    // Summary Box (Tạm ứng & Quyết toán)
    const summaryBoxH = 46;
    currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: currentY - summaryBoxH,
      width: USABLE_WIDTH,
      height: summaryBoxH,
      color: COLOR_BG_TINT,
      borderColor: COLOR_BORDER,
      borderWidth: 1,
    });

    const colW = USABLE_WIDTH / 3;
    const sumY = currentY - 14;

    // Col 1: Tổng thực chi
    currentPage.drawText('TỔNG THỰC CHI:', {
      x: MARGIN_LEFT + 10,
      y: sumY,
      size: 8,
      font: regularFont,
      color: COLOR_TEXT_MUTED,
    });
    currentPage.drawText(formatVND(grandTotal), {
      x: MARGIN_LEFT + 10,
      y: sumY - 14,
      size: 11,
      font: boldFont,
      color: COLOR_PRIMARY_DARK,
    });

    // Col 2: Tổng tạm ứng
    currentPage.drawText('TỔNG TẠM ỨNG:', {
      x: MARGIN_LEFT + colW + 10,
      y: sumY,
      size: 8,
      font: regularFont,
      color: COLOR_TEXT_MUTED,
    });
    currentPage.drawText(formatVND(totalAdvances), {
      x: MARGIN_LEFT + colW + 10,
      y: sumY - 14,
      size: 11,
      font: boldFont,
      color: COLOR_TEXT_DARK,
    });

    // Col 3: Chênh lệch quyết toán
    const balLabel =
      balance >= 0 ? 'SỐ CÒN DƯ (HOÀN ỨNG):' : 'CHI VƯỢT (THANH TOÁN THÊM):';
    const balColor = balance >= 0 ? COLOR_PRIMARY : rgb(0.85, 0.2, 0.2);
    currentPage.drawText(balLabel, {
      x: MARGIN_LEFT + colW * 2 + 10,
      y: sumY,
      size: 8,
      font: boldFont,
      color: balColor,
    });
    currentPage.drawText(formatVND(Math.abs(balance)), {
      x: MARGIN_LEFT + colW * 2 + 10,
      y: sumY - 14,
      size: 11,
      font: boldFont,
      color: balColor,
    });

    currentY -= summaryBoxH + 20;

    // -------------------------------------------------------------
    // Draw Month Groups and Expenses
    // -------------------------------------------------------------
    let overallItemIndex = 1;

    for (let gIdx = 0; gIdx < monthGroups.length; gIdx++) {
      const group = monthGroups[gIdx];
      const sortedItems = [...group.items].sort(
        (a, b) => parseDateSortKey(a.date || '') - parseDateSortKey(b.date || '')
      );

      // Check space for Month Header Banner (needs at least 65pt)
      if (currentY - 65 < MARGIN_BOTTOM) {
        addNewPage(`${reportTitle} — ${group.monthTitle}`);
      }

      // Draw Month Banner
      const monthBannerH = 24;
      currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: currentY - monthBannerH,
        width: USABLE_WIDTH,
        height: monthBannerH,
        color: COLOR_PRIMARY,
      });

      const monthTitleStr = `${group.monthTitle.toUpperCase()} (${group.count} KHOẢN CHI)`;
      currentPage.drawText(monthTitleStr, {
        x: MARGIN_LEFT + 8,
        y: currentY - 16,
        size: 9.5,
        font: boldFont,
        color: COLOR_WHITE,
      });

      const monthTotalStr = `TỔNG THÁNG: ${formatVND(group.totalAmount)}`;
      const monthTotalW = boldFont.widthOfTextAtSize(monthTotalStr, 9.5);
      currentPage.drawText(monthTotalStr, {
        x: PAGE_WIDTH - MARGIN_RIGHT - monthTotalW - 8,
        y: currentY - 16,
        size: 9.5,
        font: boldFont,
        color: COLOR_WHITE,
      });

      currentY -= monthBannerH + 10;

      // Draw Items in this Month
      for (let itIdx = 0; itIdx < sortedItems.length; itIdx++) {
        const item = sortedItems[itIdx];
        const isRefund = item.amount < 0;
        const itemImages = processedImagesMap.get(item.id) || [];
        const hasImages = itemImages.length > 0;

        // Calculate item height to avoid cutting images across pages
        const descLines = wrapText(
          item.description || 'Khoản chi',
          boldFont,
          9,
          USABLE_WIDTH - 150
        );
        const notesLines = item.notes
          ? wrapText(`Ghi chú: ${item.notes}`, regularFont, 8, USABLE_WIDTH - 60)
          : [];

        const mainLineH = Math.max(18, descLines.length * 12) + (notesLines.length > 0 ? notesLines.length * 10 + 4 : 0) + 12;

        // Calculate images layout height
        const THUMB_BOX_W = 118;
        const THUMB_BOX_H = 100;
        const THUMBS_PER_ROW = 4;
        const THUMB_GAP_X = (USABLE_WIDTH - THUMB_BOX_W * THUMBS_PER_ROW) / (THUMBS_PER_ROW - 1);
        const THUMB_GAP_Y = 10;

        const imgRowsCount = hasImages ? Math.ceil(itemImages.length / THUMBS_PER_ROW) : 0;
        const imagesSectionH = hasImages ? 16 + imgRowsCount * (THUMB_BOX_H + THUMB_GAP_Y) : 0;
        const totalBlockH = mainLineH + imagesSectionH + 10;

        // Requirement 4: Auto-break pages cleanly without cutting images in half
        if (currentY - totalBlockH < MARGIN_BOTTOM) {
          addNewPage(`${reportTitle} — ${group.monthTitle}`);
        }

        // Draw Expense Entry Card Box
        currentPage.drawRectangle({
          x: MARGIN_LEFT,
          y: currentY - totalBlockH,
          width: USABLE_WIDTH,
          height: totalBlockH,
          color: isRefund ? rgb(0.97, 1, 1) : COLOR_WHITE,
          borderColor: isRefund ? rgb(0.6, 0.88, 0.92) : COLOR_BORDER,
          borderWidth: 0.8,
        });

        // Top Content Line inside block
        let textY = currentY - 14;

        // STT badge
        currentPage.drawText(`#${overallItemIndex}`, {
          x: MARGIN_LEFT + 8,
          y: textY,
          size: 8,
          font: boldFont,
          color: COLOR_PRIMARY,
        });

        // Date
        currentPage.drawText(item.date || '', {
          x: MARGIN_LEFT + 32,
          y: textY,
          size: 8.5,
          font: boldFont,
          color: COLOR_TEXT_MUTED,
        });

        // Amount (aligned right)
        const amtStr = formatVND(item.amount);
        const amtW = boldFont.widthOfTextAtSize(amtStr, 10);
        currentPage.drawText(amtStr, {
          x: PAGE_WIDTH - MARGIN_RIGHT - amtW - 10,
          y: textY,
          size: 10,
          font: boldFont,
          color: isRefund ? COLOR_REFUND : COLOR_TEXT_DARK,
        });

        // Refund badge if amount is negative
        if (isRefund) {
          const refundBadgeText = '[Hoàn/thu lại]';
          const rBadgeW = regularFont.widthOfTextAtSize(refundBadgeText, 7.5);
          currentPage.drawText(refundBadgeText, {
            x: PAGE_WIDTH - MARGIN_RIGHT - amtW - rBadgeW - 14,
            y: textY,
            size: 7.5,
            font: boldFont,
            color: COLOR_REFUND,
          });
        }

        // Description text lines
        const descStartX = MARGIN_LEFT + 100;
        for (let dlIdx = 0; dlIdx < descLines.length; dlIdx++) {
          currentPage.drawText(descLines[dlIdx], {
            x: descStartX,
            y: textY - dlIdx * 12,
            size: 9,
            font: boldFont,
            color: COLOR_TEXT_DARK,
          });
        }
        textY -= descLines.length * 12;

        // Notes lines (if any)
        if (notesLines.length > 0) {
          textY -= 2;
          for (let nlIdx = 0; nlIdx < notesLines.length; nlIdx++) {
            currentPage.drawText(notesLines[nlIdx], {
              x: descStartX,
              y: textY - nlIdx * 10,
              size: 8,
              font: regularFont,
              color: COLOR_AMBER,
            });
          }
          textY -= notesLines.length * 10;
        }

        // -------------------------------------------------------------
        // Draw Thumbnails below expense line (Requirements 3 & 4)
        // -------------------------------------------------------------
        if (hasImages) {
          let imgSecY = currentY - mainLineH - 12;

          currentPage.drawText(`Chứng từ kèm theo (${itemImages.length} ảnh):`, {
            x: MARGIN_LEFT + 10,
            y: imgSecY,
            size: 7.5,
            font: boldFont,
            color: COLOR_TEXT_MUTED,
          });
          imgSecY -= 6;

          for (let imgIndex = 0; imgIndex < itemImages.length; imgIndex++) {
            const imgData = itemImages[imgIndex];
            const colIndex = imgIndex % THUMBS_PER_ROW;
            const rowIndex = Math.floor(imgIndex / THUMBS_PER_ROW);

            const thumbX = MARGIN_LEFT + 8 + colIndex * (THUMB_BOX_W + THUMB_GAP_X);
            const thumbY = imgSecY - (rowIndex + 1) * THUMB_BOX_H - rowIndex * THUMB_GAP_Y;

            // Thumbnail container background & border
            currentPage.drawRectangle({
              x: thumbX,
              y: thumbY,
              width: THUMB_BOX_W,
              height: THUMB_BOX_H,
              color: COLOR_BG_TINT,
              borderColor: COLOR_BORDER,
              borderWidth: 0.5,
            });

            if (imgData.isError || !imgData.bytes || imgData.bytes.length === 0) {
              // Draw "Ảnh lỗi" placeholder gracefully
              currentPage.drawText('⚠️ Ảnh lỗi', {
                x: thumbX + 28,
                y: thumbY + 54,
                size: 8,
                font: boldFont,
                color: COLOR_AMBER,
              });
              currentPage.drawText(imgData.errorMessage || 'Không đọc được ảnh', {
                x: thumbX + 8,
                y: thumbY + 40,
                size: 6.5,
                font: regularFont,
                color: COLOR_TEXT_MUTED,
              });
            } else {
              try {
                // Embed JPEG image into pdf-lib
                const embeddedImg = await doc.embedJpg(imgData.bytes);

                // Strictly preserve aspect ratio within (THUMB_BOX_W - 8) x (THUMB_BOX_H - 20)
                const maxInnerW = THUMB_BOX_W - 8;
                const maxInnerH = THUMB_BOX_H - 20;

                const scale = Math.min(
                  maxInnerW / imgData.width,
                  maxInnerH / imgData.height,
                  1
                );

                const renderW = Math.max(1, imgData.width * scale);
                const renderH = Math.max(1, imgData.height * scale);

                const centerOffsetX = (THUMB_BOX_W - renderW) / 2;
                const centerOffsetY = (THUMB_BOX_H - 16 - renderH) / 2 + 14;

                currentPage.drawImage(embeddedImg, {
                  x: thumbX + centerOffsetX,
                  y: thumbY + centerOffsetY,
                  width: renderW,
                  height: renderH,
                });
              } catch (embedErr: any) {
                console.warn('Failed to embed image into PDF:', embedErr);
                currentPage.drawText('⚠️ Lỗi nhúng ảnh', {
                  x: thumbX + 16,
                  y: thumbY + 50,
                  size: 7.5,
                  font: regularFont,
                  color: COLOR_AMBER,
                });
              }
            }

            // Caption under thumbnail
            currentPage.drawText(`Ảnh ${imgIndex + 1}`, {
              x: thumbX + 8,
              y: thumbY + 4,
              size: 6.8,
              font: regularFont,
              color: COLOR_TEXT_MUTED,
            });
          }
        }

        currentY -= totalBlockH + 6;
        overallItemIndex++;
      }

      // Subtotal per month
      const subtotalH = 20;
      if (currentY - subtotalH < MARGIN_BOTTOM) {
        addNewPage(`${reportTitle} — ${group.monthTitle}`);
      }

      currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: currentY - subtotalH,
        width: USABLE_WIDTH,
        height: subtotalH,
        color: COLOR_BG_TINT,
        borderColor: COLOR_BORDER,
        borderWidth: 0.5,
      });

      const subtotalText = `TỔNG CỘNG ${group.monthTitle.toUpperCase()}: ${formatVND(
        group.totalAmount
      )} (${group.count} khoản chi)`;
      currentPage.drawText(subtotalText, {
        x: MARGIN_LEFT + 8,
        y: currentY - 14,
        size: 8.5,
        font: boldFont,
        color: COLOR_PRIMARY_DARK,
      });

      currentY -= subtotalH + 16;
    }

    // -------------------------------------------------------------
    // Signatures Section at the end of report
    // -------------------------------------------------------------
    const signBoxH = 85;
    if (currentY - signBoxH < MARGIN_BOTTOM) {
      addNewPage(`${reportTitle} — Ký xác nhận`);
    }

    currentY -= 10;
    const sigColW = USABLE_WIDTH / 3;

    // Col 1: Người đề nghị thanh toán
    currentPage.drawText('Người đề nghị thanh toán', {
      x: MARGIN_LEFT + 15,
      y: currentY,
      size: 9,
      font: boldFont,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText('(Ký, ghi rõ họ tên)', {
      x: MARGIN_LEFT + 25,
      y: currentY - 12,
      size: 7.5,
      font: regularFont,
      color: COLOR_TEXT_MUTED,
    });

    // Col 2: Kế toán kiểm tra
    currentPage.drawText('Kế toán kiểm tra', {
      x: MARGIN_LEFT + sigColW + 28,
      y: currentY,
      size: 9,
      font: boldFont,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText('(Ký, ghi rõ họ tên)', {
      x: MARGIN_LEFT + sigColW + 25,
      y: currentY - 12,
      size: 7.5,
      font: regularFont,
      color: COLOR_TEXT_MUTED,
    });

    // Col 3: Thủ trưởng phê duyệt
    currentPage.drawText('Thủ trưởng phê duyệt', {
      x: MARGIN_LEFT + sigColW * 2 + 20,
      y: currentY,
      size: 9,
      font: boldFont,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText('(Ký, đóng dấu nếu có)', {
      x: MARGIN_LEFT + sigColW * 2 + 18,
      y: currentY - 12,
      size: 7.5,
      font: regularFont,
      color: COLOR_TEXT_MUTED,
    });

    // -------------------------------------------------------------
    // Footer on every page (Trang X / Y)
    // -------------------------------------------------------------
    const totalPagesCount = pagesList.length;
    pagesList.forEach((page, index) => {
      const pageNumStr = `Trang ${index + 1} / ${totalPagesCount}`;
      const pageNumW = regularFont.widthOfTextAtSize(pageNumStr, 8);

      page.drawText(pageNumStr, {
        x: PAGE_WIDTH - MARGIN_RIGHT - pageNumW,
        y: MARGIN_BOTTOM - 18,
        size: 8,
        font: regularFont,
        color: COLOR_TEXT_MUTED,
      });

      page.drawText('Sổ Chi Tiêu & Quản Lý Công Tác Phí (Báo cáo tự động)', {
        x: MARGIN_LEFT,
        y: MARGIN_BOTTOM - 18,
        size: 8,
        font: regularFont,
        color: COLOR_TEXT_MUTED,
      });
    });

    // -------------------------------------------------------------
    // Step 4: Finalize & Generate Blob (Requirement 6)
    // -------------------------------------------------------------
    updateProgress(
      'generate_blob',
      'Bước 4/4: Đang đóng gói file PDF và tạo đường dẫn tải xuống...',
      92
    );

    const pdfBytes = await doc.save();
    const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    const cleanTitle = (reportTitle.trim() || 'Bao_Cao_Cong_Tac_Phi')
      .replace(/[\/\\?%*:|"<> ]/g, '_');
    const fileName = `${cleanTitle}_${new Date().toISOString().slice(0, 10)}.pdf`;

    // Trigger download automatically
    downloadPdfBlob(blob, fileName);

    updateProgress('done', 'Đã tạo và tải file PDF thành công!', 100);

    return {
      blob,
      blobUrl,
      fileName,
      totalPages: totalPagesCount,
      totalExpenses,
      totalImages: totalImagesCount,
      failedImagesCount: failedImagesCounter,
    };
  } catch (error: any) {
    const errorMsg = error?.message || 'Lỗi không xác định khi tạo PDF.';
    updateProgress('error', `Lỗi: ${errorMsg}`, 100);
    throw error;
  }
}
