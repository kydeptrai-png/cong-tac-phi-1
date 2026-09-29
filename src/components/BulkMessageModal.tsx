import React, { useState, useMemo } from 'react';
import {
  X,
  Sparkles,
  MessageSquareText,
  Trash2,
  Check,
  AlertTriangle,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { ExpenseItem } from '../types';
import { parseBulkExpenses } from '../utils/gemini';
import { formatVND } from '../utils/categories';
import { buildDuplicateKey } from '../utils/db';

interface BulkMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingExpenses: ExpenseItem[];
  defaultMonth: string;
  activeProfileId: string;
  onConfirmAddBulk: (items: ExpenseItem[]) => void;
}

interface BulkPreviewRow {
  tempId: string;
  date: string;
  amount: number;
  description: string;
}

export const BulkMessageModal: React.FC<BulkMessageModalProps> = ({
  isOpen,
  onClose,
  existingExpenses,
  defaultMonth,
  activeProfileId,
  onConfirmAddBulk,
}) => {
  const [rawText, setRawText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<BulkPreviewRow[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'keep'>('keep');

  // Compute duplicate status for each preview row
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

  const sampleZaloMessage = `Ngày 17/03/2026:
- Ăn sáng phở bò 45k
- Taxi đi gặp khách hàng 125k
- Cà phê tiếp khách 85 nghìn
Ngày 18/03/2026:
- Ăn trưa cơm văn phòng 50k
- Mua văn phòng phẩm 180k
- Khách sạn hoàn tiền đặt cọc -150k`;

  const handleAnalyzeText = async (textOverride?: string) => {
    const textToUse = (textOverride ?? rawText).trim();
    if (!textToUse) {
      setErrorMessage('Vui lòng dán nội dung tin nhắn chứa các khoản chi tiêu.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      const result = await parseBulkExpenses(textToUse);
      if (result.success && result.data.length > 0) {
        setUsedFallback(Boolean(result.usedFallback));
        setPreviewRows(
          result.data.map((item, idx) => ({
            tempId: `bulk_${Date.now()}_${idx}`,
            date: item.ngay,
            amount: item.so_tien,
            description: item.dien_giai,
          }))
        );
      } else {
        setErrorMessage(
          result.error ||
            'Không tách được khoản chi nào. Hãy đảm bảo mỗi khoản có ghi số tiền (VD: 50k, 120 nghìn, 1tr2).'
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Lỗi khi phân tích đoạn tin nhắn.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateRow = (
    tempId: string,
    field: 'date' | 'amount' | 'description',
    value: string | number
  ) => {
    setPreviewRows((prev) =>
      prev.map((row) => (row.tempId === tempId ? { ...row, [field]: value } : row))
    );
  };

  const handleRemoveRow = (tempId: string) => {
    setPreviewRows((prev) => prev.filter((r) => r.tempId !== tempId));
  };

  const handleAddBlankRow = () => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    setPreviewRows((prev) => [
      ...prev,
      {
        tempId: `bulk_${Date.now()}_${prev.length}`,
        date: `${dd}/${mm}/${yyyy}`,
        amount: 0,
        description: '',
      },
    ]);
  };

  const inferMonthLabel = (dateStr: string): string => {
    const m = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
    if (m) {
      const monthNum = parseInt(m[2], 10);
      const yearNum = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
      if (monthNum >= 1 && monthNum <= 12) {
        return `Tháng ${monthNum}/${yearNum}`;
      }
    }
    return defaultMonth || 'Tháng 4';
  };

  const handleConfirmImport = (modeOverride?: 'skip' | 'keep') => {
    const chosenMode = modeOverride ?? duplicateAction;
    const targetRows =
      chosenMode === 'skip'
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
    const newExpenses: ExpenseItem[] = validRows.map((row, idx) => {
      let amt = Number(row.amount) || 0;
      if (Math.abs(amt) > 0 && Math.abs(amt) < 1000) {
        amt = Math.round(amt * 1000);
      }
      return {
        id: `exp_bulk_${now}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
        date: row.date.trim(),
        month: inferMonthLabel(row.date.trim()),
        amount: amt,
        description: row.description.trim(),
        images: [],
        profileId: activeProfileId === 'all' ? 'default' : activeProfileId,
        notes: 'Tách từ tin nhắn nhiều khoản',
        createdAt: now + idx,
        updatedAt: now + idx,
      };
    });

    onConfirmAddBulk(newExpenses);
    setRawText('');
    setPreviewRows([]);
    setErrorMessage(null);
    onClose();
  };

  const totalPreviewAmount = rowsWithDuplicateFlag
    .filter((r) => (duplicateAction === 'skip' ? !r.isDuplicate : true))
    .reduce((sum, r) => {
      let amt = Number(r.amount) || 0;
      if (Math.abs(amt) > 0 && Math.abs(amt) < 1000) amt *= 1000;
      return sum + amt;
    }, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-message-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden my-4 border border-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shadow-xs">
              <MessageSquareText size={18} />
            </div>
            <div>
              <h3 id="bulk-message-modal-title" className="text-base font-bold text-slate-800 flex items-center gap-2">
                <span>Dán Đoạn Tin Nhắn Tách Nhiều Khoản Chi</span>
                <span className="text-[10px] bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-semibold border border-teal-200">
                  Gemini AI
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Copy tin nhắn từ Zalo, Ghi chú... để AI tự động tách thành bảng các khoản chi tiêu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Textarea Input */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700">
                Nội dung tin nhắn / ghi chú nhiều khoản chi:
              </label>
              <button
                type="button"
                onClick={() => {
                  setRawText(sampleZaloMessage);
                  handleAnalyzeText(sampleZaloMessage);
                }}
                className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-lg border border-teal-200/70 transition-colors cursor-pointer"
              >
                Dán tin nhắn mẫu (Zalo) để thử
              </button>
            </div>

            <textarea
              rows={5}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder={`Ví dụ dán từ Zalo:\nNgày 17/3:\n- Ăn sáng 45k\n- Taxi sân bay 250k\nNgày 18/3:\n- Tiếp khách ăn trưa 1tr2\n- Hoàn tiền cọc khách sạn -200k`}
              className="w-full p-3 text-xs sm:text-sm rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 leading-relaxed"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                Hỗ trợ tự suy ra ngày cho các dòng bên dưới, đổi "k/nghìn/tr/triệu" và giữ nguyên số âm.
              </span>
              <button
                type="button"
                onClick={() => handleAnalyzeText()}
                disabled={isAnalyzing || !rawText.trim()}
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 shadow-xs transition-all ${
                  isAnalyzing || !rawText.trim()
                    ? 'bg-slate-300 cursor-not-allowed'
                    : 'bg-teal-700 hover:bg-teal-800 cursor-pointer'
                }`}
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Đang dùng Gemini tách khoản chi...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Tách danh sách khoản chi</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Preview Table */}
          {rowsWithDuplicateFlag.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Bảng xem trước ({rowsWithDuplicateFlag.length} khoản tách được)
                  </span>
                  {usedFallback && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-semibold border border-amber-200">
                      Tách bằng bộ phân tích dự phòng
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleAddBlankRow}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-900 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200/70"
                >
                  <Plus size={13} />
                  <span>Thêm 1 dòng</span>
                </button>
              </div>

              {/* Requirement 3: Duplicate Warning Banner if duplicates detected */}
              {duplicateCount > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-bold">
                        Cảnh báo nhập trùng: Phát hiện {duplicateCount} khoản chi có cùng Ngày, Số tiền và Diễn giải với khoản đã có!
                      </span>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Bạn muốn vẫn thêm tất cả hay bỏ qua các khoản bị trùng?
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-6">
                    <button
                      type="button"
                      onClick={() => setDuplicateAction('keep')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
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
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
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

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-semibold uppercase text-[11px] border-b border-slate-200">
                      <th className="py-2 px-2.5 w-10 text-center">#</th>
                      <th className="py-2 px-2.5 w-32">Ngày (DD/MM/YYYY)</th>
                      <th className="py-2 px-2.5 w-36">Số tiền (VNĐ)</th>
                      <th className="py-2 px-2.5">Diễn giải</th>
                      <th className="py-2 px-2.5 w-12 text-center">Bỏ</th>
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
                          <input
                            type="text"
                            value={row.date}
                            onChange={(e) =>
                              handleUpdateRow(row.tempId, 'date', e.target.value)
                            }
                            className="w-full px-2 py-1 rounded-lg border border-slate-200 font-mono text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                          />
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
                            className="w-full px-2 py-1 rounded-lg border border-slate-200 font-mono font-bold text-teal-900 text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={row.description}
                              onChange={(e) =>
                                handleUpdateRow(row.tempId, 'description', e.target.value)
                              }
                              className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                            />
                            {row.isDuplicate && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                                <AlertTriangle size={10} />
                                {row.duplicateReason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.tempId)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
                Tổng tiền sẽ thêm:{' '}
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
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors"
            >
              Đóng
            </button>
            {rowsWithDuplicateFlag.length > 0 && (
              <button
                type="button"
                onClick={() => handleConfirmImport()}
                className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Check size={15} />
                <span>
                  Xác nhận thêm vào danh sách (
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
