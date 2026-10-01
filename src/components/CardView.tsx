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
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Lock,
  Unlock,
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
  settledMonthKeys?: Set<string>;
  collapsedMonthKeys?: Set<string>;
  onToggleCollapseMonth?: (monthKey: string) => void;
  onToggleSettleMonth?: (monthKey: string, monthTitle: string) => void;
  onCollapseAllSettled?: () => void;
  onCollapseAllMonths?: () => void;
  onExpandAllMonths?: () => void;
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
  settledMonthKeys = new Set(),
  collapsedMonthKeys = new Set(),
  onToggleCollapseMonth,
  onToggleSettleMonth,
  onCollapseAllSettled,
  onCollapseAllMonths,
  onExpandAllMonths,
}) => {
  const settledInViewCount = monthGroups.filter((g) =>
    settledMonthKeys.has(g.monthKey)
  ).length;
  const collapsedInViewCount = monthGroups.filter((g) =>
    collapsedMonthKeys.has(g.monthKey)
  ).length;
  const hasExpandedSettledMonth = monthGroups.some(
    (g) => settledMonthKeys.has(g.monthKey) && !collapsedMonthKeys.has(g.monthKey)
  );

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

      {/* Quick Collapse / Expand / Settled Months Control Bar */}
      {monthGroups.length > 0 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl px-3.5 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-800">
              Hiển thị {monthGroups.length} tháng
            </span>
            {settledInViewCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                <Lock size={11} className="text-emerald-600" />
                <span>Đã chốt {settledInViewCount} tháng</span>
              </span>
            )}
            {collapsedInViewCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-medium text-[11px]">
                <span>Đang thu gọn {collapsedInViewCount} tháng</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {hasExpandedSettledMonth && onCollapseAllSettled && (
              <button
                type="button"
                onClick={onCollapseAllSettled}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Thu gọn tất cả các tháng đã đánh dấu chốt sổ"
              >
                <Lock size={12} />
                <span>Thu gọn tháng đã chốt</span>
              </button>
            )}
            {collapsedInViewCount < monthGroups.length && onCollapseAllMonths && (
              <button
                type="button"
                onClick={onCollapseAllMonths}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Thu gọn toàn bộ các tháng"
              >
                <ChevronsUp size={13} />
                <span>Thu gọn tất cả</span>
              </button>
            )}
            {collapsedInViewCount > 0 && onExpandAllMonths && (
              <button
                type="button"
                onClick={onExpandAllMonths}
                className="px-2.5 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Mở rộng toàn bộ các tháng"
              >
                <ChevronsDown size={13} />
                <span>Mở rộng tất cả</span>
              </button>
            )}
          </div>
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
        <div className="space-y-4">
          {monthGroups.map((group) => {
            const items = [...group.items].sort(
              (a, b) => parseDateSortKey(a.date || '') - parseDateSortKey(b.date || '')
            );
            const isSettled = settledMonthKeys.has(group.monthKey);
            const isCollapsed = collapsedMonthKeys.has(group.monthKey);
            const missingInMonth = group.items.filter(
              (it) => !it.images || it.images.length === 0
            ).length;

            return (
              <div key={group.monthKey} className="space-y-3">
                {/* Month Header Card */}
                <div
                  className={`border rounded-2xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs transition-all ${
                    isSettled
                      ? 'bg-gradient-to-r from-emerald-50/90 via-teal-50/80 to-slate-50 border-emerald-300/90'
                      : 'bg-gradient-to-r from-teal-50 to-emerald-50 border-teal-200/80'
                  }`}
                >
                  {/* Clickable Left Info Area to toggle collapse/expand */}
                  <div
                    onClick={() => onToggleCollapseMonth?.(group.monthKey)}
                    className="flex items-start sm:items-center gap-2.5 flex-1 min-w-[200px] cursor-pointer select-none group"
                    title={isCollapsed ? 'Bấm để mở rộng chi tiết tháng này' : 'Bấm để thu gọn tháng này'}
                  >
                    <button
                      type="button"
                      aria-label={isCollapsed ? 'Mở rộng tháng' : 'Thu gọn tháng'}
                      className={`mt-0.5 sm:mt-0 w-8 h-8 rounded-xl flex items-center justify-center border transition-colors shrink-0 ${
                        isCollapsed
                          ? 'bg-white text-teal-800 border-teal-300 group-hover:bg-teal-100'
                          : 'bg-teal-700/10 text-teal-900 border-teal-200 group-hover:bg-teal-700/20'
                      }`}
                    >
                      {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    </button>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-bold text-teal-900 uppercase tracking-wider">
                          {group.monthTitle}
                        </span>
                        {isSettled && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-700 text-white shadow-2xs">
                            <Lock size={10} />
                            <span>Đã chốt</span>
                          </span>
                        )}
                        {isCollapsed && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/90 text-slate-600 border border-slate-200">
                            Đang thu gọn
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-0.5">
                        <span className="text-base sm:text-lg font-bold text-teal-950 font-mono">
                          {formatVND(group.totalAmount)}
                        </span>
                        <span className="text-xs text-teal-700 font-medium">
                          • {group.count} khoản chi
                        </span>
                        {missingInMonth > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                            <AlertTriangle size={11} className="text-amber-600" />
                            <span>Thiếu {missingInMonth} ảnh</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Action Buttons: Settle/Unsettle, Expand/Collapse, Add */}
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {onToggleSettleMonth && (
                      <button
                        type="button"
                        onClick={() => onToggleSettleMonth(group.monthKey, group.monthTitle)}
                        title={
                          isSettled
                            ? 'Bỏ trạng thái chốt sổ tháng này để tiếp tục chỉnh sửa'
                            : 'Đánh dấu tháng này đã chốt sổ và tự động thu gọn'
                        }
                        className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                          isSettled
                            ? 'bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-900 border-slate-300'
                            : 'bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-700 shadow-2xs'
                        }`}
                      >
                        {isSettled ? (
                          <>
                            <Unlock size={13} />
                            <span>Mở chốt</span>
                          </>
                        ) : (
                          <>
                            <Lock size={13} />
                            <span>Chốt tháng</span>
                          </>
                        )}
                      </button>
                    )}

                    {onToggleCollapseMonth && (
                      <button
                        type="button"
                        onClick={() => onToggleCollapseMonth(group.monthKey)}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/90 hover:bg-white text-teal-900 border border-teal-200/90 flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        {isCollapsed ? (
                          <>
                            <ChevronDown size={14} />
                            <span>Mở rộng ({group.count})</span>
                          </>
                        ) : (
                          <>
                            <ChevronRight size={14} className="-rotate-90" />
                            <span>Thu gọn</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onAddNewToMonth(group.monthTitle)}
                      className="min-h-[38px] flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl shadow-2xs transition-colors cursor-pointer"
                    >
                      <Plus size={15} />
                      <span>Thêm</span>
                    </button>
                  </div>
                </div>

                {/* List of Cards (Hidden when month is collapsed) */}
                {!isCollapsed && (
                  <>
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

                    {/* Month Total Footer */}
                    <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="uppercase">Tổng cộng {group.monthTitle}:</span>
                      <span className="text-sm font-mono text-teal-800">
                        {formatVND(group.totalAmount)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
