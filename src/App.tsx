import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus,
  Table as TableIcon,
  BarChart3,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  MessageSquareText,
  Settings,
} from 'lucide-react';
import {
  ExpenseItem,
  MonthGroup,
  AdvancePaymentItem,
  ExpenseProfile,
  ReceiptScanResult,
} from './types';
import {
  getAllExpenses,
  saveExpense,
  saveExpensesBulk,
  replaceAllExpenses,
  mergeExpensesWithExisting,
  deleteExpense,
  clearAllExpenses,
  isDBInitialized,
  markDBInitialized,
  getAllAdvances,
  saveAdvance,
  deleteAdvance,
  replaceAllAdvances,
  getAllProfiles,
  saveProfile,
  deleteProfile,
  replaceAllProfiles,
  DEFAULT_PROFILE,
  getDuplicateIdsSet,
  downloadBackupJSON,
  formatBackupFileNameWithTimestamp,
  requestPersistentStorage,
} from './utils/db';
import { INITIAL_SAMPLE_EXPENSES } from './utils/sampleData';
import { groupExpensesByMonth, parseMonthYearSortKey, parseDateSortKey } from './utils/excel';
import { exportExpensesToPDF } from './utils/pdfExport';
import { removeVietnameseAccents } from './utils/categories';
import { Header } from './components/Header';
import { TableView } from './components/TableView';
import { CardView } from './components/CardView';
import { DashboardView } from './components/DashboardView';
import { ExpenseModal } from './components/ExpenseModal';
import { ReceiptViewerModal } from './components/ReceiptViewerModal';
import { ImportExcelModal } from './components/ImportExcelModal';
import { ExportExcelModal } from './components/ExportExcelModal';
import { NaturalExpenseInput } from './components/NaturalExpenseInput';
import { AdvancePaymentPanel } from './components/AdvancePaymentPanel';
import { BulkMessageModal } from './components/BulkMessageModal';
import { AutoBackupBar } from './components/AutoBackupBar';
import { BatchOperationsBar } from './components/BatchOperationsBar';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { PDFExportModal } from './components/PDFExportModal';
import { SettingsModal } from './components/SettingsModal';
import { DriveSyncModal } from './components/DriveSyncModal';
import {
  GoogleDriveUser,
  DriveBackupMetadata,
  DriveErrorCode,
  DriveSyncError,
  DRIVE_BACKUP_FILENAME,
  initAuth,
  googleSignIn,
  logoutGoogleDrive,
  findDriveBackupFile,
  uploadBackupToDrive,
  downloadBackupFromDrive,
  isDriveBackupNewerThanLocal,
  getLastDriveSyncTime,
  getLastDriveSyncIso,
  getLocalLastModifiedIso,
  markLocalDataModified,
  saveDriveSyncTimestamp,
  getAutoDriveSyncEnabled,
  setAutoDriveSyncEnabled,
  saveAppUIContextSnapshot,
  loadAppUIContextSnapshot,
  clearAppUIContextSnapshot,
} from './utils/googleDrive';

const AUTO_BACKUP_STORAGE_KEY = 'so_chi_tieu_auto_backup_enabled';
const LAST_BACKUP_TIME_KEY = 'so_chi_tieu_last_backup_time';
const LAST_BACKUP_FILE_KEY = 'so_chi_tieu_last_backup_file';

