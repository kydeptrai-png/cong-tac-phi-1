import React from 'react';
import {
  Download,
  Clock,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Cloud,
  CloudUpload,
  RefreshCw,
  AlertCircle,
  LogOut,
  Database,
} from 'lucide-react';
import { GoogleDriveUser, DriveErrorCode } from '../utils/googleDrive';
import { RealtimeSyncStatus } from '../utils/cloudSync';

interface AutoBackupBarProps {
  // Real-time Firestore Sync status
  realtimeSyncStatus?: RealtimeSyncStatus;
  // Local JSON Backup props (Bản sao lưu dự phòng)
  autoBackupEnabled: boolean;
  onToggleAutoBackup: (enabled: boolean) => void;
  lastBackupTime: string | null;
  lastBackupFileName: string | null;
  pendingCountdown: number | null;
  onDownloadBackupNow: () => void;

  // Google Auth & Drive Backup props
  driveUser: GoogleDriveUser | null;
  hasActiveToken: boolean;
  needsReauth: boolean;
  isSigningIn?: boolean;
  autoDriveSyncEnabled: boolean;
  onToggleAutoDriveSync: (enabled: boolean) => void;
  driveSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastDriveSyncTime: string | null;
  driveError: { message: string; code: DriveErrorCode } | null;
  onGoogleLogin: () => void;
  onGoogleLogout: () => void;
  onOpenDriveSyncModal: () => void;
  onQuickSyncDriveNow: () => void;
}

export const AutoBackupBar: React.FC<AutoBackupBarProps> = ({
  realtimeSyncStatus = 'unauthenticated',
  autoBackupEnabled,
  onToggleAutoBackup,
  lastBackupTime,
  pendingCountdown,
  onDownloadBackupNow,
  driveUser,
  hasActiveToken,
  needsReauth,
  isSigningIn = false,
  driveSyncStatus,
  driveError,
  onGoogleLogin,
  onGoogleLogout,
  onOpenDriveSyncModal,
  onQuickSyncDriveNow,
}) => {
  const isSignedIn = Boolean(driveUser?.uid);
  const isDriveConnected = Boolean(driveUser && hasActiveToken);
  const isOffline =
    realtimeSyncStatus === 'offline' ||
    (typeof navigator !== 'undefined' && !navigator.onLine);

  return (
    <div className="mb-3 space-y-1.5">
      <div
        className={`px-3 py-2 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 transition-colors ${
          isOffline
            ? 'bg-rose-50/90 border-rose-200 text-rose-950'
            : isSignedIn
            ? 'bg-emerald-50/70 border-emerald-200/90 text-slate-800'
            : needsReauth
            ? 'bg-amber-50/80 border-amber-200 text-amber-950'
            : 'bg-white border-slate-200/90 text-slate-700 shadow-2xs'
        }`}
      >
        {/* Left: Real-Time Firestore Multi-Device Sync Status */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {!isSignedIn ? (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={onGoogleLogin}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 disabled:cursor-not-allowed text-white shadow-2xs transition-colors cursor-pointer"
              title="Đăng nhập Google để bật đồng bộ thời gian thực (Firestore) giữa điện thoại và máy tính"
            >
              {isSigningIn ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Cloud size={13} />
              )}
              <span>
                {isSigningIn
                  ? 'Đang đăng nhập...'
                  : needsReauth
                  ? 'Đăng nhập lại Google'
                  : 'Đăng nhập Google (Đồng bộ Real-time)'}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Real-time status pill */}
              {isOffline ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-rose-100 text-rose-900 border border-rose-300 font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                  <span>Mất mạng - sẽ đồng bộ lại khi có mạng</span>
                </span>
              ) : realtimeSyncStatus === 'syncing' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  <span>Đang đồng bộ...</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300 font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>Đã đồng bộ (Firestore Real-time)</span>
                </span>
              )}

              <span className="text-[11px] text-slate-600 font-medium truncate max-w-[180px]">
                {driveUser?.email || driveUser?.displayName || 'Tài khoản Google'}
              </span>
            </div>
          )}

          {/* Secondary Status Text */}
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            {!isSignedIn && (
              <span className="text-slate-500">
                {lastBackupTime
                  ? `Lưu nội bộ • Sao lưu dự phòng JSON: ${lastBackupTime}`
                  : 'Đăng nhập Google để tự động đồng bộ tức thời giữa điện thoại & máy tính'}
              </span>
            )}
          </div>
        </div>

        {/* Right: Backup & Contingency Actions (Bản sao lưu dự phòng JSON / Drive) */}
        <div className="flex items-center gap-1.5 ml-auto">
          {isDriveConnected && (
            <>
              <button
                type="button"
                disabled={driveSyncStatus === 'syncing'}
                onClick={onQuickSyncDriveNow}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white hover:bg-sky-50 text-sky-900 border border-sky-200 flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                title="Lưu thêm bản sao lưu dự phòng JSON lên Google Drive"
              >
                <CloudUpload size={12} className="text-sky-700" />
                <span className="hidden sm:inline">Sao lưu Drive</span>
              </button>

              <button
                type="button"
                onClick={onOpenDriveSyncModal}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
                title="Quản lý bản sao lưu dự phòng trên Google Drive"
              >
                <RefreshCw size={12} className="text-sky-700" />
                <span className="hidden md:inline">Khôi phục Drive</span>
              </button>
            </>
          )}

          {isSignedIn && (
            <button
              type="button"
              onClick={onGoogleLogout}
              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              title="Đăng xuất tài khoản Google"
            >
              <LogOut size={13} />
            </button>
          )}

          <button
            type="button"
            onClick={onDownloadBackupNow}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white hover:bg-teal-50 text-slate-700 hover:text-teal-900 border border-slate-200 flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
            title="Tải file JSON bản sao lưu dự phòng xuống thiết bị để khôi phục khi cần"
          >
            <Database size={12} className="text-teal-700" />
            <span>Sao lưu dự phòng (.JSON)</span>
          </button>

          {!isSignedIn && (
            <button
              type="button"
              onClick={() => onToggleAutoBackup(!autoBackupEnabled)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg font-semibold text-[11px] transition-colors cursor-pointer ${
                autoBackupEnabled
                  ? 'bg-teal-100/80 text-teal-900 hover:bg-teal-200/70'
                  : 'bg-slate-200/70 text-slate-600 hover:bg-slate-300/70'
              }`}
              title="Bật/tắt tự động tải file JSON sao lưu dự phòng về máy"
            >
              {autoBackupEnabled ? (
                <>
                  <ToggleRight size={14} className="text-teal-700" />
                  <span className="hidden sm:inline">Tự tải JSON</span>
                </>
              ) : (
                <>
                  <ToggleLeft size={14} className="text-slate-500" />
                  <span className="hidden sm:inline">Tắt tự tải</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Inline error notice if Drive backup fails */}
      {driveError && (
        <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-rose-600 shrink-0" />
            <span>{driveError.message}</span>
          </div>
          {driveError.code === 'TOKEN_EXPIRED' && (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={onGoogleLogin}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors cursor-pointer"
            >
              {isSigningIn && <RefreshCw size={12} className="animate-spin" />}
              <span>{isSigningIn ? 'Đang đăng nhập...' : 'Đăng nhập lại ngay'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
