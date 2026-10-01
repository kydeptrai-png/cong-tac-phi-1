import React, { useState } from 'react';
import {
  X,
  Cloud,
  CloudDownload,
  CloudUpload,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  HardDrive,
  Clock,
  FileJson,
} from 'lucide-react';
import { DriveBackupMetadata, DRIVE_BACKUP_FILENAME } from '../utils/googleDrive';

interface GoogleSignInButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  label?: string;
  className?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onClick,
  disabled = false,
  isLoading = false,
  label = 'Đăng nhập Google',
  className = '',
}) => {
  const isDisabled = disabled || isLoading;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`gsi-material-button ${isDisabled ? 'opacity-70 cursor-not-allowed' : ''} ${className}`}
    >
      <div className="gsi-material-button-state"></div>
      <div className="gsi-material-button-content-wrapper">
        <div className="gsi-material-button-icon flex items-center justify-center">
          {isLoading ? (
            <RefreshCw size={16} className="animate-spin text-sky-600" />
          ) : (
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="block w-full h-full"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              ></path>
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              ></path>
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              ></path>
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              ></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
          )}
        </div>
        <span className="gsi-material-button-contents">
          {isLoading ? 'Đang đăng nhập...' : label}
        </span>
        <span className="hidden">{isLoading ? 'Đang đăng nhập...' : label}</span>
      </div>
    </button>
  );
};

interface DriveSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'newer_on_drive' | 'manual_sync';
  driveMeta: DriveBackupMetadata | null;
  localExpensesCount: number;
  localImagesCount: number;
  lastSyncTime: string | null;
  isSyncing: boolean;
  onConfirmDownloadFromDrive: (restoreMode: 'replace' | 'merge') => Promise<void>;
  onConfirmUploadToDrive: () => Promise<void>;
}