export default function App() {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [advances, setAdvances] = useState<AdvancePaymentItem[]>([]);
  const [profiles, setProfiles] = useState<ExpenseProfile[]>([DEFAULT_PROFILE]);
  const [activeProfileId, setActiveProfileId] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Navigation & View Mode
  const [currentTab, setCurrentTab] = useState<'expenses' | 'dashboard'>('expenses');
  const [viewMode, setViewMode] = useState<'table' | 'card'>('card');

  // Requirement 8: Comprehensive Filters (keyword, month, date range, amount range, photo status)
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState<number | ''>('');
  const [maxAmount, setMaxAmount] = useState<number | ''>('');
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'has_receipt' | 'no_receipt'>('all');
  const [onlyMissingReceipts, setOnlyMissingReceipts] = useState<boolean>(false);

  // Requirement 8: Multi-selection for batch operations
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());

  // Modals state
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [defaultMonthForNew, setDefaultMonthForNew] = useState<string>('Tháng 4');

  const [isReceiptViewerOpen, setIsReceiptViewerOpen] = useState(false);
  const [activeReceiptExpense, setActiveReceiptExpense] = useState<ExpenseItem | null>(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isPDFExportModalOpen, setIsPDFExportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Auto-backup state (Requirement 9)
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_BACKUP_TIME_KEY);
    } catch {
      return null;
    }
  });
  const [lastBackupFileName, setLastBackupFileName] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_BACKUP_FILE_KEY);
    } catch {
      return null;
    }
  });
  const [pendingCountdown, setPendingCountdown] = useState<number | null>(null);

  // Google Drive Sync state
  const [driveUser, setDriveUser] = useState<GoogleDriveUser | null>(null);
  const [hasActiveToken, setHasActiveToken] = useState<boolean>(false);
  const [needsReauth, setNeedsReauth] = useState<boolean>(false);
  const [autoDriveSyncEnabled, setAutoDriveSyncEnabledState] = useState<boolean>(() =>
    getAutoDriveSyncEnabled()
  );
  const [driveSyncStatus, setDriveSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>(
    'idle'
  );
  const [lastDriveSyncTime, setLastDriveSyncTimeState] = useState<string | null>(() =>
    getLastDriveSyncTime()
  );
  const [driveError, setDriveError] = useState<{
    message: string;
    code: DriveErrorCode;
    firebaseErrorCode?: string;
  } | null>(null);
  const [driveSyncModalState, setDriveSyncModalState] = useState<{
    isOpen: boolean;
    mode: 'newer_on_drive' | 'manual_sync';
    driveMeta: DriveBackupMetadata | null;
  }>({
    isOpen: false,
    mode: 'manual_sync',
    driveMeta: null,
  });
  const pendingRetryAfterReauthRef = useRef<boolean>(false);

  // Refs for latest state during debounced auto-backup
  const latestDataRef = useRef<{
    expenses: ExpenseItem[];
    advances: AdvancePaymentItem[];
    profiles: ExpenseProfile[];
  }>({
    expenses: [],
    advances: [],
    profiles: [DEFAULT_PROFILE],
  });

  useEffect(() => {
    latestDataRef.current = { expenses, advances, profiles };
  }, [expenses, advances, profiles]);

  const backupTimerRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  // Notification Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Perform upload to Google Drive (updates fixed file CongTacPhi_backup.json)
  const performDriveUpload = useCallback(
    async (
      customExpenses?: ExpenseItem[],
      customAdvances?: AdvancePaymentItem[],
      customProfiles?: ExpenseProfile[],
      isAuto = false,
      explicitToken?: string
    ) => {
      const expToSave = customExpenses ?? latestDataRef.current.expenses;
      const advToSave = customAdvances ?? latestDataRef.current.advances;
      const profToSave = customProfiles ?? latestDataRef.current.profiles;

      setDriveSyncStatus('syncing');
      setDriveError(null);

      try {
        const res = await uploadBackupToDrive(expToSave, advToSave, profToSave, explicitToken);
        setLastDriveSyncTimeState(res.formattedSyncTime);
        setDriveSyncStatus('synced');
        setPendingCountdown(null);
        setNeedsReauth(false);
        pendingRetryAfterReauthRef.current = false;

        if (!isAuto) {
          showToast(
            `Đã đồng bộ lên Google Drive (${DRIVE_BACKUP_FILENAME}) lúc ${res.formattedSyncTime}!`
          );
        }
      } catch (err: any) {
        const syncErr: DriveSyncError =
          err instanceof DriveSyncError
            ? err
            : new DriveSyncError(err?.message || 'Lỗi đồng bộ Google Drive', 'UNKNOWN');

        setDriveSyncStatus('error');
        setDriveError({
          message: syncErr.message,
          code: syncErr.code,
          firebaseErrorCode: syncErr.firebaseErrorCode,
        });

        if (syncErr.code === 'TOKEN_EXPIRED') {
          setHasActiveToken(false);
          setNeedsReauth(true);
          pendingRetryAfterReauthRef.current = true;
        }
      }
    },
    []
  );

  // Trigger immediate backup download
  const performBackupDownload = useCallback(
    (
      customExpenses?: ExpenseItem[],
      customAdvances?: AdvancePaymentItem[],
      customProfiles?: ExpenseProfile[],
      isAuto = false
    ) => {
      const expToSave = customExpenses ?? latestDataRef.current.expenses;
      const advToSave = customAdvances ?? latestDataRef.current.advances;
      const profToSave = customProfiles ?? latestDataRef.current.profiles;

      const fileName = formatBackupFileNameWithTimestamp('Sao_Luu_So_Chi_Tieu');
      downloadBackupJSON(expToSave, fileName, advToSave, profToSave);

      const nowStr = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' ' + new Date().toLocaleDateString('vi-VN');

      setLastBackupTime(nowStr);
      setLastBackupFileName(fileName);
      setPendingCountdown(null);

      try {
        localStorage.setItem(LAST_BACKUP_TIME_KEY, nowStr);
        localStorage.setItem(LAST_BACKUP_FILE_KEY, fileName);
      } catch {
        // ignore storage error
      }

      if (!isAuto) {
        showToast(`Đã tải file sao lưu: ${fileName}`);
      }
    },
    []
  );

  // Schedule debounced auto-backup & Drive sync (Requirement 2: debounce 25s, prioritize Drive when signed in)
  const scheduleAutoBackup = useCallback(
    (
      nextExpenses?: ExpenseItem[],
      nextAdvances?: AdvancePaymentItem[],
      nextProfiles?: ExpenseProfile[]
    ) => {
      if (nextExpenses) latestDataRef.current.expenses = nextExpenses;
      if (nextAdvances) latestDataRef.current.advances = nextAdvances;
      if (nextProfiles) latestDataRef.current.profiles = nextProfiles;

      markLocalDataModified();

      const shouldSyncDrive = Boolean(driveUser && hasActiveToken && autoDriveSyncEnabled);
      const shouldDownloadLocal = autoBackupEnabled;

      if (!shouldSyncDrive && !shouldDownloadLocal) return;

      if (backupTimerRef.current) {
        window.clearTimeout(backupTimerRef.current);
      }
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
      }

      setPendingCountdown(25);

      countdownIntervalRef.current = window.setInterval(() => {
        setPendingCountdown((prev) => (prev !== null && prev > 1 ? prev - 1 : prev));
      }, 1000);

      backupTimerRef.current = window.setTimeout(() => {
        if (countdownIntervalRef.current) {
          window.clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }

        // Priority 1: Upload to Google Drive if signed in & enabled
        if (shouldSyncDrive) {
          performDriveUpload(
            latestDataRef.current.expenses,
            latestDataRef.current.advances,
            latestDataRef.current.profiles,
            true
          );
        }

        // Priority 2: Also download local JSON if enabled by user
        if (shouldDownloadLocal) {
          performBackupDownload(
            latestDataRef.current.expenses,
            latestDataRef.current.advances,
            latestDataRef.current.profiles,
            true
          );
        }
      }, 25000);
    },
    [
      driveUser,
      hasActiveToken,
      autoDriveSyncEnabled,
      autoBackupEnabled,
      performDriveUpload,
      performBackupDownload,
    ]
  );

  const handleToggleAutoBackup = (enabled: boolean) => {
    setAutoBackupEnabled(enabled);
    try {
      localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    if (!enabled && !(driveUser && hasActiveToken && autoDriveSyncEnabled)) {
      if (backupTimerRef.current) window.clearTimeout(backupTimerRef.current);
      if (countdownIntervalRef.current) window.clearInterval(countdownIntervalRef.current);
      setPendingCountdown(null);
    }
    if (!enabled) {
      showToast('Đã tắt tự động tải file sao lưu xuống máy.');
    } else {
      showToast('Đã bật tự động tải file sao lưu xuống máy sau 25 giây khi có thay đổi.');
    }
  };

  const handleToggleAutoDriveSync = (enabled: boolean) => {
    setAutoDriveSyncEnabledState(enabled);
    setAutoDriveSyncEnabled(enabled);
    if (!enabled && !autoBackupEnabled) {
      if (backupTimerRef.current) window.clearTimeout(backupTimerRef.current);
      if (countdownIntervalRef.current) window.clearInterval(countdownIntervalRef.current);
      setPendingCountdown(null);
    }
    showToast(
      enabled
        ? 'Đã bật tự động đồng bộ lên Google Drive sau 25 giây khi dữ liệu thay đổi.'
        : 'Đã tắt tự động đồng bộ lên Google Drive.'
    );
  };

  // Helper to run post-login Drive check or upload (shared by Popup, GIS, and Redirect return)
  const handlePostAuthDriveSync = useCallback(
    async (accessToken: string, isRetryAfterReauth = false) => {
      try {
        const savedLocalPref = localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
        if (savedLocalPref === null) {
          setAutoBackupEnabled(false);
          localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, 'false');
        }
      } catch {
        // ignore
      }

      if (isRetryAfterReauth || pendingRetryAfterReauthRef.current) {
        await performDriveUpload(
          latestDataRef.current.expenses,
          latestDataRef.current.advances,
          latestDataRef.current.profiles,
          false,
          accessToken
        );
        return;
      }

      try {
        setDriveSyncStatus('syncing');
        const remoteMeta = await findDriveBackupFile(accessToken);
        setDriveSyncStatus('idle');

        if (remoteMeta) {
          const isNewer = isDriveBackupNewerThanLocal(
            remoteMeta.modifiedTime,
            getLastDriveSyncIso(),
            getLocalLastModifiedIso()
          );

          if (isNewer) {
            setDriveSyncModalState({
              isOpen: true,
              mode: 'newer_on_drive',
              driveMeta: remoteMeta,
            });
          } else {
            showToast('Đã kết nối Google Drive! Dữ liệu trên máy đang là bản mới nhất.');
          }
        } else {
          await performDriveUpload(
            latestDataRef.current.expenses,
            latestDataRef.current.advances,
            latestDataRef.current.profiles,
            false,
            accessToken
          );
        }
      } catch (err: any) {
        setDriveSyncStatus('error');
        const syncErr: DriveSyncError =
          err instanceof DriveSyncError
            ? err
            : new DriveSyncError(err?.message || 'Lỗi kiểm tra file Google Drive', 'UNKNOWN');
        setDriveError({
          message: syncErr.message,
          code: syncErr.code,
          firebaseErrorCode: syncErr.firebaseErrorCode,
        });
      }
    },
    [performDriveUpload]
  );

  // Requirement 5: Restore UI context snapshot on mount if returning from signInWithRedirect
  useEffect(() => {
    const snapshot = loadAppUIContextSnapshot();
    if (!snapshot) return;

    setCurrentTab(snapshot.currentTab || 'expenses');
    if (snapshot.viewMode) setViewMode(snapshot.viewMode);
    if (snapshot.activeProfileId) setActiveProfileId(snapshot.activeProfileId);
    if (snapshot.selectedMonth) setSelectedMonth(snapshot.selectedMonth);
    if (typeof snapshot.searchTerm === 'string') setSearchTerm(snapshot.searchTerm);
    if (typeof snapshot.startDate === 'string') setStartDate(snapshot.startDate);
    if (typeof snapshot.endDate === 'string') setEndDate(snapshot.endDate);
    if (snapshot.minAmount !== undefined) setMinAmount(snapshot.minAmount);
    if (snapshot.maxAmount !== undefined) setMaxAmount(snapshot.maxAmount);
    if (snapshot.receiptFilter) setReceiptFilter(snapshot.receiptFilter);
    if (typeof snapshot.onlyMissingReceipts === 'boolean') {
      setOnlyMissingReceipts(snapshot.onlyMissingReceipts);
    }
    if (snapshot.defaultMonthForNew) setDefaultMonthForNew(snapshot.defaultMonthForNew);
    if (snapshot.editingExpense) setEditingExpense(snapshot.editingExpense);

    if (snapshot.openModal === 'expense') setIsExpenseModalOpen(true);
    else if (snapshot.openModal === 'bulk') setIsBulkModalOpen(true);
    else if (snapshot.openModal === 'settings') setIsSettingsModalOpen(true);
    else if (snapshot.openModal === 'export') setIsExportModalOpen(true);
    else if (snapshot.openModal === 'import') setIsImportModalOpen(true);
    else if (snapshot.openModal === 'pdf') setIsPDFExportModalOpen(true);

    if (snapshot.pendingDriveSyncAfterAuth) {
      pendingRetryAfterReauthRef.current = true;
    }

    clearAppUIContextSnapshot();
  }, []);

  // Initialize Firebase Auth state listener & getRedirectResult on mount (Requirements 1, 2, 3, 5)
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token, isFromRedirect) => {
        setDriveUser(user);
        setHasActiveToken(true);
        setNeedsReauth(false);
        setDriveError(null);

        if (isFromRedirect && token) {
          showToast(`Đã đăng nhập Google (${user.email || user.displayName || 'Drive'}) thành công!`);
          handlePostAuthDriveSync(token, pendingRetryAfterReauthRef.current);
        }
      },
      (userWithoutToken) => {
        if (userWithoutToken) {
          setDriveUser(userWithoutToken);
          setHasActiveToken(false);
          setNeedsReauth(true);
        } else {
          setDriveUser(null);
          setHasActiveToken(false);
        }
      },
      (redirectErr) => {
        setDriveSyncStatus('error');
        setDriveError({
          message: redirectErr.message,
          code: redirectErr.code,
          firebaseErrorCode: redirectErr.firebaseErrorCode,
        });
      }
    );
    return () => unsubscribe();
  }, [handlePostAuthDriveSync]);

  // Save current UI context right before Redirect Auth navigates away (Requirement 5)
  const saveCurrentContextBeforeRedirect = useCallback(() => {
    let openModal: 'none' | 'expense' | 'bulk' | 'settings' | 'export' | 'import' | 'pdf' = 'none';
    if (isExpenseModalOpen) openModal = 'expense';
    else if (isBulkModalOpen) openModal = 'bulk';
    else if (isSettingsModalOpen) openModal = 'settings';
    else if (isExportModalOpen) openModal = 'export';
    else if (isImportModalOpen) openModal = 'import';
    else if (isPDFExportModalOpen) openModal = 'pdf';

    saveAppUIContextSnapshot({
      currentTab,
      viewMode,
      activeProfileId,
      selectedMonth,
      searchTerm,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      receiptFilter,
      onlyMissingReceipts,
      openModal,
      editingExpense,
      defaultMonthForNew,
      pendingDriveSyncAfterAuth: pendingRetryAfterReauthRef.current,
      savedAt: Date.now(),
    });
  }, [
    isExpenseModalOpen,
    isBulkModalOpen,
    isSettingsModalOpen,
    isExportModalOpen,
    isImportModalOpen,
    isPDFExportModalOpen,
    currentTab,
    viewMode,
    activeProfileId,
    selectedMonth,
    searchTerm,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    receiptFilter,
    onlyMissingReceipts,
    editingExpense,
    defaultMonthForNew,
  ]);

  // Requirement 1 & 3: Sign in with Google & check Drive backup timestamp
  const handleGoogleLogin = async () => {
    setDriveError(null);
    try {
      const result = await googleSignIn(saveCurrentContextBeforeRedirect);
      // If signInWithRedirect was triggered, result is null because browser is navigating
      if (!result) return;

      setDriveUser(result.user);
      setHasActiveToken(true);
      setNeedsReauth(false);

      await handlePostAuthDriveSync(result.accessToken, pendingRetryAfterReauthRef.current);
    } catch (err: any) {
      setDriveSyncStatus('error');
      const syncErr: DriveSyncError =
        err instanceof DriveSyncError
          ? err
          : new DriveSyncError(err?.message || 'Đăng nhập Google thất bại', 'UNKNOWN');
      setDriveError({
        message: syncErr.message,
        code: syncErr.code,
        firebaseErrorCode: syncErr.firebaseErrorCode,
      });
    }
  };

  const handleGoogleLogout = async () => {
    await logoutGoogleDrive();
    setDriveUser(null);
    setHasActiveToken(false);
    setNeedsReauth(false);
    setDriveError(null);
    setDriveSyncStatus('idle');
    showToast('Đã đăng xuất khỏi Google Drive.');
  };

  // Open manual Drive Sync Modal (checks remote file metadata first)
  const handleOpenDriveSyncModal = async () => {
    setDriveError(null);
    setDriveSyncStatus('syncing');
    try {
      const remoteMeta = await findDriveBackupFile();
      setDriveSyncStatus('idle');
      setDriveSyncModalState({
        isOpen: true,
        mode: 'manual_sync',
        driveMeta: remoteMeta,
      });
    } catch (err: any) {
      setDriveSyncStatus('error');
      const syncErr: DriveSyncError =
        err instanceof DriveSyncError
          ? err
          : new DriveSyncError(err?.message || 'Không thể kiểm tra Google Drive', 'UNKNOWN');
      setDriveError({ message: syncErr.message, code: syncErr.code });
      if (syncErr.code === 'TOKEN_EXPIRED') {
        setHasActiveToken(false);
        setNeedsReauth(true);
      }
    }
  };

  // Download from Drive and restore (Replace or Merge) after user confirmation
  const handleConfirmDownloadFromDrive = async (restoreMode: 'replace' | 'merge') => {
    setDriveSyncStatus('syncing');
    setDriveError(null);
    try {
      const { backup, metadata } = await downloadBackupFromDrive(
        driveSyncModalState.driveMeta?.id
      );

      await handleRestoreBackup(
        backup.items,
        restoreMode,
        backup.advances,
        backup.profiles
      );

      const formattedTime = saveDriveSyncTimestamp(
        metadata.modifiedTime || new Date().toISOString()
      );
      try {
        localStorage.setItem(
          'so_chi_tieu_local_last_modified_iso',
          metadata.modifiedTime || new Date().toISOString()
        );
      } catch {
        // ignore
      }

      setLastDriveSyncTimeState(formattedTime);
      setDriveSyncStatus('synced');
      setDriveSyncModalState((prev) => ({ ...prev, isOpen: false }));
      showToast(
        `Đã đồng bộ từ Google Drive về máy (${backup.totalExpenses} khoản chi, ${backup.totalImages} ảnh)!`
      );
    } catch (err: any) {
      setDriveSyncStatus('error');
      const syncErr: DriveSyncError =
        err instanceof DriveSyncError
          ? err
          : new DriveSyncError(err?.message || 'Lỗi tải dữ liệu từ Google Drive', 'UNKNOWN');
      setDriveError({ message: syncErr.message, code: syncErr.code });
      if (syncErr.code === 'TOKEN_EXPIRED') {
        setHasActiveToken(false);
        setNeedsReauth(true);
        setDriveSyncModalState((prev) => ({ ...prev, isOpen: false }));
      }
    }
  };

  const handleConfirmUploadToDriveFromModal = async () => {
    await performDriveUpload(expenses, advances, profiles, false);
    setDriveSyncModalState((prev) => ({ ...prev, isOpen: false }));
  };

  // Load from IndexedDB on startup & request persistent storage
  useEffect(() => {
    async function loadData() {
      try {
        // Requirement 3: Request persistent storage from browser / Android system
        requestPersistentStorage().then((res) => {
          if (res.persisted) {
            console.log('[Storage]: Persistent storage granted by OS.');
          }
        }).catch(() => {});

        const [storedExpenses, storedAdvances, storedProfiles] = await Promise.all([
          getAllExpenses(),
          getAllAdvances(),
          getAllProfiles(),
        ]);

        setAdvances(storedAdvances);
        setProfiles(storedProfiles.length > 0 ? storedProfiles : [DEFAULT_PROFILE]);

        if (storedExpenses && storedExpenses.length > 0) {
          setExpenses(storedExpenses);
          await markDBInitialized();
        } else {
          const initialized = await isDBInitialized();
          if (!initialized) {
            // Seed sample data only on the very first launch
            await replaceAllExpenses(INITIAL_SAMPLE_EXPENSES);
            setExpenses(INITIAL_SAMPLE_EXPENSES);
          } else {
            setExpenses([]);
          }
        }
      } catch (err) {
        console.error('Failed to load from DB:', err);
        setExpenses(INITIAL_SAMPLE_EXPENSES);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Requirement 7: Android Hardware / Gesture Back Button Handling
  // When any modal is open, pressing Back closes the top modal instead of exiting the app.
  const isAnyModalOpen =
    driveSyncModalState.isOpen ||
    isSettingsModalOpen ||
    isExpenseModalOpen ||
    isReceiptViewerOpen ||
    isImportModalOpen ||
    isExportModalOpen ||
    isBulkModalOpen ||
    isPDFExportModalOpen;

  const closeTopModal = useCallback((): boolean => {
    if (driveSyncModalState.isOpen) {
      setDriveSyncModalState((prev) => ({ ...prev, isOpen: false }));
      return true;
    }
    if (isSettingsModalOpen) {
      setIsSettingsModalOpen(false);
      return true;
    }
    if (isReceiptViewerOpen) {
      setIsReceiptViewerOpen(false);
      return true;
    }
    if (isExpenseModalOpen) {
      setIsExpenseModalOpen(false);
      setEditingExpense(null);
      return true;
    }
    if (isImportModalOpen) {
      setIsImportModalOpen(false);
      return true;
    }
    if (isExportModalOpen) {
      setIsExportModalOpen(false);
      return true;
    }
    if (isBulkModalOpen) {
      setIsBulkModalOpen(false);
      return true;
    }
    if (isPDFExportModalOpen) {
      setIsPDFExportModalOpen(false);
      return true;
    }
    return false;
  }, [
    driveSyncModalState.isOpen,
    isSettingsModalOpen,
    isReceiptViewerOpen,
    isExpenseModalOpen,
    isImportModalOpen,
    isExportModalOpen,
    isBulkModalOpen,
    isPDFExportModalOpen,
  ]);

  // Push history state when any modal opens so physical Back button pops it
  useEffect(() => {
    if (isAnyModalOpen) {
      window.history.pushState({ appModalOpen: true }, '');
    }
  }, [isAnyModalOpen]);

  // Listen to popstate and backbutton events
  useEffect(() => {
    const handlePopState = () => {
      if (isAnyModalOpen) {
        closeTopModal();
      }
    };

    const handleBackButton = (e: Event) => {
      if (isAnyModalOpen) {
        e.preventDefault();
        closeTopModal();
      }
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('backbutton', handleBackButton as any);

    // Capacitor App plugin backButton listener if running in Capacitor Android APK
    const capApp = (window as any).Capacitor?.Plugins?.App;
    let removeListenerPromise: any = null;
    if (capApp?.addListener) {
      removeListenerPromise = capApp.addListener('backButton', (data: any) => {
        if (isAnyModalOpen) {
          closeTopModal();
        } else if (data?.canGoBack) {
          window.history.back();
        }
      });
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('backbutton', handleBackButton as any);
      if (removeListenerPromise && typeof removeListenerPromise.then === 'function') {
        removeListenerPromise.then((handle: any) => handle?.remove?.()).catch(() => {});
      }
    };
  }, [isAnyModalOpen, closeTopModal]);

  // Set default view mode based on screen width on initial mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setViewMode('table');
    } else {
      setViewMode('card');
    }
  }, []);

  // Filter expenses by active profile first
  const profileExpenses = useMemo(() => {
    if (activeProfileId === 'all') return expenses;
    return expenses.filter((e) => (e.profileId || 'default') === activeProfileId);
  }, [expenses, activeProfileId]);

  // Compute all available months for filter
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    profileExpenses.forEach((e) => {
      if (e.month) months.add(e.month);
    });
    const arr = Array.from(months);
    arr.sort((a, b) => parseMonthYearSortKey(a) - parseMonthYearSortKey(b));
    return arr;
  }, [profileExpenses]);

  // Requirement 2 & 8: Comprehensive Filters (keyword, month, date range, amount range, photo status)
  const filteredExpenses = useMemo(() => {
    let result = profileExpenses;

    // 1. Search keyword in description, date, or notes
    if (searchTerm.trim()) {
      const normSearch = removeVietnameseAccents(searchTerm.trim());
      result = result.filter((item) => {
        const normDesc = removeVietnameseAccents(item.description);
        const normDate = removeVietnameseAccents(item.date);
        const normNotes = removeVietnameseAccents(item.notes || '');
        return (
          normDesc.includes(normSearch) ||
          normDate.includes(normSearch) ||
          normNotes.includes(normSearch)
        );
      });
    }

    // 2. Month filter
    if (selectedMonth !== 'all') {
      result = result.filter((item) => item.month === selectedMonth);
    }

    // 3. Date range filter (startDate, endDate in YYYY-MM-DD format)
    const startSortKey = startDate ? parseInt(startDate.replace(/-/g, ''), 10) : null;
    const endSortKey = endDate ? parseInt(endDate.replace(/-/g, ''), 10) : null;
    if (startSortKey || endSortKey) {
      result = result.filter((item) => {
        const itemKey = parseDateSortKey(item.date || '');
        if (startSortKey && itemKey < startSortKey) return false;
        if (endSortKey && itemKey > endSortKey) return false;
        return true;
      });
    }

    // 4. Amount range filter
    if (minAmount !== '') {
      result = result.filter((item) => item.amount >= Number(minAmount));
    }
    if (maxAmount !== '') {
      result = result.filter((item) => item.amount <= Number(maxAmount));
    }

    // 5. Receipt filter (has photo vs no photo)
    if (receiptFilter === 'no_receipt' || onlyMissingReceipts) {
      result = result.filter(
        (item) => !Array.isArray(item.images) || item.images.length === 0
      );
    } else if (receiptFilter === 'has_receipt') {
      result = result.filter(
        (item) => Array.isArray(item.images) && item.images.length > 0
      );
    }

    return result;
  }, [
    profileExpenses,
    searchTerm,
    selectedMonth,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    receiptFilter,
    onlyMissingReceipts,
  ]);

  // Count how many items in current scope are missing receipt images (Requirement 2)
  const missingReceiptsCount = useMemo(() => {
    return profileExpenses.filter(
      (item) => !Array.isArray(item.images) || item.images.length === 0
    ).length;
  }, [profileExpenses]);

  // Active filters indicator & reset
  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedMonth !== 'all' ||
    startDate ||
    endDate ||
    minAmount !== '' ||
    maxAmount !== '' ||
    receiptFilter !== 'all' ||
    onlyMissingReceipts
  );

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedMonth('all');
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
    setReceiptFilter('all');
    setOnlyMissingReceipts(false);
  };

  // Requirement 8: Batch selection & operations (delete multiple, change date multiple)
  const handleToggleSelect = (id: string) => {
    setSelectedExpenseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (
      selectedExpenseIds.size === filteredExpenses.length &&
      filteredExpenses.length > 0
    ) {
      setSelectedExpenseIds(new Set());
    } else {
      setSelectedExpenseIds(new Set(filteredExpenses.map((e) => e.id)));
    }
  };

  const handleDeselectAll = () => {
    setSelectedExpenseIds(new Set());
  };

  const handleBatchDelete = async () => {
    const idsToDelete = Array.from(selectedExpenseIds);
    if (idsToDelete.length === 0) return;
    try {
      for (const id of idsToDelete) {
        await deleteExpense(id);
      }
      const nextList = expenses.filter((e) => !selectedExpenseIds.has(e.id));
      setExpenses(nextList);
      setSelectedExpenseIds(new Set());
      showToast(`Đã xóa hàng loạt ${idsToDelete.length} khoản chi!`);
      scheduleAutoBackup(nextList);
    } catch (err) {
      showToast('Lỗi khi xóa hàng loạt.');
    }
  };

  const handleBatchChangeDate = async (newDate: string) => {
    const idsToUpdate = selectedExpenseIds;
    if (idsToUpdate.size === 0) return;
    try {
      let nextMonth: string | undefined;
      const parts = newDate.split(/[\/\-]/);
      if (parts.length >= 2) {
        const m = parseInt(parts[1], 10);
        const y = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
        if (!isNaN(m) && m >= 1 && m <= 12) {
          nextMonth = `Tháng ${m}/${y}`;
        }
      }

      const updatedList = expenses.map((item) => {
        if (!idsToUpdate.has(item.id)) return item;
        return {
          ...item,
          date: newDate,
          month: nextMonth || item.month,
          updatedAt: Date.now(),
        };
      });

      const itemsToSave = updatedList.filter((item) => idsToUpdate.has(item.id));
      await saveExpensesBulk(itemsToSave);
      setExpenses(updatedList);
      setSelectedExpenseIds(new Set());
      showToast(`Đã đổi ngày cho ${idsToUpdate.size} khoản chi thành ${newDate}!`);
      scheduleAutoBackup(updatedList);
    } catch (err) {
      showToast('Lỗi khi đổi ngày hàng loạt.');
    }
  };

  const selectedTotalAmount = useMemo(() => {
    return expenses
      .filter((e) => selectedExpenseIds.has(e.id))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses, selectedExpenseIds]);

  // Requirement 9: Export PDF directly with thumbnail images & month groupings
  const handleExportPDF = async () => {
    if (filteredExpenses.length === 0) {
      showToast('Không có khoản chi nào để xuất PDF.');
      return;
    }
    const currentProfile = profiles.find((p) => p.id === activeProfileId);
    const profileName =
      activeProfileId !== 'all'
        ? currentProfile?.name || 'Hồ sơ công tác'
        : 'Tất cả hồ sơ';
    showToast('Đang mở trang in / lưu PDF kèm ảnh chứng từ...');
    try {
      await exportExpensesToPDF({
        expenses: filteredExpenses,
        reportTitle: `Báo Cáo Thanh Toán Công Tác Phí - ${profileName}`,
        profileName,
        advances: activeAdvances,
        selectedMonth,
      });
    } catch (err: any) {
      showToast(`Xuất PDF thất bại: ${err?.message || 'Lỗi không xác định'}`);
    }
  };

  // Set of IDs suspected of being duplicates (Requirement 3)
  const duplicateIdsSet = useMemo(() => {
    return getDuplicateIdsSet(profileExpenses);
  }, [profileExpenses]);

  // Grouped by Month
  const monthGroups = useMemo<MonthGroup[]>(() => {
    return groupExpensesByMonth(filteredExpenses);
  }, [filteredExpenses]);

  // Grand totals
  const totalAmount = useMemo(() => {
    return filteredExpenses.reduce((sum, item) => sum + item.amount, 0);
  }, [filteredExpenses]);

  const refundsTotal = useMemo(() => {
    return filteredExpenses
      .filter((item) => item.amount < 0)
      .reduce((sum, item) => sum + item.amount, 0);
  }, [filteredExpenses]);

  // Filtered advances for current profile
  const activeAdvances = useMemo(() => {
    if (activeProfileId === 'all') return advances;
    return advances.filter((a) => (a.profileId || 'default') === activeProfileId);
  }, [advances, activeProfileId]);

  // Action: Add New
  const handleOpenAddModal = (monthPreset?: string) => {
    setEditingExpense(null);
    if (monthPreset) {
      setDefaultMonthForNew(monthPreset);
    } else if (availableMonths.length > 0) {
      setDefaultMonthForNew(availableMonths[availableMonths.length - 1]);
    } else {
      setDefaultMonthForNew('Tháng 4');
    }
    setIsExpenseModalOpen(true);
  };

  // Action: Edit
  const handleEditExpense = (expense: ExpenseItem) => {
    setEditingExpense(expense);
    setIsExpenseModalOpen(true);
  };

  // Action: Save Expense (Add or Edit)
  const handleSaveExpense = async (savedItem: ExpenseItem) => {
    try {
      const itemWithProfile: ExpenseItem = {
        ...savedItem,
        profileId:
          savedItem.profileId ||
          (activeProfileId !== 'all' ? activeProfileId : 'default'),
      };
      await saveExpense(itemWithProfile);

      let nextList: ExpenseItem[] = [];
      setExpenses((prev) => {
        const exists = prev.some((e) => e.id === itemWithProfile.id);
        nextList = exists
          ? prev.map((e) => (e.id === itemWithProfile.id ? itemWithProfile : e))
          : [itemWithProfile, ...prev];
        return nextList;
      });

      showToast(editingExpense ? 'Đã cập nhật khoản chi!' : 'Đã thêm khoản chi mới!');
      scheduleAutoBackup(nextList);
    } catch (err: any) {
      console.error('Error saving expense:', err);
      showToast(err?.message || 'Không thể lưu khoản chi vào bộ nhớ trình duyệt.');
    }
  };

  // Action: Add Bulk Expenses from Message (Requirement 6)
  const handleConfirmAddBulk = async (bulkItems: ExpenseItem[]) => {
    try {
      await saveExpensesBulk(bulkItems);
      let nextList: ExpenseItem[] = [];
      setExpenses((prev) => {
        nextList = [...bulkItems, ...prev];
        return nextList;
      });
      showToast(`Đã tách và thêm ${bulkItems.length} khoản chi từ tin nhắn!`);
      scheduleAutoBackup(nextList);
    } catch (err: any) {
      console.error('Error adding bulk expenses:', err);
      showToast(err?.message || 'Không thể lưu danh sách khoản chi.');
    }
  };

  // Action: Delete Expense
  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteExpense(id);
      let nextList: ExpenseItem[] = [];
      setExpenses((prev) => {
        nextList = prev.filter((e) => e.id !== id);
        return nextList;
      });
      showToast('Đã xóa khoản chi thành công.');
      scheduleAutoBackup(nextList);
    } catch (err) {
      console.error('Error deleting expense:', err);
      showToast('Không thể xóa khoản chi.');
    }
  };

  // Action: Update Receipt Images
  const handleUpdateImages = async (expenseId: string, updatedImages: string[]) => {
    const item = expenses.find((e) => e.id === expenseId);
    if (!item) return;

    const updated: ExpenseItem = {
      ...item,
      images: updatedImages,
      updatedAt: Date.now(),
    };

    try {
      await saveExpense(updated);
      let nextList: ExpenseItem[] = [];
      setExpenses((prev) => {
        nextList = prev.map((e) => (e.id === expenseId ? updated : e));
        return nextList;
      });
      setActiveReceiptExpense(updated);
      showToast('Đã cập nhật ảnh chứng từ!');
      scheduleAutoBackup(nextList);
    } catch (err: any) {
      console.error('Error updating images:', err);
      showToast(err?.message || 'Không thể lưu ảnh chứng từ.');
    }
  };

  // Action: Apply Gemini OCR extracted info directly from ReceiptViewerModal (Requirement 7)
  const handleApplyExtractedReceipt = async (
    expenseId: string,
    extracted: ReceiptScanResult
  ) => {
    const item = expenses.find((e) => e.id === expenseId);
    if (!item) return;

    let nextMonth = item.month;
    if (extracted.date) {
      const match = extracted.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (match) {
        nextMonth = `Tháng ${parseInt(match[2], 10)}`;
      }
    }

    const updated: ExpenseItem = {
      ...item,
      amount:
        typeof extracted.amount === 'number' && extracted.amount > 0
          ? extracted.amount
          : item.amount,
      date: extracted.date || item.date,
      month: nextMonth,
      description: extracted.description || item.description,
      updatedAt: Date.now(),
    };

    try {
      await saveExpense(updated);
      let nextList: ExpenseItem[] = [];
      setExpenses((prev) => {
        nextList = prev.map((e) => (e.id === expenseId ? updated : e));
        return nextList;
      });
      setActiveReceiptExpense(updated);
      showToast('Đã cập nhật thông tin khoản chi từ hóa đơn AI!');
      scheduleAutoBackup(nextList);
    } catch (err: any) {
      console.error('Error applying receipt OCR:', err);
      showToast(err?.message || 'Không thể cập nhật khoản chi.');
    }
  };

  // Action: Open Receipt Lightbox
  const handleOpenReceiptViewer = (expense: ExpenseItem) => {
    setActiveReceiptExpense(expense);
    setIsReceiptViewerOpen(true);
  };

  // Action: Manage Advances (Requirement 4)
  const handleAddAdvance = async (adv: AdvancePaymentItem) => {
    try {
      await saveAdvance(adv);
      let nextAdvances: AdvancePaymentItem[] = [];
      setAdvances((prev) => {
        nextAdvances = [adv, ...prev];
        return nextAdvances;
      });
      showToast('Đã ghi nhận khoản tạm ứng!');
      scheduleAutoBackup(undefined, nextAdvances);
    } catch (err: any) {
      console.error('Error saving advance:', err);
      showToast(err?.message || 'Không thể lưu khoản tạm ứng.');
    }
  };

  const handleDeleteAdvance = async (id: string) => {
    try {
      await deleteAdvance(id);
      let nextAdvances: AdvancePaymentItem[] = [];
      setAdvances((prev) => {
        nextAdvances = prev.filter((a) => a.id !== id);
        return nextAdvances;
      });
      showToast('Đã xóa đợt tạm ứng.');
      scheduleAutoBackup(undefined, nextAdvances);
    } catch (err) {
      console.error('Error deleting advance:', err);
      showToast('Không thể xóa đợt tạm ứng.');
    }
  };

  // Action: Manage Profiles (Requirement 4)
  const handleCreateProfile = async (name: string) => {
    const newProfile: ExpenseProfile = {
      id: `prof_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      name,
      createdAt: Date.now(),
    };
    try {
      await saveProfile(newProfile);
      let nextProfiles: ExpenseProfile[] = [];
      setProfiles((prev) => {
        nextProfiles = [...prev, newProfile];
        return nextProfiles;
      });
      setActiveProfileId(newProfile.id);
      showToast(`Đã tạo hồ sơ "${name}"!`);
      scheduleAutoBackup(undefined, undefined, nextProfiles);
    } catch (err: any) {
      console.error('Error creating profile:', err);
      showToast('Không thể tạo hồ sơ mới.');
    }
  };

  const handleRenameProfile = async (profileId: string, newName: string) => {
    const target = profiles.find((p) => p.id === profileId);
    if (!target) return;
    const cleanName = newName.trim();
    if (!cleanName) return;

    const updated: ExpenseProfile = { ...target, name: cleanName };
    try {
      await saveProfile(updated);
      let nextProfiles: ExpenseProfile[] = [];
      setProfiles((prev) => {
        nextProfiles = prev.map((p) => (p.id === profileId ? updated : p));
        return nextProfiles;
      });
      showToast(`Đã đổi tên hồ sơ thành "${cleanName}"!`);
      scheduleAutoBackup(undefined, undefined, nextProfiles);
    } catch (err) {
      console.error('Error renaming profile:', err);
      showToast('Không thể đổi tên hồ sơ.');
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profileId === 'default' || profileId === 'all') return;
    try {
      await deleteProfile(profileId);
      let nextProfiles: ExpenseProfile[] = [];
      setProfiles((prev) => {
        nextProfiles = prev.filter((p) => p.id !== profileId);
        return nextProfiles;
      });
      setActiveProfileId('all');
      showToast('Đã xóa hồ sơ.');
      scheduleAutoBackup(undefined, undefined, nextProfiles);
    } catch (err) {
      console.error('Error deleting profile:', err);
    }
  };

  // Action: Import Excel Completed
  const handleImportComplete = async (importedItems: ExpenseItem[], mode: 'append' | 'replace') => {
    try {
      const itemsWithProfile = importedItems.map((it) => ({
        ...it,
        profileId:
          it.profileId || (activeProfileId !== 'all' ? activeProfileId : 'default'),
      }));

      if (mode === 'replace') {
        const saved = await replaceAllExpenses(itemsWithProfile);
        setExpenses(saved);
        setSelectedMonth('all');
        setSearchTerm('');
        showToast(`Đã thay thế toàn bộ bằng ${saved.length} khoản chi mới!`);
        scheduleAutoBackup(saved);
      } else {
        await saveExpensesBulk(itemsWithProfile);
        let nextList: ExpenseItem[] = [];
        setExpenses((prev) => {
          nextList = [...itemsWithProfile, ...prev];
          return nextList;
        });
        setSelectedMonth('all');
        showToast(`Đã gộp thêm ${itemsWithProfile.length} khoản chi từ Excel!`);
        scheduleAutoBackup(nextList);
      }
    } catch (err: any) {
      console.error('Error handling import:', err);
      showToast(err?.message || 'Lỗi khi lưu dữ liệu nhập từ Excel.');
    }
  };

  // Action: Restore Backup JSON
  const handleRestoreBackup = async (
    restoredItems: ExpenseItem[],
    mode: 'replace' | 'merge',
    restoredAdvances?: AdvancePaymentItem[],
    restoredProfiles?: ExpenseProfile[]
  ): Promise<{ totalExpenses: number; totalImages: number }> => {
    let finalList: ExpenseItem[] = [];
    if (mode === 'replace') {
      finalList = await replaceAllExpenses(restoredItems);
      if (restoredAdvances) {
        const savedAdv = await replaceAllAdvances(restoredAdvances);
        setAdvances(savedAdv);
      }
      if (restoredProfiles && restoredProfiles.length > 0) {
        const savedProf = await replaceAllProfiles(restoredProfiles);
        setProfiles(savedProf);
      }
    } else {
      finalList = await mergeExpensesWithExisting(restoredItems, expenses);
      if (restoredAdvances && restoredAdvances.length > 0) {
        const mergedAdvMap = new Map<string, AdvancePaymentItem>();
        advances.forEach((a) => mergedAdvMap.set(a.id, a));
        restoredAdvances.forEach((a) => mergedAdvMap.set(a.id, a));
        const mergedAdv = await replaceAllAdvances(Array.from(mergedAdvMap.values()));
        setAdvances(mergedAdv);
      }
      if (restoredProfiles && restoredProfiles.length > 0) {
        const mergedProfMap = new Map<string, ExpenseProfile>();
        profiles.forEach((p) => mergedProfMap.set(p.id, p));
        restoredProfiles.forEach((p) => mergedProfMap.set(p.id, p));
        const mergedProf = await replaceAllProfiles(Array.from(mergedProfMap.values()));
        setProfiles(mergedProf);
      }
    }

    const totalImages = finalList.reduce(
      (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
      0
    );

    // Immediately update all UI states without page reload
    setExpenses(finalList);
    setSelectedMonth('all');
    setSearchTerm('');
    setOnlyMissingReceipts(false);
    if (activeReceiptExpense) {
      const updatedActive = finalList.find((e) => e.id === activeReceiptExpense.id) || null;
      setActiveReceiptExpense(updatedActive);
    }

    showToast(
      `Đã khôi phục thành công ${finalList.length} khoản chi và ${totalImages} ảnh chứng từ!`
    );

    return {
      totalExpenses: finalList.length,
      totalImages,
    };
  };

  // Action: Clear All Data
  const handleClearAllData = async (): Promise<void> => {
    await clearAllExpenses();
    await replaceAllAdvances([]);
    setExpenses([]);
    setAdvances([]);
    setSelectedMonth('all');
    setSearchTerm('');
    setOnlyMissingReceipts(false);
    setActiveReceiptExpense(null);
    showToast('Đã xóa toàn bộ dữ liệu chi tiêu hiện tại.');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-teal-100 selection:text-teal-900 pb-20 sm:pb-12">
      {/* Requirement 10: PWA Install & Offline Status Banner */}
      <PWAInstallBanner />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 size={16} className="text-teal-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Header with Navigation & Filter Bar */}
      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onOpenAddModal={() => handleOpenAddModal()}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenBulkModal={() => setIsBulkModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        availableMonths={availableMonths}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        minAmount={minAmount}
        setMinAmount={setMinAmount}
        maxAmount={maxAmount}
        setMaxAmount={setMaxAmount}
        receiptFilter={receiptFilter}
        setReceiptFilter={(f) => {
          setReceiptFilter(f);
          if (f === 'no_receipt') setOnlyMissingReceipts(true);
          else if (f === 'has_receipt') setOnlyMissingReceipts(false);
        }}
        missingReceiptsCount={missingReceiptsCount}
        totalAmount={totalAmount}
        totalExpensesCount={filteredExpenses.length}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Main Content Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-5">
        {/* Requirement 9: Auto Backup & Google Drive Sync Status Bar */}
        <AutoBackupBar
          autoBackupEnabled={autoBackupEnabled}
          onToggleAutoBackup={handleToggleAutoBackup}
          lastBackupTime={lastBackupTime}
          lastBackupFileName={lastBackupFileName}
          pendingCountdown={pendingCountdown}
          onDownloadBackupNow={() =>
            performBackupDownload(expenses, advances, profiles, false)
          }
          driveUser={driveUser}
          hasActiveToken={hasActiveToken}
          needsReauth={needsReauth}
          autoDriveSyncEnabled={autoDriveSyncEnabled}
          onToggleAutoDriveSync={handleToggleAutoDriveSync}
          driveSyncStatus={driveSyncStatus}
          lastDriveSyncTime={lastDriveSyncTime}
          driveError={driveError}
          onGoogleLogin={handleGoogleLogin}
          onGoogleLogout={handleGoogleLogout}
          onOpenDriveSyncModal={handleOpenDriveSyncModal}
          onQuickSyncDriveNow={() =>
            performDriveUpload(expenses, advances, profiles, false)
          }
        />

        {/* Requirement 4: Advance Payments & Settlement Summary Panel */}
        <AdvancePaymentPanel
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSelectProfile={setActiveProfileId}
          onCreateProfile={handleCreateProfile}
          onRenameProfile={handleRenameProfile}
          onDeleteProfile={handleDeleteProfile}
          advances={advances}
          onAddAdvance={handleAddAdvance}
          onDeleteAdvance={handleDeleteAdvance}
          totalSpent={totalAmount}
          refundsTotal={refundsTotal}
        />

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <div className="w-8 h-8 border-3 border-teal-700 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium">Đang tải dữ liệu chi tiêu...</p>
          </div>
        ) : currentTab === 'expenses' ? (
          <>
            {/* Quick Natural Language Expense Input Bar */}
            <NaturalExpenseInput
              onAddExpense={(item) => {
                handleSaveExpense(item);
              }}
              defaultMonth={
                availableMonths.length > 0
                  ? availableMonths[availableMonths.length - 1]
                  : 'Tháng 4'
              }
              existingExpenses={expenses}
              activeProfileId={activeProfileId !== 'all' ? activeProfileId : 'default'}
              onOpenBulkMessageModal={() => setIsBulkModalOpen(true)}
            />

            {/* Requirement 8: Batch Operations Floating / Sticky Bar */}
            <BatchOperationsBar
              selectedCount={selectedExpenseIds.size}
              totalVisibleCount={filteredExpenses.length}
              selectedTotalAmount={selectedTotalAmount}
              onSelectAll={handleToggleSelectAll}
              onDeselectAll={handleDeselectAll}
              isAllSelected={
                filteredExpenses.length > 0 &&
                selectedExpenseIds.size === filteredExpenses.length
              }
              onBatchDelete={handleBatchDelete}
              onBatchUpdateDate={handleBatchChangeDate}
            />

            {viewMode === 'table' ? (
              <TableView
                monthGroups={monthGroups}
                onEditExpense={handleEditExpense}
                onDeleteExpense={handleDeleteExpense}
                onOpenReceiptViewer={handleOpenReceiptViewer}
                onAddNewToMonth={(month) => handleOpenAddModal(month)}
                grandTotal={totalAmount}
                totalExpensesCount={filteredExpenses.length}
                duplicateIdsSet={duplicateIdsSet}
                missingReceiptsCount={missingReceiptsCount}
                onlyMissingReceipts={onlyMissingReceipts}
                onToggleMissingReceipts={setOnlyMissingReceipts}
                selectedIds={selectedExpenseIds}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                isAllSelected={
                  filteredExpenses.length > 0 &&
                  selectedExpenseIds.size === filteredExpenses.length
                }
              />
            ) : (
              <CardView
                monthGroups={monthGroups}
                onEditExpense={handleEditExpense}
                onDeleteExpense={handleDeleteExpense}
                onOpenReceiptViewer={handleOpenReceiptViewer}
                onAddNewToMonth={(month) => handleOpenAddModal(month)}
                duplicateIdsSet={duplicateIdsSet}
                missingReceiptsCount={missingReceiptsCount}
                onlyMissingReceipts={onlyMissingReceipts}
                onToggleMissingReceipts={setOnlyMissingReceipts}
                totalExpensesCount={filteredExpenses.length}
                selectedIds={selectedExpenseIds}
                onToggleSelect={handleToggleSelect}
              />
            )}
          </>
        ) : (
          <DashboardView
            expenses={filteredExpenses}
            monthGroups={monthGroups}
            advances={activeAdvances}
            onOpenReceiptViewer={handleOpenReceiptViewer}
            onEditExpense={handleEditExpense}
          />
        )}
      </main>

      {/* Mobile Floating Action Button (FAB) for quick adding on phone */}
      <div className="sm:hidden fixed bottom-18 right-4 z-40">
        <button
          onClick={() => handleOpenAddModal()}
          aria-label="Thêm khoản chi"
          className="w-13 h-13 rounded-full bg-teal-700 hover:bg-teal-800 text-white shadow-xl flex items-center justify-center active:scale-95 transition-all border-2 border-white"
        >
          <Plus size={24} />
        </button>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 pt-1 pb-safe flex items-center justify-around shadow-lg">
        <button
          onClick={() => setCurrentTab('expenses')}
          className={`min-h-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
            currentTab === 'expenses' ? 'text-teal-800' : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          <TableIcon size={18} />
          <span className="mt-0.5">Sổ chi tiêu</span>
        </button>

        <button
          onClick={() => setCurrentTab('dashboard')}
          className={`min-h-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
            currentTab === 'dashboard' ? 'text-teal-800' : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          <BarChart3 size={18} />
          <span className="mt-0.5">Thống kê</span>
        </button>

        <button
          onClick={() => setIsBulkModalOpen(true)}
          className="min-h-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
        >
          <MessageSquareText size={18} />
          <span className="mt-0.5">Dán tin</span>
        </button>

        <button
          onClick={() => setIsExportModalOpen(true)}
          className="min-h-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
        >
          <FileSpreadsheet size={18} />
          <span className="mt-0.5">Xuất/Lưu</span>
        </button>

        <button
          onClick={() => setIsSettingsModalOpen(true)}
          className="min-h-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
        >
          <Settings size={18} />
          <span className="mt-0.5">Cài đặt</span>
        </button>
      </div>

      {/* Modals */}
      <ExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        onSave={handleSaveExpense}
        editingItem={editingExpense}
        defaultMonth={defaultMonthForNew}
        existingExpenses={expenses}
        activeProfileId={activeProfileId !== 'all' ? activeProfileId : 'default'}
      />

      <ReceiptViewerModal
        expense={activeReceiptExpense}
        isOpen={isReceiptViewerOpen}
        onClose={() => setIsReceiptViewerOpen(false)}
        onUpdateImages={handleUpdateImages}
        onApplyExtractedReceipt={handleApplyExtractedReceipt}
      />

      <BulkMessageModal
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
        existingExpenses={expenses}
        defaultMonth={
          availableMonths.length > 0
            ? availableMonths[availableMonths.length - 1]
            : 'Tháng 4'
        }
        activeProfileId={activeProfileId !== 'all' ? activeProfileId : 'default'}
        onConfirmAddBulk={handleConfirmAddBulk}
      />

      <ImportExcelModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
        existingExpenses={expenses}
      />

      <ExportExcelModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        expenses={profileExpenses}
        monthGroups={monthGroups}
        advances={activeAdvances}
        profiles={profiles}
        onRestoreBackup={handleRestoreBackup}
        onClearAllData={handleClearAllData}
        autoBackupEnabled={autoBackupEnabled}
        onToggleAutoBackup={handleToggleAutoBackup}
        lastBackupTime={lastBackupTime}
        onDownloadBackupNow={() =>
          performBackupDownload(expenses, advances, profiles, false)
        }
        onOpenPDFExportModal={() => setIsPDFExportModalOpen(true)}
      />

      <PDFExportModal
        isOpen={isPDFExportModalOpen}
        onClose={() => setIsPDFExportModalOpen(false)}
        expenses={profileExpenses}
        advances={activeAdvances}
        profiles={profiles}
        activeProfileId={activeProfileId}
        defaultMonth={selectedMonth}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        autoBackupEnabled={autoBackupEnabled}
        onToggleAutoBackup={handleToggleAutoBackup}
        onManualBackup={() =>
          performBackupDownload(expenses, advances, profiles, false)
        }
        onExportPDF={handleExportPDF}
        onOpenPDFExportModal={() => setIsPDFExportModalOpen(true)}
        driveUser={driveUser}
        hasActiveToken={hasActiveToken}
        needsReauth={needsReauth}
        autoDriveSyncEnabled={autoDriveSyncEnabled}
        onToggleAutoDriveSync={handleToggleAutoDriveSync}
        driveSyncStatus={driveSyncStatus}
        lastDriveSyncTime={lastDriveSyncTime}
        driveError={driveError}
        onGoogleLogin={handleGoogleLogin}
        onGoogleLogout={handleGoogleLogout}
        onOpenDriveSyncModal={handleOpenDriveSyncModal}
        onQuickSyncDriveNow={() =>
          performDriveUpload(expenses, advances, profiles, false)
        }
      />

      <DriveSyncModal
        isOpen={driveSyncModalState.isOpen}
        onClose={() => setDriveSyncModalState((prev) => ({ ...prev, isOpen: false }))}
        mode={driveSyncModalState.mode}
        driveMeta={driveSyncModalState.driveMeta}
        localExpensesCount={expenses.length}
        localImagesCount={expenses.reduce(
          (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
          0
        )}
        lastSyncTime={lastDriveSyncTime}
        isSyncing={driveSyncStatus === 'syncing'}
        onConfirmDownloadFromDrive={handleConfirmDownloadFromDrive}
        onConfirmUploadToDrive={handleConfirmUploadToDriveFromModal}
      />
    </div>
  );
}
