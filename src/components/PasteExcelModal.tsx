import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X,
  ClipboardPaste,
  FileSpreadsheet,
  Image as ImageIcon,
  Table as TableIcon,
  Sparkles,
  Check,
  Trash2,
  AlertTriangle,
  AlertCircle,
  Plus,
  Columns,
  Calendar,
  Coins,
  RotateCcw,
} from 'lucide-react';
import { ExpenseItem } from '../types';
import {
  AmountUnitMode,
  RawWorkbookData,
  SheetColumnMapping,
  buildImportPreview,
  parseClipboardToRawWorkbook,
  formatDayMonthYear,
} from '../utils/excel';
import { compressImage, parseExcelImageWithAI } from '../utils/gemini';
import { formatVND } from '../utils/categories';
import { buildDuplicateKey } from '../utils/db';

export interface InitialClipboardPayload {
  id: string;
  imageBlob?: Blob | File;
  plainText?: string;
  htmlText?: string;
}

interface PasteExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingExpenses: ExpenseItem[];
  defaultMonth: string;
  activeProfileId: string;
  onConfirmAddBulk: (items: ExpenseItem[]) => void;
  initialPayload?: InitialClipboardPayload | null;
  onClearInitialPayload?: () => void;
}

interface EditablePasteRow {
  tempId: string;
  date: string;
  amount: number;
  description: string;
  warnings?: string[];
}

const UNRECOGNIZED_CONTENT_MSG =
  'Không nhận diện được nội dung, vui lòng dán lại hoặc nhập tay';

function parseMonthYearFromLabel(label: string): { monthNum: number; year: number } {
  const now = new Date();
  const defaultM = now.getMonth() + 1;
  const defaultY = now.getFullYear();
  if (!label) return { monthNum: defaultM, year: defaultY };

  const match = label.match(/0?([1-9]|1[0-2])(?:\s*[\/\-]\s*(20\d{2}|\d{2}))?/);
  if (match) {
    const m = parseInt(match[1], 10);
    let y = match[2] ? parseInt(match[2], 10) : defaultY;
    if (y < 100) y += 2000;
    return { monthNum: m, year: y };
  }
  return { monthNum: defaultM, year: defaultY };
}

