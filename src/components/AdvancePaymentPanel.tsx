import React, { useState } from 'react';
import {
  Wallet,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  Calendar,
  Edit2,
  Check,
  X,
} from 'lucide-react';
import { AdvancePaymentItem, ExpenseProfile } from '../types';
import { formatVND } from '../utils/categories';

interface AdvancePaymentPanelProps {
  profiles: ExpenseProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name: string) => void;
  onRenameProfile: (profileId: string, newName: string) => void;
  onDeleteProfile: (profileId: string) => void;
  advances: AdvancePaymentItem[];
  onAddAdvance: (item: AdvancePaymentItem) => void;
  onDeleteAdvance: (id: string) => void;
  totalSpent: number;
  refundsTotal: number;
}

export const AdvancePaymentPanel: React.FC<AdvancePaymentPanelProps> = ({
  profiles,
  activeProfileId,
  onSelectProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
  advances,
  onAddAdvance,
  onDeleteAdvance,
  totalSpent,
  refundsTotal,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNewProfileInput, setShowNewProfileInput] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isRenamingProfile, setIsRenamingProfile] = useState(false);
  const [renamedTitle, setRenamedTitle] = useState('');

  // Form states for adding a new advance payment
  const [advAmount, setAdvAmount] = useState<number | ''>('');
  const [advDate, setAdvDate] = useState(() => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  });
  const [advNote, setAdvNote] = useState('');

  // Filter advances for the active profile (or all if 'all')
  const profileAdvances =
    activeProfileId === 'all'
      ? advances
      : advances.filter((a) => (a.profileId || 'default') === activeProfileId);

  const totalAdvance = profileAdvances.reduce((sum, a) => sum + a.amount, 0);
  // Balance = Tổng tạm ứng - Tổng thực chi (Lưu ý: số tiền âm đã được trừ vào totalSpent)
  const balance = totalAdvance - totalSpent;

  const activeProfileObj =
    profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const handleAddAdvanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let numAmount = Number(advAmount) || 0;
    if (numAmount <= 0) return;

    // Auto-convert shorthand < 10000 to thousand VND (e.g. 500 -> 500.000, 2000 -> 2.000.000)
    if (numAmount > 0 && numAmount < 10000) {
      numAmount = Math.round(numAmount * 1000);
    }

    const newAdv: AdvancePaymentItem = {
      id: `adv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      profileId: activeProfileId === 'all' ? 'default' : activeProfileId,
      date: advDate.trim() || new Date().toLocaleDateString('vi-VN'),
      amount: numAmount,
      note: advNote.trim() || `Tạm ứng đợt ${profileAdvances.length + 1}`,
      createdAt: Date.now(),
    };

    onAddAdvance(newAdv);
    setAdvAmount('');
    setAdvNote('');
  };

  const handleCreateProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;
    onCreateProfile(newProfileName.trim());
    setNewProfileName('');
    setShowNewProfileInput(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs mb-5 overflow-hidden transition-all">
      {/* Top Bar: Profile Switcher & Summary Cards */}
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5 pb-3 border-b border-slate-100">
          {/* Profile Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <FolderKanban size={15} className="text-teal-700" />
              <span>Hồ sơ:</span>
            </div>
            <select
              value={activeProfileId}
              onChange={(e) => onSelectProfile(e.target.value)}
              aria-label="Chọn hồ sơ công tác"
              className="text-xs font-bold text-teal-900 bg-teal-50/80 border border-teal-200 rounded-xl px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {profiles.length > 1 && (
                <option value="all">Tất cả hồ sơ ({profiles.length})</option>
              )}
            </select>

            {!showNewProfileInput && !isRenamingProfile ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowNewProfileInput(true)}
                  className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 bg-slate-100 hover:bg-slate-200/70 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                  title="Tạo hồ sơ / đợt công tác mới"
                >
                  <Plus size={12} />
                  <span>Hồ sơ mới</span>
                </button>

                {activeProfileId !== 'all' && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamedTitle(activeProfileObj?.name || '');
                      setIsRenamingProfile(true);
                    }}
                    className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                    title="Đổi tên hồ sơ đang chọn"
                  >
                    <Edit2 size={12} />
                    <span className="hidden sm:inline">Đổi tên</span>
                  </button>
                )}
              </div>
            ) : null}

            {showNewProfileInput && (
              <form onSubmit={handleCreateProfileSubmit} className="flex items-center gap-1">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Tên hồ sơ (VD: Công tác Đà Nẵng)..."
                  className="px-2.5 py-1 text-xs rounded-lg border border-teal-300 focus:outline-hidden focus:ring-1 focus:ring-teal-600 bg-white"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  Tạo
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewProfileInput(false)}
                  className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
              </form>
            )}

            {isRenamingProfile && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!renamedTitle.trim()) return;
                  onRenameProfile(activeProfileId, renamedTitle.trim());
                  setIsRenamingProfile(false);
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="text"
                  value={renamedTitle}
                  onChange={(e) => setRenamedTitle(e.target.value)}
                  placeholder="Tên mới của hồ sơ..."
                  className="px-2.5 py-1 text-xs rounded-lg border border-teal-400 focus:outline-hidden focus:ring-1 focus:ring-teal-600 bg-white font-medium"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-0.5 cursor-pointer"
                  title="Lưu tên mới"
                >
                  <Check size={12} />
                  <span>Lưu</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsRenamingProfile(false)}
                  className="p-1 text-slate-500 hover:text-slate-700 cursor-pointer"
                  title="Hủy đổi tên"
                >
                  <X size={14} />
                </button>
              </form>
            )}

            {activeProfileId !== 'default' && activeProfileId !== 'all' && !isRenamingProfile && !showNewProfileInput && (
              <button
                type="button"
                onClick={() => onDeleteProfile(activeProfileId)}
                className="text-[11px] text-rose-600 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50 flex items-center gap-1 cursor-pointer"
                title="Xóa hồ sơ này"
              >
                <Trash2 size={12} />
                <span className="hidden sm:inline">Xóa hồ sơ</span>
              </button>
            )}
          </div>

          {/* Toggle Advance Payment Form Button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-xl border border-teal-200/80 transition-colors cursor-pointer"
          >
            <Wallet size={14} className="text-teal-700" />
            <span>
              Nhập Tạm Ứng / Hoàn Ứng ({profileAdvances.length} lần)
            </span>
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* 3 Summary Metrics: Tổng thực chi, Tổng tạm ứng, Số còn lại / Số cần hoàn */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 1. Tổng chi */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
                Tổng thực chi
              </span>
              <div className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-0.5">
                {formatVND(totalSpent)}
              </div>
              {refundsTotal < 0 && (
                <span className="text-[10px] text-cyan-700 font-medium block mt-0.5">
                  Đã trừ hoàn/thu lại: {formatVND(refundsTotal)}
                </span>
              )}
            </div>
            <div className="w-8 h-8 rounded-lg bg-slate-200/70 text-slate-700 flex items-center justify-center shrink-0">
              <ArrowUpRight size={17} />
            </div>
          </div>

          {/* 2. Tổng tạm ứng */}
          <div
            onClick={() => setIsExpanded(true)}
            className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-200/80 flex items-center justify-between cursor-pointer hover:bg-sky-50 transition-colors"
            title="Bấm để thêm hoặc xem chi tiết các lần tạm ứng"
          >
            <div>
              <span className="text-[11px] font-semibold text-sky-800 uppercase tracking-wide block">
                Tổng tạm ứng ({profileAdvances.length} lần)
              </span>
              <div className="text-base sm:text-lg font-bold font-mono text-sky-900 mt-0.5">
                {formatVND(totalAdvance)}
              </div>
              <span className="text-[10px] text-sky-700 font-medium block mt-0.5">
                {profileAdvances.length === 0
                  ? 'Bấm vào đây để nhập tiền tạm ứng'
                  : `Hồ sơ: ${activeProfileObj?.name || 'Mặc định'}`}
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
              <ArrowDownLeft size={17} />
            </div>
          </div>

          {/* 3. Số còn lại / Số cần hoàn */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between ${
              balance > 0
                ? 'bg-emerald-50/80 border-emerald-200/90'
                : balance < 0
                ? 'bg-amber-50/80 border-amber-200/90'
                : 'bg-slate-50 border-slate-200/80'
            }`}
          >
            <div>
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide block ${
                  balance > 0
                    ? 'text-emerald-800'
                    : balance < 0
                    ? 'text-amber-800'
                    : 'text-slate-500'
                }`}
              >
                {balance > 0
                  ? 'Số còn lại (Dư tạm ứng / Cần hoàn)'
                  : balance < 0
                  ? 'Chi vượt tạm ứng (Được nhận thêm)'
                  : 'Cân đối Tạm ứng & Thực chi'}
              </span>
              <div
                className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                  balance > 0
                    ? 'text-emerald-900'
                    : balance < 0
                    ? 'text-amber-900'
                    : 'text-slate-800'
                }`}
              >
                {balance > 0
                  ? `+${formatVND(balance)}`
                  : balance < 0
                  ? formatVND(Math.abs(balance))
                  : '0 ₫'}
              </div>
              <span
                className={`text-[10px] font-medium block mt-0.5 ${
                  balance > 0
                    ? 'text-emerald-700'
                    : balance < 0
                    ? 'text-amber-700'
                    : 'text-slate-400'
                }`}
              >
                {balance > 0
                  ? 'Tiền tạm ứng còn dư, hoàn lại quỹ'
                  : balance < 0
                  ? 'Công ty/Quỹ cần thanh toán bù thêm'
                  : 'Đã khớp hoàn toàn'}
              </span>
            </div>
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                balance > 0
                  ? 'bg-emerald-100 text-emerald-700'
                  : balance < 0
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-200/70 text-slate-600'
              }`}
            >
              <CheckCircle2 size={17} />
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Section: Add & List Advance Payments */}
      {isExpanded && (
        <div className="px-4 sm:px-5 py-4 bg-slate-50/90 border-t border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Danh sách các đợt tạm ứng ({activeProfileObj?.name || 'Mặc định'})
            </h4>
            <span className="text-[11px] text-slate-500">
              Nhập số nhỏ (VD: 2000) sẽ tự hiểu là 2.000.000 ₫
            </span>
          </div>

          {/* Add Advance Form */}
          <form
            onSubmit={handleAddAdvanceSubmit}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-white p-3 rounded-xl border border-slate-200 shadow-2xs"
          >
            <div className="sm:col-span-3">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
                Ngày tạm ứng
              </label>
              <input
                type="text"
                value={advDate}
                onChange={(e) => setAdvDate(e.target.value)}
                placeholder="DD/MM/YYYY"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 font-mono focus:outline-hidden focus:ring-1 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
                Số tiền tạm ứng (VNĐ)
              </label>
              <input
                type="number"
                required
                value={advAmount}
                onChange={(e) =>
                  setAdvAmount(e.target.value === '' ? '' : Number(e.target.value))
                }
                placeholder="VD: 2000000 hoặc 2000"
                className="w-full px-2.5 py-1.5 text-xs font-bold font-mono text-teal-900 rounded-lg border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
                Ghi chú đợt tạm ứng
              </label>
              <input
                type="text"
                value={advNote}
                onChange={(e) => setAdvNote(e.target.value)}
                placeholder="VD: Tạm ứng đợt 1 chuyển khoản..."
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>Thêm tạm ứng</span>
              </button>
            </div>
          </form>

          {/* List of Existing Advances */}
          {profileAdvances.length > 0 ? (
            <div className="divide-y divide-slate-200/70 bg-white rounded-xl border border-slate-200 overflow-hidden">
              {profileAdvances.map((adv, idx) => (
                <div
                  key={adv.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-800 font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="font-mono text-slate-600 flex items-center gap-1 shrink-0">
                      <Calendar size={12} className="text-slate-400" />
                      {adv.date}
                    </span>
                    <span className="font-medium text-slate-800 truncate">
                      {adv.note || `Tạm ứng lần ${idx + 1}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-bold font-mono text-sky-800">
                      +{formatVND(adv.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteAdvance(adv.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                      title="Xóa khoản tạm ứng này"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-3 text-xs text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
              Chưa có khoản tạm ứng nào được ghi nhận cho hồ sơ này.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
