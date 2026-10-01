import React, { useState } from 'react';
import {
  Camera,
  Image as ImageIcon,
  ImagePlus,
  Upload,
  ClipboardPaste,
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

interface TableViewProps {
  monthGroups: MonthGroup[];
  onEditExpense: (expense: ExpenseItem) => void;
  onDeleteExpense: (id: string) => void;
  onOpenReceiptViewer: (expense: ExpenseItem) => void;
  onAddNewToMonth: (monthTitle: string) => void;
  onDropFilesOnExpense?: (expense: ExpenseItem, files: File[]) => Promise<void> | void;
  onPasteClipboardToExpense?: (expense: ExpenseItem) => Promise<void> | void;
  onHoverExpense?: (expenseId: string | null) => void;
  uploadingExpenseId?: string | null;
  isGlobalDraggingFiles?: boolean;
  grandTotal: number;
  totalExpensesCount: number;
  duplicateIdsSet: Set<string>;
  missingReceiptsCount: number;
  onlyMissingReceipts: boolean;
  onToggleMissingReceipts: (val: boolean) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  isAllSelected?: boolean;
  settledMonthKeys?: Set<string>;
  collapsedMonthKeys?: Set<string>;
  onToggleCollapseMonth?: (monthKey: string) => void;
  onToggleSettleMonth?: (monthKey: string, monthTitle: string) => void;
  onCollapseAllSettled?: () => void;
  onCollapseAllMonths?: () => void;
  onExpandAllMonths?: () => void;
}

export const TableView: React.FC<TableViewProps> = ({
  monthGroups,
  onEditExpense,
  onDeleteExpense,
  onOpenReceiptViewer,
  onAddNewToMonth,
  onDropFilesOnExpense,
  onPasteClipboardToExpense,
  onHoverExpense,
  uploadingExpenseId = null,
  isGlobalDraggingFiles = false,
  grandTotal,
  totalExpensesCount,
  duplicateIdsSet,
  missingReceiptsCount,
  onlyMissingReceipts,
  onToggleMissingReceipts,
  selectedIds = new Set(),
  onToggleSelect,
  onToggleSelectAll,
  isAllSelected = false,
  settledMonthKeys = new Set(),
  collapsedMonthKeys = new Set(),
  onToggleCollapseMonth,
  onToggleSettleMonth,
  onCollapseAllSettled,
  onCollapseAllMonths,
  onExpandAllMonths,
}) => {
  const [dragOverExpenseId, setDragOverExpenseId] = useState<string | null>(null);

  const extractImageFilesFromDataTransfer = (dt: DataTransfer | null): File[] => {
    if (!dt) return [];
    const files: File[] = [];
    if (dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i];
        if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(f.name)) {
          files.push(f);
        }
      }
    }
    if (files.length === 0 && dt.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    return files;
  };

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
                  Đang lọc hiển thị <strong>{totalExpensesCount} khoản chi chưa có ảnh chứng từ</strong>.{' '}
                  <span className="hidden md:inline text-amber-800">
                    (Kéo thả ảnh trực tiếp vào dòng bất kỳ hoặc bấm nút Dán ảnh / Ctrl+V)
                  </span>
                </>
              ) : (
                <>
                  Hiện có <strong>{missingReceiptsCount} khoản chi chưa có ảnh chứng từ</strong> trong danh sách.{' '}
                  <span className="hidden md:inline text-amber-800">
                    (Có thể kéo thả ảnh trực tiếp vào từng dòng ở ngoài bảng)
                  </span>
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
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-xs">
          <Calendar size={48} className="mx-auto text-slate-300 mb-3" />
          <h4 className="text-base font-semibold text-slate-700">
            {onlyMissingReceipts
              ? 'Không có khoản chi nào thiếu ảnh chứng từ'
              : 'Chưa có dữ liệu chi tiêu'}
          </h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {onlyMissingReceipts
              ? 'Tất cả khoản chi trong phạm vi này đều đã có ảnh hóa đơn.'
              : 'Nhấn nút "Thêm mới", "Tách tin nhắn" hoặc "Nhập Excel" ở thanh công cụ để bắt đầu quản lý.'}
          </p>
        </div>
      ) : (
        <>
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
              <div
                key={group.monthKey}
                className={`bg-white rounded-2xl border shadow-xs overflow-hidden transition-all ${
                  isSettled ? 'border-emerald-300/90' : 'border-slate-200/90'
                }`}
              >
                {/* Month Header Banner */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 ${
                    !isCollapsed ? 'border-b border-slate-200/80' : ''
                  } ${
                    isSettled
                      ? 'bg-gradient-to-r from-emerald-50/80 via-teal-50/50 to-slate-50'
                      : 'bg-slate-50/90'
                  }`}
                >
                  {/* Clickable Left Title & Status */}
                  <div
                    onClick={() => onToggleCollapseMonth?.(group.monthKey)}
                    className="flex items-center gap-3 cursor-pointer select-none group flex-1 min-w-[200px]"
                    title={isCollapsed ? 'Bấm để mở rộng chi tiết tháng này' : 'Bấm để thu gọn tháng này'}
                  >
                    <button
                      type="button"
                      aria-label={isCollapsed ? 'Mở rộng tháng' : 'Thu gọn tháng'}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors shrink-0 ${
                        isCollapsed
                          ? 'bg-white text-teal-800 border-teal-300 group-hover:bg-teal-50'
                          : 'bg-teal-600/10 text-teal-800 border-teal-200 group-hover:bg-teal-600/20'
                      }`}
                    >
                      {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    </button>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm sm:text-base font-bold text-slate-800 uppercase tracking-wide">
                          {group.monthTitle}
                        </h3>
                        {isSettled && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-700 text-white shadow-2xs">
                            <Lock size={10} />
                            <span>Đã chốt</span>
                          </span>
                        )}
                        {isCollapsed && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white text-slate-600 border border-slate-200">
                            Đang thu gọn
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium mt-0.5">
                        <span>{group.count} khoản chi tiêu</span>
                        {missingInMonth > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                            • <AlertTriangle size={11} className="text-amber-600" />
                            <span>Thiếu {missingInMonth} ảnh</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Total & Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <div className="text-right mr-1">
                      <span className="text-[11px] text-slate-500 block uppercase font-medium">
                        Tổng tháng
                      </span>
                      <span className="text-sm sm:text-base font-bold font-mono text-teal-800">
                        {formatVND(group.totalAmount)}
                      </span>
                    </div>

                    {onToggleSettleMonth && (
                      <button
                        type="button"
                        onClick={() => onToggleSettleMonth(group.monthKey, group.monthTitle)}
                        title={
                          isSettled
                            ? 'Bỏ trạng thái chốt sổ tháng này để tiếp tục chỉnh sửa'
                            : 'Đánh dấu tháng này đã chốt sổ và tự động thu gọn'
                        }
                        className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
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
                        className="min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
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
                      title={`Thêm khoản chi vào ${group.monthTitle}`}
                      className="min-h-[36px] flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-xl border border-teal-200/60 transition-colors cursor-pointer"
                    >
                      <Plus size={14} />
                      <span className="hidden sm:inline">Thêm vào tháng</span>
                    </button>
                  </div>
                </div>

                {/* Responsive Table Wrapper (Hidden when month is collapsed) */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-200/70 bg-slate-50/50 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
                          {onToggleSelect && (
                            <th className="py-2.5 px-2.5 sm:px-3 w-10 text-center">
                              <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={onToggleSelectAll}
                                className="rounded text-teal-700 focus:ring-teal-500 cursor-pointer"
                                title={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                              />
                            </th>
                          )}
                          <th className="py-2.5 px-3 sm:px-4 w-12 text-center">STT</th>
                          <th className="py-2.5 px-3 sm:px-4 w-28">Ngày</th>
                          <th className="py-2.5 px-3 sm:px-4 min-w-[200px]">Diễn giải</th>
                          <th className="py-2.5 px-3 sm:px-4 w-32 text-right">Số tiền</th>
                          <th className="py-2.5 px-3 sm:px-4 w-44 text-center">
                            Chứng từ (Kéo thả / Dán)
                          </th>
                          <th className="py-2.5 px-3 sm:px-4 w-24 text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item, index) => {
                          const hasImages = (item.images || []).length > 0;
                          const isRefund = item.amount < 0;
                          const isSuspectedDuplicate = duplicateIdsSet.has(item.id);
                          const isSelected = selectedIds.has(item.id);
                          const isDragOverRow = dragOverExpenseId === item.id;
                          const isUploadingThisRow = uploadingExpenseId === item.id;

                          return (
                            <tr
                              key={item.id}
                              onMouseEnter={() => onHoverExpense?.(item.id)}
                              onMouseLeave={() => onHoverExpense?.(null)}
                              onDragEnter={(e) => {
                                if (!onDropFilesOnExpense) return;
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverExpenseId(item.id);
                              }}
                              onDragOver={(e) => {
                                if (!onDropFilesOnExpense) return;
                                e.preventDefault();
                                e.stopPropagation();
                                e.dataTransfer.dropEffect = 'copy';
                                if (dragOverExpenseId !== item.id) {
                                  setDragOverExpenseId(item.id);
                                }
                              }}
                              onDragLeave={(e) => {
                                if (!onDropFilesOnExpense) return;
                                e.preventDefault();
                                e.stopPropagation();
                                const related = e.relatedTarget as Node | null;
                                if (!related || !e.currentTarget.contains(related)) {
                                  setDragOverExpenseId((prev) => (prev === item.id ? null : prev));
                                }
                              }}
                              onDrop={(e) => {
                                if (!onDropFilesOnExpense) return;
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverExpenseId(null);
                                const files = extractImageFilesFromDataTransfer(e.dataTransfer);
                                if (files.length > 0) {
                                  onDropFilesOnExpense(item, files);
                                }
                              }}
                              className={`transition-all group ${
                                isDragOverRow
                                  ? 'bg-teal-100/90 ring-2 ring-teal-600 ring-inset shadow-xs'
                                  : isSelected
                                  ? 'bg-teal-100/60 hover:bg-teal-100/80'
                                  : isSuspectedDuplicate
                                  ? 'bg-amber-50/45 hover:bg-amber-50/80'
                                  : isRefund
                                  ? 'bg-cyan-50/30 hover:bg-cyan-50/60'
                                  : 'hover:bg-teal-50/20'
                              }`}
                            >
                              {/* Checkbox */}
                              {onToggleSelect && (
                                <td className="py-2 px-1 text-center">
                                  <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => onToggleSelect(item.id)}
                                      className="w-4 h-4 rounded text-teal-700 focus:ring-teal-500 cursor-pointer"
                                    />
                                  </label>
                                </td>
                              )}

                              {/* STT */}
                              <td className="py-3 px-3 sm:px-4 text-center text-slate-400 font-mono text-xs">
                                {index + 1}
                              </td>

                              {/* Ngày */}
                              <td className="py-3 px-3 sm:px-4 text-slate-600 font-medium whitespace-nowrap">
                                {item.date}
                              </td>

                              {/* Diễn giải, Cảnh báo trùng & Ghi chú comment */}
                              <td className="py-3 px-3 sm:px-4 text-slate-800 font-medium">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span>{item.description}</span>
                                  {isRefund && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-100 text-cyan-800 border border-cyan-200">
                                      Hoàn/thu lại
                                    </span>
                                  )}
                                  {/* Requirement 3: Subtle duplicate indicator */}
                                  {isSuspectedDuplicate && (
                                    <span
                                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300"
                                      title="Khoản chi này có cùng Ngày, Số tiền và Diễn giải với một dòng khác"
                                    >
                                      <Copy size={10} className="text-amber-700" />
                                      <span>Nghi trùng</span>
                                    </span>
                                  )}
                                </div>
                                {item.notes && (
                                  <div className="inline-flex items-center gap-1 text-[11px] text-amber-900 bg-yellow-50/90 border border-yellow-200/90 px-2 py-0.5 rounded-md mt-1">
                                    <MessageSquare size={11} className="text-amber-600 shrink-0" />
                                    <span>{item.notes}</span>
                                  </div>
                                )}
                              </td>

                              {/* Số tiền */}
                              <td
                                className={`py-3 px-3 sm:px-4 text-right whitespace-nowrap font-bold font-mono ${
                                  isRefund ? 'text-cyan-700' : 'text-slate-900'
                                }`}
                              >
                                {formatVND(item.amount)}
                              </td>

                              {/* Requirement 2 & Drop Outside: Ảnh chứng từ (hỗ trợ kéo thả trực tiếp & dán ảnh ở ngoài) */}
                              <td className="py-2 px-2 text-center whitespace-nowrap">
                                {isUploadingThisRow ? (
                                  <div className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-300">
                                    <div className="w-3.5 h-3.5 border-2 border-teal-700 border-t-transparent rounded-full animate-spin shrink-0" />
                                    <span>Đang lưu ảnh...</span>
                                  </div>
                                ) : isDragOverRow ? (
                                  <div className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-700 text-white border-2 border-dashed border-white shadow-sm animate-pulse">
                                    <Upload size={14} className="shrink-0" />
                                    <span>Thả ảnh vào đây</span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onOpenReceiptViewer(item)}
                                      title={
                                        hasImages
                                          ? `Xem ${item.images.length} ảnh chứng từ (Hoặc kéo thả thêm ảnh trực tiếp vào dòng này)`
                                          : 'Chưa có ảnh chứng từ — Bấm để xem/thêm hoặc Kéo thả ảnh trực tiếp vào dòng này'
                                      }
                                      className={`min-h-[40px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                        isGlobalDraggingFiles
                                          ? 'bg-teal-50 text-teal-900 border-2 border-dashed border-teal-500 shadow-2xs'
                                          : hasImages
                                          ? 'bg-teal-50 text-teal-700 hover:bg-teal-100 active:bg-teal-200 border border-teal-200'
                                          : 'bg-amber-50/80 text-amber-800 hover:bg-amber-100 active:bg-amber-200 border border-dashed border-amber-300'
                                      }`}
                                    >
                                      {isGlobalDraggingFiles ? (
                                        <>
                                          <ImagePlus size={14} className="text-teal-700 shrink-0" />
                                          <span className="text-[11px] font-bold">
                                            {hasImages ? `${item.images.length} • Thả thêm` : 'Thả ảnh vào đây'}
                                          </span>
                                        </>
                                      ) : hasImages ? (
                                        <>
                                          <ImageIcon size={15} className="text-teal-600" />
                                          <span className="font-semibold">{item.images.length}</span>
                                        </>
                                      ) : (
                                        <>
                                          <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                                          <Camera size={13} className="text-amber-700 shrink-0" />
                                          <span className="text-[11px] font-semibold">Thiếu ảnh</span>
                                        </>
                                      )}
                                    </button>

                                    {onPasteClipboardToExpense && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onPasteClipboardToExpense(item);
                                        }}
                                        title="Dán nhanh ảnh chụp màn hình từ bộ nhớ tạm vào khoản chi này (hoặc chỉ chuột vào dòng rồi bấm Ctrl+V)"
                                        className={`min-h-[40px] min-w-[36px] px-2 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1 border transition-all cursor-pointer ${
                                          hasImages
                                            ? 'bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-700 border-slate-200 hover:border-indigo-200 opacity-70 group-hover:opacity-100'
                                            : 'bg-indigo-50/80 hover:bg-indigo-100 text-indigo-800 border-indigo-200/80'
                                        }`}
                                      >
                                        <ClipboardPaste size={13} className="shrink-0" />
                                        <span className="hidden xl:inline text-[10px]">Dán</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Thao tác */}
                              <td className="py-2 px-2 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => onEditExpense(item)}
                                    title="Sửa khoản chi"
                                    aria-label="Sửa khoản chi"
                                    className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-teal-700 hover:bg-teal-50 active:bg-teal-100 rounded-xl transition-colors cursor-pointer"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => onDeleteExpense(item.id)}
                                    title="Xóa khoản chi"
                                    aria-label="Xóa khoản chi"
                                    className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-xl transition-colors cursor-pointer"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>

                      {/* Subtotal Row per Month */}
                      <tfoot>
                        <tr className="bg-slate-50 font-bold border-t-2 border-slate-200 text-slate-800">
                          <td
                            colSpan={onToggleSelect ? 4 : 3}
                            className="py-3 px-4 text-right uppercase tracking-wider text-xs sm:text-sm"
                          >
                            Tổng cộng {group.monthTitle}:
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-teal-800 text-sm sm:text-base">
                            {formatVND(group.totalAmount)}
                          </td>
                          <td
                            colSpan={2}
                            className="py-3 px-4 text-xs text-slate-400 text-center font-normal"
                          >
                            {group.count} khoản
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {/* Grand Summary Card at bottom */}
          <div className="bg-gradient-to-r from-teal-800 to-slate-900 rounded-2xl p-5 text-white shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-200 block">
                Báo cáo tổng hợp
              </span>
              <h4 className="text-lg font-bold">Tổng chi phí tất cả các tháng</h4>
              <p className="text-xs text-teal-100/80 mt-0.5">
                Gồm {monthGroups.length} tháng, tổng cộng {totalExpensesCount} khoản chi tiêu
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-white">
                {formatVND(grandTotal)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
