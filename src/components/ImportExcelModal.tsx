import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Layers,
  Coins,
  Calendar,
  Columns,
  MessageSquare,
  Trash2,
  CornerDownRight,
  RotateCcw,
} from 'lucide-react';
import { ExpenseItem } from '../types';
import {
  AmountUnitMode,
  ExcelImportResult,
  PreviewExpenseItem,
  RawWorkbookData,
  SheetColumnMapping,
  buildImportPreview,
  formatDayMonthYear,
  readRawExcelWorkbook,
  revalidatePreviewItems,
} from '../utils/excel';
import { formatVND } from '../utils/categories';
import { buildDuplicateKey } from '../utils/db';

interface ImportExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (items: ExpenseItem[], mode: 'append' | 'replace') => void;
  existingExpenses?: ExpenseItem[];
  activeProfileId?: string;
}

export const ImportExcelModal: React.FC<ImportExcelModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  existingExpenses = [],
  activeProfileId = 'default',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rawWorkbook, setRawWorkbook] = useState<RawWorkbookData | null>(null);

  // Rule 5: Năm bắt đầu (mặc định năm hiện tại)
  const [startYear, setStartYear] = useState<number>(new Date().getFullYear());
  // Rule 6: Đơn vị tiền (mặc định nghìn đồng)
  const [unitMode, setUnitMode] = useState<AmountUnitMode>('thousand');
  // Rule 4: Tùy chỉnh cột cho từng sheet
  const [sheetMappings, setSheetMappings] = useState<Record<string, SheetColumnMapping>>({});
  const [activeSheetTab, setActiveSheetTab] = useState<string>('');

  // Danh sách các khoản chi xem trước (Rule 9: cho phép sửa trực tiếp)
  const [previewItems, setPreviewItems] = useState<PreviewExpenseItem[]>([]);
  const [parseResultMeta, setParseResultMeta] = useState<ExcelImportResult | null>(null);

  // Bộ lọc trên bảng xem trước
  const [previewFilter, setPreviewFilter] = useState<'all' | 'warnings' | 'refunds' | 'comments'>('all');
  const [selectedSheetFilter, setSelectedSheetFilter] = useState<string>('all');

  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [duplicateHandling, setDuplicateHandling] = useState<'keep' | 'skip'>('keep');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Requirement 3: Detect duplicates against existingExpenses when in 'append' mode
  const existingKeysSet = useMemo(() => {
    const set = new Set<string>();
    existingExpenses.forEach((e) => {
      set.add(buildDuplicateKey(e.date, e.amount, e.description));
    });
    return set;
  }, [existingExpenses]);

  const duplicatePreviewIds = useMemo(() => {
    const dupSet = new Set<string>();
    const seenInPreview = new Set<string>();
    for (const it of previewItems) {
      const validDay = it.day !== null && it.day >= 1 && it.day <= 31 ? it.day : 1;
      const validMonth =
        it.monthNum !== null && it.monthNum >= 1 && it.monthNum <= 12 ? it.monthNum : 1;
      const cleanDate = formatDayMonthYear(validDay, validMonth, it.year);
      const key = buildDuplicateKey(cleanDate, it.amount, it.description);

      if ((importMode === 'append' && existingKeysSet.has(key)) || seenInPreview.has(key)) {
        dupSet.add(it.id);
      }
      seenInPreview.add(key);
    }
    return dupSet;
  }, [previewItems, existingKeysSet, importMode]);

  // Thống kê nhanh trên danh sách previewItems hiện tại
  const stats = useMemo(() => {
    let totalNet = 0;
    let warningCount = 0;
    let refundCount = 0;
    let commentCount = 0;
    const monthsSet = new Set<string>();

    for (const item of previewItems) {
      totalNet += item.amount;
      if (item.warnings && item.warnings.length > 0) warningCount++;
      if (item.amount < 0) refundCount++;
      if (item.notes && item.notes.trim().length > 0) commentCount++;
      if (item.month) monthsSet.add(item.month);
    }

    return {
      totalNet,
      warningCount,
      refundCount,
      commentCount,
      months: Array.from(monthsSet),
    };
  }, [previewItems]);

  const filteredPreviewItems = useMemo(() => {
    return previewItems.filter((item) => {
      if (selectedSheetFilter !== 'all' && item.sheetName !== selectedSheetFilter) {
        return false;
      }
      if (previewFilter === 'warnings') {
        return item.warnings && item.warnings.length > 0;
      }
      if (previewFilter === 'refunds') {
        return item.amount < 0;
      }
      if (previewFilter === 'comments') {
        return Boolean(item.notes && item.notes.trim().length > 0);
      }
      return true;
    });
  }, [previewItems, previewFilter, selectedSheetFilter]);

  const activeSheetObj = useMemo(() => {
    if (!rawWorkbook) return null;
    return (
      rawWorkbook.sheets.find((s) => s.sheetName === activeSheetTab) ||
      rawWorkbook.sheets[0] ||
      null
    );
  }, [rawWorkbook, activeSheetTab]);

  if (!isOpen) return null;

  const applyBuildPreview = (
    wb: RawWorkbookData,
    year: number,
    unit: AmountUnitMode,
    mappings: Record<string, SheetColumnMapping>
  ) => {
    const result = buildImportPreview(wb, {
      startYear: year,
      unitMode: unit,
      sheetMappings: mappings,
    });
    setParseResultMeta(result);
    setPreviewItems(result.items);
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
      setErrorMessage('Vui lòng chọn file định dạng Excel (.xlsx hoặc .xls)');
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const wb = await readRawExcelWorkbook(file);
      if (wb.sheets.length === 0) {
        setErrorMessage('File Excel trống hoặc không có dữ liệu.');
        setIsProcessing(false);
        return;
      }

      const initialMappings: Record<string, SheetColumnMapping> = {};
      wb.sheets.forEach((s) => {
        initialMappings[s.sheetName] = { ...s.detectedMapping };
      });

      setRawWorkbook(wb);
      setSheetMappings(initialMappings);
      setActiveSheetTab(wb.sheets[0].sheetName);
      setSelectedSheetFilter('all');
      setPreviewFilter('all');

      const result = buildImportPreview(wb, {
        startYear,
        unitMode,
        sheetMappings: initialMappings,
      });

      setParseResultMeta(result);
      setPreviewItems(result.items);

      if (result.items.length === 0) {
        setErrorMessage(
          'Chưa nhận diện được dòng chi tiêu nào. Bạn có thể kiểm tra và chọn lại vị trí cột Ngày / Số tiền / Diễn giải bên dưới.'
        );
      }
    } catch (err: any) {
      console.error('Import error:', err);
      setErrorMessage('Không thể đọc file Excel. Vui lòng kiểm tra lại cấu trúc file.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Khi đổi Năm bắt đầu (Rule 5)
  const handleStartYearChange = (newYear: number) => {
    const validYear = isNaN(newYear) ? new Date().getFullYear() : newYear;
    setStartYear(validYear);
    if (rawWorkbook && validYear >= 1990 && validYear <= 2100) {
      applyBuildPreview(rawWorkbook, validYear, unitMode, sheetMappings);
    }
  };

  // Khi đổi Đơn vị tiền (Rule 6)
  const handleUnitModeChange = (newMode: AmountUnitMode) => {
    setUnitMode(newMode);
    if (rawWorkbook) {
      applyBuildPreview(rawWorkbook, startYear, newMode, sheetMappings);
    }
  };

  // Khi người dùng chỉnh lại cột Ngày / Số tiền / Diễn giải của 1 sheet (Rule 4)
  const handleColumnMappingChange = (
    sheetName: string,
    field: keyof SheetColumnMapping,
    newColIdx: number
  ) => {
    if (!rawWorkbook) return;
    const current =
      sheetMappings[sheetName] ||
      rawWorkbook.sheets.find((s) => s.sheetName === sheetName)?.detectedMapping || {
        dateColIdx: 0,
        amountColIdx: 1,
        descColIdx: 2,
      };
    const updatedMappings: Record<string, SheetColumnMapping> = {
      ...sheetMappings,
      [sheetName]: {
        ...current,
        [field]: newColIdx,
      },
    };
    setSheetMappings(updatedMappings);
    applyBuildPreview(rawWorkbook, startYear, unitMode, updatedMappings);
  };

  const handleResetSheetColumns = (sheetName: string) => {
    if (!rawWorkbook) return;
    const sheet = rawWorkbook.sheets.find((s) => s.sheetName === sheetName);
    if (!sheet) return;
    const updatedMappings: Record<string, SheetColumnMapping> = {
      ...sheetMappings,
      [sheetName]: { ...sheet.detectedMapping },
    };
    setSheetMappings(updatedMappings);
    applyBuildPreview(rawWorkbook, startYear, unitMode, updatedMappings);
  };

  // Rule 9: Chỉnh sửa trực tiếp trên bảng xem trước
  const handleUpdateItemDay = (id: string, newDayStr: string) => {
    const parsed = newDayStr.trim() === '' ? null : parseInt(newDayStr, 10);
    const newDay = parsed !== null && !isNaN(parsed) ? parsed : null;

    setPreviewItems((prev) => {
      const idx = prev.findIndex((it) => it.id === id);
      if (idx === -1) return prev;

      const target = prev[idx];
      const nextList = [...prev];
      nextList[idx] = {
        ...target,
        day: newDay,
        hasManualDayEdit: true,
      };

      // Forward-fill tự động cho các dòng ngay bên dưới cùng tháng nếu ô Ngày gốc trong Excel để trống và chưa sửa tay
      if (newDay !== null && newDay >= 1 && newDay <= 31) {
        for (let i = idx + 1; i < nextList.length; i++) {
          const row = nextList[i];
          if (
            row.sheetName === target.sheetName &&
            row.monthNum === target.monthNum &&
            row.year === target.year &&
            row.isDateCellEmpty &&
            !row.hasManualDayEdit
          ) {
            nextList[i] = {
              ...row,
              day: newDay,
            };
          } else {
            break;
          }
        }
      }

      return revalidatePreviewItems(nextList);
    });
  };

  const handleUpdateItemMonthYear = (
    id: string,
    newMonthNum: number | null,
    newYear: number
  ) => {
    setPreviewItems((prev) => {
      const nextList = prev.map((it) => {
        if (it.id !== id) return it;
        return {
          ...it,
          monthNum: newMonthNum,
          year: newYear,
        };
      });
      return revalidatePreviewItems(nextList);
    });
  };

  // Nút tiện ích: Khi phát hiện ngày nhỏ hơn ngày trước đó (thiếu mốc tháng), cho phép tách từ dòng này sang tháng kế tiếp
  const handleShiftToNextMonthFromRow = (id: string) => {
    setPreviewItems((prev) => {
      const idx = prev.findIndex((it) => it.id === id);
      if (idx === -1) return prev;

      const target = prev[idx];
      const origMonthNum = target.monthNum || 1;
      const origYear = target.year;

      let nextMonthNum = origMonthNum + 1;
      let nextYear = origYear;
      if (nextMonthNum > 12) {
        nextMonthNum = 1;
        nextYear += 1;
      }

      const nextList = [...prev];
      for (let i = idx; i < nextList.length; i++) {
        const item = nextList[i];
        // Chỉ chuyển các dòng từ vị trí này cho tới hết khối tháng hiện tại trong cùng sheet
        if (
          item.sheetName === target.sheetName &&
          item.monthNum === origMonthNum &&
          item.year === origYear
        ) {
          nextList[i] = {
            ...item,
            monthNum: nextMonthNum,
            year: nextYear,
          };
        } else {
          break;
        }
      }

      return revalidatePreviewItems(nextList);
    });
  };

  const handleUpdateItemAmount = (id: string, newAmountStr: string) => {
    const cleaned = newAmountStr.replace(/[^\d-]/g, '');
    const num = cleaned === '' || cleaned === '-' ? 0 : parseInt(cleaned, 10) || 0;

    setPreviewItems((prev) => {
      const nextList = prev.map((it) => {
        if (it.id !== id) return it;
        return {
          ...it,
          amount: num,
        };
      });
      return revalidatePreviewItems(nextList);
    });
  };

  const handleUpdateItemDescription = (id: string, newDesc: string) => {
    setPreviewItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, description: newDesc } : it))
    );
  };

  const handleUpdateItemNotes = (id: string, newNotes: string) => {
    setPreviewItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, notes: newNotes || undefined } : it))
    );
  };

  const handleDeletePreviewItem = (id: string) => {
    setPreviewItems((prev) => revalidatePreviewItems(prev.filter((it) => it.id !== id)));
  };

  const handleConfirmImport = () => {
    if (previewItems.length === 0) return;

    const sourceItems =
      duplicateHandling === 'skip' && duplicatePreviewIds.size > 0
        ? previewItems.filter((it) => !duplicatePreviewIds.has(it.id))
        : previewItems;

    // Chuẩn hóa sang ExpenseItem trước khi lưu vào DB
    const finalItems: ExpenseItem[] = sourceItems.map((it) => {
      const validDay =
        it.day !== null && it.day >= 1 && it.day <= 31 ? it.day : 1;
      const validMonth =
        it.monthNum !== null && it.monthNum >= 1 && it.monthNum <= 12 ? it.monthNum : 1;
      const cleanDate =
        it.day !== null && it.day >= 1 && it.day <= 31
          ? formatDayMonthYear(validDay, validMonth, it.year)
          : formatDayMonthYear(1, validMonth, it.year);

      return {
        id: it.id,
        month:
          it.monthNum && it.monthNum >= 1 && it.monthNum <= 12
            ? `Tháng ${it.monthNum}/${it.year}`
            : it.month,
        date: cleanDate,
        amount: it.amount,
        description: it.description.trim() || 'Khoản chi',
        images: it.images || [],
        sheetName: it.sheetName,
        notes: it.notes?.trim() ? it.notes.trim() : undefined,
        profileId: activeProfileId === 'all' ? 'default' : activeProfileId,
        createdAt: it.createdAt,
        updatedAt: Date.now(),
      };
    });

    onImportComplete(finalItems, importMode);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-excel-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto"
    >
      <div
        className={`relative w-full ${
          rawWorkbook ? 'max-w-6xl' : 'max-w-xl'
        } bg-white rounded-2xl shadow-2xl overflow-hidden my-4 border border-slate-100 flex flex-col max-h-[94vh] transition-all`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <h3 id="import-excel-title" className="text-sm sm:text-base font-bold text-slate-800">
                Nhập Dữ Liệu Từ Excel (.xlsx / .xls)
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500">
                Tự suy ra Tháng (t1..t12), điền Ngày tự động (forward-fill), giữ comment &amp; kiểm tra dòng đáng ngờ
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {!rawWorkbook ? (
            <>
              {/* Pre-import Settings: Năm bắt đầu (Rule 5) & Đơn vị tiền (Rule 6) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Rule 5: Năm bắt đầu */}
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/90 space-y-2">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar size={14} className="text-teal-700" />
                    <span>1. Chọn năm bắt đầu:</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={2000}
                      max={2100}
                      value={startYear}
                      onChange={(e) => handleStartYearChange(parseInt(e.target.value, 10))}
                      className="w-24 px-3 py-1.5 text-sm font-bold font-mono text-teal-900 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                    />
                    <div className="flex items-center gap-1">
                      {[2024, 2025, 2026].map((yr) => (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => handleStartYearChange(yr)}
                          className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                            startYear === yr
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {yr}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Nếu mốc tháng giảm so với mốc trước (VD: từ <strong>t12</strong> sang <strong>t1</strong>), hệ thống tự tăng năm lên <strong>+1</strong>.
                  </p>
                </div>

                {/* Rule 6: Đơn vị tiền */}
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/90 space-y-2">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Coins size={14} className="text-amber-600" />
                    <span>2. Đơn vị tiền trong file:</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleUnitModeChange('thousand')}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        unitMode === 'thousand'
                          ? 'border-teal-600 bg-teal-50/80 text-teal-950 font-semibold shadow-2xs'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="text-xs font-bold">Nghìn đồng (×1.000)</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        Mặc định: 116 → 116.000đ
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnitModeChange('vnd')}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        unitMode === 'vnd'
                          ? 'border-teal-600 bg-teal-50/80 text-teal-950 font-semibold shadow-2xs'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="text-xs font-bold">Đồng (VNĐ ×1)</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        Giữ nguyên số trong file
                      </div>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Số âm (VD: <strong>-158</strong>) sẽ giữ nguyên số âm, trừ vào tổng và gắn nhãn <strong>"Hoàn/thu lại"</strong>.
                  </p>
                </div>
              </div>

              {/* Drag and Drop Box */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFile(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                  isDragging
                    ? 'border-teal-600 bg-teal-50/50 scale-[1.01]'
                    : 'border-slate-300 hover:border-teal-500 hover:bg-slate-50/80'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center mb-3">
                  <UploadCloud size={24} />
                </div>
                <h4 className="text-sm font-semibold text-slate-800">
                  Kéo và thả file Excel (.xlsx, .xls) vào đây
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  hoặc bấm để chọn file từ máy tính của bạn
                </p>
                <button
                  type="button"
                  className="mt-4 px-4 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-xl border border-teal-200 transition-colors"
                >
                  Chọn file từ máy tính
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFile(e.target.files[0]);
                    }
                  }}
                />
              </div>

              {/* Rules Summary Box */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Layers size={14} className="text-teal-700" />
                  <span>Quy tắc tự động suy luận Tháng &amp; Ngày:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-500 text-[11px] pl-1">
                  <li>
                    <strong>Mốc tháng (t1..t12, T 3, Tháng 3):</strong> Hiểu là dòng tiêu đề tháng. Khi tháng giảm (VD: t12 → t1) tự tăng năm +1.
                  </li>
                  <li>
                    <strong>Điền ngày tự động (Forward-fill):</strong> Dòng để trống ô Ngày sẽ lấy cùng ngày với khoản chi gần nhất phía trên trong cùng tháng. Reset khi sang tháng mới.
                  </li>
                  <li>
                    <strong>Tự nhận diện vị trí cột:</strong> Tự tìm cột Ngày, Số tiền, Diễn giải cho từng sheet và cho phép chỉnh lại.
                  </li>
                  <li>
                    <strong>Giữ nguyên Comment &amp; Số âm:</strong> Lưu comment của ô làm ghi chú; giữ số âm làm khoản <em>"Hoàn/thu lại"</em>.
                  </li>
                </ul>
              </div>

              {isProcessing && (
                <div className="flex items-center justify-center gap-2 p-4 text-xs font-medium text-teal-700">
                  <div className="w-4 h-4 border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                  <span>Đang đọc file Excel, trích xuất comment và kiểm tra ngày tháng...</span>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </>
          ) : (
            /* PREVIEW & CONFIGURATION SCREEN */
            <div className="space-y-4">
              {/* Top Control Bar: File Info + Start Year + Unit Mode + Import Mode */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/90">
                {/* File summary */}
                <div className="lg:col-span-4 flex items-start gap-2.5 pr-2">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                        {rawWorkbook.fileName}
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          setRawWorkbook(null);
                          setParseResultMeta(null);
                          setPreviewItems([]);
                          setErrorMessage(null);
                        }}
                        className="text-[11px] font-semibold text-teal-700 hover:underline shrink-0"
                      >
                        Đổi file
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Đọc được <strong>{previewItems.length}</strong> khoản chi từ{' '}
                      <strong>{rawWorkbook.sheets.length}</strong> sheet • Tổng cộng:{' '}
                      <strong className="text-teal-800 font-mono">
                        {formatVND(stats.totalNet)}
                      </strong>
                    </p>
                    {stats.months.length > 0 && (
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        Các tháng: {stats.months.join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Rule 5: Năm bắt đầu */}
                <div className="lg:col-span-2 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-slate-200/80 pt-2 lg:pt-0 lg:pl-3">
                  <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 flex items-center gap-1">
                    <Calendar size={12} className="text-teal-700" />
                    <span>Năm bắt đầu</span>
                  </label>
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={startYear}
                    onChange={(e) => handleStartYearChange(parseInt(e.target.value, 10))}
                    className="w-full px-2.5 py-1.5 text-xs font-bold font-mono text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                {/* Rule 6: Đơn vị tiền */}
                <div className="lg:col-span-3 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-slate-200/80 pt-2 lg:pt-0 lg:pl-3">
                  <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 flex items-center gap-1">
                    <Coins size={12} className="text-amber-600" />
                    <span>Đơn vị tiền (Nhân hệ số)</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => handleUnitModeChange('thousand')}
                      className={`py-1 px-2 rounded-md font-semibold text-[11px] transition-all ${
                        unitMode === 'thousand'
                          ? 'bg-white text-teal-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Nghìn đồng (×1.000)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnitModeChange('vnd')}
                      className={`py-1 px-2 rounded-md font-semibold text-[11px] transition-all ${
                        unitMode === 'vnd'
                          ? 'bg-white text-teal-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Đồng (×1)
                    </button>
                  </div>
                </div>

                {/* Chế độ lưu: Gộp thêm vs Thay thế */}
                <div className="lg:col-span-3 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-slate-200/80 pt-2 lg:pt-0 lg:pl-3">
                  <label className="text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Chế độ nhập vào sổ
                  </label>
                  <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setImportMode('append')}
                      className={`py-1 px-2 rounded-md font-semibold text-[11px] transition-all ${
                        importMode === 'append'
                          ? 'bg-white text-teal-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Gộp thêm
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode('replace')}
                      className={`py-1 px-2 rounded-md font-semibold text-[11px] transition-all ${
                        importMode === 'replace'
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Thay thế hết
                    </button>
                  </div>
                </div>
              </div>

              {/* Rule 4: Column Mapping Inspector & Editor per Sheet */}
              {activeSheetObj && (
                <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Columns size={15} className="text-teal-700" />
                      <span className="text-xs font-bold text-slate-800">
                        Vị trí cột tự nhận diện theo từng Sheet (chỉnh lại nếu lệch cột):
                      </span>
                    </div>

                    {/* Sheet Selector Tabs if multiple sheets */}
                    {rawWorkbook.sheets.length > 1 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {rawWorkbook.sheets.map((s) => (
                          <button
                            key={s.sheetName}
                            type="button"
                            onClick={() => setActiveSheetTab(s.sheetName)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                              activeSheetObj.sheetName === s.sheetName
                                ? 'bg-teal-700 text-white border-teal-700'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            Sheet: {s.sheetName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {(() => {
                    const currentMap =
                      sheetMappings[activeSheetObj.sheetName] || activeSheetObj.detectedMapping;
                    const cols = activeSheetObj.availableColumns;

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                        {/* Cột Ngày */}
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                          <label className="text-[11px] font-bold text-slate-700 block mb-1">
                            Cột Ngày &amp; Mốc tháng (t1..t12):
                          </label>
                          <select
                            value={currentMap.dateColIdx}
                            onChange={(e) =>
                              handleColumnMappingChange(
                                activeSheetObj.sheetName,
                                'dateColIdx',
                                parseInt(e.target.value, 10)
                              )
                            }
                            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-teal-600"
                          >
                            {cols.map((col) => (
                              <option key={col.colIdx} value={col.colIdx}>
                                Cột {col.colLetter} — [
                                {col.sampleValues.slice(0, 3).join(', ') || 'Trống'}]
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Cột Số tiền */}
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                          <label className="text-[11px] font-bold text-slate-700 block mb-1">
                            Cột Số tiền:
                          </label>
                          <select
                            value={currentMap.amountColIdx}
                            onChange={(e) =>
                              handleColumnMappingChange(
                                activeSheetObj.sheetName,
                                'amountColIdx',
                                parseInt(e.target.value, 10)
                              )
                            }
                            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-teal-600"
                          >
                            {cols.map((col) => (
                              <option key={col.colIdx} value={col.colIdx}>
                                Cột {col.colLetter} — [
                                {col.sampleValues.slice(0, 3).join(', ') || 'Trống'}]
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Cột Diễn giải */}
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-bold text-slate-700">
                              Cột Diễn giải (chữ dài nhất):
                            </label>
                            <button
                              type="button"
                              onClick={() => handleResetSheetColumns(activeSheetObj.sheetName)}
                              title="Khôi phục cột tự nhận diện mặc định"
                              className="text-[10px] text-teal-700 hover:underline flex items-center gap-0.5"
                            >
                              <RotateCcw size={10} />
                              <span>Tự động</span>
                            </button>
                          </div>
                          <select
                            value={currentMap.descColIdx}
                            onChange={(e) =>
                              handleColumnMappingChange(
                                activeSheetObj.sheetName,
                                'descColIdx',
                                parseInt(e.target.value, 10)
                              )
                            }
                            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-teal-600"
                          >
                            {cols.map((col) => (
                              <option key={col.colIdx} value={col.colIdx}>
                                Cột {col.colLetter} — [
                                {col.sampleValues.slice(0, 3).join(', ') || 'Trống'}]
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Rule 9: Warning Banner for Suspicious Rows */}
              {stats.warningCount > 0 ? (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-950">
                      <span className="font-bold">
                        Cảnh báo: Phát hiện {stats.warningCount} dòng đáng ngờ cần kiểm tra!
                      </span>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Bao gồm các khoản chi xuất hiện trước khi có ngày nào trong tháng, hoặc có ngày nhỏ hơn ngày trước đó trong cùng tháng (có thể thiếu mốc tháng). Bạn có thể sửa trực tiếp ở bảng dưới.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewFilter(previewFilter === 'warnings' ? 'all' : 'warnings')
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors shrink-0 ${
                      previewFilter === 'warnings'
                        ? 'bg-amber-700 text-white border-amber-700'
                        : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    {previewFilter === 'warnings'
                      ? `Hiện tất cả (${previewItems.length})`
                      : `Chỉ xem dòng đáng ngờ (${stats.warningCount})`}
                  </button>
                </div>
              ) : (
                <div className="p-2.5 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-900">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <span>
                    Tất cả <strong>{previewItems.length}</strong> khoản chi đều có Tháng và Ngày hợp lệ theo thứ tự thời gian.
                  </span>
                </div>
              )}

              {/* Filter Tabs Bar above Preview Table */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      previewFilter === 'all'
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Tất cả ({previewItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('warnings')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
                      previewFilter === 'warnings'
                        ? 'bg-amber-600 text-white'
                        : stats.warningCount > 0
                        ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <AlertTriangle size={12} />
                    <span>Đáng ngờ ({stats.warningCount})</span>
                  </button>
                  {stats.refundCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreviewFilter('refunds')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        previewFilter === 'refunds'
                          ? 'bg-cyan-700 text-white'
                          : 'bg-cyan-50 text-cyan-800 border border-cyan-200 hover:bg-cyan-100'
                      }`}
                    >
                      Hoàn/thu lại ({stats.refundCount})
                    </button>
                  )}
                  {stats.commentCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreviewFilter('comments')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
                        previewFilter === 'comments'
                          ? 'bg-amber-700 text-white'
                          : 'bg-yellow-50 text-yellow-800 border border-yellow-300 hover:bg-yellow-100'
                      }`}
                    >
                      <MessageSquare size={12} />
                      <span>Có Comment ({stats.commentCount})</span>
                    </button>
                  )}
                </div>

                {rawWorkbook.sheets.length > 1 && (
                  <select
                    value={selectedSheetFilter}
                    onChange={(e) => setSelectedSheetFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs font-semibold bg-slate-100 border border-slate-200 rounded-lg text-slate-700"
                  >
                    <option value="all">Mọi Sheet ({rawWorkbook.sheets.length})</option>
                    {rawWorkbook.sheets.map((s) => (
                      <option key={s.sheetName} value={s.sheetName}>
                        Sheet: {s.sheetName}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Rule 9: Editable Preview Table (Tháng / Ngày / Số tiền / Diễn giải) */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="max-h-[46vh] overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 text-slate-600 border-b border-slate-200 text-[11px] uppercase sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-2.5 w-14 text-center">Dòng</th>
                        <th className="py-2.5 px-2.5 w-40">Tháng / Năm</th>
                        <th className="py-2.5 px-2.5 w-32">Ngày (1-31)</th>
                        <th className="py-2.5 px-2.5 w-40 text-right">Số tiền (VNĐ)</th>
                        <th className="py-2.5 px-2.5 min-w-[220px]">Diễn giải &amp; Ghi chú (Comment)</th>
                        <th className="py-2.5 px-2 w-10 text-center">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPreviewItems.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-400">
                            Không có dòng dữ liệu nào trong bộ lọc này.
                          </td>
                        </tr>
                      ) : (
                        filteredPreviewItems.map((item) => {
                          const hasWarning = item.warnings && item.warnings.length > 0;
                          const isDayDecreased = item.warningTypes?.includes('day_decreased');
                          const isRefund = item.amount < 0;

                          return (
                            <React.Fragment key={item.id}>
                              <tr
                                className={`transition-colors ${
                                  hasWarning
                                    ? 'bg-amber-50/70 hover:bg-amber-100/60'
                                    : isRefund
                                    ? 'bg-cyan-50/30 hover:bg-cyan-50/60'
                                    : 'hover:bg-slate-50'
                                }`}
                              >
                                {/* Dòng Excel & Sheet */}
                                <td className="py-2 px-2.5 text-center font-mono text-[11px] text-slate-400">
                                  <div>#{item.rowIndex}</div>
                                  {rawWorkbook.sheets.length > 1 && (
                                    <div className="text-[9px] text-slate-400 truncate max-w-[48px]">
                                      {item.sheetName}
                                    </div>
                                  )}
                                </td>

                                {/* Cột Tháng / Năm (Sửa trực tiếp) */}
                                <td className="py-2 px-2.5 align-top">
                                  <div className="flex items-center gap-1">
                                    <select
                                      value={item.monthNum ?? ''}
                                      onChange={(e) => {
                                        const val = e.target.value
                                          ? parseInt(e.target.value, 10)
                                          : null;
                                        handleUpdateItemMonthYear(item.id, val, item.year);
                                      }}
                                      aria-label="Chọn tháng"
                                      className={`px-1.5 py-1 text-xs font-semibold rounded-lg border bg-white focus:outline-hidden ${
                                        !item.monthNum
                                          ? 'border-rose-400 text-rose-700 bg-rose-50'
                                          : 'border-slate-200 text-slate-800'
                                      }`}
                                    >
                                      <option value="">Tháng?</option>
                                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                        <option key={m} value={m}>
                                          Tháng {m}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      value={item.year}
                                      onChange={(e) => {
                                        const y =
                                          parseInt(e.target.value, 10) || startYear;
                                        handleUpdateItemMonthYear(
                                          item.id,
                                          item.monthNum,
                                          y
                                        );
                                      }}
                                      aria-label="Năm"
                                      className="w-15 px-1.5 py-1 text-xs font-mono font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-hidden"
                                    />
                                  </div>
                                </td>

                                {/* Cột Ngày (Sửa trực tiếp + hiển thị DD/MM/YYYY) */}
                                <td className="py-2 px-2.5 align-top">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number"
                                      min={1}
                                      max={31}
                                      placeholder="Ngày?"
                                      value={
                                        item.day !== null && item.day > 0 ? item.day : ''
                                      }
                                      onChange={(e) =>
                                        handleUpdateItemDay(item.id, e.target.value)
                                      }
                                      className={`w-14 px-2 py-1 text-xs font-mono font-bold rounded-lg border focus:outline-hidden ${
                                        hasWarning
                                          ? 'border-amber-500 bg-white text-amber-950 ring-1 ring-amber-400/50'
                                          : 'border-slate-200 bg-white text-slate-800'
                                      }`}
                                    />
                                    {item.isDateCellEmpty && (
                                      <span
                                        title="Ngày được điền tự động (forward-fill) từ dòng trên"
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium"
                                      >
                                        Tự điền
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                                    {item.date}
                                  </div>
                                </td>

                                {/* Cột Số tiền (Sửa trực tiếp + nhãn Hoàn/thu lại cho số âm) */}
                                <td className="py-2 px-2.5 align-top text-right">
                                  <input
                                    type="number"
                                    step="1000"
                                    value={item.amount}
                                    onChange={(e) =>
                                      handleUpdateItemAmount(item.id, e.target.value)
                                    }
                                    className={`w-full px-2 py-1 text-xs font-mono font-bold text-right rounded-lg border bg-white focus:outline-hidden ${
                                      isRefund
                                        ? 'border-cyan-300 text-cyan-800'
                                        : 'border-slate-200 text-teal-900'
                                    }`}
                                  />
                                  <div className="flex items-center justify-end gap-1 mt-0.5">
                                    {isRefund && (
                                      <span className="text-[10px] px-1.5 py-0.2 bg-cyan-100 text-cyan-800 rounded font-bold">
                                        Hoàn/thu lại
                                      </span>
                                    )}
                                    <span
                                      className={`text-[10px] font-mono font-semibold ${
                                        isRefund ? 'text-cyan-700' : 'text-slate-500'
                                      }`}
                                    >
                                      {formatVND(item.amount)}
                                    </span>
                                  </div>
                                </td>

                                {/* Cột Diễn giải & Comment Ghi chú */}
                                <td className="py-2 px-2.5 align-top space-y-1">
                                  <input
                                    type="text"
                                    value={item.description}
                                    onChange={(e) =>
                                      handleUpdateItemDescription(item.id, e.target.value)
                                    }
                                    placeholder="Nhập diễn giải..."
                                    className="w-full px-2.5 py-1 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-teal-600"
                                  />
                                  {/* Hiển thị / sửa Comment từ Excel (Rule 8) */}
                                  <div className="flex items-center gap-1">
                                    <span
                                      title="Ghi chú (tự động lấy từ Comment ô Excel có tam giác vàng)"
                                      className="text-[10px] text-amber-700 font-semibold shrink-0 flex items-center gap-0.5"
                                    >
                                      <MessageSquare size={10} />
                                      <span>Ghi chú:</span>
                                    </span>
                                    <input
                                      type="text"
                                      value={item.notes || ''}
                                      onChange={(e) =>
                                        handleUpdateItemNotes(item.id, e.target.value)
                                      }
                                      placeholder="Không có comment..."
                                      className={`flex-1 px-2 py-0.5 text-[11px] rounded border focus:outline-hidden ${
                                        item.notes
                                          ? 'bg-yellow-50/90 border-yellow-300 text-amber-950 font-medium'
                                          : 'bg-slate-50/60 border-transparent hover:border-slate-200 text-slate-500'
                                      }`}
                                    />
                                  </div>
                                </td>

                                {/* Xóa dòng */}
                                <td className="py-2 px-2 align-top text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePreviewItem(item.id)}
                                    title="Bỏ qua dòng này"
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>

                              {/* Dòng hiển thị chi tiết Cảnh báo và nút xử lý nhanh (Rule 9) */}
                              {hasWarning && (
                                <tr className="bg-amber-100/70 border-b border-amber-200">
                                  <td />
                                  <td colSpan={5} className="py-1.5 px-2.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900">
                                      <div className="flex items-center gap-1.5 font-medium">
                                        <AlertTriangle
                                          size={13}
                                          className="text-amber-700 shrink-0"
                                        />
                                        <span>{item.warnings.join(' • ')}</span>
                                      </div>
                                      {isDayDecreased && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleShiftToNextMonthFromRow(item.id)
                                          }
                                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-700 hover:bg-amber-800 text-white font-semibold text-[11px] shadow-2xs transition-colors cursor-pointer"
                                        >
                                          <CornerDownRight size={11} />
                                          <span>
                                            Chuyển từ dòng này sang tháng kế tiếp (thiếu mốc tháng)
                                          </span>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-100">
          {/* Requirement 3: Duplicate Warning Banner in Excel Import */}
          {rawWorkbook && duplicatePreviewIds.size > 0 && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                <span>
                  <strong>Cảnh báo trùng:</strong> Có <strong>{duplicatePreviewIds.size}</strong> dòng trong file trùng Ngày, Số tiền và Diễn giải với khoản đã có.
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDuplicateHandling('keep')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    duplicateHandling === 'keep'
                      ? 'bg-amber-700 text-white border-amber-800'
                      : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100/50'
                  }`}
                >
                  Vẫn thêm tất cả ({previewItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicateHandling('skip')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    duplicateHandling === 'skip'
                      ? 'bg-teal-700 text-white border-teal-800'
                      : 'bg-white text-teal-900 border-teal-300 hover:bg-teal-50'
                  }`}
                >
                  Bỏ qua khoản trùng (Chỉ nhập {previewItems.length - duplicatePreviewIds.size} khoản)
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {rawWorkbook && (
                <span>
                  Tổng cộng <strong>{previewItems.length}</strong> khoản • Tổng tiền:{' '}
                  <strong className="font-mono text-teal-800">
                    {formatVND(stats.totalNet)}
                  </strong>
                  {stats.warningCount > 0 && (
                    <span className="ml-2 text-amber-700 font-semibold">
                      ({stats.warningCount} dòng cảnh báo)
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-200/60 transition-colors"
              >
                Hủy
              </button>
              {rawWorkbook && previewItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>
                    Xác nhận nhập{' '}
                    {duplicateHandling === 'skip'
                      ? previewItems.length - duplicatePreviewIds.size
                      : previewItems.length}{' '}
                    khoản chi
                  </span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

