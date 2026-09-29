import React, { useState, useEffect } from 'react';
import {
  FileText,
  X,
  Download,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Layers,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import { ExpenseItem, AdvancePaymentItem, ExpenseProfile } from '../types';
import {
  exportExpensesToPDF,
  downloadPdfBlob,
  PDFExportProgress,
  PDFExportResult,
} from '../utils/pdfExport';
import { formatVND } from '../utils/categories';

interface PDFExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenses: ExpenseItem[];
  advances: AdvancePaymentItem[];
  profiles: ExpenseProfile[];
  activeProfileId?: string;
  defaultMonth?: string;
}

export const PDFExportModal: React.FC<PDFExportModalProps> = ({
  isOpen,
  onClose,
  expenses,
  advances,
  profiles,
  activeProfileId = 'all',
  defaultMonth = 'all',
}) => {
  const [reportTitle, setReportTitle] = useState('Báo Cáo Thanh Toán Công Tác Phí & Chi Tiêu');
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [profileScope, setProfileScope] = useState<'current' | 'all'>(
    activeProfileId !== 'all' ? 'current' : 'all'
  );
  const [skipImages, setSkipImages] = useState<boolean>(false);

  // Status states
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<PDFExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<PDFExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<{ step: string; detail: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedMonth(defaultMonth);
      setProfileScope(activeProfileId !== 'all' ? 'current' : 'all');
      setErrorMessage(null);
      setExportResult(null);
      setProgress(null);
      setIsExporting(false);
    }
  }, [isOpen, defaultMonth, activeProfileId]);

  if (!isOpen) return null;

  // Filter items based on scope and selected month
  const currentProfileObj = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const scopeExpenses =
    profileScope === 'current' && activeProfileId && activeProfileId !== 'all'
      ? expenses.filter((e) => (e.profileId || 'default') === activeProfileId)
      : expenses;

  const scopeAdvances =
    profileScope === 'current' && activeProfileId && activeProfileId !== 'all'
      ? advances.filter((a) => (a.profileId || 'default') === activeProfileId)
      : advances;

  const filteredItems =
    selectedMonth === 'all'
      ? scopeExpenses
      : scopeExpenses.filter((e) => e.month === selectedMonth);

  const totalAmount = filteredItems.reduce((sum, item) => sum + item.amount, 0);
  const totalAdvancesAmount = scopeAdvances.reduce((sum, a) => sum + a.amount, 0);
  const balance = totalAdvancesAmount - totalAmount;

  const totalImagesCount = filteredItems.reduce(
    (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
    0
  );

  // Available months list for selection
  const availableMonths = Array.from(
    new Set(scopeExpenses.map((e) => e.month).filter(Boolean))
  );

  const handleStartExport = async (forceSkipImages = false) => {
    if (filteredItems.length === 0) {
      setErrorMessage({
        step: 'Kiểm tra dữ liệu đầu vào',
        detail: 'Không có khoản chi nào trong phạm vi đã chọn để xuất PDF.',
      });
      return;
    }

    setIsExporting(true);
    setErrorMessage(null);
    setExportResult(null);

    const profileName =
      profileScope === 'current' && activeProfileId !== 'all'
        ? currentProfileObj?.name || 'Hồ sơ công tác'
        : 'Tất cả hồ sơ công tác';

    try {
      const result = await exportExpensesToPDF({
        expenses: filteredItems,
        reportTitle: reportTitle.trim() || 'Báo Cáo Thanh Toán Công Tác Phí & Chi Tiêu',
        profileName,
        advances: scopeAdvances,
        selectedMonth,
        skipImages: forceSkipImages || skipImages,
        onProgress: (prog) => {
          setProgress(prog);
        },
      });

      setExportResult(result);
    } catch (err: any) {
      console.error('Lỗi khi xuất PDF:', err);
      setErrorMessage({
        step: progress?.stepDescription || 'Xử lý file PDF',
        detail: err?.message || 'Lỗi không xác định khi tạo PDF.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadAgain = () => {
    if (!exportResult) return;
    downloadPdfBlob(exportResult.blob, exportResult.fileName);
  };

  const handleOpenPreview = () => {
    if (!exportResult) return;
    window.open(exportResult.blobUrl, '_blank');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden my-4 border border-slate-100 flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-700 text-white flex items-center justify-center shadow-xs">
              <FileText size={18} />
            </div>
            <div>
              <h3 id="pdf-export-modal-title" className="text-base font-bold text-slate-800">
                Xuất Báo Cáo PDF Kèm Ảnh Chứng Từ
              </h3>
              <p className="text-xs text-slate-500">
                Font Unicode tiếng Việt chuẩn • Tự nén ảnh JPEG • Không cắt ảnh làm đôi
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            aria-label="Đóng"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Options Section (Hide during active export or show alongside progress) */}
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tiêu đề báo cáo
              </label>
              <input
                type="text"
                disabled={isExporting}
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                placeholder="VD: Báo Cáo Quyết Toán Công Tác Phí Tháng 3"
                className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Profile Scope */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phạm vi hồ sơ
                </label>
                <select
                  disabled={isExporting}
                  value={profileScope}
                  onChange={(e) => setProfileScope(e.target.value as 'current' | 'all')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
                >
                  {activeProfileId !== 'all' && (
                    <option value="current">Hồ sơ này: "{currentProfileObj?.name}"</option>
                  )}
                  <option value="all">Tất cả các hồ sơ</option>
                </select>
              </div>

              {/* Month Scope */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kỳ / Tháng chi tiêu
                </label>
                <select
                  disabled={isExporting}
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="all">Tất cả các tháng ({scopeExpenses.length} khoản)</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Option to skip images if needed */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <ImageIcon size={16} className="text-teal-700 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-800">
                    Kèm ảnh chứng từ thu nhỏ ({totalImagesCount} ảnh)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Ảnh được tự động nén ≤1000px, giữ đúng tỉ lệ gốc
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  disabled={isExporting}
                  checked={!skipImages}
                  onChange={(e) => setSkipImages(!e.target.checked)}
                  className="rounded text-teal-700 focus:ring-teal-500"
                />
                <span>Kèm ảnh</span>
              </label>
            </div>

            {/* Scope Summary Preview Box */}
            <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-200 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-teal-900 font-semibold">Khoản chi xuất báo cáo:</span>
                <span className="font-bold text-teal-950 font-mono">
                  {filteredItems.length} khoản chi • {totalImagesCount} ảnh
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-teal-900 font-semibold">Tổng thực chi:</span>
                <span className="font-bold text-teal-950 font-mono">{formatVND(totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-teal-900 font-semibold">Tổng tạm ứng:</span>
                <span className="font-bold text-teal-950 font-mono">{formatVND(totalAdvancesAmount)}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-teal-200/80">
                <span className="text-teal-900 font-bold">
                  {balance >= 0 ? 'Số còn dư (Hoàn ứng):' : 'Chi vượt (Cần cấp thêm):'}
                </span>
                <span className={`font-bold font-mono ${balance >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>
                  {formatVND(Math.abs(balance))}
                </span>
              </div>
            </div>
          </div>

          {/* Requirement 1 & 5: Active Progress Bar during PDF generation */}
          {isExporting && progress && (
            <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold flex items-center gap-2 text-teal-400">
                  <div className="w-3.5 h-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  <span>Đang xử lý tạo file PDF...</span>
                </span>
                <span className="font-mono font-bold text-teal-300">{progress.percent}%</span>
              </div>

              {/* Progress bar line */}
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                <div
                  className="bg-teal-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <div className="text-[11px] text-slate-300 flex items-center justify-between">
                <span className="truncate">{progress.stepDescription}</span>
                {progress.totalImages && progress.totalImages > 0 && (
                  <span className="shrink-0 text-slate-400 font-mono ml-2">
                    {progress.processedImages || 0}/{progress.totalImages} ảnh
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Requirement 1: Clear Error Message Feedback Box with Step Detail */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 space-y-2 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-rose-900">
                    Không thể xuất file PDF
                  </div>
                  <div className="text-rose-800 font-medium">
                    <strong>Bước bị lỗi:</strong> {errorMessage.step}
                  </div>
                  <div className="text-rose-700 bg-white/80 p-2 rounded-lg border border-rose-200 font-mono text-[11px] break-words">
                    {errorMessage.detail}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleStartExport(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-300 cursor-pointer"
                  title="Xuất bản chỉ chứa thông tin văn bản, bỏ qua phần nén ảnh"
                >
                  Xuất nhanh bỏ qua ảnh
                </button>
                <button
                  type="button"
                  onClick={() => handleStartExport(false)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Thử lại</span>
                </button>
              </div>
            </div>
          )}

          {/* Requirement 6: Success Feedback and Download/Preview Actions */}
          {exportResult && !isExporting && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-emerald-900 text-sm">
                    Đã tạo và tải file PDF thành công!
                  </div>
                  <div className="text-emerald-800 font-medium">
                    File: <strong className="font-mono text-slate-900">{exportResult.fileName}</strong>
                  </div>
                  <div className="text-emerald-700 text-[11px]">
                    Báo cáo gồm <strong>{exportResult.totalPages} trang</strong>,{' '}
                    <strong>{exportResult.totalExpenses} khoản chi</strong> và{' '}
                    <strong>{exportResult.totalImages} ảnh chứng từ</strong> đã được bố cục chuẩn chỉnh.
                    {exportResult.failedImagesCount > 0 && (
                      <span className="block text-amber-700 font-semibold mt-0.5">
                        (Có {exportResult.failedImagesCount} ảnh bị hỏng đã được ghi chú "Ảnh lỗi" mà không làm gián đoạn báo cáo)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-emerald-200">
                <button
                  type="button"
                  onClick={handleOpenPreview}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-100 rounded-xl border border-emerald-300 transition-colors cursor-pointer"
                >
                  <ExternalLink size={14} />
                  <span>Xem trước trong tab mới</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadAgain}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer shadow-2xs"
                >
                  <Download size={14} />
                  <span>Tải lại file PDF</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-100">
          <div className="text-[11px] text-slate-500 font-medium">
            {!isExporting && exportResult && 'Đã hoàn thành'}
            {isExporting && 'Vui lòng chờ giây lát...'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors disabled:opacity-40"
            >
              {exportResult ? 'Xong' : 'Hủy'}
            </button>

            {!exportResult && (
              <button
                type="button"
                onClick={() => handleStartExport(false)}
                disabled={isExporting || filteredItems.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl shadow-xs transition-colors disabled:opacity-40 cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Đang xuất PDF...</span>
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    <span>Bắt đầu xuất PDF</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
