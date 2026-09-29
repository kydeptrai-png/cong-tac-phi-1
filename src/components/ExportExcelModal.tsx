import React, { useState, useRef } from 'react';
import {
  X,
  FileSpreadsheet,
  Download,
  Database,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  Printer,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { ExpenseItem, MonthGroup, AdvancePaymentItem, ExpenseProfile } from '../types';
import { exportExpensesToExcel } from '../utils/excel';
import { exportExpensesToPDF } from '../utils/pdfExport';
import { formatVND } from '../utils/categories';
import {
  ValidatedBackupResult,
  downloadBackupJSON,
  parseAndValidateBackupJSON,
  readBackupFileAsText,
} from '../utils/db';

interface ExportExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenses: ExpenseItem[];
  monthGroups: MonthGroup[];
  advances?: AdvancePaymentItem[];
  profiles?: ExpenseProfile[];
  activeProfileId?: string;
  onRestoreBackup: (
    items: ExpenseItem[],
    mode: 'replace' | 'merge',
    restoredAdvances?: AdvancePaymentItem[],
    restoredProfiles?: ExpenseProfile[]
  ) => Promise<{ totalExpenses: number; totalImages: number }>;
  onClearAllData: () => Promise<void>;
  autoBackupEnabled?: boolean;
  onToggleAutoBackup?: (enabled: boolean) => void;
  lastBackupTime?: string | null;
  onDownloadBackupNow?: () => void;
}

interface PendingBackupState extends ValidatedBackupResult {
  fileName: string;
}