export const DriveSyncModal: React.FC<DriveSyncModalProps> = ({
  isOpen,
  onClose,
  mode,
  driveMeta,
  localExpensesCount,
  localImagesCount,
  lastSyncTime,
  isSyncing,
  onConfirmDownloadFromDrive,
  onConfirmUploadToDrive,
}) => {
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [confirmUploadStep, setConfirmUploadStep] = useState(false);

  if (!isOpen) return null;

  const formattedDriveTime = driveMeta?.modifiedTime
    ? new Date(driveMeta.modifiedTime).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) +
      ' ' +
      new Date(driveMeta.modifiedTime).toLocaleDateString('vi-VN')
    : 'Chưa xác định';

  const formattedDriveSize = driveMeta?.size
    ? driveMeta.size >= 1024 * 1024
      ? `${(driveMeta.size / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.max(1, Math.round(driveMeta.size / 1024))} KB`
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between ${
            mode === 'newer_on_drive'
              ? 'bg-amber-50/90 border-amber-200'
              : 'bg-teal-50/80 border-teal-100'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                mode === 'newer_on_drive'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-teal-100 text-teal-800'
              }`}
            >
              {mode === 'newer_on_drive' ? <CloudDownload size={20} /> : <Cloud size={20} />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                {mode === 'newer_on_drive'
                  ? 'Có bản mới hơn trên Drive, muốn tải về không?'
                  : 'Đồng Bộ Ngay Với Google Drive'}
              </h3>
              <p className="text-xs text-slate-600">
                File đồng bộ cố định: <span className="font-mono font-semibold">{DRIVE_BACKUP_FILENAME}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSyncing}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
          {mode === 'newer_on_drive' && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 flex items-start gap-2.5">
              <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <p className="font-bold">
                  Phát hiện bản sao lưu mới hơn trên Google Drive!
                </p>
                <p className="text-amber-900">
                  File <strong>{DRIVE_BACKUP_FILENAME}</strong> trên Google Drive được cập nhật lúc{' '}
                  <strong>{formattedDriveTime}</strong> (mới hơn dữ liệu hiện tại trên máy này). Bạn có muốn tải dữ liệu từ Drive về máy không?
                </p>
              </div>
            </div>
          )}

          {/* Comparison Cards: Drive vs Local */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Drive File Info */}
            <div className="p-3.5 rounded-2xl border border-sky-200 bg-sky-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-950 flex items-center gap-1.5">
                  <Cloud size={15} className="text-sky-700" />
                  <span>Bản trên Google Drive</span>
                </span>
                {driveMeta ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                    Đã có file
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    Chưa có file
                  </span>
                )}
              </div>

              {driveMeta ? (
                <div className="space-y-1 text-[11px] text-sky-900">
                  <div className="flex items-center gap-1.5">
                    <FileJson size={12} className="text-sky-700 shrink-0" />
                    <span className="font-mono truncate">{driveMeta.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className="text-sky-700 shrink-0" />
                    <span>Sửa đổi: <strong>{formattedDriveTime}</strong></span>
                  </div>
                  {formattedDriveSize && (
                    <div>Dung lượng: <strong className="font-mono">{formattedDriveSize}</strong></div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Chưa có file <span className="font-mono">{DRIVE_BACKUP_FILENAME}</span> trên Google Drive. Bấm "Tải lên Drive" bên dưới để khởi tạo bản sao lưu đầu tiên.
                </p>
              )}
            </div>

            {/* Local Device Info */}
            <div className="p-3.5 rounded-2xl border border-teal-200 bg-teal-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-teal-950 flex items-center gap-1.5">
                  <HardDrive size={15} className="text-teal-700" />
                  <span>Dữ liệu trên máy này</span>
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-200">
                  IndexedDB
                </span>
              </div>
              <div className="space-y-1 text-[11px] text-teal-900">
                <div>
                  Số khoản chi hiện có: <strong>{localExpensesCount} khoản</strong>
                </div>
                <div>
                  Ảnh chứng từ đính kèm: <strong>{localImagesCount} ảnh</strong>
                </div>
                <div>
                  Đồng bộ gần nhất:{' '}
                  <strong>{lastSyncTime || 'Chưa đồng bộ lần nào'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Section 1: Download from Drive to Device */}
          {driveMeta && (
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-3">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <CloudDownload size={16} className="text-teal-700" />
                <span>Tùy chọn 1: Tải dữ liệu từ Google Drive về máy này</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRestoreMode('replace')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    restoreMode === 'replace'
                      ? 'bg-white border-teal-600 ring-2 ring-teal-500/20 text-teal-950'
                      : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                  }`}
                >
                  <div className="font-bold text-xs flex items-center justify-between">
                    <span>Thay thế dữ liệu trên máy</span>
                    {restoreMode === 'replace' && <CheckCircle2 size={14} className="text-teal-600" />}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Đồng bộ nguyên trạng từ Drive về máy (khuyên dùng khi đổi máy)
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRestoreMode('merge')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    restoreMode === 'merge'
                      ? 'bg-white border-teal-600 ring-2 ring-teal-500/20 text-teal-950'
                      : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                  }`}
                >
                  <div className="font-bold text-xs flex items-center justify-between">
                    <span>Gộp thêm với máy này</span>
                    {restoreMode === 'merge' && <CheckCircle2 size={14} className="text-teal-600" />}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Giữ các khoản trên máy và gộp thêm khoản từ Drive
                  </p>
                </button>
              </div>

              <button
                type="button"
                disabled={isSyncing}
                onClick={() => onConfirmDownloadFromDrive(restoreMode)}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isSyncing ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <CloudDownload size={16} />
                )}
                <span>
                  {restoreMode === 'replace'
                    ? 'Xác nhận tải từ Drive về & Thay thế dữ liệu trên máy'
                    : 'Xác nhận tải từ Drive về & Gộp thêm vào máy'}
                </span>
              </button>
            </div>
          )}

          {/* Section 2: Upload from Device to Drive */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2.5">
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <CloudUpload size={16} className="text-sky-700" />
              <span>
                {driveMeta
                  ? 'Tùy chọn 2: Tải dữ liệu từ máy này lên Google Drive (Cập nhật file trên Drive)'
                  : 'Tải dữ liệu từ máy này lên Google Drive'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Đóng gói toàn bộ {localExpensesCount} khoản chi, {localImagesCount} ảnh chứng từ, tạm ứng và các hồ sơ trên máy này để cập nhật vào file{' '}
              <span className="font-mono font-semibold">{DRIVE_BACKUP_FILENAME}</span> trên Google Drive.
            </p>

            {mode === 'newer_on_drive' && !confirmUploadStep ? (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => setConfirmUploadStep(true)}
                className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <CloudUpload size={14} />
                <span>Không tải về — Dùng dữ liệu máy này ghi đè lên Drive</span>
              </button>
            ) : (
              <div className="space-y-2">
                {mode === 'newer_on_drive' && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-[11px]">
                    Bạn có chắc chắn muốn ghi đè dữ liệu từ máy này ({localExpensesCount} khoản) lên file <strong>{DRIVE_BACKUP_FILENAME}</strong> trên Google Drive không?
                  </div>
                )}
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={onConfirmUploadToDrive}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-sky-700 hover:bg-sky-800 active:bg-sky-900 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSyncing ? (
                    <RefreshCw size={15} className="animate-spin" />
                  ) : (
                    <CloudUpload size={16} />
                  )}
                  <span>
                    Xác nhận cập nhật "{DRIVE_BACKUP_FILENAME}" lên Google Drive ngay
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSyncing}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            Để sau / Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
