import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Check,
  X,
  Edit2,
  AlertCircle,
  AlertTriangle,
  MessageSquareText,
} from 'lucide-react';
import { NaturalExpenseParsed, ExpenseItem } from '../types';
import { formatVND } from '../utils/categories';
import { parseNaturalExpense } from '../utils/gemini';
import { findDuplicateExpenses } from '../utils/db';

interface NaturalExpenseInputProps {
  onAddExpense: (item: ExpenseItem) => void;
  defaultMonth?: string;
  existingExpenses?: ExpenseItem[];
  activeProfileId?: string;
  onOpenBulkMessageModal?: () => void;
}

export const NaturalExpenseInput: React.FC<NaturalExpenseInputProps> = ({
  onAddExpense,
  defaultMonth,
  existingExpenses = [],
  activeProfileId = 'default',
  onOpenBulkMessageModal,
}) => {
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<NaturalExpenseParsed | null>(null);
  const [isEditingPreview, setIsEditingPreview] = useState(false);

  // Duplicate warning state (Requirement 3)
  const [pendingDuplicateItem, setPendingDuplicateItem] = useState<ExpenseItem | null>(null);

  // Editable fields inside preview
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editDescription, setEditDescription] = useState('');

  const examples = [
    'mua phở hết 150k',
    'đi chợ mua rau 35 nghìn hôm qua',
    'thuốc ho 1tr2',
    'xăng xe 70k sáng nay',
  ];

  const handleAnalyze = async (textToAnalyze?: string) => {
    const raw = (textToAnalyze ?? inputText).trim();
    if (!raw) {
      setErrorMessage('Vui lòng gõ một câu mô tả khoản chi');
      return;
    }

    // If user pasted multiple lines, suggest or auto-open bulk modal if desired
    setIsAnalyzing(true);
    setErrorMessage(null);
    setPreview(null);
    setPendingDuplicateItem(null);
    setIsEditingPreview(false);

    try {
      const result = await parseNaturalExpense(raw);
      if (result.success && result.data) {
        const data = result.data;

        if (!data.so_tien || data.so_tien === 0) {
          setErrorMessage(
            'Không tách được số tiền từ câu đã nhập. Vui lòng ghi rõ số tiền (ví dụ: 150k, 35 nghìn, 1tr2).'
          );
          return;
        }

        if (!data.dien_giai || !data.dien_giai.trim()) {
          setErrorMessage('Không nhận diện được nội dung/mô tả khoản chi.');
          return;
        }

        setPreview(data);
        setEditDate(data.ngay);
        setEditAmount(data.so_tien);
        setEditDescription(data.dien_giai);
      } else {
        setErrorMessage(result.error || 'Không thể phân tích câu mô tả.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Có lỗi xảy ra khi phân tích.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAnalyze();
    }
  };

  const getMonthFromDate = (dateStr: string): string => {
    const parts = dateStr.split('/');
    if (parts.length >= 2) {
      const m = parseInt(parts[1], 10);
      const y = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
      if (!isNaN(m) && m >= 1 && m <= 12) {
        return `Tháng ${m}/${y}`;
      }
    }
    return defaultMonth || 'Tháng 4';
  };

  const handleConfirmSave = (forceAddDuplicate = false) => {
    if (!preview) return;

    const finalAmount = Number(editAmount) || preview.so_tien;
    const finalDesc = editDescription.trim() || preview.dien_giai;
    const finalDate = editDate.trim() || preview.ngay;

    if (finalAmount === 0 || Number.isNaN(finalAmount)) {
      setErrorMessage('Số tiền không hợp lệ');
      return;
    }

    if (!finalDesc) {
      setErrorMessage('Vui lòng nhập diễn giải khoản chi');
      return;
    }

    const newItem: ExpenseItem = {
      id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      amount: finalAmount,
      description: finalDesc,
      date: finalDate,
      month: getMonthFromDate(finalDate),
      images: [],
      profileId: activeProfileId === 'all' ? 'default' : activeProfileId,
      notes: `Nhập tự nhiên: "${preview.rawInput || inputText.trim()}"`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Requirement 3: Duplicate Warning Check
    if (!forceAddDuplicate) {
      const dups = findDuplicateExpenses(
        {
          date: newItem.date,
          amount: newItem.amount,
          description: newItem.description,
        },
        existingExpenses
      );
      if (dups.length > 0) {
        setPendingDuplicateItem(newItem);
        return;
      }
    }

    onAddExpense(newItem);

    // Reset form
    setInputText('');
    setPreview(null);
    setPendingDuplicateItem(null);
    setIsEditingPreview(false);
    setErrorMessage(null);
  };

  const handleCancelPreview = () => {
    setPreview(null);
    setPendingDuplicateItem(null);
    setIsEditingPreview(false);
  };

  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-xs mb-5 transition-all">
      {/* Top Banner / Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-teal-700 text-white flex items-center justify-center shadow-xs">
            <Sparkles size={15} />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span>Nhập nhanh bằng câu văn bản tự nhiên</span>
              <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded-full font-semibold border border-teal-200/70">
                AI Gemini
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Gõ 1 câu tự nhiên hoặc dán đoạn tin nhắn dài (Zalo) để AI tự động tách khoản chi
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Example Badges */}
          <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>Ví dụ:</span>
            {examples.slice(0, 2).map((ex, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setInputText(ex);
                  handleAnalyze(ex);
                }}
                className="text-[11px] text-teal-700 bg-teal-50 hover:bg-teal-100/90 px-2 py-0.5 rounded-md border border-teal-200/60 transition-colors cursor-pointer"
              >
                "{ex}"
              </button>
            ))}
          </div>

          {/* Requirement 6: Button to open Bulk Multi-line Message Parser */}
          {onOpenBulkMessageModal && (
            <button
              type="button"
              onClick={onOpenBulkMessageModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
              title="Dán đoạn tin nhắn dài từ Zalo/Ghi chú để tách nhiều khoản chi cùng lúc"
            >
              <MessageSquareText size={14} className="text-teal-700" />
              <span>Dán tin nhắn tách nhiều khoản</span>
            </button>
          )}
        </div>
      </div>

      {/* Input Box with Action Button */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={isAnalyzing}
            placeholder='VD: "mua phở hết 150k", "đi chợ mua rau 35 nghìn hôm qua", "thuốc ho 1tr2"...'
            className="w-full pl-3.5 pr-20 py-2.5 sm:py-3 text-xs sm:text-sm rounded-xl border border-slate-300 bg-slate-50/50 hover:bg-white focus:bg-white text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600 transition-all shadow-2xs"
          />
          {inputText && !isAnalyzing && (
            <button
              type="button"
              onClick={() => {
                setInputText('');
                setPreview(null);
                setPendingDuplicateItem(null);
                setErrorMessage(null);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md"
              title="Xóa trắng câu"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => handleAnalyze()}
          disabled={isAnalyzing || !inputText.trim()}
          className={`flex items-center gap-1.5 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-semibold text-white shadow-xs transition-all shrink-0 ${
            isAnalyzing || !inputText.trim()
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-teal-700 hover:bg-teal-800 active:scale-98 cursor-pointer'
          }`}
        >
          {isAnalyzing ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span className="hidden sm:inline">Đang phân tích...</span>
            </>
          ) : (
            <>
              <span>Phân tích</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </div>

      {/* Mobile Examples row */}
      <div className="xl:hidden flex flex-wrap items-center gap-1.5 mt-2 text-[11px] text-slate-500">
        <span className="text-[10px] text-slate-400">Gợi ý thử:</span>
        {examples.map((ex, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              setInputText(ex);
              handleAnalyze(ex);
            }}
            className="text-[10px] text-teal-700 bg-teal-50 hover:bg-teal-100/90 px-2 py-0.5 rounded-md border border-teal-200/60 transition-colors"
          >
            "{ex}"
          </button>
        ))}
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 animate-in fade-in">
          <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">{errorMessage}</span>
            <p className="text-[11px] text-rose-700 mt-0.5">
              Câu bạn vừa gõ đã được giữ nguyên ở ô trên để bạn bổ sung hoặc sửa lại dễ dàng.
            </p>
          </div>
        </div>
      )}

      {/* Confirmation & Preview Bar */}
      {preview && (
        <div className="mt-3.5 p-3.5 sm:p-4 rounded-xl bg-gradient-to-r from-teal-50/90 via-emerald-50/70 to-teal-50/90 border border-teal-200 text-slate-900 shadow-2xs animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white text-[11px] font-bold">
                ✓
              </span>
              <span className="text-xs font-bold text-teal-950">
                Xác nhận khoản chi đã nhận diện
              </span>
              {preview.isFallback && (
                <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-md font-medium border border-amber-200">
                  Dự phòng Regex
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsEditingPreview(!isEditingPreview)}
                className="flex items-center gap-1 text-[11px] font-medium text-teal-800 hover:text-teal-950 bg-white/80 hover:bg-white px-2 py-1 rounded-lg border border-teal-200/80 transition-colors shadow-2xs"
              >
                <Edit2 size={12} />
                <span>{isEditingPreview ? 'Đóng sửa' : 'Chỉnh sửa'}</span>
              </button>
              <button
                type="button"
                onClick={handleCancelPreview}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
                title="Hủy bỏ"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Requirement 3: Duplicate Warning inside Natural Input */}
          {pendingDuplicateItem && (
            <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">
                    Cảnh báo nhập trùng: Khoản chi "{pendingDuplicateItem.description}" ({formatVND(pendingDuplicateItem.amount)} - {pendingDuplicateItem.date}) đã có trong danh sách!
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelPreview}
                  className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 cursor-pointer"
                >
                  Bỏ qua
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmSave(true)}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                >
                  Vẫn thêm
                </button>
              </div>
            </div>
          )}

          {/* Normal View Mode */}
          {!isEditingPreview ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white/90 p-3 rounded-xl border border-teal-100 shadow-2xs">
              <div>
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block">
                  Ngày
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-800 font-mono">
                  {editDate}
                </span>
              </div>

              <div>
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block">
                  Số tiền
                </span>
                <span className="text-xs sm:text-sm font-bold font-mono text-teal-800">
                  {formatVND(Number(editAmount) || 0)}
                </span>
              </div>

              <div>
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block">
                  Diễn giải
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-900 line-clamp-1">
                  {editDescription}
                </span>
              </div>
            </div>
          ) : (
            /* Inline Edit Mode */
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white p-3 rounded-xl border border-teal-200 shadow-2xs">
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase block mb-1">
                  Ngày (DD/MM/YYYY)
                </label>
                <input
                  type="text"
                  value={editDate}
                  onChange={(e) => {
                    setEditDate(e.target.value);
                    setPendingDuplicateItem(null);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600 font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase block mb-1">
                  Số tiền (VNĐ)
                </label>
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => {
                    setEditAmount(e.target.value);
                    setPendingDuplicateItem(null);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600 font-mono font-bold text-teal-800"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase block mb-1">
                  Diễn giải
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => {
                    setEditDescription(e.target.value);
                    setPendingDuplicateItem(null);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                />
              </div>
            </div>
          )}

          {/* Action Row: Confirm Save into Main Expenses List */}
          {!pendingDuplicateItem && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelPreview}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-white/70 hover:bg-white rounded-xl border border-slate-200 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => handleConfirmSave(false)}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 active:scale-98 rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <Check size={14} />
                <span>Xác nhận &amp; Lưu vào danh sách</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
