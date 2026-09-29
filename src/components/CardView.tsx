import React from 'react';
import {
  Camera,
  Image as ImageIcon,
  Edit2,
  Trash2,
  Plus,
  Calendar,
  MessageSquare,
  AlertTriangle,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { ExpenseItem, MonthGroup } from '../types';
import { formatVND } from '../utils/categories';
import { parseDateSortKey } from '../utils/excel';

interface CardViewProps {
  monthGroups: MonthGroup[];
  onEditExpense: (expense: ExpenseItem) => void;
  onDeleteExpense: (id: string) => void;
  onOpenReceiptViewer: (expense: ExpenseItem) => void;
  onAddNewToMonth: (monthTitle: string) => void;
  duplicateIdsSet: Set<string>;
  missingReceiptsCount: number;
  onlyMissingReceipts: boolean;
  onToggleMissingReceipts: (val: boolean) => void;
  totalExpensesCount: number;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export const CardView: React.FC<CardViewProps> = ({
  monthGroups,
  onEditExpense,
  onDeleteExpense,
  onOpenReceiptViewer,
  onAddNewToMonth,
  duplicateIdsSet,
  missingReceiptsCount,
  onlyMissingReceipts,
  onToggleMissingReceipts,
  totalExpensesCount,
  selectedIds = new Set(),
  onToggleSelect,
}) => {
  return (
    <div className="space-y-5">
      {/* Requirement 2: Missing Receipts Summary Banner at the top of the list */}
      {(missingReceiptsCount > 0 || onlyMissingReceipts) && (
        <div
          className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-2 text-xs shadow-2xs ${
            onlyMissingReceipts
              ? 'bg-amber-100/90 border-amber-300 text-amber-950'
              : 'bg-amber-50/80 border-amber-200/90 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span>
              {onlyMissingReceipts ? (
                <>
                  Đang lọc hiển thị <strong>{totalExpensesCount} khoản chi chưa có ảnh chứng từ</strong>.
                </>
              ) : (
                <>
                  Hiện có <strong>{missingReceiptsCount} khoản chi chưa có ảnh chứng từ</strong> trong danh sách.
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onToggleMissingReceipts(!onlyMissingReceipts)}
            className={`px-3 py-1 rounded-xl font-semibold transition-colors cursor-pointer ${
              onlyMissingReceipts
                ? 'bg-white text-amber-900 border border-amber-300 hover:bg-amber-50'
                : 'bg-amber-600 text-white hover:bg-amber-700'
            }`}
          >
            {onlyMissingReceipts ? 'Hiện tất cả khoản chi' : 'Lọc khoản thiếu chứng từ'}
          </button>
        </div>
      )}

      {missingReceiptsCount === 0 && !onlyMissingReceipts && totalExpensesCount > 0 && (
        <div className="p-3 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 text-emerald-900 text-xs flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>Tất cả {totalExpensesCount} khoản chi đều đã có đầy đủ ảnh chứng từ.</span>
        </div>
      )}

      {monthGroups.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200 shadow-xs">
          <Calendar size={44} className="mx-auto text-slate-300 mb-3" />
          <h4 className="text-base font-semibold text-slate-700">
            {onlyMissingReceipts
              ? 'Không có khoản chi nào thiếu ảnh chứng từ'
              : 'Chưa có dữ liệu chi tiêu'}
          </h4>
          <p className="text-xs text-slate-400 mt-1">
            {onlyMissingReceipts
              ? 'Tất cả khoản chi trong phạm vi này đều đã có ảnh hóa đơn.'
              : 'Nhấn nút "Thêm mới" ở dưới để bắt đầu ghi chép.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {monthGroups.map((group) => {
            const items = [...group.items].sort(
              (a, b) => parseDateSortKey(a.date || '') - parseDateSortKey(b.date || '')
            );

            return (
              <div key={group.monthKey} className="space-y-3">
                {/* Month Header Card */}
                <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200/80 rounded-2xl p-4 flex items-center justify-between shadow-2xs">
                  <div>
                    <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider block">
                      {group.monthTitle}
                    </span>
                    <div className="text-lg font-bold text-teal-950 font-mono">
                      {formatVND(group.totalAmount)}
                    </div>
                    <span className="text-xs text-teal-700 font-medium">
                      {group.count} khoản chi tiêu
                    </span>
                  </div>
                  <button
                    onClick={() => onAddNewToMonth(group.monthTitle)}
                    className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <Plus size={16} />
                    <span>Thêm</span>
                  </button>
                </div>

                {/* List of Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map((item) => {
                    const hasImages = (item.images || []).length > 0;
                    const isRefund = item.amount < 0;
                    const isSuspectedDuplicate = duplicateIdsSet.has(item.id);
                    const isSelected = selectedIds.has(item.id);

                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 shadow-2xs flex flex-col justify-between transition-all group ${
                          isSelected
                            ? 'bg-teal-50/90 border-teal-500 ring-2 ring-teal-500/20 shadow-xs'
                            : isSuspectedDuplicate
                            ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400'
                            : isRefund
                            ? 'bg-cyan-50/20 border-cyan-200 hover:border-cyan-400'
                            : 'bg-white border-slate-200 hover:border-teal-300'
                        }`}
                      >
                        <div>
                          {/* Top Bar: Checkbox, Date & Badges */}
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              {onToggleSelect && (
                                <label className="min-h-[44px] min-w-[44px] -ml-2 -my-2 flex items-center justify-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => onToggleSelect(item.id)}
                                    className="w-4 h-4 rounded text-teal-700 focus:ring-teal-500 cursor-pointer"
                                  />
                                </label>
                              )}
                              <span className="text-xs text-slate-500 font-medium">
                                {item.date}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {!hasImages && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200"
                                  title="Khoản chi này chưa có ảnh chứng từ"
                                >
                                  <AlertTriangle size={10} className="text-amber-600" />
                                  <span>Thiếu chứng từ</span>
                                </span>
                              )}
                              {isSuspectedDuplicate && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300"
                                  title="Có cùng Ngày, Số tiền và Diễn giải với khoản khác"
                                >
                                  <Copy size={10} className="text-amber-700" />
                                  <span>Nghi trùng</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Description */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <h4 className="text-sm font-semibold text-slate-800 line-clamp-2">
                              {item.description}
                            </h4>
                            {isRefund && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-100 text-cyan-800 border border-cyan-200">
                                Hoàn/thu lại
                              </span>
                            )}
                          </div>

                          {/* Notes / Comment if any */}
                          {item.notes && (
                            <div className="inline-flex items-center gap-1 text-[11px] text-amber-900 bg-yellow-50/90 border border-yellow-200/90 px-2 py-0.5 rounded-md mb-2">
                              <MessageSquare size={11} className="text-amber-600 shrink-0" />
                              <span>{item.notes}</span>
                            </div>
                          )}

                          {/* Amount */}
                          <div
                            className={`text-lg font-bold font-mono mb-3 ${
                              isRefund ? 'text-cyan-700' : 'text-teal-800'
                            }`}
                          >
                            {formatVND(item.amount)}
                          </div>

                          {/* Receipt thumbnails if any */}
                          {hasImages && (
                            <div
                              onClick={() => onOpenReceiptViewer(item)}
                              className="flex items-center gap-2 mb-3 p-1.5 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:bg-teal-50/50 transition-colors"
                              title="Bấm để xem ảnh phóng to"
                            >
                              <div className="flex -space-x-2 overflow-hidden">
                                {item.images.slice(0, 3).map((img, i) => (
                                  <img
                                    key={i}
                                    src={img}
                                    alt="Chứng từ"
                                    className="inline-block h-9 w-9 rounded-lg object-cover ring-2 ring-white"
                                  />
                                ))}
                              </div>
                              <span className="text-xs text-teal-700 font-semibold flex items-center gap-1 ml-1">
                                <ImageIcon size={13} />
                                {item.images.length} ảnh chứng từ
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Bottom Actions */}
                        <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 mt-1">
                          <button
                            onClick={() => onOpenReceiptViewer(item)}
                            className={`min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-colors cursor-pointer ${
                              hasImages
                                ? 'text-teal-700 bg-teal-50 hover:bg-teal-100 active:bg-teal-200'
                                : 'text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 border border-amber-200/80'
                            }`}
                          >
                            {hasImages ? (
                              <>
                                <ImageIcon size={15} />
                                <span>Xem ảnh</span>
                              </>
                            ) : (
                              <>
                                <Camera size={15} className="text-amber-700" />
                                <span>Chụp / Thêm ảnh</span>
                              </>
                            )}
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onEditExpense(item)}
                              aria-label="Sửa khoản chi"
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-teal-700 hover:bg-teal-50 active:bg-teal-100 rounded-xl transition-colors cursor-pointer"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => onDeleteExpense(item.id)}
                              aria-label="Xóa khoản chi"
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-xl transition-colors cursor-pointer"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Month Total Footer for mobile */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between text-xs font-bold text-slate-700">
                  <span className="uppercase">Tổng cộng {group.monthTitle}:</span>
                  <span className="text-sm font-mono text-teal-800">{formatVND(group.totalAmount)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