export const PasteExcelModal: React.FC<PasteExcelModalProps> = ({
  isOpen,
  onClose,
  existingExpenses,
  defaultMonth,
  activeProfileId,
  onConfirmAddBulk,
  initialPayload,
  onClearInitialPayload,
}) => {
  const initialMY = useMemo(() => parseMonthYearFromLabel(defaultMonth), [defaultMonth]);

  const [defaultMonthNum, setDefaultMonthNum] = useState<number>(initialMY.monthNum);
  const [startYear, setStartYear] = useState<number>(initialMY.year);
  const [unitMode, setUnitMode] = useState<AmountUnitMode>('thousand');

  // Detected source mode
  const [detectedSourceType, setDetectedSourceType] = useState<'none' | 'table' | 'image'>('none');
  const [pastedImageUrl, setPastedImageUrl] = useState<string | null>(null);
  const [rawTextValue, setRawTextValue] = useState<string>('');
  const [rawHtmlValue, setRawHtmlValue] = useState<string>('');

  // Raw workbook when pasted as text/table (supports column re-mapping)
  const [rawWorkbook, setRawWorkbook] = useState<RawWorkbookData | null>(null);
  const [columnMapping, setColumnMapping] = useState<SheetColumnMapping | null>(null);

  // Preview rows (unified for both Image and Table)
  const [previewRows, setPreviewRows] = useState<EditablePasteRow[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<'keep' | 'skip'>('keep');

  const pasteZoneRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const my = parseMonthYearFromLabel(defaultMonth);
    setDefaultMonthNum(my.monthNum);
    setStartYear(my.year);
  }, [defaultMonth]);

  // Helper to convert buildImportPreview result into EditablePasteRow[]
  const rebuildTablePreview = useCallback(
    (
      wb: RawWorkbookData,
      year: number,
      mNum: number,
      unit: AmountUnitMode,
      mappingOverride?: SheetColumnMapping | null
    ): EditablePasteRow[] => {
      const sheetName = wb.sheets[0]?.sheetName || 'Vùng dán Excel';
      const activeMap = mappingOverride || wb.sheets[0]?.detectedMapping;
      const result = buildImportPreview(wb, {
        startYear: year,
        unitMode: unit,
        defaultMonthNum: mNum,
        defaultDay: 1,
        sheetMappings: activeMap ? { [sheetName]: activeMap } : undefined,
      });

      return result.items
        .filter((it) => it.amount !== 0 && it.description.trim().length > 0)
        .map((it, idx) => {
          const validDay = it.day !== null && it.day >= 1 && it.day <= 31 ? it.day : 1;
          const validMonth =
            it.monthNum !== null && it.monthNum >= 1 && it.monthNum <= 12
              ? it.monthNum
              : mNum;
          return {
            tempId: `paste_tbl_${Date.now()}_${idx}`,
            date: formatDayMonthYear(validDay, validMonth, it.year),
            amount: it.amount,
            description: it.description,
            warnings: it.warnings,
          };
        });
    },
    []
  );

  // Process pasted Image (via Gemini Vision)
  const processPastedImage = useCallback(
    async (
      imageFileOrBlob: Blob | File,
      overrideUnitMode?: AmountUnitMode,
      overrideMonthNum?: number,
      overrideYear?: number
    ) => {
      setIsAnalyzing(true);
      setErrorMessage(null);
      setDetectedSourceType('image');
      setRawWorkbook(null);
      setColumnMapping(null);

      try {
        const compressedDataUrl = await compressImage(imageFileOrBlob, 1400, 0.8);
        setPastedImageUrl(compressedDataUrl);

        const activeUnit = overrideUnitMode ?? unitMode;
        const activeMonth = overrideMonthNum ?? defaultMonthNum;
        const activeYear = overrideYear ?? startYear;

        const aiRes = await parseExcelImageWithAI(compressedDataUrl, {
          mimeType: 'image/jpeg',
          defaultMonthNum: activeMonth,
          defaultYear: activeYear,
          unitMode: activeUnit,
        });

        if (aiRes.success && aiRes.data.length > 0) {
          setPreviewRows(
            aiRes.data.map((item, idx) => ({
              tempId: `paste_img_${Date.now()}_${idx}`,
              date: item.ngay,
              amount: item.so_tien,
              description: item.dien_giai,
            }))
          );
          setErrorMessage(null);
        } else {
          setPreviewRows([]);
          setErrorMessage(aiRes.error || UNRECOGNIZED_CONTENT_MSG);
        }
      } catch {
        setPreviewRows([]);
        setErrorMessage(UNRECOGNIZED_CONTENT_MSG);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [unitMode, defaultMonthNum, startYear]
  );

  // Process pasted Text / HTML Table
  const processPastedTableText = useCallback(
    (
      plainText: string,
      htmlText = '',
      overrideUnitMode?: AmountUnitMode,
      overrideMonthNum?: number,
      overrideYear?: number
    ) => {
      setErrorMessage(null);
      setPastedImageUrl(null);
      setRawTextValue(plainText);
      setRawHtmlValue(htmlText);

      const wb = parseClipboardToRawWorkbook(plainText, htmlText);
      if (!wb || wb.sheets.length === 0) {
        setDetectedSourceType('none');
        setRawWorkbook(null);
        setPreviewRows([]);
        setErrorMessage(UNRECOGNIZED_CONTENT_MSG);
        return;
      }

      const detectedMap = wb.sheets[0].detectedMapping;
      const activeUnit = overrideUnitMode ?? unitMode;
      const activeMonth = overrideMonthNum ?? defaultMonthNum;
      const activeYear = overrideYear ?? startYear;

      const rows = rebuildTablePreview(wb, activeYear, activeMonth, activeUnit, detectedMap);
      if (rows.length === 0) {
        setDetectedSourceType('none');
        setRawWorkbook(wb);
        setColumnMapping(detectedMap);
        setPreviewRows([]);
        setErrorMessage(UNRECOGNIZED_CONTENT_MSG);
        return;
      }

      setDetectedSourceType('table');
      setRawWorkbook(wb);
      setColumnMapping(detectedMap);
      setPreviewRows(rows);
    },
    [unitMode, defaultMonthNum, startYear, rebuildTablePreview]
  );

  // Handle initialPayload if modal was opened from a paste event on the main screen
  useEffect(() => {
    if (!isOpen || !initialPayload) return;
    if (initialPayload.imageBlob) {
      processPastedImage(initialPayload.imageBlob);
    } else if (initialPayload.plainText || initialPayload.htmlText) {
      processPastedTableText(
        initialPayload.plainText || '',
        initialPayload.htmlText || ''
      );
    }
    if (onClearInitialPayload) {
      onClearInitialPayload();
    }
  }, [
    isOpen,
    initialPayload,
    processPastedImage,
    processPastedTableText,
    onClearInitialPayload,
  ]);

  // Unified handler for ClipboardEvent (Ctrl+V or mobile native Paste)
  const handleClipboardDataTransfer = useCallback(
    (clipboardData: DataTransfer | null, e?: ClipboardEvent | React.ClipboardEvent) => {
      if (!clipboardData) return;

      // 1. Check if clipboard contains an IMAGE (e.g., copied Excel cells pasted as image on phone or desktop)
      const items = clipboardData.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              if (e) e.preventDefault();
              processPastedImage(blob);
              return;
            }
          }
        }
      }

      if (clipboardData.files && clipboardData.files.length > 0) {
        const firstFile = clipboardData.files[0];
        if (firstFile.type.startsWith('image/')) {
          if (e) e.preventDefault();
          processPastedImage(firstFile);
          return;
        }
      }

      // 2. Otherwise check for HTML table or Plain text (Tab-separated from Excel)
      const htmlText = clipboardData.getData('text/html') || '';
      const plainText = clipboardData.getData('text/plain') || '';

      if (plainText.trim() || htmlText.trim()) {
        if (e) e.preventDefault();
        processPastedTableText(plainText, htmlText);
      } else {
        if (e) e.preventDefault();
        setErrorMessage(UNRECOGNIZED_CONTENT_MSG);
      }
    },
    [processPastedImage, processPastedTableText]
  );

  // Global window paste listener while modal is open (unless user is editing an input inside the preview table)
  useEffect(() => {
    if (!isOpen) return;
    const onWindowPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT') &&
        !target.dataset.pasteZone
      ) {
        return;
      }
      handleClipboardDataTransfer(e.clipboardData, e);
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [isOpen, handleClipboardDataTransfer]);

  // Button "Dán từ bộ nhớ tạm" for mobile / 1-click paste
  const handleReadFromClipboardButton = async () => {
    setErrorMessage(null);

    try {
      // 1. Try modern Clipboard API .read() to support both Images and HTML/Text
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const clipItem of clipboardItems) {
            // Check image types first
            const imgType = clipItem.types.find((t) => t.startsWith('image/'));
            if (imgType) {
              const blob = await clipItem.getType(imgType);
              await processPastedImage(blob);
              return;
            }

            // Check HTML + Plain text
            let htmlText = '';
            let plainText = '';
            if (clipItem.types.includes('text/html')) {
              const htmlBlob = await clipItem.getType('text/html');
              htmlText = await htmlBlob.text();
            }
            if (clipItem.types.includes('text/plain')) {
              const textBlob = await clipItem.getType('text/plain');
              plainText = await textBlob.text();
            }
            if (plainText.trim() || htmlText.trim()) {
              processPastedTableText(plainText, htmlText);
              return;
            }
          }
        } catch {
          // Fall back to readText() if read() is blocked or unsupported
        }
      }

      // 2. Fallback to navigator.clipboard.readText()
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          processPastedTableText(text, '');
          return;
        } else {
          setErrorMessage(UNRECOGNIZED_CONTENT_MSG);
          return;
        }
      }

      // 3. If browser blocks programmatic clipboard access, focus the paste zone for native paste
      pasteZoneRef.current?.focus();
      setErrorMessage(
        'Trình duyệt yêu cầu quyền dán trực tiếp: hãy nhấn giữ vào ô bên dưới và chọn "Dán" (hoặc bấm Ctrl+V).'
      );
    } catch {
      pasteZoneRef.current?.focus();
      setErrorMessage(
        'Hãy nhấn giữ vào ô dán bên dưới và chọn "Dán" (hoặc bấm Ctrl+V trên bàn phím).'
      );
    }
  };

  // Update unitMode / defaultMonthNum / startYear / columnMapping dynamically
  const handleChangeUnitMode = (newMode: AmountUnitMode) => {
    setUnitMode(newMode);
    if (detectedSourceType === 'table' && rawWorkbook) {
      const nextRows = rebuildTablePreview(
        rawWorkbook,
        startYear,
        defaultMonthNum,
        newMode,
        columnMapping
      );
      setPreviewRows(nextRows);
    } else if (detectedSourceType === 'image' && pastedImageUrl) {
      // Scale existing preview amounts if switching between thousand and vnd
      setPreviewRows((prev) =>
        prev.map((r) => {
          if (newMode === 'thousand' && Math.abs(r.amount) > 0 && Math.abs(r.amount) < 10000) {
            return { ...r, amount: r.amount * 1000 };
          }
          if (newMode === 'vnd' && Math.abs(r.amount) >= 1000 && r.amount % 1000 === 0) {
            return { ...r, amount: Math.round(r.amount / 1000) };
          }
          return r;
        })
      );
    }
  };

  const handleChangeDefaultMonth = (newMonth: number) => {
    setDefaultMonthNum(newMonth);
    if (detectedSourceType === 'table' && rawWorkbook) {
      const nextRows = rebuildTablePreview(
        rawWorkbook,
        startYear,
        newMonth,
        unitMode,
        columnMapping
      );
      setPreviewRows(nextRows);
    }
  };

  const handleChangeStartYear = (newYear: number) => {
    const validY = isNaN(newYear) ? new Date().getFullYear() : newYear;
    setStartYear(validY);
    if (detectedSourceType === 'table' && rawWorkbook && validY >= 2000 && validY <= 2100) {
      const nextRows = rebuildTablePreview(
        rawWorkbook,
        validY,
        defaultMonthNum,
        unitMode,
        columnMapping
      );
      setPreviewRows(nextRows);
    }
  };

  const handleChangeColumnMapping = (
    field: keyof SheetColumnMapping,
    newColIdx: number
  ) => {
    if (!rawWorkbook) return;
    const baseMap = columnMapping || rawWorkbook.sheets[0].detectedMapping;
    const nextMap: SheetColumnMapping = {
      ...baseMap,
      [field]: newColIdx,
    };
    setColumnMapping(nextMap);
    const nextRows = rebuildTablePreview(
      rawWorkbook,
      startYear,
      defaultMonthNum,
      unitMode,
      nextMap
    );
    setPreviewRows(nextRows);
    if (nextRows.length === 0) {
      setErrorMessage(UNRECOGNIZED_CONTENT_MSG);
    } else {
      setErrorMessage(null);
    }
  };

  // Requirement 5: Duplicate detection against existingExpenses & within pasted batch
  const existingKeysSet = useMemo(() => {
    const set = new Set<string>();
    existingExpenses.forEach((e) => {
      set.add(buildDuplicateKey(e.date, e.amount, e.description));
    });
    return set;
  }, [existingExpenses]);

  const rowsWithDuplicateFlag = useMemo(() => {
    const seenInBatch = new Set<string>();
    return previewRows.map((row) => {
      const key = buildDuplicateKey(row.date, row.amount, row.description);
      const isDupWithExisting = existingKeysSet.has(key);
      const isDupInBatch = seenInBatch.has(key);
      seenInBatch.add(key);
      return {
        ...row,
        isDuplicate: isDupWithExisting || isDupInBatch,
        duplicateReason: isDupWithExisting
          ? 'Trùng khoản đã có trong danh sách'
          : isDupInBatch
          ? 'Trùng dòng bên trên'
          : '',
      };
    });
  }, [previewRows, existingKeysSet]);

  const duplicateCount = useMemo(
    () => rowsWithDuplicateFlag.filter((r) => r.isDuplicate).length,
    [rowsWithDuplicateFlag]
  );

  if (!isOpen) return null;

  const sampleExcelClipboard = `t3\t\t\n15\t116\tĂn trưa cơm văn phòng\n\t45\tCà phê tiếp khách\n17\t250\tTaxi đi sân bay\n\t-158\tHoàn tiền đặt cọc khách sạn`;

  const handleUpdateRow = (
    tempId: string,
    field: 'date' | 'amount' | 'description',
    value: string | number
  ) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r))
    );
  };

  const handleRemoveRow = (tempId: string) => {
    setPreviewRows((prev) => prev.filter((r) => r.tempId !== tempId));
  };

  const handleAddBlankRow = () => {
    const dd = String(new Date().getDate()).padStart(2, '0');
    const mm = String(defaultMonthNum).padStart(2, '0');
    setPreviewRows((prev) => [
      ...prev,
      {
        tempId: `paste_manual_${Date.now()}_${prev.length}`,
        date: `${dd}/${mm}/${startYear}`,
        amount: 0,
        description: '',
      },
    ]);
  };

  const handleResetPaste = () => {
    setDetectedSourceType('none');
    setPastedImageUrl(null);
    setRawTextValue('');
    setRawHtmlValue('');
    setRawWorkbook(null);
    setColumnMapping(null);
    setPreviewRows([]);
    setErrorMessage(null);
  };

  const inferMonthLabelFromDate = (dateStr: string): string => {
    const m = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
    if (m) {
      const monthNum = parseInt(m[2], 10);
      const yearNum = m[3] ? parseInt(m[3], 10) : startYear;
      if (monthNum >= 1 && monthNum <= 12) {
        return `Tháng ${monthNum}/${yearNum}`;
      }
    }
    return `Tháng ${defaultMonthNum}/${startYear}`;
  };

  const handleConfirmSave = () => {
    const targetRows =
      duplicateAction === 'skip'
        ? rowsWithDuplicateFlag.filter((r) => !r.isDuplicate)
        : rowsWithDuplicateFlag;

    const validRows = targetRows.filter(
      (r) => r.amount !== 0 && !Number.isNaN(r.amount) && r.description.trim().length > 0
    );

    if (validRows.length === 0) {
      setErrorMessage('Không có khoản chi hợp lệ nào để thêm vào danh sách.');
      return;
    }

    const now = Date.now();
    const newExpenses: ExpenseItem[] = validRows.map((row, idx) => ({
      id: `exp_paste_${now}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
      date: row.date.trim(),
      month: inferMonthLabelFromDate(row.date.trim()),
      amount: Number(row.amount) || 0,
      description: row.description.trim(),
      images: [],
      profileId: activeProfileId === 'all' ? 'default' : activeProfileId,
      notes:
        detectedSourceType === 'image'
          ? 'Dán từ ảnh bảng Excel (Gemini AI)'
          : 'Dán trực tiếp từ bảng Excel',
      createdAt: now + idx,
      updatedAt: now + idx,
    }));

    onConfirmAddBulk(newExpenses);
    handleResetPaste();
    onClose();
  };

  const totalPreviewAmount = rowsWithDuplicateFlag
    .filter((r) => (duplicateAction === 'skip' ? !r.isDuplicate : true))
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const activeSheetColumns = rawWorkbook?.sheets[0]?.availableColumns || [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paste-excel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2.5 sm:p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden my-4 border border-slate-100 flex flex-col max-h-[93vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <ClipboardPaste size={18} />
            </div>
            <div>
              <h3
                id="paste-excel-modal-title"
                className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2"
              >
                <span>Dán Từ Excel (Bảng Văn Bản hoặc Ảnh Chụp Ô Excel)</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold border border-emerald-200">
                  Nhanh &amp; Chuẩn
                </span>
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500">
                Copy một vài dòng trong Excel rồi bấm <strong>Ctrl+V</strong> hoặc nút{' '}
                <strong>Dán</strong> (tự nhận diện cả Bảng chữ và Hình ảnh)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Quick Settings Bar: Tháng/Năm mặc định & Đơn vị tiền */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/90">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Calendar size={13} className="text-teal-700" />
                <span>Tháng mặc định (nếu thiếu mốc t1..t12):</span>
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  value={defaultMonthNum}
                  onChange={(e) => handleChangeDefaultMonth(parseInt(e.target.value, 10))}
                  className="px-2 py-1 text-xs font-bold text-teal-900 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      Tháng {m}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={startYear}
                  onChange={(e) => handleChangeStartYear(parseInt(e.target.value, 10))}
                  className="w-20 px-2 py-1 text-xs font-bold font-mono text-teal-900 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Coins size={13} className="text-amber-600" />
                <span>Đơn vị tiền:</span>
              </span>
              <div className="inline-flex rounded-lg p-0.5 bg-slate-200/80">
                <button
                  type="button"
                  onClick={() => handleChangeUnitMode('thousand')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                    unitMode === 'thousand'
                      ? 'bg-white text-teal-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Nghìn đồng (×1.000)
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeUnitMode('vnd')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                    unitMode === 'vnd'
                      ? 'bg-white text-teal-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  VNĐ (×1)
                </button>
              </div>
            </div>
          </div>

          {/* Requirement 1: Ô Dán Trực Tiếp (Paste Zone + Mobile Clipboard Button) */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-800">
                  Vùng dán trực tiếp từ Excel (Văn bản bảng hoặc Ảnh):
                </label>
                {detectedSourceType === 'table' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md border border-emerald-200">
                    <TableIcon size={12} />
                    Đã nhận diện: Bảng văn bản Excel
                  </span>
                )}
                {detectedSourceType === 'image' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-teal-100 text-teal-900 px-2 py-0.5 rounded-md border border-teal-200">
                    <ImageIcon size={12} />
                    Đã nhận diện: Ảnh chụp bảng Excel (Gemini AI)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleReadFromClipboardButton}
                  disabled={isAnalyzing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
                >
                  <ClipboardPaste size={14} />
                  <span>Dán từ bộ nhớ tạm (Clipboard)</span>
                </button>

                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isAnalyzing}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors cursor-pointer"
                  title="Chọn ảnh chụp bảng Excel từ điện thoại/máy tính"
                >
                  <ImageIcon size={13} />
                  <span>Chọn ảnh bảng</span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      processPastedImage(file);
                    }
                    e.target.value = '';
                  }}
                />

                <button
                  type="button"
                  onClick={() => {
                    processPastedTableText(sampleExcelClipboard, '');
                  }}
                  disabled={isAnalyzing}
                  className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-xl border border-teal-200/70 transition-colors cursor-pointer"
                >
                  Dán mẫu thử
                </button>

                {(previewRows.length > 0 || pastedImageUrl || rawTextValue) && (
                  <button
                    type="button"
                    onClick={handleResetPaste}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold border border-rose-200 transition-colors cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>Xóa / Dán lại</span>
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Paste Box (supports Ctrl+V, long-press Paste on mobile, or typing/editing TSV) */}
            <div className="relative">
              <textarea
                ref={pasteZoneRef}
                data-paste-zone="true"
                rows={4}
                value={rawTextValue}
                onPaste={(e) => handleClipboardDataTransfer(e.clipboardData, e)}
                onChange={(e) => {
                  setRawTextValue(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder={`• Trên máy tính: Bấm Ctrl+V trực tiếp vào đây (hỗ trợ cả dán bảng văn bản Tab và dán hình ảnh từ Excel).\n• Trên điện thoại: Bấm nút "Dán từ bộ nhớ tạm" ở trên, hoặc nhấn giữ vào ô này chọn "Dán".\n• Ví dụ định dạng cột Excel: [Ngày / t1..t12]   [Số tiền]   [Diễn giải]`}
                className="w-full p-3 text-xs sm:text-sm font-mono rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/20 hover:bg-emerald-50/40 focus:bg-white focus:border-emerald-600 focus:outline-hidden transition-all leading-relaxed"
              />
              {rawTextValue.trim() && (
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Mẹo: Dòng ghi <strong>t1..t12</strong> được hiểu là mốc tháng, ô Ngày để trống sẽ tự lấy theo ngày gần nhất phía trên.
                  </span>
                  <button
                    type="button"
                    onClick={() => processPastedTableText(rawTextValue, rawHtmlValue)}
                    className="px-3 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Phân tích lại văn bản trong ô
                  </button>
                </div>
              )}
            </div>

            {/* Loading State when Gemini is reading pasted Excel image */}
            {isAnalyzing && (
              <div className="p-5 rounded-xl bg-teal-50/80 border border-teal-200 flex items-center justify-center gap-3 text-teal-900">
                <div className="w-5 h-5 border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                <div className="text-xs sm:text-sm font-semibold">
                  Đang dùng Gemini AI đọc bảng dữ liệu từ ảnh bạn vừa dán...
                </div>
              </div>
            )}

            {/* Pasted Image Preview Thumbnail (if clipboard was an image) */}
            {pastedImageUrl && !isAnalyzing && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={pastedImageUrl}
                    alt="Ảnh bảng Excel đã dán"
                    className="h-16 w-auto max-w-[160px] object-contain rounded-lg border border-slate-300 bg-white p-0.5"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Sparkles size={13} className="text-teal-700" />
                      <span>Ảnh bảng dữ liệu đã dán từ Clipboard</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Gemini đã đọc ảnh thành các dòng bên dưới. Hãy kiểm tra trước khi xác nhận thêm.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Column Mapping Selector (when pasted from Text/Table with multiple columns) */}
            {detectedSourceType === 'table' &&
              rawWorkbook &&
              columnMapping &&
              activeSheetColumns.length >= 2 && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/90 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Columns size={13} className="text-teal-700" />
                      <span>Ánh xạ cột từ bảng vừa dán (tự động nhận diện):</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                        Cột Ngày &amp; Mốc t1..t12
                      </label>
                      <select
                        value={columnMapping.dateColIdx}
                        onChange={(e) =>
                          handleChangeColumnMapping('dateColIdx', parseInt(e.target.value, 10))
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
                      >
                        {activeSheetColumns.map((col) => (
                          <option key={col.colIdx} value={col.colIdx}>
                            Cột {col.colLetter}{' '}
                            {col.sampleValues.length > 0
                              ? `(${col.sampleValues.slice(0, 2).join(', ')})`
                              : '(Trống)'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                        Cột Số Tiền
                      </label>
                      <select
                        value={columnMapping.amountColIdx}
                        onChange={(e) =>
                          handleChangeColumnMapping(
                            'amountColIdx',
                            parseInt(e.target.value, 10)
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
                      >
                        {activeSheetColumns.map((col) => (
                          <option key={col.colIdx} value={col.colIdx}>
                            Cột {col.colLetter}{' '}
                            {col.sampleValues.length > 0
                              ? `(${col.sampleValues.slice(0, 2).join(', ')})`
                              : '(Trống)'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                        Cột Diễn Giải
                      </label>
                      <select
                        value={columnMapping.descColIdx}
                        onChange={(e) =>
                          handleChangeColumnMapping('descColIdx', parseInt(e.target.value, 10))
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
                      >
                        {activeSheetColumns.map((col) => (
                          <option key={col.colIdx} value={col.colIdx}>
                            Cột {col.colLetter}{' '}
                            {col.sampleValues.length > 0
                              ? `(${col.sampleValues.slice(0, 2).join(', ')})`
                              : '(Trống)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
          </div>

          {/* Requirement 4: Clear Error Banner when content cannot be recognized */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle size={17} className="text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold text-xs sm:text-sm block">{errorMessage}</span>
                <span className="text-[11px] text-rose-700 mt-0.5 block">
                  Hãy copy vùng ô trong bảng Excel (chứa cột Số tiền và Diễn giải) hoặc copy ảnh chụp bảng rồi bấm Dán lại.
                </span>
              </div>
            </div>
          )}

          {/* Requirement 3 & 5: Preview Table & Duplicate Warnings */}
          {rowsWithDuplicateFlag.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={15} className="text-emerald-700" />
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Bảng xem trước &amp; chỉnh sửa ({rowsWithDuplicateFlag.length} khoản chi)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleAddBlankRow}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-900 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200/70 cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Thêm 1 dòng</span>
                </button>
              </div>

              {/* Requirement 5: Duplicate Warning Banner */}
              {duplicateCount > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-bold">
                        Cảnh báo nhập trùng: Phát hiện {duplicateCount} khoản chi trùng Ngày, Số tiền và Diễn giải với dữ liệu đã có!
                      </span>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Vui lòng kiểm tra các dòng đánh dấu màu vàng bên dưới hoặc chọn cách xử lý trước khi xác nhận thêm:
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <button
                      type="button"
                      onClick={() => setDuplicateAction('keep')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        duplicateAction === 'keep'
                          ? 'bg-amber-700 text-white border-amber-800'
                          : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100/50'
                      }`}
                    >
                      Vẫn thêm tất cả ({rowsWithDuplicateFlag.length} khoản)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDuplicateAction('skip')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        duplicateAction === 'skip'
                          ? 'bg-teal-700 text-white border-teal-800'
                          : 'bg-white text-teal-900 border-teal-300 hover:bg-teal-50'
                      }`}
                    >
                      Bỏ qua khoản trùng (Chỉ thêm {rowsWithDuplicateFlag.length - duplicateCount} khoản mới)
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[340px] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-100 text-slate-600 font-semibold uppercase text-[11px] border-b border-slate-200">
                      <th className="py-2.5 px-2.5 w-10 text-center">#</th>
                      <th className="py-2.5 px-2.5 w-36">Ngày (DD/MM/YYYY)</th>
                      <th className="py-2.5 px-2.5 w-40">Số tiền (VNĐ)</th>
                      <th className="py-2.5 px-2.5">Diễn giải</th>
                      <th className="py-2.5 px-2.5 w-12 text-center">Bỏ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rowsWithDuplicateFlag.map((row, idx) => (
                      <tr
                        key={row.tempId}
                        className={`${
                          row.isDuplicate
                            ? duplicateAction === 'skip'
                              ? 'bg-amber-50/40 opacity-50'
                              : 'bg-amber-50/70'
                            : 'bg-white hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-2 px-2.5 text-center font-mono text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={row.date}
                              onChange={(e) =>
                                handleUpdateRow(row.tempId, 'date', e.target.value)
                              }
                              className={`w-full px-2 py-1 rounded-lg border font-mono text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600 ${
                                row.warnings && row.warnings.length > 0
                                  ? 'border-amber-500 text-amber-950'
                                  : 'border-slate-200'
                              }`}
                            />
                            {row.warnings && row.warnings.length > 0 && (
                              <span
                                title={row.warnings.join(' • ')}
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 shrink-0 cursor-help"
                              >
                                <AlertTriangle size={12} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            type="number"
                            value={row.amount}
                            onChange={(e) =>
                              handleUpdateRow(
                                row.tempId,
                                'amount',
                                Number(e.target.value) || 0
                              )
                            }
                            className={`w-full px-2 py-1 rounded-lg border border-slate-200 font-mono font-bold text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600 ${
                              row.amount < 0 ? 'text-rose-600' : 'text-teal-900'
                            }`}
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={row.description}
                              onChange={(e) =>
                                handleUpdateRow(
                                  row.tempId,
                                  'description',
                                  e.target.value
                                )
                              }
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                            />
                            <div className="flex flex-wrap items-center gap-1">
                              {row.isDuplicate && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                                  <AlertTriangle size={10} />
                                  {row.duplicateReason}
                                </span>
                              )}
                              {row.warnings &&
                                row.warnings.map((w, wIdx) => (
                                  <span
                                    key={wIdx}
                                    className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200"
                                  >
                                    {w}
                                  </span>
                                ))}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.tempId)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Bỏ dòng này"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {rowsWithDuplicateFlag.length > 0 && (
              <span>
                Tổng cộng xem trước:{' '}
                <strong className="font-mono text-teal-800 text-sm">
                  {formatVND(totalPreviewAmount)}
                </strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            >
              Đóng
            </button>
            {rowsWithDuplicateFlag.length > 0 && (
              <button
                type="button"
                onClick={handleConfirmSave}
                className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Check size={15} />
                <span>
                  Xác nhận thêm tất cả (
                  {duplicateAction === 'skip'
                    ? rowsWithDuplicateFlag.length - duplicateCount
                    : rowsWithDuplicateFlag.length}{' '}
                  khoản)
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
