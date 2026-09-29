import React, { useState } from 'react';
import {
  Download,
  ShieldCheck,
  Clock,
  HelpCircle,
  X,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Cloud,
  RefreshCw,
  AlertCircle,
  LogOut,
} from 'lucide-react';
import { GoogleDriveUser, DriveErrorCode } from '../utils/googleDrive';
import { GoogleSignInButton } from './DriveSyncModal';

interface AutoBackupBarProps {
  autoBackupEnabled: boolean;
  onToggleAutoBackup: (enabled: boolean) => void;
  lastBackupTime: string | null;
  lastBackupFileName: string | null;
  pendingCountdown: number | null;
  onDownloadBackupNow: () => void;
  // Google Drive Sync props
  driveUser: GoogleDriveUser | null;
  hasActiveToken: boolean;
  needsReauth: boolean;
  autoDriveSyncEnabled: boolean;
  onToggleAutoDriveSync: (enabled: boolean) => void;
  driveSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastDriveSyncTime: string | null;
  driveError: { message: string; code: DriveErrorCode; firebaseErrorCode?: string } | null;
  onGoogleLogin: () => void;
  onGoogleLogout: () => void;
  onOpenDriveSyncModal: () => void;
  onQuickSyncDriveNow: () => void;
}

export const AutoBackupBar: React.FC<AutoBackupBarProps> = ({
  autoBackupEnabled,
  onToggleAutoBackup,
  lastBackupTime,
  lastBackupFileName,
  pendingCountdown,
  onDownloadBackupNow,
  driveUser,
  hasActiveToken,
  needsReauth,
  autoDriveSyncEnabled,
  onToggleAutoDriveSync,
  driveSyncStatus,
  lastDriveSyncTime,
  driveError,
  onGoogleLogin,
  onGoogleLogout,
  onOpenDriveSyncModal,
  onQuickSyncDriveNow,
}) => {
  const [showBrowserGuide, setShowBrowserGuide] = useState(false);

  const isDriveConnected = Boolean(driveUser && hasActiveToken);

  return (
    <div className="bg-white rounded-2xl px-3.5 sm:px-4 py-3 border border-slate-200/90 shadow-2xs mb-4 space-y-2.5 text-xs">
      {/* Row 1: Google Drive Cloud Sync Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Cloud size={16} className={isDriveConnected ? 'text-sky-600' : 'text-slate-400'} />
            <span>Đồng bộ Google Drive:</span>
          </div>

          {!isDriveConnected ? (
            <div className="flex flex-wrap items-center gap-2">
              <GoogleSignInButton
                onClick={onGoogleLogin}
                label={needsReauth ? 'Đăng nhập lại Google' : 'Đăng nhập Google'}
              />
              {needsReauth ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                  <AlertCircle size={12} className="text-amber-600 shrink-0" />
                  <span>Phiên đăng nhập hết hạn — bấm đăng nhập lại (dữ liệu trên máy vẫn an toàn)</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 hidden lg:inline">
                  Đăng nhập để tự động sao lưu &amp; đồng bộ giữa nhiều máy (không bắt buộc)
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle Auto Drive Sync */}
              <button
                type="button"
                onClick={() => onToggleAutoDriveSync(!autoDriveSyncEnabled)}
                className={`flex items-center gap-1.5 font-semibold px-2.5 py-1 rounded-xl border transition-colors cursor-pointer ${
                  autoDriveSyncEnabled
                    ? 'bg-sky-50 text-sky-900 border-sky-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
                title="Bật/Tắt tự động cập nhật file CongTacPhi_backup.json lên Google Drive sau 25 giây khi có thay đổi"
              >
                {autoDriveSyncEnabled ? (
                  <ToggleRight size={17} className="text-sky-700" />
                ) : (
                  <ToggleLeft size={17} className="text-slate-400" />
                )}
                <span>Tự động lưu Drive: {autoDriveSyncEnabled ? 'BẬT' : 'TẮT'}</span>
              </button>

              {/* Sync Status Badge */}
              {driveSyncStatus === 'syncing' && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200">
                  <RefreshCw size={12} className="text-sky-600 animate-spin shrink-0" />
                  <span>Đang đồng bộ...</span>
                </span>
              )}

              {driveSyncStatus !== 'syncing' && lastDriveSyncTime && !driveError && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50/90 px-2.5 py-1 rounded-lg border border-emerald-200">
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                  <span>Đã đồng bộ lúc {lastDriveSyncTime}</span>
                </span>
              )}

              {/* Connected Account Pill */}
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                <span className="truncate max-w-[160px] font-medium">
                  {driveUser?.email || driveUser?.displayName || 'Đã kết nối Google'}
                </span>
                <button
                  type="button"
                  onClick={onGoogleLogout}
                  title="Đăng xuất Google Drive"
                  className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  <LogOut size={12} />
                </button>
              </span>
            </div>
          )}
        </div>

        {/* Right: Sync Now Actions when connected */}
        {isDriveConnected && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={driveSyncStatus === 'syncing'}
              onClick={onQuickSyncDriveNow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
              title="Tải ngay dữ liệu hiện tại lên file CongTacPhi_backup.json trên Google Drive"
            >
              <RefreshCw
                size={13}
                className={driveSyncStatus === 'syncing' ? 'animate-spin' : ''}
              />
              <span>Đồng bộ ngay</span>
            </button>

            <button
              type="button"
              disabled={driveSyncStatus === 'syncing'}
              onClick={onOpenDriveSyncModal}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200 text-xs font-semibold transition-colors cursor-pointer"
              title="Mở tùy chọn tải lên hoặc tải về từ Google Drive"
            >
              <span>Tải lên / Tải về</span>
            </button>
          </div>
        )}
      </div>

      {/* Error Banner for Google Drive if any error occurred */}
      {driveError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-start gap-2 flex-1 min-w-[240px]">
            <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              {driveError.firebaseErrorCode && (
                <span className="inline-block px-1.5 py-0.5 rounded bg-rose-200/80 text-rose-950 font-mono font-bold text-[10px]">
                  Mã lỗi Firebase: {driveError.firebaseErrorCode}
                </span>
              )}
              <div className="font-medium leading-relaxed">{driveError.message}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {driveError.code === 'TOKEN_EXPIRED' ||
            driveError.code === 'PERMISSION_DENIED' ||
            driveError.code === 'FIREBASE_AUTH_ERROR' ? (
              <button
                type="button"
                onClick={onGoogleLogin}
                className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer"
              >
                Đăng nhập lại ngay
              </button>
            ) : (
              <button
                type="button"
                onClick={onQuickSyncDriveNow}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 font-semibold cursor-pointer"
              >
                Thử đồng bộ lại
              </button>
            )}
          </div>
        </div>
      )}

      {/* Row 2: Local JSON Auto-Backup Toggle & Immediate Download */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onToggleAutoBackup(!autoBackupEnabled)}
            className={`flex items-center gap-1.5 font-semibold px-2.5 py-1 rounded-xl border transition-colors cursor-pointer ${
              autoBackupEnabled
                ? 'bg-teal-50 text-teal-900 border-teal-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
            title="Bật/Tắt tự động tải file sao lưu JSON xuống thiết bị (có thể tắt riêng khi đã dùng Google Drive)"
          >
            {autoBackupEnabled ? (
              <ToggleRight size={17} className="text-teal-700" />
            ) : (
              <ToggleLeft size={17} className="text-slate-400" />
            )}
            <span>Tự tải file về máy: {autoBackupEnabled ? 'BẬT' : 'TẮT'}</span>
          </button>

          {pendingCountdown !== null && pendingCountdown > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 animate-pulse">
              <Clock size={12} className="text-amber-600" />
              <span>
                {isDriveConnected && autoDriveSyncEnabled
                  ? autoBackupEnabled
                    ? `Tự động đồng bộ Drive & tải file sau ${pendingCountdown}s...`
                    : `Tự động đồng bộ lên Drive sau ${pendingCountdown}s...`
                  : `Tự động tải file sao lưu sau ${pendingCountdown}s...`}
              </span>
            </span>
          )}

          {lastBackupTime && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-800 bg-teal-50/80 px-2.5 py-1 rounded-lg border border-teal-200"
              title={lastBackupFileName || 'File sao lưu tải xuống máy gần nhất'}
            >
              <CheckCircle2 size={12} className="text-teal-600 shrink-0" />
              <span>Đã tải về máy lúc {lastBackupTime}</span>
            </span>
          )}
        </div>

        {/* Right: Guide & Immediate Local Download Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBrowserGuide(!showBrowserGuide)}
            className="text-[11px] font-medium text-slate-500 hover:text-teal-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Hướng dẫn nếu trình duyệt chặn tải tự động nhiều file"
          >
            <HelpCircle size={13} className="text-teal-700" />
            <span className="hidden sm:inline">Bị chặn tải tự động?</span>
          </button>

          <button
            type="button"
            onClick={onDownloadBackupNow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <Download size={13} />
            <span>Tải sao lưu ngay</span>
          </button>
        </div>
      </div>

      {/* Inline Browser Multi-file Download Permission Guide */}
      {showBrowserGuide && (
        <div className="w-full mt-2 p-3 bg-sky-50/90 border border-sky-200 rounded-xl text-[11px] text-sky-950 flex items-start justify-between gap-2">
          <div className="space-y-1 leading-relaxed">
            <div className="font-bold flex items-center gap-1.5 text-sky-900">
              <ShieldCheck size={14} className="text-sky-700 shrink-0" />
              <span>Hướng dẫn về tự động sao lưu Drive &amp; tải file xuống máy:</span>
            </div>
            <p className="text-sky-800">
              • Khi đã <strong>Đăng nhập Google Drive</strong>, ứng dụng sẽ ưu tiên tự động cập nhật trực tiếp vào file <strong>CongTacPhi_backup.json</strong> trên Google Drive của bạn sau 25 giây. Bạn có thể tắt nút <strong>"Tự tải file về máy"</strong> để trình duyệt không tải thêm file xuống thư mục Downloads.
            </p>
            <p className="text-sky-800">
              • Nếu bạn bật <strong>"Tự tải file về máy"</strong> và trình duyệt hỏi <strong>"Cho phép tải xuống nhiều tệp?"</strong>, hãy bấm <strong>"Cho phép" (Allow)</strong> trên thanh địa chỉ.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowBrowserGuide(false)}
            className="p-1 text-sky-600 hover:text-sky-900 rounded-lg"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
