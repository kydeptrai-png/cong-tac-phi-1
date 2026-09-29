import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Award,
  Calendar,
  Sparkles,
  Copy,
  Check,
  Wallet,
} from 'lucide-react';
import { ExpenseItem, MonthGroup, MonthlyTrend, AdvancePaymentItem } from '../types';
import { formatCompactVND, formatVND } from '../utils/categories';
import { summarizeExpensesWithAI } from '../utils/gemini';

interface DashboardViewProps {
  expenses: ExpenseItem[];
  monthGroups: MonthGroup[];
  advances?: AdvancePaymentItem[];
  onOpenReceiptViewer: (expense: ExpenseItem) => void;
  onEditExpense: (expense: ExpenseItem) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  expenses,
  monthGroups,
  advances = [],
  onOpenReceiptViewer,
  onEditExpense,
}) => {
  const availableMonths = useMemo(() => {
    return monthGroups.map((g) => g.monthTitle);
  }, [monthGroups]);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : '';
  });

  // AI Summary state (Requirement 8)
  const [aiSummaryText, setAiSummaryText] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  const currentMonthTitle = useMemo(() => {
    if (selectedMonth && availableMonths.includes(selectedMonth)) {
      return selectedMonth;
    }
    return availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : '';
  }, [selectedMonth, availableMonths]);

  const currentMonthIdx = availableMonths.indexOf(currentMonthTitle);
  const currentGroup = monthGroups.find((g) => g.monthTitle === currentMonthTitle);
  const prevMonthTitle = currentMonthIdx > 0 ? availableMonths[currentMonthIdx - 1] : null;
  const prevGroup = prevMonthTitle ? monthGroups.find((g) => g.monthTitle === prevMonthTitle) : null;

  const currentTotal = currentGroup ? currentGroup.totalAmount : 0;
  const prevTotal = prevGroup ? prevGroup.totalAmount : 0;
  const currentCount = currentGroup ? currentGroup.count : 0;

  const comparison = useMemo(() => {
    if (!prevGroup || prevTotal === 0) {
      return { diff: 0, percent: 0, hasPrev: false, isIncrease: false };
    }
    const diff = currentTotal - prevTotal;
    const percent = Math.round((diff / prevTotal) * 100);
    return {
      diff,
      percent: Math.abs(percent),
      hasPrev: true,
      isIncrease: diff > 0,
    };
  }, [currentTotal, prevTotal, prevGroup]);

  const currentItems = currentGroup ? currentGroup.items : expenses;

  const monthlyTrends = useMemo<MonthlyTrend[]>(() => {
    return monthGroups.map((g) => ({
      monthKey: g.monthKey,
      monthTitle: g.monthTitle,
      totalAmount: g.totalAmount,
      count: g.count,
    }));
  }, [monthGroups]);

  const maxMonthAmount = useMemo(() => {
    const max = Math.max(...monthlyTrends.map((t) => Math.abs(t.totalAmount)), 1);
    return max;
  }, [monthlyTrends]);

  // Top 5 largest expenses
  const topExpenses = useMemo(() => {
    return [...currentItems].sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [currentItems]);

  // Advance balance calculation
  const totalAllSpent = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const totalAdvances = useMemo(() => advances.reduce((s, a) => s + a.amount, 0), [advances]);
  const advanceBalance = totalAdvances - totalAllSpent;

  const handleGenerateAISummary = async () => {
    setIsGeneratingSummary(true);
    const missingReceiptsCount = currentItems.filter(
      (it) => !it.images || it.images.length === 0
    ).length;

    const comparisonText = comparison.hasPrev
      ? `${comparison.isIncrease ? 'Tăng' : 'Giảm'} ${comparison.percent}% (${formatVND(
          Math.abs(comparison.diff)
        )}) so với ${prevMonthTitle}`
      : 'Chưa có tháng trước để so sánh';

    const balanceStatusText =
      advanceBalance > 0
        ? `Còn dư tạm ứng ${formatVND(advanceBalance)} (cần hoàn lại)`
        : advanceBalance < 0
        ? `Chi vượt tạm ứng ${formatVND(Math.abs(advanceBalance))} (cần được thanh toán thêm)`
        : 'Đã khớp tạm ứng và thực chi';

    const payload = {
      period: currentMonthTitle,
      totalSpent: currentTotal,
      totalSpentFormatted: formatVND(currentTotal),
      expenseCount: currentCount,
      comparisonText,
      totalAdvance: totalAdvances,
      totalAdvanceFormatted: formatVND(totalAdvances),
      totalAllMonthsSpentFormatted: formatVND(totalAllSpent),
      balanceStatusText,
      missingReceiptsCount,
      topExpenses: topExpenses.map((e) => ({
        date: e.date,
        description: e.description,
        amountFormatted: formatVND(e.amount),
      })),
    };

    const res = await summarizeExpensesWithAI(payload);
    setAiSummaryText(res.summary);
    setIsGeneratingSummary(false);
  };

  const handleCopySummary = async () => {
    if (!aiSummaryText) return;
    try {
      await navigator.clipboard.writeText(aiSummaryText);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      // ignore
    }
  };

  if (expenses.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
        <BarChart3 size={44} className="mx-auto text-slate-300 mb-3" />
        <h4 className="text-base font-semibold text-slate-700">Chưa có dữ liệu để phân tích</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          Hãy thêm các khoản chi hoặc nhập từ file Excel để xem biểu đồ thống kê trực quan.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Month Filter Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-teal-700" />
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            Kỳ báo cáo thống kê:
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={currentMonthTitle}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setAiSummaryText('');
            }}
            className="text-xs sm:text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Overview Cards: Tổng chi theo tháng, So sánh với tháng trước, và Tạm ứng & Hoàn ứng */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Card 1: Tổng chi tháng hiện tại */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Tổng chi {currentMonthTitle}</span>
              <DollarSign size={16} className="text-teal-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
              {formatVND(currentTotal)}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-400">Số lượng:</span>
            <span className="font-semibold text-slate-700">{currentCount} khoản chi</span>
          </div>
        </div>

        {/* Card 2: So sánh với tháng trước */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>So sánh với {prevMonthTitle || 'tháng trước'}</span>
              {comparison.isIncrease ? (
                <TrendingUp size={16} className="text-rose-500" />
              ) : (
                <TrendingDown size={16} className="text-emerald-600" />
              )}
            </div>
            {comparison.hasPrev ? (
              <div>
                <div
                  className={`text-xl sm:text-2xl font-bold font-mono ${
                    comparison.isIncrease ? 'text-rose-600' : 'text-emerald-700'
                  }`}
                >
                  {comparison.isIncrease ? '+' : '-'}
                  {comparison.percent}%
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {comparison.isIncrease ? 'Tăng' : 'Giảm'} {formatVND(Math.abs(comparison.diff))}
                </div>
              </div>
            ) : (
              <div className="text-sm font-medium text-slate-400 mt-2">
                Không có dữ liệu tháng trước để so sánh
              </div>
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs text-slate-500">
            {prevGroup ? `Tháng trước: ${formatVND(prevTotal)}` : 'Kỳ ghi nhận đầu tiên'}
          </div>
        </div>

        {/* Card 3: Tạm ứng & Hoàn ứng toàn hồ sơ */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Cân đối Tạm ứng &amp; Hoàn ứng</span>
              <Wallet size={16} className="text-sky-600" />
            </div>
            <div
              className={`text-xl sm:text-2xl font-bold font-mono ${
                advanceBalance > 0
                  ? 'text-emerald-700'
                  : advanceBalance < 0
                  ? 'text-amber-700'
                  : 'text-slate-800'
              }`}
            >
              {advanceBalance > 0
                ? `+${formatVND(advanceBalance)}`
                : advanceBalance < 0
                ? formatVND(Math.abs(advanceBalance))
                : '0 ₫'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {advanceBalance > 0
                ? 'Còn dư tạm ứng (cần hoàn lại)'
                : advanceBalance < 0
                ? 'Chi vượt tạm ứng (cần thanh toán thêm)'
                : 'Đã khớp tạm ứng & thực chi'}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Tạm ứng: {formatVND(totalAdvances)}</span>
            <span>Thực chi: {formatVND(totalAllSpent)}</span>
          </div>
        </div>
      </div>

      {/* Requirement 8: AI Verbal Summary Card */}
      <div className="bg-gradient-to-r from-teal-50/90 via-emerald-50/60 to-teal-50/90 rounded-2xl p-5 border border-teal-200 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-700 text-white flex items-center justify-center shadow-2xs">
              <Sparkles size={16} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-teal-950 flex items-center gap-1.5">
                <span>Nhận xét &amp; Tóm tắt báo cáo bằng lời (Gemini AI)</span>
              </h4>
              <p className="text-xs text-teal-800">
                Tổng hợp nhanh tình hình chi tiêu, biến động và số tiền hoàn ứng để gửi báo cáo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {aiSummaryText && (
              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-teal-900 border border-teal-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                {copiedSummary ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                <span>{copiedSummary ? 'Đã sao chép!' : 'Copy gửi Zalo'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleGenerateAISummary}
              disabled={isGeneratingSummary}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              {isGeneratingSummary ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Đang viết tóm tắt...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>{aiSummaryText ? 'Tạo lại tóm tắt AI' : 'Tóm tắt bằng AI'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {aiSummaryText && (
          <div className="p-3.5 bg-white/95 rounded-xl border border-teal-200/80 text-xs sm:text-sm text-slate-800 whitespace-pre-line leading-relaxed">
            {aiSummaryText}
          </div>
        )}
      </div>

      {/* Biểu đồ cột: Tổng chi theo tháng & So sánh chi tiêu qua các tháng */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2">
              <BarChart3 size={18} className="text-teal-600" />
              <span>Tổng chi theo tháng</span>
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">So sánh chi tiêu qua các tháng</p>
          </div>
        </div>

        {/* Bar Chart Container */}
        <div className="pt-6 pb-2">
          <div className="h-44 flex items-end gap-3 sm:gap-6 justify-around border-b border-slate-200 px-2">
            {monthlyTrends.map((trend) => {
              const heightPercent = Math.max(
                12,
                Math.round((Math.abs(trend.totalAmount) / maxMonthAmount) * 100)
              );
              const isSelected = trend.monthTitle === currentMonthTitle;

              return (
                <div
                  key={trend.monthKey}
                  onClick={() => setSelectedMonth(trend.monthTitle)}
                  className="flex-1 flex flex-col items-center h-full justify-end cursor-pointer group"
                  title={`${trend.monthTitle}: ${formatVND(trend.totalAmount)}`}
                >
                  <span className="text-[10px] font-mono font-bold text-slate-600 mb-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    {formatCompactVND(trend.totalAmount)}
                  </span>
                  <div
                    className={`w-full max-w-[42px] rounded-t-xl transition-all duration-300 ${
                      isSelected
                        ? 'bg-teal-700 shadow-xs'
                        : 'bg-slate-200 group-hover:bg-teal-300'
                    }`}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>
              );
            })}
          </div>
          {/* X-axis labels */}
          <div className="flex items-center justify-around gap-3 sm:gap-6 px-2 mt-2">
            {monthlyTrends.map((trend) => {
              const isSelected = trend.monthTitle === currentMonthTitle;
              return (
                <button
                  key={trend.monthKey}
                  onClick={() => setSelectedMonth(trend.monthTitle)}
                  className={`flex-1 text-center text-xs font-semibold py-1 rounded-md transition-colors cursor-pointer ${
                    isSelected
                      ? 'text-teal-800 font-bold bg-teal-50'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {trend.monthTitle}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top 5 Khoản Chi Lớn Nhất */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award size={18} className="text-amber-500" />
            <h4 className="text-sm sm:text-base font-bold text-slate-800">
              Top 5 khoản chi lớn nhất ({currentMonthTitle})
            </h4>
          </div>
          <span className="text-xs text-slate-400 font-medium">Chiếm tỷ trọng cao nhất</span>
        </div>

        <div className="divide-y divide-slate-100">
          {topExpenses.map((item, idx) => {
            const rankMedalColor =
              idx === 0
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : idx === 1
                ? 'bg-slate-200 text-slate-700 border-slate-300'
                : idx === 2
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-slate-100 text-slate-500 border-slate-200';

            return (
              <div
                key={item.id}
                className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-xl transition-colors cursor-pointer group"
                onClick={() => onEditExpense(item)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono border shrink-0 ${rankMedalColor}`}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <h5 className="text-xs sm:text-sm font-semibold text-slate-800 truncate group-hover:text-teal-800 transition-colors">
                      {item.description}
                    </h5>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span>{item.date}</span>
                      {item.images?.length > 0 && (
                        <>
                          <span>•</span>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenReceiptViewer(item);
                            }}
                            className="text-teal-700 font-semibold hover:underline flex items-center gap-0.5"
                          >
                            {item.images.length} ảnh chứng từ
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right whitespace-nowrap">
                  <div className="text-sm sm:text-base font-bold font-mono text-slate-900">
                    {formatVND(item.amount)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {currentTotal > 0
                      ? `${Math.round((item.amount / currentTotal) * 100)}% tổng tháng`
                      : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