export const ExportExcelModal: React.FC<ExportExcelModalProps> = ({
  isOpen,
  onClose,
  expenses,
  monthGroups,
  advances = [],
  profiles = [],
  activeProfileId = 'default',
  onRestoreBackup,
  onClearAllData,
  autoBackupEnabled = true,
  onToggleAutoBackup,
  lastBackupTime,
  onDownloadBackupNow,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [reportTitle, setReportTitle] = useState('Bao_Cao_Cong_Tac_Phi');
  const [exportProfileScope, setExportProfileScope] = useState<'current' | 'all'>(
    activeProfileId !== 'all' ? 'current' : 'all'
  );
  const [backupProfileScope, setBackupProfileScope] = useState<'current' | 'all'>('all');

  const [feedback, setFeedback] = useState<{
    type: 'loading' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Pending backup waiting for user confirmation (Replace vs Merge)
  const [pendingBackup, setPendingBackup] = useState<PendingBackupState | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');

  // Inline confirmation for clearing all current data
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const restoreInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const currentProfileObj = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  // Filter items by profile scope first
  const scopeExpenses =
    exportProfileScope === 'current' && activeProfileId && activeProfileId !== 'all'
      ? expenses.filter((e) => (e.profileId || 'default') === activeProfileId)
      : expenses;

  const scopeAdvances =
    exportProfileScope === 'current' && activeProfileId && activeProfileId !== 'all'
      ? advances.filter((a) => (a.profileId || 'default') === activeProfileId)
      : advances;

  const filteredItems =
    selectedMonth === 'all'
      ? scopeExpenses
      : scopeExpenses.filter((e) => e.month === selectedMonth);

  const totalAmount = filteredItems.reduce((sum, item) => sum + item.amount, 0);
  const totalAdvances = scopeAdvances.reduce((sum, a) => sum + a.amount, 0);
  const balance = totalAdvances - totalAmount;

  const currentTotalImages = expenses.reduce(
    (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
    0
  );

  const handleExportExcel = async () => {
    if (filteredItems.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Không có khoản chi nào trong phạm vi đã chọn để xuất báo cáo Excel.',
      });
      return;
    }

    try {
      setIsExporting(true);
      setFeedback({
        type: 'loading',
        message: 'Đang xử lý dữ liệu và nhúng ảnh chứng từ vào file Excel...',
      });
      await exportExpensesToExcel(
        filteredItems,
        reportTitle.trim() || 'Bao_Cao_Cong_Tac_Phi'
      );
      setFeedback({
        type: 'success',
        message: 'Đã xuất file Excel (.xlsx) kèm toàn bộ ảnh chứng từ thành công!',
      });
    } catch (err: any) {
      console.error('Lỗi khi xuất file Excel:', err);
      setFeedback({
        type: 'error',
        message: `Xuất file Excel thất bại: ${err?.message || 'Lỗi không xác định'}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Requirement 9: Xuất PDF báo cáo kèm ảnh chứng từ thu nhỏ bên dưới mỗi khoản chi
  const handleExportPDF = async () => {
    if (filteredItems.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Không có khoản chi nào để xuất báo cáo PDF.',
      });
      return;
    }

    try {
      setFeedback({
        type: 'loading',
        message: 'Đang chuẩn bị trang in / lưu PDF kèm toàn bộ ảnh chứng từ...',
      });

      const profileName =
        exportProfileScope === 'current'
          ? currentProfileObj?.name || 'Hồ sơ công tác'
          : 'Tất cả hồ sơ công tác';

      const result = await exportExpensesToPDF({
        expenses: filteredItems,
        reportTitle: reportTitle.trim() || 'Báo Cáo Thanh Toán Công Tác Phí & Chi Tiêu',
        profileName,
        advances: scopeAdvances,
        selectedMonth,
      });

      setFeedback({
        type: 'success',
        message: `Đã tạo và tải file PDF "${result.fileName}" thành công (${result.totalPages} trang, ${result.totalExpenses} khoản chi, ${result.totalImages} ảnh chứng từ)!`,
      });
    } catch (err: any) {
      console.error('Lỗi khi xuất báo cáo PDF:', err);
      setFeedback({
        type: 'error',
        message: `Xuất báo cáo PDF thất bại: ${err?.message || 'Lỗi không xác định'}`,
      });
    }
  };

  // Requirement 10 & 12: Unified JSON Backup export with profile scope option
  const handleExportJSON = () => {
    try {
      const expToBackup =
        backupProfileScope === 'current' && activeProfileId && activeProfileId !== 'all'
          ? expenses.filter((e) => (e.profileId || 'default') === activeProfileId)
          : expenses;
      const advToBackup =
        backupProfileScope === 'current' && activeProfileId && activeProfileId !== 'all'
          ? advances.filter((a) => (a.profileId || 'default') === activeProfileId)
          : advances;
      const profToBackup =
        backupProfileScope === 'current' && activeProfileId && activeProfileId !== 'all'
          ? profiles.filter((p) => p.id === activeProfileId)
          : profiles;

      const result = downloadBackupJSON(expToBackup, undefined, advToBackup, profToBackup);
      const scopeLabel =
        backupProfileScope === 'current' && activeProfileId !== 'all'
          ? `hồ sơ "${currentProfileObj?.name}"`
          : 'tất cả hồ sơ';

      setFeedback({
        type: 'success',
        message: `Đã tải file sao lưu "${result.fileName}" (${scopeLabel}: ${result.totalExpenses} khoản chi, ${result.totalImages} ảnh chứng từ)!`,
      });
    } catch (err: any) {
      console.error('Lỗi khi tạo file sao lưu JSON:', err);
      setFeedback({
        type: 'error',
        message: `Không thể tạo file sao lưu JSON: ${err?.message || 'Lỗi không xác định'}`,
      });
    }
  };

  // Print / Export PDF Settlement Report via hidden iframe (safe in sandboxed iframes)
  const handlePrintPDF = () => {
    if (filteredItems.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Không có khoản chi nào để in báo cáo PDF.',
      });
      return;
    }

    const printIframe = document.createElement('iframe');
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    document.body.appendChild(printIframe);

    const rowsHtml = filteredItems
      .map(
        (item, idx) => `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td style="text-align:center;">${item.date}</td>
          <td>${item.description}${item.notes ? `<br/><small style="color:#64748b;">Ghi chú: ${item.notes}</small>` : ''}</td>
          <td style="text-align:right;font-weight:bold;">${formatVND(item.amount)}</td>
          <td style="text-align:center;">${item.images?.length ? `${item.images.length} ảnh` : 'Chưa có'}</td>
        </tr>`
      )
      .join('');

    const htmlContent = `
      <!doctype html>
      <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <title>${reportTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0f172a; padding: 24px; font-size: 13px; }
          h1 { font-size: 18px; text-transform: uppercase; color: #0f766e; margin-bottom: 4px; }
          .meta { color: #475569; font-size: 12px; margin-bottom: 16px; }
          .summary-box { display: flex; gap: 16px; margin-bottom: 16px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; }
          .summary-item { flex: 1; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; }
          th { background: #0f766e; color: white; text-transform: uppercase; }
          .signatures { display: flex; justify-content: space-between; margin-top: 32px; text-align: center; }
          .sig-col { width: 30%; }
        </style>
      </head>
      <body>
        <h1>BẢNG KÊ THANH TOÁN CÔNG TÁC PHÍ & CHI TIÊU</h1>
        <div class="meta">Ngày xuất: ${new Date().toLocaleDateString('vi-VN')} • Phạm vi: ${
      selectedMonth === 'all' ? 'Tất cả các tháng' : selectedMonth
    }</div>
        <div class="summary-box">
          <div class="summary-item"><strong>Tổng thực chi:</strong><br/>${formatVND(totalAmount)}</div>
          <div class="summary-item"><strong>Tổng tạm ứng:</strong><br/>${formatVND(totalAdvances)}</div>
          <div class="summary-item"><strong>${
            balance >= 0 ? 'Số còn dư (Hoàn lại):' : 'Chi vượt (Thanh toán thêm):'
          }</strong><br/>${formatVND(Math.abs(balance))}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:45px;">STT</th>
              <th style="width:95px;">Ngày</th>
              <th>Diễn giải nội dung chi</th>
              <th style="width:120px;">Số tiền (VNĐ)</th>
              <th style="width:80px;">Chứng từ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align:right;font-weight:bold;">TỔNG CỘNG:</td>
              <td style="text-align:right;font-weight:bold;color:#0f766e;">${formatVND(totalAmount)}</td>
              <td style="text-align:center;">${filteredItems.length} khoản</td>
            </tr>
          </tfoot>
        </table>
        <div class="signatures">
          <div class="sig-col"><strong>Người đề nghị</strong><br/><small>(Ký, ghi rõ họ tên)</small></div>
          <div class="sig-col"><strong>Kế toán kiểm tra</strong><br/><small>(Ký, ghi rõ họ tên)</small></div>
          <div class="sig-col"><strong>Phê duyệt</strong><br/><small>(Ký, ghi rõ họ tên)</small></div>
        </div>
      </body>
      </html>
    `;

    const doc = printIframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
      setTimeout(() => {
        printIframe.contentWindow?.focus();
        printIframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printIframe);
        }, 2000);
      }, 300);
    }
  };

  const handleSelectBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!file) return;

    setConfirmClearAll(false);
    setPendingBackup(null);
    setIsRestoring(true);
    setFeedback({
      type: 'loading',
      message: `Đang đọc file sao lưu "${file.name}"...`,
    });

    try {
      const rawText = await readBackupFileAsText(file);
      const validated = parseAndValidateBackupJSON(rawText);

      setPendingBackup({
        fileName: file.name,
        ...validated,
      });
      setRestoreMode('replace');
      setFeedback({
        type: 'success',
        message: `Đã đọc file "${file.name}": tìm thấy ${validated.totalExpenses} khoản chi và ${validated.totalImages} ảnh chứng từ. Vui lòng xác nhận khôi phục bên dưới.`,
      });
    } catch (err: any) {
      console.error('[Khôi phục JSON - Lỗi đọc/kiểm tra file]:', err);
      setFeedback({
        type: 'error',
        message: `Khôi phục thất bại: ${
          err?.message || 'File không đọc được hoặc sai định dạng sao lưu.'
        }`,
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingBackup) return;

    setIsRestoring(true);
    setFeedback({
      type: 'loading',
      message: `Đang lưu ${pendingBackup.totalExpenses} khoản chi và ${pendingBackup.totalImages} ảnh chứng từ vào bộ nhớ trình duyệt (IndexedDB)...`,
    });

    try {
      const result = await onRestoreBackup(
        pendingBackup.items,
        restoreMode,
        pendingBackup.advances,
        pendingBackup.profiles
      );
      const actionLabel =
        restoreMode === 'replace' ? 'Khôi phục (thay thế)' : 'Khôi phục (gộp thêm)';

      setPendingBackup(null);
      setFeedback({
        type: 'success',
        message: `${actionLabel} thành công: ${result.totalExpenses} khoản chi và ${result.totalImages} ảnh chứng từ đã được cập nhật!`,
      });
    } catch (err: any) {
      console.error('[Khôi phục JSON - Lỗi ghi IndexedDB]:', err);
      setFeedback({
        type: 'error',
        message: `Khôi phục thất bại khi lưu dữ liệu: ${
          err?.message || 'Không thể ghi vào bộ nhớ trình duyệt (IndexedDB).'
        }`,
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setIsRestoring(true);
    setFeedback({
      type: 'loading',
      message: 'Đang xóa toàn bộ dữ liệu hiện tại...',
    });
    try {
      await onClearAllData();
      setConfirmClearAll(false);
      setPendingBackup(null);
      setFeedback({
        type: 'success',
        message:
          'Đã xóa toàn bộ khoản chi và ảnh chứng từ hiện tại. Bạn có thể chọn "Khôi phục JSON" để khôi phục lại từ bản sao lưu.',
      });
    } catch (err: any) {
      console.error('[Lỗi khi xóa dữ liệu]:', err);
      setFeedback({
        type: 'error',
        message: `Không thể xóa dữ liệu: ${err?.message || 'Lỗi bộ nhớ trình duyệt.'}`,
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-excel-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden my-6 border border-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <h3 id="export-excel-title" className="text-base font-bold text-slate-800">
                Xuất Báo Cáo &amp; Sao Lưu Dữ Liệu
              </h3>
              <p className="text-xs text-slate-500">
                Tải file .xlsx, in PDF hoặc sao lưu / khôi phục JSON kèm ảnh chứng từ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Status / Error Banner */}
          {feedback && (
            <div
              role="status"
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 font-medium ${
                feedback.type === 'loading'
                  ? 'bg-sky-50 border-sky-200 text-sky-900'
                  : feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {feedback.type === 'loading' && (
                <div className="w-4 h-4 border-2 border-sky-700 border-t-transparent rounded-full animate-spin shrink-0 mt-0.5" />
              )}
              {feedback.type === 'success' && (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              )}
              {feedback.type === 'error' && (
                <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 leading-relaxed">{feedback.message}</div>
              {feedback.type !== 'loading' && (
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  aria-label="Đóng thông báo"
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Backup & Restore Section */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/90 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <Database size={15} className="text-teal-700" />
                <span>Sao lưu &amp; Khôi phục dữ liệu (JSON)</span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                Hiện có: {expenses.length} khoản · {currentTotalImages} ảnh
              </span>
            </div>

            {/* Requirement 12: Auto-backup toggle & status */}
            {onToggleAutoBackup && (
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <span>Tự động tải file sao lưu khi có thay đổi</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {lastBackupTime
                      ? `Lần sao lưu gần nhất: ${lastBackupTime}`
                      : 'Chờ 25s sau thao tác cuối để tải file JSON có gắn ngày giờ'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleAutoBackup(!autoBackupEnabled)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-xs border transition-colors cursor-pointer ${
                    autoBackupEnabled
                      ? 'bg-teal-50 text-teal-800 border-teal-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {autoBackupEnabled ? (
                    <ToggleRight size={16} className="text-teal-700" />
                  ) : (
                    <ToggleLeft size={16} />
                  )}
                  <span>{autoBackupEnabled ? 'Đang BẬT' : 'Đang TẮT'}</span>
                </button>
              </div>
            )}

            {/* Requirement 10: Scope for JSON Backup */}
            {profiles.length > 1 && (
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 space-y-1.5 text-xs">
                <span className="font-semibold text-slate-700 block">
                  Phạm vi sao lưu JSON:
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBackupProfileScope('all')}
                    className={`py-1 px-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      backupProfileScope === 'all'
                        ? 'bg-teal-700 text-white border-teal-800'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Tất cả các hồ sơ ({profiles.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackupProfileScope('current')}
                    className={`py-1 px-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer truncate ${
                      backupProfileScope === 'current'
                        ? 'bg-teal-700 text-white border-teal-800'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Chỉ hồ sơ "{currentProfileObj?.name}"
                  </button>
                </div>
              </div>
            )}

            {/* Hidden File Input */}
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={handleSelectBackupFile}
            />

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={handleExportJSON}
                disabled={isRestoring}
                className="py-2.5 px-3 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              >
                <Download size={14} />
                <span>Tải sao lưu ngay (JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                disabled={isRestoring}
                className="py-2.5 px-3 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-xl border border-teal-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              >
                <Upload size={14} className="text-teal-700" />
                <span>Khôi phục JSON</span>
              </button>
            </div>

            {/* Confirmation & Mode Selection before overwriting */}
            {pendingBackup && (
              <div className="mt-3 p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl space-y-3 animate-in fade-in duration-150">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={17} className="text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs text-amber-950">
                    <div className="font-bold">
                      {restoreMode === 'replace'
                        ? 'Khôi phục sẽ thay thế dữ liệu hiện tại, tiếp tục?'
                        : 'Xác nhận gộp thêm dữ liệu từ file sao lưu vào dữ liệu hiện có?'}
                    </div>
                    <div className="text-[11px] text-amber-900 space-y-0.5">
                      <div>
                        • File đã chọn: <strong className="font-mono">{pendingBackup.fileName}</strong> (v{pendingBackup.version})
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>
                          • Số khoản chi: <strong>{pendingBackup.totalExpenses} khoản</strong>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ImageIcon size={11} />
                          <span>
                            Số ảnh chứng từ: <strong>{pendingBackup.totalImages} ảnh</strong>
                          </span>
                        </span>
                        <span>
                          • Tổng tiền: <strong className="font-mono">{formatVND(pendingBackup.totalAmount)}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mode selector: Thay thế vs Gộp thêm */}
                <div className="grid grid-cols-2 gap-1.5 bg-amber-100/70 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setRestoreMode('replace')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all text-center ${
                      restoreMode === 'replace'
                        ? 'bg-white text-amber-950 shadow-2xs border border-amber-300'
                        : 'text-amber-900 hover:bg-white/50'
                    }`}
                  >
                    <div>Thay thế dữ liệu hiện tại</div>
                    <div className="text-[10px] font-normal text-amber-700">
                      Ghi đè toàn bộ ({pendingBackup.totalExpenses} khoản)
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreMode('merge')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all text-center ${
                      restoreMode === 'merge'
                        ? 'bg-white text-teal-950 shadow-2xs border border-teal-300'
                        : 'text-amber-900 hover:bg-white/50'
                    }`}
                  >
                    <div>Gộp thêm vào dữ liệu hiện có</div>
                    <div className="text-[10px] font-normal text-amber-700">
                      Giữ dữ liệu cũ + thêm mới
                    </div>
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPendingBackup(null)}
                    disabled={isRestoring}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmRestore}
                    disabled={isRestoring}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RefreshCw size={13} className={isRestoring ? 'animate-spin' : ''} />
                    <span>
                      {restoreMode === 'replace'
                        ? 'Tiếp tục khôi phục (Thay thế)'
                        : 'Tiếp tục khôi phục (Gộp thêm)'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Clear All Data option */}
            {expenses.length > 0 && !pendingBackup && (
              <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between gap-2">
                {!confirmClearAll ? (
                  <>
                    <span className="text-[11px] text-slate-400">
                      Cần làm trống sổ để kiểm tra khôi phục?
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(true)}
                      className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1"
                    >
                      <Trash2 size={12} />
                      <span>Xóa toàn bộ dữ liệu hiện tại</span>
                    </button>
                  </>
                ) : (
                  <div className="w-full p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-rose-900">
                      Xóa toàn bộ {expenses.length} khoản chi ({currentTotalImages} ảnh)?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white rounded-lg border border-slate-200"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmClearAll}
                        disabled={isRestoring}
                        className="px-2.5 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                      >
                        Xác nhận xóa hết
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Excel & PDF Export Configuration */}
          <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <FileSpreadsheet size={15} className="text-teal-700" />
              <span>Xuất Báo Cáo Excel (.xlsx) &amp; Xuất PDF Báo Cáo Kèm Ảnh</span>
            </div>

            {/* Requirement 10: Scope for Excel / PDF */}
            {profiles.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Hồ sơ xuất báo cáo
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setExportProfileScope('current')}
                    className={`py-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer truncate ${
                      exportProfileScope === 'current'
                        ? 'bg-teal-700 text-white border-teal-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Hồ sơ "{currentProfileObj?.name}"
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportProfileScope('all')}
                    className={`py-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                      exportProfileScope === 'all'
                        ? 'bg-teal-700 text-white border-teal-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Tất cả các hồ sơ ({profiles.length})
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên file báo cáo
              </label>
              <input
                type="text"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                placeholder="VD: Bao_Cao_Cong_Tac_Phi_Q1"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Phạm vi tháng
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="all">Tất cả các tháng ({scopeExpenses.length} khoản chi)</option>
                {monthGroups.map((g) => (
                  <option key={g.monthKey} value={g.monthTitle}>
                    {g.monthTitle} ({g.count} khoản - {formatVND(g.totalAmount)})
                  </option>
                ))}
              </select>
            </div>

            {/* Summary Preview */}
            <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Tổng số tiền sẽ xuất:</span>
              <span className="font-bold font-mono text-teal-800 text-sm">{formatVND(totalAmount)}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleExportExcel}
                disabled={isExporting}
                className={`py-2.5 px-3 text-xs font-semibold text-white rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 ${
                  isExporting
                    ? 'bg-emerald-600/80 cursor-not-allowed'
                    : 'bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 cursor-pointer'
                }`}
              >
                {isExporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Đang xuất Excel...</span>
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    <span>Tải Excel (.xlsx) kèm ảnh</span>
                  </>
                )}
              </button>

              {/* Requirement 9: Xuất PDF báo cáo kèm ảnh */}
              <button
                type="button"
                onClick={handleExportPDF}
                className="py-2.5 px-3 text-xs font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                title="Mỗi khoản chi 1 dòng kèm ảnh chứng từ thu nhỏ bên dưới, nhóm theo tháng"
              >
                <Printer size={15} className="text-rose-600" />
                <span>Xuất PDF báo cáo kèm ảnh</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3.5 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-200/60 transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
