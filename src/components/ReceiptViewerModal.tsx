import React, { useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Camera,
  Upload,
  Receipt,
  Wand2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { ExpenseItem, ReceiptScanResult } from '../types';
import { formatVND } from '../utils/categories';
import { compressImage, scanReceiptWithAI } from '../utils/gemini';
import { saveOrDownloadFile } from '../utils/fileSaver';

interface ReceiptViewerModalProps {
  expense: ExpenseItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateImages: (expenseId: string, updatedImages: string[]) => void;
  onApplyExtractedReceipt?: (expenseId: string, extracted: ReceiptScanResult) => void;
}

export const ReceiptViewerModal: React.FC<ReceiptViewerModalProps> = ({
  expense,
  isOpen,
  onClose,
  onUpdateImages,
  onApplyExtractedReceipt,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ReceiptScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  if (!isOpen || !expense) return null;

  const images = expense.images || [];
  const hasImages = images.length > 0;
  const safeIdx = hasImages ? Math.min(currentIndex, images.length - 1) : 0;
  const currentImage = hasImages ? images[safeIdx] : null;

  const handleNext = () => {
    if (safeIdx < images.length - 1) {
      setCurrentIndex(safeIdx + 1);
      setScanResult(null);
      setScanError(null);
    }
  };

  const handlePrev = () => {
    if (safeIdx > 0) {
      setCurrentIndex(safeIdx - 1);
      setScanResult(null);
      setScanError(null);
    }
  };

  const handleDeleteCurrentImage = () => {
    if (!hasImages) return;

    const newImages = images.filter((_, idx) => idx !== safeIdx);
    onUpdateImages(expense.id, newImages);
    if (safeIdx >= newImages.length) {
      setCurrentIndex(Math.max(0, newImages.length - 1));
    }
    setScanResult(null);
  };

  // Requirement 1: Capture from camera or pick multiple images from gallery, auto-compress max 1280px, JPEG 0.7
  const handleAddImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsCompressing(true);
    setScanError(null);
    const compressedList: string[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const compressedDataUrl = await compressImage(files[i], 1280, 0.7);
        compressedList.push(compressedDataUrl);
      } catch (err) {
        console.error('Lỗi khi nén ảnh chứng từ:', err);
      }
    }

    e.target.value = '';
    setIsCompressing(false);

    if (compressedList.length > 0) {
      const newImages = [...images, ...compressedList];
      onUpdateImages(expense.id, newImages);
      setCurrentIndex(newImages.length - 1);
    }
  };

  // Requirement 7: Read invoice from current image using Gemini AI
  const handleScanCurrentImageWithAI = async () => {
    if (!currentImage) return;
    setIsScanning(true);
    setScanError(null);
    setScanResult(null);

    try {
      const res = await scanReceiptWithAI(currentImage);
      if (res.success && res.data) {
        setScanResult(res.data);
      } else {
        setScanError(res.error || 'Không đọc được thông tin từ ảnh hóa đơn này.');
      }
    } catch (err: any) {
      setScanError(err?.message || 'Lỗi khi gửi ảnh tới Gemini AI.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleDownload = async () => {
    if (!currentImage) return;
    try {
      const resp = await fetch(currentImage);
      const blob = await resp.blob();
      const fileName = `chung_tu_${expense.date.replace(/[\/\-]/g, '_')}_${safeIdx + 1}.jpg`;
      await saveOrDownloadFile({
        blob,
        fileName,
        mimeType: 'image/jpeg',
        title: `Ảnh chứng từ #${safeIdx + 1}`,
      });
    } catch (err) {
      console.warn('Download image error:', err);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-viewer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-6"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="min-w-0 pr-2">
            <h3 id="receipt-viewer-title" className="text-base font-semibold text-slate-800 truncate">
              {expense.description}
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span>{expense.date}</span>
              <span>•</span>
              <span className="font-semibold text-teal-700">{formatVND(expense.amount)}</span>
              <span>•</span>
              <span>{hasImages ? `Ảnh ${safeIdx + 1} / ${images.length}` : 'Chưa có ảnh'}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* AI Extracted Result Banner */}
        {scanResult && (
          <div className="px-5 py-3 bg-teal-50 border-b border-teal-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="text-teal-950 space-y-0.5">
              <div className="font-bold flex items-center gap-1.5">
                <Wand2 size={14} className="text-teal-700" />
                <span>Kết quả đọc hóa đơn bằng Gemini AI:</span>
              </div>
              <div className="text-teal-800">
                • Nội dung:{' '}
                <strong>
                  {[scanResult.description, scanResult.merchant].filter(Boolean).join(' - ') ||
                    'Không rõ'}
                </strong>{' '}
                | Số tiền: <strong className="font-mono">{formatVND(Number(scanResult.amount) || 0)}</strong>
                {scanResult.date ? ` | Ngày: ${scanResult.date}` : ''}
              </div>
            </div>
            {onApplyExtractedReceipt && (
              <button
                type="button"
                onClick={() => {
                  onApplyExtractedReceipt(expense.id, scanResult);
                  setScanResult(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold flex items-center gap-1 shadow-2xs cursor-pointer"
              >
                <Check size={13} />
                <span>Cập nhật vào khoản chi</span>
              </button>
            )}
          </div>
        )}

        {scanError && (
          <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle size={15} className="text-rose-600 shrink-0" />
            <span>{scanError}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="relative flex-1 bg-slate-950 flex items-center justify-center min-h-[300px] max-h-[56vh] select-none overflow-hidden">
          {hasImages && currentImage ? (
            <>
              <img
                src={currentImage}
                alt="Chứng từ hóa đơn"
                className="max-h-full max-w-full object-contain mx-auto"
              />

              {/* Prev / Next controls */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={handlePrev}
                    disabled={safeIdx === 0}
                    className={`absolute left-3 p-2.5 rounded-full bg-black/50 text-white backdrop-blur-xs transition-opacity ${
                      safeIdx === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-black/75 cursor-pointer'
                    }`}
                    aria-label="Ảnh trước"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={safeIdx === images.length - 1}
                    className={`absolute right-3 p-2.5 rounded-full bg-black/50 text-white backdrop-blur-xs transition-opacity ${
                      safeIdx === images.length - 1
                        ? 'opacity-30 cursor-not-allowed'
                        : 'hover:bg-black/75 cursor-pointer'
                    }`}
                    aria-label="Ảnh sau"
                  >
                    <ChevronRight size={22} />
                  </button>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Receipt size={48} className="text-slate-600 mb-3 stroke-[1.5]" />
              <p className="text-sm font-medium text-slate-300">Chưa có ảnh chứng từ nào</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Bạn có thể chụp ảnh trực tiếp bằng camera hoặc chọn nhiều ảnh từ thư viện (tự động nén ≤1280px, JPEG 0.7)
              </p>
            </div>
          )}
        </div>

        {/* Bottom Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            {/* Chụp trực tiếp bằng Camera */}
            <label className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl cursor-pointer transition-colors shadow-2xs">
              <Camera size={16} />
              <span>{isCompressing ? 'Đang nén...' : 'Chụp camera'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleAddImages}
                disabled={isCompressing}
              />
            </label>

            {/* Chọn nhiều ảnh từ thư viện */}
            <label className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 active:bg-teal-200 rounded-xl cursor-pointer transition-colors border border-teal-200">
              <Upload size={16} />
              <span>Chọn nhiều ảnh</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleAddImages}
                disabled={isCompressing}
              />
            </label>

            {/* Đọc hóa đơn bằng AI */}
            {hasImages && (
              <button
                type="button"
                onClick={handleScanCurrentImageWithAI}
                disabled={isScanning}
                className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded-xl border border-amber-200 transition-colors cursor-pointer"
                title="Dùng Gemini đọc số tiền, ngày, nội dung từ ảnh này"
              >
                {isScanning ? (
                  <div className="w-4 h-4 border-2 border-amber-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Wand2 size={15} className="text-amber-700" />
                )}
                <span>{isScanning ? 'Đang đọc...' : 'Đọc hóa đơn AI'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {hasImages && (
              <>
                <button
                  onClick={handleDownload}
                  title="Tải ảnh về máy"
                  className="min-h-[44px] flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 active:bg-slate-200 rounded-xl border border-slate-200 transition-colors cursor-pointer"
                >
                  <Download size={15} />
                  <span className="hidden sm:inline">Tải về</span>
                </button>
                <button
                  onClick={handleDeleteCurrentImage}
                  title="Xóa ảnh này"
                  className="min-h-[44px] flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 hover:text-rose-700 bg-white hover:bg-rose-50 active:bg-rose-100 rounded-xl border border-rose-200 transition-colors cursor-pointer"
                >
                  <Trash2 size={15} />
                  <span className="hidden sm:inline">Xóa ảnh</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="min-h-[44px] px-5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 active:bg-slate-200 rounded-xl border border-slate-200 transition-colors cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
