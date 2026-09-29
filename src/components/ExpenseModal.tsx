import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Sparkles,
  Camera,
  Upload,
  Trash2,
  Check,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  History,
  Wand2,
} from 'lucide-react';
import { ExpenseItem, DescriptionSuggestion } from '../types';
import { formatVND } from '../utils/categories';
import { compressImage, scanReceiptWithAI, parseNaturalExpense } from '../utils/gemini';
import { buildDescriptionSuggestions, findDuplicateExpenses } from '../utils/db';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (expense: ExpenseItem) => void;
  editingItem: ExpenseItem | null;
  defaultMonth?: string;
  existingExpenses?: ExpenseItem[];
  activeProfileId?: string;
}

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingItem,
  defaultMonth = 'Tháng 3',
  existingExpenses = [],
  activeProfileId = 'default',
}) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [month, setMonth] = useState(defaultMonth);
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Historical description suggestions state (Requirement 5)
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Duplicate warning confirmation state (Requirement 3)
  const [pendingDuplicateItem, setPendingDuplicateItem] = useState<ExpenseItem | null>(null);
  const [matchedDuplicates, setMatchedDuplicates] = useState<ExpenseItem[]>([]);

  // Natural language sentence input state
  const [naturalText, setNaturalText] = useState('');
  const [isParsingNatural, setIsParsingNatural] = useState(false);
  const [naturalMessage, setNaturalMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (editingItem) {
      setDescription(editingItem.description);
      setAmount(editingItem.amount);
      setMonth(editingItem.month || defaultMonth);
      setDate(editingItem.date);
      setNotes(editingItem.notes || '');
      setImages(editingItem.images || []);
    } else {
      setDescription('');
      setAmount('');
      setMonth(defaultMonth);
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      setDate(`${dd}/${mm}/${yyyy}`);
      setNotes('');
      setImages([]);
    }
    setScanMessage(null);
    setNaturalMessage(null);
    setNaturalText('');
    setPendingDuplicateItem(null);
    setMatchedDuplicates([]);
    setShowSuggestions(false);
  }, [editingItem, defaultMonth, isOpen]);

  // Compute historical description suggestions (Requirement 5)
  const suggestions = useMemo<DescriptionSuggestion[]>(() => {
    return buildDescriptionSuggestions(existingExpenses, description, 6);
  }, [existingExpenses, description]);

  if (!isOpen) return null;

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDescription(e.target.value);
    setShowSuggestions(true);
    if (pendingDuplicateItem) {
      setPendingDuplicateItem(null);
      setMatchedDuplicates([]);
    }
  };

  const handleSelectSuggestion = (sug: DescriptionSuggestion, alsoFillAmount: boolean) => {
    setDescription(sug.description);
    if (alsoFillAmount && sug.lastAmount !== 0) {
      setAmount(sug.lastAmount);
    }
    setShowSuggestions(false);
  };

  // Requirement 7: Run Gemini AI OCR on a base64 receipt image and auto-fill form fields
  const runGeminiReceiptReader = async (base64Img: string) => {
    setIsScanning(true);
    setScanMessage(null);
    try {
      const result = await scanReceiptWithAI(base64Img);
      if (result.success && result.data) {
        const data = result.data;
        if (data.amount && Number(data.amount) !== 0) {
          setAmount(Number(data.amount));
        }
        const combinedDesc = [data.description, data.merchant]
          .filter(Boolean)
          .join(' - ')
          .trim();
        if (combinedDesc) {
          setDescription(combinedDesc);
        } else if (data.description) {
          setDescription(data.description);
        }
        if (data.date) {
          setDate(data.date);
          const parts = data.date.split(/[\/\-]/);
          if (parts.length >= 2) {
            const m = parseInt(parts[1], 10);
            const y = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
            if (!isNaN(m) && m >= 1 && m <= 12) {
              setMonth(`Tháng ${m}/${y}`);
            }
          }
        }

        setScanMessage({
          type: 'success',
          text: `AI đã đọc hóa đơn: ${combinedDesc || data.description || 'Chứng từ'} — ${formatVND(
            Number(data.amount) || 0
          )}${data.date ? ` (${data.date})` : ''}. Bạn có thể kiểm tra và sửa lại bên dưới.`,
        });
      } else {
        setScanMessage({
          type: 'error',
          text: result.error || 'Không trích xuất được thông tin từ ảnh hóa đơn.',
        });
      }
    } catch (err: any) {
      setScanMessage({
        type: 'error',
        text: err?.message || 'Lỗi khi gửi ảnh tới Gemini AI.',
      });
    } finally {
      setIsScanning(false);
    }
  };

  // Requirement 1 & 7: Add multiple photos (from library or camera), auto-compress (max 1280px, JPEG 0.7),
  // and optionally auto-read the first receipt with Gemini if form is still blank
  const handleAddPhotos = async (
    e: React.ChangeEvent<HTMLInputElement>,
    autoReadWithAI = false
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newPhotos: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        // Compress max long edge 1280px, JPEG quality 0.7, preserving aspect ratio
        const compressed = await compressImage(files[i], 1280, 0.7);
        newPhotos.push(compressed);
      } catch (err) {
        console.error('Error compressing image:', err);
      }
    }

    e.target.value = '';

    if (newPhotos.length > 0) {
      setImages((prev) => [...prev, ...newPhotos]);
      // If user clicked "Quét hóa đơn AI" OR if both description and amount are currently empty, read the first image with Gemini
      if (autoReadWithAI || (!description.trim() && (amount === '' || amount === 0))) {
        await runGeminiReceiptReader(newPhotos[0]);
      }
    }
  };

  // Parse natural language sentence
  const handleParseNatural = async () => {
    const query = naturalText.trim();
    if (!query) return;

    setIsParsingNatural(true);
    setNaturalMessage(null);

    try {
      const result = await parseNaturalExpense(query);
      if (result.success && result.data) {
        const item = result.data;
        if (item.so_tien === 0) {
          setNaturalMessage({
            type: 'error',
            text: 'Không tách được số tiền từ câu đã nhập. Vui lòng ghi rõ (vd: 150k, 35 nghìn, 1tr2).',
          });
          return;
        }

        if (!item.dien_giai.trim()) {
          setNaturalMessage({
            type: 'error',
            text: 'Không tách được nội dung khoản chi. Vui lòng mô tả rõ hơn.',
          });
          return;
        }

        setAmount(item.so_tien);
        setDescription(item.dien_giai);
        setDate(item.ngay);

        const parts = item.ngay.split('/');
        if (parts.length >= 2) {
          const m = parseInt(parts[1], 10);
          const y = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
          if (!isNaN(m) && m >= 1 && m <= 12) {
            setMonth(`Tháng ${m}/${y}`);
          }
        }

        setNaturalMessage({
          type: 'success',
          text: `Đã điền tự động: "${item.dien_giai}" - ${formatVND(item.so_tien)} (${item.ngay})`,
        });
      } else {
        setNaturalMessage({
          type: 'error',
          text: result.error || 'Không thể phân tích câu văn bản.',
        });
      }
    } catch (err: any) {
      setNaturalMessage({
        type: 'error',
        text: err?.message || 'Có lỗi xảy ra khi phân tích câu.',
      });
    } finally {
      setIsParsingNatural(false);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const buildCandidateExpense = (): ExpenseItem | null => {
    if (!description.trim()) {
      setScanMessage({
        type: 'error',
        text: 'Vui lòng nhập diễn giải khoản chi!',
      });
      return null;
    }

    let numAmount = Number(amount) || 0;
    if (Math.abs(numAmount) > 0 && Math.abs(numAmount) < 1000) {
      numAmount = Math.round(numAmount * 1000);
    }

    return {
      id: editingItem
        ? editingItem.id
        : `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      description: description.trim(),
      amount: numAmount,
      month: month || defaultMonth || 'Tháng 4',
      date: date.trim() || new Date().toLocaleDateString('vi-VN'),
      notes: notes.trim() ? notes.trim() : undefined,
      images,
      profileId: editingItem?.profileId || (activeProfileId === 'all' ? 'default' : activeProfileId),
      createdAt: editingItem ? editingItem.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const candidate = buildCandidateExpense();
    if (!candidate) return;

    // Requirement 3: Check for duplicates (same date, same amount, same description)
    const dups = findDuplicateExpenses(
      {
        id: editingItem?.id,
        date: candidate.date,
        amount: candidate.amount,
        description: candidate.description,
      },
      existingExpenses
    );

    if (dups.length > 0 && !pendingDuplicateItem) {
      setPendingDuplicateItem(candidate);
      setMatchedDuplicates(dups);
      return;
    }

    onSave(candidate);
    onClose();
  };

  const handleForceSaveDuplicate = () => {
    if (!pendingDuplicateItem) return;
    onSave(pendingDuplicateItem);
    setPendingDuplicateItem(null);
    setMatchedDuplicates([]);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden my-6 border border-slate-100 flex flex-col max-h-[94vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
          <div>
            <h3 id="expense-modal-title" className="text-base font-bold text-slate-800">
              {editingItem ? 'Sửa Khoản Chi' : 'Thêm Khoản Chi Mới'}
            </h3>
            <p className="text-xs text-slate-500">
              {editingItem
                ? 'Cập nhật thông tin chi tiêu & ảnh chứng từ'
                : 'Chụp hóa đơn đọc tự động bằng AI, nhập câu tự nhiên hoặc điền thủ công'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* AI Assisted Helpers Banner (Natural Language & Receipt Scanner) */}
        {!editingItem && (
          <div className="px-5 pt-3 pb-1 space-y-2">
            {/* 1. Natural Language Input Box */}
            <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200/80 text-teal-900 shadow-2xs">
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-xs font-bold flex items-center gap-1.5 text-teal-950">
                  <Sparkles size={14} className="text-teal-700" />
                  <span>Điền nhanh bằng câu văn bản (Gemini)</span>
                </span>
                <span className="text-[10px] bg-teal-600 text-white px-1.5 py-0.2 rounded-full font-semibold">
                  AI
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={naturalText}
                  onChange={(e) => {
                    setNaturalText(e.target.value);
                    if (naturalMessage) setNaturalMessage(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleParseNatural();
                    }
                  }}
                  placeholder='VD: "mua phở hết 150k", "thuốc ho 1tr2", "rau 35k hôm qua"...'
                  disabled={isParsingNatural}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-teal-200 bg-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                />
                <button
                  type="button"
                  onClick={handleParseNatural}
                  disabled={isParsingNatural || !naturalText.trim()}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1 shrink-0 ${
                    isParsingNatural || !naturalText.trim()
                      ? 'bg-slate-300 cursor-not-allowed'
                      : 'bg-teal-700 hover:bg-teal-800 active:scale-98 cursor-pointer'
                  }`}
                >
                  {isParsingNatural ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Tách</span>
                      <ArrowRight size={12} />
                    </>
                  )}
                </button>
              </div>

              {naturalMessage && (
                <div
                  className={`mt-2 p-2 rounded-lg text-[11px] flex items-start gap-1.5 ${
                    naturalMessage.type === 'success'
                      ? 'bg-emerald-100/70 text-emerald-900 border border-emerald-300'
                      : 'bg-rose-100/70 text-rose-900 border border-rose-300'
                  }`}
                >
                  {naturalMessage.type === 'success' ? (
                    <Check size={14} className="text-emerald-700 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={14} className="text-rose-700 shrink-0 mt-0.5" />
                  )}
                  <span>{naturalMessage.text}</span>
                </div>
              )}
            </div>

            {/* 2. Gemini Read Receipt from Camera or Photo (Requirement 7) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="min-h-[44px] flex items-center justify-center gap-2 p-2.5 rounded-xl bg-teal-50/80 border border-teal-200 text-teal-900 cursor-pointer hover:bg-teal-100/80 active:bg-teal-200 transition-all shadow-2xs text-xs font-semibold">
                {isScanning ? (
                  <div className="w-4 h-4 border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera size={16} className="text-teal-700 shrink-0" />
                )}
                <span>Chụp hóa đơn (AI đọc)</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleAddPhotos(e, true)}
                  disabled={isScanning}
                />
              </label>

              <label className="min-h-[44px] flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 cursor-pointer hover:bg-slate-100 active:bg-slate-200 transition-all shadow-2xs text-xs font-semibold">
                {isScanning ? (
                  <div className="w-4 h-4 border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Wand2 size={16} className="text-teal-700 shrink-0" />
                )}
                <span>Chọn ảnh hóa đơn (AI đọc)</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleAddPhotos(e, true)}
                  disabled={isScanning}
                />
              </label>
            </div>
          </div>
        )}

        {/* Scan Message Feedback */}
        {scanMessage && (
          <div className="px-5 pt-2">
            <div
              className={`p-2.5 rounded-xl text-xs flex items-start gap-2 ${
                scanMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {scanMessage.type === 'success' ? (
                <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="font-medium">{scanMessage.text}</span>
            </div>
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {/* Requirement 3: Duplicate Warning Box */}
          {pendingDuplicateItem && matchedDuplicates.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2.5 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-amber-950">
                    Cảnh báo nhập trùng khoản chi!
                  </div>
                  <p className="text-amber-900">
                    Khoản chi <strong>"{pendingDuplicateItem.description}"</strong> ngày{' '}
                    <strong className="font-mono">{pendingDuplicateItem.date}</strong> với số tiền{' '}
                    <strong className="font-mono">{formatVND(pendingDuplicateItem.amount)}</strong>{' '}
                    trùng khớp hoàn toàn với {matchedDuplicates.length} khoản đã có trong danh sách.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 cursor-pointer"
                >
                  Bỏ qua (Không thêm)
                </button>
                <button
                  type="button"
                  onClick={handleForceSaveDuplicate}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-2xs cursor-pointer"
                >
                  Vẫn thêm khoản này
                </button>
              </div>
            </div>
          )}

          {/* Diễn giải + Gợi ý lịch sử (Requirement 5) */}
          <div className="relative">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Diễn giải nội dung chi tiêu <span className="text-rose-500">*</span>
              </label>
              {suggestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSuggestions(!showSuggestions)}
                  className="text-[11px] text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"
                >
                  <History size={12} />
                  <span>Gợi ý từ lịch sử ({suggestions.length})</span>
                </button>
              )}
            </div>
            <input
              type="text"
              required
              value={description}
              onChange={handleDescriptionChange}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                // Delay hiding so click on suggestion registers
                setTimeout(() => setShowSuggestions(false), 180);
              }}
              placeholder="VD: Cơm trưa văn phòng, Mua thuốc hạ sốt, Đổ xăng..."
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-colors"
            />

            {/* Historical Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="mt-1.5 bg-white rounded-xl border border-teal-200 shadow-lg overflow-hidden z-30 divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-teal-50/70 text-[10px] font-bold text-teal-800 uppercase tracking-wider flex items-center justify-between">
                  <span>Gợi ý diễn giải từng nhập (ưu tiên dùng nhiều nhất)</span>
                  <span>Chọn để điền</span>
                </div>
                {suggestions.map((sug, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 hover:bg-teal-50/50 flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(sug, false);
                      }}
                      className="flex-1 text-left font-medium text-slate-800 hover:text-teal-900 truncate cursor-pointer"
                    >
                      <span>{sug.description}</span>
                      <span className="ml-2 text-[10px] text-slate-400 font-normal">
                        ({sug.count} lần)
                      </span>
                    </button>

                    {sug.lastAmount !== 0 && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(sug, true);
                        }}
                        className="px-2 py-0.5 rounded-md bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/80 font-mono text-[11px] font-semibold shrink-0 cursor-pointer"
                        title="Điền cả diễn giải và số tiền gần nhất"
                      >
                        + {formatVND(sug.lastAmount)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Số tiền */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Số tiền (VNĐ) <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    if (amount && Number(amount) !== 0) {
                      setAmount(Number(amount) * 1000);
                    }
                  }}
                  className="px-2 py-0.5 rounded-md bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold border border-teal-200 transition-colors"
                  title="Nhân 1.000 (Ví dụ: 17 thành 17.000)"
                >
                  x1.000 (k)
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="number"
                step="1"
                required
                value={amount}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : Number(e.target.value);
                  setAmount(val);
                  if (pendingDuplicateItem) {
                    setPendingDuplicateItem(null);
                  }
                }}
                placeholder="VD: Nhập 116 (116k), -158 (hoàn -158k) hoặc 150000"
                className="w-full pl-3.5 pr-14 py-2.5 text-base font-semibold text-slate-800 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-colors"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                VNĐ
              </span>
            </div>

            {amount !== '' && Math.abs(Number(amount)) > 0 && Math.abs(Number(amount)) < 1000 && (
              <div className="mt-1.5 p-2 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between gap-2 text-xs">
                <span className="text-amber-800">
                  Bạn nhập <strong>{amount}</strong> (nghìn đồng)? Khi lưu sẽ tự tính là{' '}
                  <strong>{formatVND(Number(amount) * 1000)}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setAmount(Number(amount) * 1000)}
                  className="px-2.5 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs transition-colors shrink-0"
                >
                  Đổi ngay
                </button>
              </div>
            )}

            {amount !== '' && Math.abs(Number(amount)) >= 1000 && (
              <p className="text-xs font-medium text-teal-700 mt-1">
                Quy đổi: <span className="font-bold">{formatVND(Number(amount))}</span>
                {Number(amount) < 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 font-bold text-[10px]">
                    Hoàn/thu lại (trừ vào tổng chi)
                  </span>
                )}
              </p>
            )}

            {/* Quick add shortcuts */}
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 text-[11px] text-slate-600 scrollbar-none">
              <span className="text-slate-400 shrink-0">Chọn nhanh:</span>
              {[20, 30, 50, 100, 150, 200, 500].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAmount(k * 1000)}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-200 border border-slate-200/80 transition-colors shrink-0 font-medium"
                >
                  {k}k
                </button>
              ))}
            </div>
          </div>

          {/* Grid: Tháng & Ngày phát sinh */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Thuộc tháng
              </label>
              <input
                type="text"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="VD: Tháng 3/2026, Tháng 4"
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Ngày phát sinh
              </label>
              <input
                type="text"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (pendingDuplicateItem) setPendingDuplicateItem(null);
                }}
                placeholder="VD: 15/03/2026"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-colors"
              />
            </div>
          </div>

          {/* Ghi chú */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Ghi chú (Comment)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú thêm hoặc từ comment Excel..."
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-colors"
            />
          </div>

          {/* Requirement 1 & 7: Ảnh chứng từ đính kèm (Chụp camera trực tiếp hoặc Chọn nhiều ảnh từ thư viện, tự động nén 1280px JPEG 0.7) */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-xs font-semibold text-slate-700">
                Ảnh chứng từ hóa đơn ({images.length})
                <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                  (Tự nén ≤1280px, JPEG 0.7)
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="min-h-[44px] text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 active:bg-teal-200 px-3 py-2 rounded-xl border border-teal-200 cursor-pointer flex items-center gap-1.5 transition-colors">
                  <Camera size={15} className="text-teal-700" />
                  <span>Chụp camera</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleAddPhotos(e, false)}
                  />
                </label>

                <label className="min-h-[44px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 active:bg-slate-300 px-3 py-2 rounded-xl border border-slate-200 cursor-pointer flex items-center gap-1.5 transition-colors">
                  <Upload size={15} className="text-slate-600" />
                  <span>Chọn nhiều ảnh</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleAddPhotos(e, false)}
                  />
                </label>
              </div>
            </div>

            {images.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-200"
                  >
                    <img src={img} alt="Chứng từ" className="w-full h-full object-cover" />
                    {/* AI Read button on each attached image */}
                    <button
                      type="button"
                      onClick={() => runGeminiReceiptReader(img)}
                      disabled={isScanning}
                      className="absolute bottom-1 left-1 right-1 py-1 px-1.5 bg-teal-900/85 hover:bg-teal-800 text-white text-[10px] font-semibold rounded flex items-center justify-center gap-1 backdrop-blur-2xs transition-colors cursor-pointer"
                      title="Dùng Gemini đọc số tiền, ngày và nội dung từ ảnh này"
                    >
                      <Wand2 size={10} />
                      <span>Đọc hóa đơn AI</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(idx)}
                      className="absolute top-1 right-1 p-1 bg-black/70 hover:bg-rose-600 text-white rounded-md transition-colors cursor-pointer"
                      title="Xóa ảnh"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
                <p className="text-xs text-slate-400">
                  Chưa có ảnh chứng từ. Nhấn "Chụp camera" hoặc "Chọn nhiều ảnh" để đính kèm.
                </p>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-6 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              {editingItem ? 'Lưu thay đổi' : 'Thêm khoản chi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
