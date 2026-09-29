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

interface TableViewProps {
  monthGroups: MonthGroup[];
  onEditExpense: (expense: ExpenseItem) => void;
  onDeleteExpense: (id: string) => void;
  onOpenReceiptViewer: (expense: ExpenseItem) => void;
  onAddNewToMonth: (monthTitle: string) => void;
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
}

export const TableView: React.FC<TableViewProps> = ({
  monthGroups,
  onEditExpense,
  onDeleteExpense,
  onOpenReceiptViewer,
  onAddNewToMonth,
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

            return (
              <div
                key={group.monthKey}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden"
              >
                {/* Month Header Banner */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-slate-50/90 border-b border-slate-200/80">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-6 bg-teal-600 rounded-full" />
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-800 uppercase tracking-wide">
                        {group.monthTitle}
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">
                        {group.count} khoản chi tiêu
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block uppercase font-medium">
                        Tổng tháng
                      </span>
                      <span className="text-sm sm:text-base font-bold text-teal-800">
                        {formatVND(group.totalAmount)}
                      </span>
                    </div>
                    <button
                      onClick={() => onAddNewToMonth(group.monthTitle)}
                      title={`Thêm khoản chi vào ${group.monthTitle}`}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-xl border border-teal-200/60 transition-colors cursor-pointer"
                    >
                      <Plus size={14} />
                      <span className="hidden sm:inline">Thêm vào tháng</span>
                    </button>
                  </div>
                </div>

                {/* Responsive Table Wrapper */}
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
                        <th className="py-2.5 px-3 sm:px-4 w-32 text-center">Chứng từ</th>
                        <th className="py-2.5 px-3 sm:px-4 w-24 text-center">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item, index) => {
                        const hasImages = (item.images || []).length > 0;
                        const isRefund = item.amount < 0;
                        const isSuspectedDuplicate = duplicateIdsSet.has(item.id);
                        const isSelected = selectedIds.has(item.id);

                        return (
                          <tr
                            key={item.id}
                            className={`transition-colors group ${
                              isSelected
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

                            {/* Requirement 2: Ảnh chứng từ (dòng thiếu ảnh có biểu tượng cảnh báo) */}
                            <td className="py-2 px-2 text-center whitespace-nowrap">
                              <button
                                onClick={() => onOpenReceiptViewer(item)}
                                title={
                                  hasImages
                                    ? `Xem ${item.images.length} ảnh chứng từ`
                                    : 'Chưa có ảnh chứng từ — Bấm để chụp hoặc thêm ảnh'
                                }
                                className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                  hasImages
                                    ? 'bg-teal-50 text-teal-700 hover:bg-teal-100 active:bg-teal-200 border border-teal-200'
                                    : 'bg-amber-50/80 text-amber-800 hover:bg-amber-100 active:bg-amber-200 border border-amber-200/90'
                                }`}
                              >
                                {hasImages ? (
                                  <>
                                    <ImageIcon size={15} className="text-teal-600" />
                                    <span className="font-semibold">{item.images.length}</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                                    <Camera size={14} className="text-amber-700 shrink-0" />
                                    <span className="text-[11px] font-semibold">Thiếu ảnh</span>
                                  </>
                                )}
                              </button>
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
