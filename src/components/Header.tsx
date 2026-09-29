import React, { useState } from 'react';
import {
  Wallet,
  Plus,
  FileSpreadsheet,
  Upload,
  LayoutGrid,
  Table as TableIcon,
  BarChart3,
  Search,
  X,
  AlertTriangle,
  MessageSquareText,
  FileText,
  SlidersHorizontal,
  RotateCcw,
  CheckCircle2,
  Calendar,
  DollarSign,
  Settings,
} from 'lucide-react';
import { formatVND } from '../utils/categories';
import { PWAInstallButton } from './PWAInstallBanner';

interface HeaderProps {
  currentTab: 'expenses' | 'dashboard';
  setCurrentTab: (tab: 'expenses' | 'dashboard') => void;
  viewMode: 'table' | 'card';
  setViewMode: (mode: 'table' | 'card') => void;
  onOpenAddModal: () => void;
  onOpenImportModal: () => void;
  onOpenExportModal: () => void;
  onOpenBulkModal: () => void;
  onOpenPDFExport: () => void;
  onOpenSettings: () => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  availableMonths: string[];
  startDate: string;
  setStartDate: (d: string) => void;
  endDate: string;
  setEndDate: (d: string) => void;
  minAmount: number | '';
  setMinAmount: (val: number | '') => void;
  maxAmount: number | '';
  setMaxAmount: (val: number | '') => void;
  receiptFilter: 'all' | 'has_receipt' | 'no_receipt';
  setReceiptFilter: (f: 'all' | 'has_receipt' | 'no_receipt') => void;
  missingReceiptsCount: number;
  totalAmount: number;
  totalExpensesCount: number;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  viewMode,
  setViewMode,
  onOpenAddModal,
  onOpenImportModal,
  onOpenExportModal,
  onOpenBulkModal,
  onOpenPDFExport,
  onOpenSettings,
  searchTerm,
  setSearchTerm,
  selectedMonth,
  setSelectedMonth,
  availableMonths,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  minAmount,
  setMinAmount,
  maxAmount,
  setMaxAmount,
  receiptFilter,
  setReceiptFilter,
  missingReceiptsCount,
  totalAmount,
  totalExpensesCount,
  onResetFilters,
  hasActiveFilters,
}) => {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5">
        {/* Top Branding & Main Actions Bar */}
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-teal-800 to-teal-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Wallet size={20} className="sm:size-22" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate leading-tight tracking-tight">
                Sổ Chi Tiêu &amp; Công Tác Phí
              </h1>
              <p className="text-[11px] text-teal-700 font-semibold font-mono hidden xs:block">
                {formatVND(totalAmount)} · {totalExpensesCount} khoản
              </p>
            </div>
          </div>

          {/* Action Buttons: PWA Install, Bulk Message, Import, PDF, Export, Add */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <PWAInstallButton />

            <button
              onClick={onOpenBulkModal}
              title="Dán tin nhắn tách nhiều khoản chi (Zalo)"
              className="min-h-[44px] flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-teal-800 hover:text-teal-950 bg-teal-50/80 hover:bg-teal-100 rounded-xl border border-teal-200/70 transition-colors shrink-0 cursor-pointer"
            >
              <MessageSquareText size={15} />
              <span className="hidden md:inline">Tách tin nhắn</span>
            </button>

            <button
              onClick={onOpenImportModal}
              title="Nhập dữ liệu từ Excel (.xlsx)"
              className="min-h-[44px] flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-colors shrink-0 cursor-pointer"
            >
              <Upload size={15} />
              <span className="hidden sm:inline">Nhập Excel</span>
            </button>

            {/* Requirement 9: Xuất PDF báo cáo kèm ảnh */}
            <button
              onClick={onOpenPDFExport}
              title="Xuất báo cáo PDF kèm ảnh chứng từ thu nhỏ"
              className="min-h-[44px] flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-rose-800 hover:text-rose-950 bg-rose-50 hover:bg-rose-100/90 rounded-xl border border-rose-200 transition-colors shrink-0 cursor-pointer"
            >
              <FileText size={15} className="text-rose-600" />
              <span className="hidden sm:inline">Xuất PDF</span>
            </button>

            <button
              onClick={onOpenExportModal}
              title="Xuất file Excel / Sao lưu JSON"
              className="min-h-[44px] flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-teal-800 hover:text-teal-900 bg-teal-50 hover:bg-teal-100/80 rounded-xl border border-teal-200/70 transition-colors shrink-0 cursor-pointer"
            >
              <FileSpreadsheet size={15} />
              <span className="hidden sm:inline">Xuất / Sao lưu</span>
            </button>

            <button
              onClick={onOpenSettings}
              title="Cài đặt khóa Gemini API & Hệ thống"
              aria-label="Cài đặt khóa Gemini API"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-colors shrink-0 cursor-pointer"
            >
              <Settings size={18} />
            </button>

            <button
              onClick={onOpenAddModal}
              title="Thêm khoản chi mới"
              className="min-h-[44px] flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 active:bg-teal-900 rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
            >
              <Plus size={16} />
              <span>Thêm mới</span>
            </button>
          </div>
        </div>

        {/* Secondary Bar: Navigation Tabs & View Toggle */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          {/* Main Navigation: Sổ chi tiêu vs Thống kê */}
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl">
            <button
              onClick={() => setCurrentTab('expenses')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                currentTab === 'expenses'
                  ? 'bg-white text-teal-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TableIcon size={14} />
              <span>Sổ chi tiêu</span>
            </button>
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'bg-white text-teal-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 size={14} />
              <span>Thống kê</span>
            </button>
          </div>

          {/* View mode toggle (Bảng / Thẻ) when in 'expenses' tab */}
          {currentTab === 'expenses' && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl">
                <button
                  onClick={() => setViewMode('table')}
                  title="Xem dạng bảng tính gốc"
                  className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-white text-teal-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <TableIcon size={15} />
                </button>
                <button
                  onClick={() => setViewMode('card')}
                  title="Xem dạng thẻ điện thoại"
                  className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                    viewMode === 'card'
                      ? 'bg-white text-teal-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <LayoutGrid size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Filter & Search Bar (Requirement 8) */}
        {currentTab === 'expenses' && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Search Input: Từ khóa trong diễn giải */}
              <div className="relative flex-1 min-w-[150px]">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm từ khóa diễn giải..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-colors"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    aria-label="Xóa tìm kiếm"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Month Filter */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Lọc theo tháng"
                className="text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="all">Tất cả các tháng</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              {/* Receipt status filter: Có/Không có ảnh */}
              <select
                value={receiptFilter}
                onChange={(e) =>
                  setReceiptFilter(e.target.value as 'all' | 'has_receipt' | 'no_receipt')
                }
                aria-label="Lọc chứng từ ảnh"
                className={`text-xs font-semibold rounded-xl px-2.5 py-1.5 border transition-colors cursor-pointer ${
                  receiptFilter === 'no_receipt'
                    ? 'bg-amber-100/90 text-amber-950 border-amber-300 font-bold'
                    : receiptFilter === 'has_receipt'
                    ? 'bg-teal-50 text-teal-900 border-teal-200 font-bold'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                <option value="all">Tất cả chứng từ</option>
                <option value="has_receipt">Có ảnh chứng từ</option>
                <option value="no_receipt">
                  Chưa có ảnh {missingReceiptsCount > 0 ? `(${missingReceiptsCount})` : ''}
                </option>
              </select>

              {/* Toggle Advanced Filters Button (Khoảng ngày & Khoảng số tiền) */}
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  showAdvancedFilters || (startDate || endDate || minAmount !== '' || maxAmount !== '')
                    ? 'bg-teal-50 text-teal-900 border-teal-300 shadow-2xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
                title="Lọc theo khoảng ngày và khoảng số tiền"
              >
                <SlidersHorizontal size={13} className="text-teal-700" />
                <span>Khoảng ngày &amp; tiền</span>
                {(startDate || endDate || minAmount !== '' || maxAmount !== '') && (
                  <span className="w-2 h-2 rounded-full bg-teal-600" />
                )}
              </button>

              {/* Reset Filters button if any filter is active */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer"
                  title="Đặt lại tất cả bộ lọc về mặc định"
                >
                  <RotateCcw size={12} />
                  <span className="hidden sm:inline">Đặt lại</span>
                </button>
              )}
            </div>

            {/* Advanced Filters Panel: Khoảng ngày (Date Range) & Khoảng số tiền (Amount Range) */}
            {showAdvancedFilters && (
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2 animate-in fade-in duration-150 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Khoảng ngày */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                      <Calendar size={12} className="text-teal-700" />
                      <span>Lọc theo khoảng ngày:</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="flex-1 px-2.5 py-1 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                        title="Từ ngày"
                      />
                      <span className="text-slate-400 font-bold">-</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="flex-1 px-2.5 py-1 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                        title="Đến ngày"
                      />
                    </div>
                  </div>

                  {/* Khoảng số tiền */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                      <DollarSign size={12} className="text-teal-700" />
                      <span>Lọc theo khoảng số tiền (VNĐ):</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        placeholder="Từ (min)..."
                        value={minAmount}
                        onChange={(e) =>
                          setMinAmount(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="flex-1 px-2.5 py-1 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                      />
                      <span className="text-slate-400 font-bold">-</span>
                      <input
                        type="number"
                        placeholder="Đến (max)..."
                        value={maxAmount}
                        onChange={(e) =>
                          setMaxAmount(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="flex-1 px-2.5 py-1 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[11px] text-slate-500">
                  <span>
                    Ví dụ số tiền: 50000 đến 500000. Có thể để trống một đầu.
                  </span>
                  {(startDate || endDate || minAmount !== '' || maxAmount !== '') && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartDate('');
                        setEndDate('');
                        setMinAmount('');
                        setMaxAmount('');
                      }}
                      className="text-teal-700 hover:text-teal-900 font-semibold cursor-pointer"
                    >
                      Xóa khoảng ngày &amp; tiền
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

