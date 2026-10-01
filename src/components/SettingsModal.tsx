import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  HardDrive,
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
  Cpu,
  Smartphone,
  Info,
  Cloud,
  LogOut,
  CloudUpload,
  Printer,
  Globe,
  Terminal,
} from 'lucide-react';
import { getUserApiKey, setUserApiKey, testGeminiApiKey } from '../utils/gemini';
import { requestPersistentStorage } from '../utils/db';
import { saveOrDownloadFile, isNativeAppOrWebView } from '../utils/fileSaver';
import {
  GoogleDriveUser,
  DriveErrorCode,
  DRIVE_BACKUP_FILENAME,
  getUserGoogleClientId,
  setUserGoogleClientId,
  getDefaultGoogleClientId,
  getSavedDriveFileId,
  detectStandaloneEnvironment,
  StandaloneEnvironmentInfo,
  AuthFlowPreference,
  getPreferredAuthFlowMode,
  setPreferredAuthFlowMode,
  getEffectiveAuthDomain,
  getUserCustomAuthDomain,
  setUserCustomAuthDomain,
  DEFAULT_FIREBASE_AUTH_DOMAIN,
  getLastAuthDiagnosticLog,
  AuthDiagnosticLog,
} from '../utils/googleDrive';
import { GoogleSignInButton } from './DriveSyncModal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoBackupEnabled: boolean;
  onToggleAutoBackup: (enabled: boolean) => void;
  onManualBackup: () => void;
  // PDF Export in Settings Menu (Requirement 2 of Toolbar)
  onExportPDF?: () => void;
  onOpenPDFExportModal?: () => void;
  // Google Drive Props
  driveUser: GoogleDriveUser | null;
  hasActiveToken: boolean;
  needsReauth: boolean;
  isSigningIn?: boolean;
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

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  autoBackupEnabled,
  onToggleAutoBackup,
  onManualBackup,
  onExportPDF,
  onOpenPDFExportModal,
  driveUser,
  hasActiveToken,
  needsReauth,
  isSigningIn = false,
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
  // Gemini API Key state
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [keyTestStatus, setKeyTestStatus] = useState<{
    type: 'success' | 'error' | 'idle';
    message: string;
  }>({ type: 'idle', message: '' });

  // Google Client ID state
  const [googleClientId, setGoogleClientId] = useState('');
  const [clientIdStatus, setClientIdStatus] = useState<{
    type: 'success' | 'idle';
    message: string;
  }>({ type: 'idle', message: '' });

  // Firebase Auth Flow & AuthDomain state (Requirements 1, 2, 3, 4)
  const [authFlowPref, setAuthFlowPref] = useState<AuthFlowPreference>('auto');
  const [customAuthDomain, setCustomAuthDomain] = useState('');
  const [authDomainSavedMsg, setAuthDomainSavedMsg] = useState<string | null>(null);
  const [standaloneEnv, setStandaloneEnv] = useState<StandaloneEnvironmentInfo>(() =>
    detectStandaloneEnvironment()
  );
  const [diagLog, setDiagLog] = useState<AuthDiagnosticLog | null>(() =>
    getLastAuthDiagnosticLog()
  );
  const [showDiagDetails, setShowDiagDetails] = useState(false);

  // Storage Persistence state
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const [storageInfo, setStorageInfo] = useState<{
    usageMB: string;
    quotaMB: string;
  } | null>(null);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);

  // Network & Environment state
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isNativeWrapper, setIsNativeWrapper] = useState(false);

  // Test File Saving
  const [testFileStatus, setTestFileStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const currentKey = getUserApiKey();
      setApiKey(currentKey);
      setKeyTestStatus({ type: 'idle', message: '' });

      const currentClientId = getUserGoogleClientId();
      setGoogleClientId(currentClientId);
      setClientIdStatus({ type: 'idle', message: '' });

      setAuthFlowPref(getPreferredAuthFlowMode());
      setCustomAuthDomain(getUserCustomAuthDomain());
      setAuthDomainSavedMsg(null);
      setStandaloneEnv(detectStandaloneEnvironment());
      setDiagLog(getLastAuthDiagnosticLog());

      checkPersistenceStatus();
      setIsNativeWrapper(isNativeAppOrWebView());
    }
  }, [isOpen, driveError]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const checkPersistenceStatus = async () => {
    setIsCheckingStorage(true);
    try {
      const res = await requestPersistentStorage();
      setIsPersisted(res.persisted);
      if (res.usage !== undefined && res.quota !== undefined) {
        setStorageInfo({
          usageMB: (res.usage / (1024 * 1024)).toFixed(1),
          quotaMB: (res.quota / (1024 * 1024 * 1024)).toFixed(1) + ' GB',
        });
      }
    } catch (err) {
      console.warn('Storage check error:', err);
    } finally {
      setIsCheckingStorage(false);
    }
  };

  const handleSaveGoogleClientId = () => {
    const trimmed = googleClientId.trim();
    setUserGoogleClientId(trimmed);
    setClientIdStatus({
      type: 'success',
      message: trimmed
        ? 'Đã lưu Google Client ID cá nhân vào bộ nhớ máy này. Khi bấm "Đăng nhập Google", ứng dụng sẽ dùng Google Identity Services với Client ID này.'
        : 'Đã xóa Client ID cá nhân (sẽ dùng cấu hình Firebase / Google OAuth mặc định của ứng dụng).',
    });
  };

  const handleClearGoogleClientId = () => {
    setGoogleClientId('');
    setUserGoogleClientId('');
    setClientIdStatus({
      type: 'success',
      message: 'Đã xóa Google Client ID cá nhân khỏi thiết bị.',
    });
  };

  const handleChangeAuthFlowPref = (nextMode: AuthFlowPreference) => {
    setAuthFlowPref(nextMode);
    setPreferredAuthFlowMode(nextMode);
  };

  const handleSaveCustomAuthDomain = () => {
    setUserCustomAuthDomain(customAuthDomain);
    const effective = getEffectiveAuthDomain();
    setAuthDomainSavedMsg(
      `Đã lưu cấu hình authDomain: "${effective}". Tải lại ứng dụng nếu bạn vừa thay đổi tên miền xác thực.`
    );
  };

  const handleSaveApiKey = () => {
    setUserApiKey(apiKey.trim());
    setKeyTestStatus({
      type: 'success',
      message: apiKey.trim()
        ? 'Đã lưu khóa API thành công vào bộ nhớ máy này.'
        : 'Đã xóa khóa API. Ứng dụng sẽ sử dụng chế độ nhập thủ công.',
    });
  };

  const handleClearApiKey = () => {
    setApiKey('');
    setUserApiKey('');
    setKeyTestStatus({
      type: 'idle',
      message: 'Đã xóa khóa API khỏi thiết bị.',
    });
  };

  const handleTestApiKey = async () => {
    const keyToTest = apiKey.trim() || getUserApiKey();
    if (!keyToTest) {
      setKeyTestStatus({
        type: 'error',
        message: 'Vui lòng dán khóa API trước khi kiểm tra.',
      });
      return;
    }

    if (!isOnline) {
      setKeyTestStatus({
        type: 'error',
        message: 'Thiết bị đang ngoại tuyến. Vui lòng kết nối mạng để kiểm tra khóa API.',
      });
      return;
    }

    setIsTestingKey(true);
    setKeyTestStatus({ type: 'idle', message: '' });

    try {
      const result = await testGeminiApiKey(keyToTest);
      if (result.success) {
        setUserApiKey(keyToTest);
        setKeyTestStatus({
          type: 'success',
          message: 'Kết nối thành công! Khóa API Gemini hoạt động tốt.',
        });
      } else {
        setKeyTestStatus({
          type: 'error',
          message: result.message || 'Khóa API không hợp lệ hoặc bị từ chối kết nối.',
        });
      }
    } catch (err: any) {
      setKeyTestStatus({
        type: 'error',
        message: err?.message || 'Lỗi kết nối khi gửi yêu cầu kiểm tra.',
      });
    } finally {
      setIsTestingKey(false);
    }
  };

  const handleRequestStoragePersist = async () => {
    setIsCheckingStorage(true);
    try {
      if (navigator.storage && navigator.storage.persist) {
        const persisted = await navigator.storage.persist();
        setIsPersisted(persisted);
        await checkPersistenceStatus();
      }
    } catch (err) {
      console.warn(err);
    } finally {
      setIsCheckingStorage(false);
    }
  };

  const handleTestFileSave = async () => {
    setTestFileStatus('Đang tạo và lưu file thử nghiệm...');
    try {
      const dummyBlob = new Blob(
        [
          'Kiểm tra tính năng lưu file trên thiết bị Android / PWA / WebView thành công!\nThời gian: ' +
            new Date().toLocaleString('vi-VN'),
        ],
        { type: 'text/plain;charset=utf-8' }
      );
      const res = await saveOrDownloadFile({
        blob: dummyBlob,
        fileName: 'Kiem_Tra_Luu_File.txt',
        mimeType: 'text/plain',
        title: 'Kiểm tra lưu file',
        text: 'File kiểm tra chức năng lưu trên thiết bị',
      });

      if (res.success) {
        setTestFileStatus(
          `Thành công! Phương thức: ${res.method}${res.pathOrUri ? ` (${res.pathOrUri})` : ''}`
        );
      } else {
        setTestFileStatus(`Không thành công: ${res.error || 'Lỗi không xác định'}`);
      }
    } catch (err: any) {
      setTestFileStatus(`Lỗi: ${err?.message}`);
    }
  };

  if (!isOpen) return null;

  const isDriveConnected = Boolean(driveUser && hasActiveToken);
  const savedFileId = getSavedDriveFileId();
  const hasBuiltInClientId = Boolean(getDefaultGoogleClientId());
  const effectiveAuthDomain = getEffectiveAuthDomain();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center">
              <Cpu size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Cài Đặt, Xuất PDF &amp; Đồng Bộ Google Drive
              </h3>
              <p className="text-xs text-slate-500">
                Đồng bộ Drive (TWA/APK Redirect), xuất PDF, khóa Gemini API &amp; lưu trữ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cài đặt"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 active:bg-slate-300 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-5 text-slate-800">
          {/* SECTION: QUICK PDF EXPORT IN SETTINGS MENU (Toolbar Requirement 2) */}
          {(onOpenPDFExportModal || onExportPDF) && (
            <div className="rounded-2xl border border-teal-200 p-4 bg-teal-50/40 shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Printer size={18} className="text-teal-700" />
                  <h4 className="text-sm font-bold text-slate-900">
                    Xuất Báo Cáo PDF Đính Kèm Ảnh Chứng Từ
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-teal-800 bg-teal-100/80 px-2.5 py-0.5 rounded-full border border-teal-200">
                  A4 / Kèm ảnh
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tạo file báo cáo công tác phí định dạng PDF chuẩn tiếng Việt, tự động dàn trang bảng tổng hợp chi tiêu theo tháng và phụ lục ảnh hóa đơn chứng từ.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {onOpenPDFExportModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPDFExportModal();
                    }}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Printer size={15} />
                    <span>Tùy chỉnh &amp; Xuất file PDF</span>
                  </button>
                )}
                {onExportPDF && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onExportPDF();
                    }}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white hover:bg-teal-50 text-teal-900 border border-teal-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download size={14} className="text-teal-700" />
                    <span>In / Xuất PDF nhanh</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SECTION 0: GOOGLE DRIVE SYNC & ANDROID TWA / CAPACITOR AUTH */}
          <div className="rounded-2xl border border-sky-200 p-4 bg-sky-50/30 shadow-2xs space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cloud size={18} className="text-sky-700" />
                <h4 className="text-sm font-bold text-slate-900">
                  Đồng Bộ &amp; Sao Lưu Tự Động Google Drive
                </h4>
              </div>
              {isDriveConnected ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Đã đăng nhập
                </span>
              ) : needsReauth ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                  <AlertCircle size={12} className="text-amber-600" />
                  Cần đăng nhập lại
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                  Chưa đăng nhập
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Đóng gói toàn bộ dữ liệu (khoản chi, ảnh chứng từ nén, tạm ứng, các hồ sơ) thành 1 file cố định{' '}
              <span className="font-mono font-semibold text-slate-800">{DRIVE_BACKUP_FILENAME}</span> trên Google Drive (phạm vi quyền <span className="font-mono">drive.file</span>) và luôn cập nhật đúng file đó để đồng bộ giữa nhiều máy.
            </p>

            {/* Sign-in / Account & Sync Controls */}
            <div className="p-3.5 rounded-xl bg-white border border-sky-200/80 space-y-3">
              {!isDriveConnected ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-800">
                      {needsReauth
                        ? 'Phiên đăng nhập đã hết hạn — Vui lòng đăng nhập lại'
                        : 'Kết nối tài khoản Google Drive'}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {standaloneEnv.isStandalone
                        ? 'Đã phát hiện chế độ App đóng gói/TWA: tự động dùng signInWithRedirect an toàn.'
                        : 'Xin quyền drive.file (chỉ truy cập file sao lưu do ứng dụng tạo ra).'}
                    </p>
                  </div>
                  <GoogleSignInButton
                    onClick={onGoogleLogin}
                    disabled={isSigningIn}
                    isLoading={isSigningIn}
                    label={needsReauth ? 'Đăng nhập lại Google' : 'Đăng nhập Google'}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {driveUser?.displayName || 'Tài khoản Google Drive'}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {driveUser?.email || 'Đã cấp quyền drive.file'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onGoogleLogout}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <LogOut size={13} />
                      <span>Đăng xuất</span>
                    </button>
                  </div>

                  {/* Toggle Auto Upload to Drive */}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-800">
                        Tự động tải lên Google Drive khi dữ liệu thay đổi
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Gộp các thay đổi liên tiếp (debounce 25 giây) và cập nhật file{' '}
                        <span className="font-mono">{DRIVE_BACKUP_FILENAME}</span>
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer min-h-[36px]">
                      <input
                        type="checkbox"
                        checked={autoDriveSyncEnabled}
                        onChange={(e) => onToggleAutoDriveSync(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[6px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
                    </label>
                  </div>

                  {/* Status Info */}
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Trạng thái đồng bộ:</span>
                      {driveSyncStatus === 'syncing' ? (
                        <span className="font-bold text-sky-700 flex items-center gap-1">
                          <RefreshCw size={12} className="animate-spin" />
                          Đang đồng bộ...
                        </span>
                      ) : lastDriveSyncTime ? (
                        <span className="font-bold text-emerald-700">
                          Đã đồng bộ lúc {lastDriveSyncTime}
                        </span>
                      ) : (
                        <span className="text-slate-600">Chưa đồng bộ trong phiên này</span>
                      )}
                    </div>
                    {savedFileId && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">ID File cố định trên Drive:</span>
                        <span className="font-mono text-slate-700 truncate max-w-[200px]">
                          {savedFileId}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Manual Sync Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={driveSyncStatus === 'syncing'}
                      onClick={onQuickSyncDriveNow}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <CloudUpload size={14} />
                      <span>Đồng bộ lên Drive ngay</span>
                    </button>

                    <button
                      type="button"
                      disabled={driveSyncStatus === 'syncing'}
                      onClick={onOpenDriveSyncModal}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={14} className="text-sky-700" />
                      <span>Kiểm tra &amp; Tải từ Drive về máy</span>
                    </button>
                  </div>
                </div>
              )}

              {driveError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-1.5">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 font-medium leading-relaxed">{driveError.message}</div>
                  </div>
                  {driveError.firebaseErrorCode && (
                    <div className="pl-6 text-[11px] font-mono text-rose-700">
                      Mã lỗi Firebase: {driveError.firebaseErrorCode}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Requirement 1, 2, 3, 4: Android APK / TWA Auth Mode & authDomain Configuration */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Globe size={14} className="text-sky-700" />
                  <span>Chế độ đăng nhập &amp; Cấu hình authDomain (Android TWA / APK)</span>
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                    standaloneEnv.isStandalone
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {standaloneEnv.isStandalone ? 'Chế độ Standalone / APK' : 'Trình duyệt Web'}
                </span>
              </div>

              {/* Auth Flow Mode Selector */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Phương thức xác thực Firebase Google:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleChangeAuthFlowPref('auto')}
                    className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold border text-left transition-colors cursor-pointer ${
                      authFlowPref === 'auto'
                        ? 'bg-sky-50 border-sky-500 text-sky-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="font-bold">Tự động (Khuyên dùng)</div>
                    <div className="text-[10px] opacity-80">
                      APK/TWA dùng Redirect, Web dùng Popup
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChangeAuthFlowPref('redirect')}
                    className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold border text-left transition-colors cursor-pointer ${
                      authFlowPref === 'redirect'
                        ? 'bg-sky-50 border-sky-500 text-sky-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="font-bold">Luôn dùng Redirect</div>
                    <div className="text-[10px] opacity-80">
                      signInWithRedirect + getRedirectResult
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChangeAuthFlowPref('popup')}
                    className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold border text-left transition-colors cursor-pointer ${
                      authFlowPref === 'popup'
                        ? 'bg-sky-50 border-sky-500 text-sky-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="font-bold">Ưu tiên Popup</div>
                    <div className="text-[10px] opacity-80">
                      signInWithPopup (Tự chuyển Redirect nếu lỗi)
                    </div>
                  </button>
                </div>
              </div>

              {/* Requirement 4: Firebase authDomain Verification */}
              <div className="space-y-1.5 pt-1 border-t border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <label className="text-[11px] font-semibold text-slate-700">
                    Tên miền xác thực Firebase (<span className="font-mono">authDomain</span>):
                  </label>
                  <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Đang dùng: {effectiveAuthDomain}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customAuthDomain}
                    onChange={(e) => setCustomAuthDomain(e.target.value)}
                    placeholder={`Mặc định: ${DEFAULT_FIREBASE_AUTH_DOMAIN}`}
                    className="flex-1 min-h-[38px] px-3 text-xs font-mono rounded-xl border border-slate-300 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomAuthDomain}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    Lưu domain
                  </button>
                </div>
                {authDomainSavedMsg && (
                  <div className="text-[11px] text-emerald-700 font-medium">
                    {authDomainSavedMsg}
                  </div>
                )}
              </div>

              {/* Requirement 3: Diagnostic Log of getRedirectResult & Environment */}
              <div className="pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setDiagLog(getLastAuthDiagnosticLog());
                    setShowDiagDetails(!showDiagDetails);
                  }}
                  className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 flex items-center gap-1.5 cursor-pointer"
                >
                  <Terminal size={13} />
                  <span>
                    {showDiagDetails
                      ? 'Ẩn thông tin chẩn đoán getRedirectResult & TWA'
                      : 'Xem tham số trả về từ getRedirectResult & chẩn đoán TWA/APK'}
                  </span>
                </button>

                {showDiagDetails && (
                  <div className="mt-2 p-2.5 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono space-y-1.5 overflow-x-auto">
                    <div>
                      <span className="text-sky-400">Môi trường phát hiện:</span>{' '}
                      {standaloneEnv.modeLabel}
                    </div>
                    <div>
                      <span className="text-sky-400">Origin hiện tại:</span>{' '}
                      {typeof window !== 'undefined' ? window.location.origin : ''}
                    </div>
                    <div>
                      <span className="text-sky-400">Firebase authDomain:</span>{' '}
                      {effectiveAuthDomain}
                    </div>
                    <div>
                      <span className="text-sky-400">Chi tiết cờ Standalone:</span>{' '}
                      {JSON.stringify(standaloneEnv.details)}
                    </div>
                    {diagLog && (
                      <div className="pt-1 border-t border-slate-700 space-y-1">
                        <div className="text-emerald-400">
                          [Log getRedirectResult lúc {diagLog.timestamp} - luồng: {diagLog.flowUsed}]
                        </div>
                        {diagLog.errorCode && (
                          <div className="text-rose-400">
                            Mã lỗi Firebase: {diagLog.errorCode} — {diagLog.errorMessage}
                          </div>
                        )}
                        <pre className="text-[10px] text-slate-300 whitespace-pre-wrap break-all">
                          {JSON.stringify(diagLog.redirectResultParams, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Google Client ID Input (Optional GIS override) */}
            <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-800">
                  Google Client ID cá nhân (Tùy chọn - Google Identity Services):
                </label>
                {googleClientId.trim() ? (
                  <span className="text-[10px] font-semibold text-sky-800 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                    Đang dùng Client ID riêng
                  </span>
                ) : hasBuiltInClientId ? (
                  <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    Đang dùng Firebase OAuth mặc định
                  </span>
                ) : null}
              </div>

              <div className="relative flex items-center">
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="VD: 123456789-abcdef.apps.googleusercontent.com (Để trống nếu dùng mặc định)"
                  className="w-full min-h-[42px] pl-3 pr-10 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-slate-50/50"
                />
                {googleClientId && (
                  <button
                    type="button"
                    onClick={handleClearGoogleClientId}
                    className="absolute right-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center text-rose-500 hover:text-rose-700 rounded-lg cursor-pointer"
                    title="Xóa Google Client ID"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleSaveGoogleClientId}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Lưu Google Client ID vào máy
                </button>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-sky-700 hover:text-sky-900 flex items-center gap-1"
                >
                  <span>Tạo Client ID trên Google Cloud</span>
                  <ExternalLink size={12} />
                </a>
              </div>

              {clientIdStatus.message && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  <span>{clientIdStatus.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 1: Gemini API Key */}
          <div className="rounded-2xl border border-slate-200 p-4 bg-white shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key size={18} className="text-teal-700" />
                <h4 className="text-sm font-bold text-slate-900">
                  Khóa Gemini API Cá Nhân (Google AI)
                </h4>
              </div>
              {apiKey.trim() ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Đã cài đặt
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  <Info size={12} className="text-amber-600" />
                  Chưa có khóa
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Khóa API được lưu trực tiếp trên máy của bạn (localStorage), không nhúng sẵn trong file APK. Khi không có khóa hoặc khi mất mạng, ứng dụng vẫn hoạt động 100% đầy đủ với tính năng nhập thủ công, quản lý công tác phí, xuất Excel &amp; PDF.
            </p>

            {/* Input field */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Nhập hoặc dán Gemini API Key:
              </label>
              <div className="relative flex items-center">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full min-h-[44px] pl-3.5 pr-20 text-xs sm:text-sm font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50/50"
                />
                <div className="absolute right-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                    title={showKey ? 'Ẩn khóa' : 'Hiện khóa'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  {apiKey && (
                    <button
                      type="button"
                      onClick={handleClearApiKey}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center text-rose-500 hover:text-rose-700 rounded-lg cursor-pointer"
                      title="Xóa khóa"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Status message */}
            {keyTestStatus.message && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                  keyTestStatus.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border border-rose-200'
                }`}
              >
                {keyTestStatus.type === 'success' ? (
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{keyTestStatus.message}</span>
              </div>
            )}

            {/* Buttons: Test and Save */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTestApiKey}
                disabled={isTestingKey || !apiKey.trim()}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 active:bg-teal-200 text-teal-800 text-xs font-semibold flex items-center gap-1.5 border border-teal-200 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isTestingKey ? (
                  <RefreshCw size={14} className="animate-spin text-teal-700" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                <span>{isTestingKey ? 'Đang kiểm tra...' : 'Kiểm tra kết nối khóa'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveApiKey}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              >
                <span>Lưu khóa vào máy</span>
              </button>

              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] px-3 py-2 rounded-xl text-slate-600 hover:text-teal-800 hover:bg-slate-100 text-xs font-medium flex items-center gap-1 ml-auto transition-colors"
              >
                <span>Lấy khóa miễn phí</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>

          {/* SECTION 2: Auto-Download Local File */}
          <div className="rounded-2xl border border-slate-200 p-4 bg-white shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download size={18} className="text-teal-700" />
                <h4 className="text-sm font-bold text-slate-900">
                  Tự Động Tải File Sao Lưu Xuống Máy (JSON)
                </h4>
              </div>
              <label className="relative inline-flex items-center cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={autoBackupEnabled}
                  onChange={(e) => onToggleAutoBackup(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[12px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-700"></div>
              </label>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Tự động gom thay đổi (debounce 25 giây) để tải về file sao lưu JSON kèm ảnh chứng từ xuống máy. Khi đã bật đồng bộ Google Drive, bạn có thể tắt tính năng tự tải file xuống máy này nếu muốn.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onManualBackup}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={14} className="text-teal-700" />
                <span>Tải sao lưu xuống máy ngay</span>
              </button>

              <button
                type="button"
                onClick={handleTestFileSave}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Smartphone size={14} className="text-slate-600" />
                <span>Thử nghiệm lưu file trên máy</span>
              </button>
            </div>

            {testFileStatus && (
              <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-mono">
                {testFileStatus}
              </div>
            )}
          </div>

          {/* SECTION 3: Persistent Storage */}
          <div className="rounded-2xl border border-slate-200 p-4 bg-white shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive size={18} className="text-teal-700" />
                <h4 className="text-sm font-bold text-slate-900">
                  Lưu Trữ Bền Vững (IndexedDB + Storage Persist)
                </h4>
              </div>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  isPersisted
                    ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                    : 'text-amber-800 bg-amber-50 border-amber-200'
                }`}
              >
                <ShieldCheck size={12} className={isPersisted ? 'text-emerald-600' : 'text-amber-600'} />
                {isPersisted ? 'Đã bảo vệ' : 'Chưa bảo vệ'}
              </span>
            </div>

            {storageInfo && (
              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 block text-[11px]">Dung lượng đã dùng:</span>
                  <span className="font-semibold text-slate-800 font-mono">{storageInfo.usageMB} MB</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Hạn mức khả dụng:</span>
                  <span className="font-semibold text-slate-800 font-mono">~{storageInfo.quotaMB}</span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRequestStoragePersist}
                disabled={isCheckingStorage || isPersisted === true}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck size={15} className="text-teal-700" />
                <span>
                  {isPersisted ? 'Hệ thống đã bật chế độ bền vững' : 'Bật chế độ bền vững (Persist)'}
                </span>
              </button>

              <button
                type="button"
                onClick={checkPersistenceStatus}
                className="min-h-[40px] px-3 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={isCheckingStorage ? 'animate-spin' : ''} />
                <span>Kiểm tra lại</span>
              </button>
            </div>
          </div>

          {/* SECTION 4: Network & Native Environment Info */}
          <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/70 text-xs space-y-2">
            <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
              <Smartphone size={15} className="text-teal-700" />
              <span>Thông tin môi trường &amp; Trạng thái kết nối</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600">
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <Wifi size={14} className="text-emerald-600" />
                ) : (
                  <WifiOff size={14} className="text-rose-600" />
                )}
                <span>Kết nối mạng: {isOnline ? 'Đang trực tuyến' : 'Ngoại tuyến (Offline)'}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-teal-600" />
                <span>
                  Môi trường: {standaloneEnv.isStandalone || isNativeWrapper ? standaloneEnv.modeLabel : 'Trình duyệt Web'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
          >
            Hoàn tất &amp; Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
