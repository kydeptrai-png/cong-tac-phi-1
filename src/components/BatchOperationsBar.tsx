import React, { useState } from 'react';
import {
  Calendar,
  Trash2,
  X,
  Check,
  CheckSquare,
  Square,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { formatVND } from '../utils/categories';

interface BatchOperationsBarProps {
  selectedCount: number;
  totalVisibleCount: number;
  selectedTotalAmount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isAllSelected: boolean;
  onBatchDelete: () => void;
  onBatchUpdateDate: (newDate: string) => void;
}

export const BatchOperationsBar: React.FC<BatchOperationsBarProps> = ({
  selectedCount,
  totalVisibleCount,
  selectedTotalAmount,
  onSelectAll,
  onDeselectAll,
  isAllSelected,
  onBatchDelete,
  onBatchUpdateDate,
}) => {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [newDateValue, setNewDateValue] = useState(() => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (selectedCount === 0) return null;

  const handleApplyDate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDateValue.trim()) return;
    onBatchUpdateDate(newDateValue.trim());
    setShowDatePicker(false);
  };

  const handleConfirmDelete = () => {
    onBatchDelete();
    setShowDeleteConfirm(false);
  };

  return (
    <>
      {/* Sticky Bottom Batch Actions Bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[95%] max-w-2xl bg-slate-900 text-white rounded-2xl p-3 sm:p-3.5 shadow-2xl border border-slate-700/80 flex flex-wrap items-center justify-between gap-2.5 animate-in slide-in-from-bottom-3 duration-200">
        {/* Left: Selection info */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={isAllSelected ? onDeselectAll : onSelectAll}
            className="flex items-center gap-1.5 text-xs font-semibold text-teal-300 hover:text-white transition-colors cursor-pointer"
            title={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả các khoản chi đang hiển thị'}
          >
            {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            <span>{isAllSelected ? 'Bỏ chọn' : `Chọn hết (${totalVisibleCount})`}</span>
          </button>

          <div className="h-4 w-px bg-slate-700" />

          <div className="text-xs">
            <span className="font-bold text-white">Đã chọn {selectedCount} khoản</span>
            <span className="text-slate-400 mx-1.5">·</span>
            <span className="font-mono font-bold text-teal-300">
              {formatVND(selectedTotalAmount)}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Change Date Button */}
          <button
            type="button"
            onClick={() => {
              setShowDatePicker(true);
              setShowDeleteConfirm(false);
            }}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-teal-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            title="Đổi ngày hàng loạt cho các dòng đã chọn"
          >
            <Calendar size={13} />
            <span>Đổi ngày</span>
          </button>

          {/* Delete Batch Button */}
          <button
            type="button"
            onClick={() => {
              setShowDeleteConfirm(true);
              setShowDatePicker(false);
            }}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-900 text-rose-300 text-xs font-semibold border border-rose-800/60 transition-colors cursor-pointer"
            title="Xóa hàng loạt các khoản chi đã chọn"
          >
            <Trash2 size={13} />
            <span>Xóa ({selectedCount})</span>
          </button>

          {/* Close / Deselect */}
          <button
            type="button"
            onClick={onDeselectAll}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Bỏ chọn"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Modal: Batch Change Date */}
      {showDatePicker && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calendar size={17} className="text-teal-700" />
                <span>Đổi ngày hàng loạt ({selectedCount} khoản)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowDatePicker(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Nhập ngày mới để áp dụng đồng loạt cho <strong>{selectedCount} khoản chi</strong> đã chọn. Tháng cũng sẽ tự động được cập nhật tương ứng.
            </p>

            <form onSubmit={handleApplyDate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ngày mới (DD/MM/YYYY)
                </label>
                <input
                  type="text"
                  required
                  value={newDateValue}
                  onChange={(e) => setNewDateValue(e.target.value)}
                  placeholder="VD: 25/03/2026"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 font-mono focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDatePicker(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
                >
                  <Check size={13} />
                  <span>Áp dụng cho {selectedCount} khoản</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Batch Delete Confirmation */}
      {showDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-rose-100 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600">
              <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <h3 className="text-sm font-bold text-rose-950">
                Xác nhận xóa hàng loạt?
              </h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn xóa vĩnh viễn <strong>{selectedCount} khoản chi</strong> đã chọn (tổng cộng <strong>{formatVND(selectedTotalAmount)}</strong>)?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Xác nhận xóa {selectedCount} khoản</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
