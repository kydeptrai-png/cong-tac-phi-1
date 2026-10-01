import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus,
  Table as TableIcon,
  BarChart3,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  MessageSquareText,
  ClipboardPaste,
  Settings,
  RefreshCw,
  ImagePlus,
  X,
  Search,
  Sparkles,
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
import {
  groupExpensesByMonth,
  parseMonthYearSortKey,
  parseDateSortKey,
  isClipboardTableLike,
} from './utils/excel';
import { exportExpensesToPDF } from './utils/pdfExport';
import { removeVietnameseAccents, formatVND } from './utils/categories';
import { compressImage } from './utils/gemini';
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
import { PasteExcelModal, InitialClipboardPayload } from './components/PasteExcelModal';
import { AutoBackupBar } from './components/AutoBackupBar';
import { BatchOperationsBar } from './components/BatchOperationsBar';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { PDFExportModal } from './components/PDFExportModal';
import { SettingsModal } from './components/SettingsModal';
import { DriveSyncModal } from './components/DriveSyncModal';
import { LanSyncModal } from './components/LanSyncModal';
import {
  LanSyncManager,
  LanSyncConnectionState,
  LanPeerInfo,
  LanActivityLogItem,
  LanSyncPayload,
  getSavedRoomCode,
  getAutoJoinLanRoom,
  detectDeviceInfo,
} from './utils/lanSync';
import {
  GoogleDriveUser,
  DriveBackupMetadata,
  DriveErrorCode,
  DriveSyncError,
  DRIVE_BACKUP_FILENAME,
  initAuth,
  googleSignIn,
  getIsSigningIn,
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
import {
  RealtimeSyncStatus,
  getFirebaseAuthInstance,
  onAuthStateChanged,
  ensureRootUserDocument,
  subscribeToUserExpensesRealtime,
  syncExpenseToFirestore,
  syncExpensesBulkToFirestore,
  deleteExpenseFromFirestore,
  deleteExpensesBulkFromFirestore,
} from './utils/cloudSync';

const AUTO_BACKUP_STORAGE_KEY = 'so_chi_tieu_auto_backup_enabled';
const LAST_BACKUP_TIME_KEY = 'so_chi_tieu_last_backup_time';
const LAST_BACKUP_FILE_KEY = 'so_chi_tieu_last_backup_file';
const SETTLED_MONTHS_STORAGE_KEY = 'so_chi_tieu_settled_months_v1';
const COLLAPSED_MONTHS_STORAGE_KEY = 'so_chi_tieu_collapsed_months_v1';

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

  // Settled ("Đã chốt") and Collapsed ("Thu gọn") months state persisted in localStorage
  const [settledMonthsMap, setSettledMonthsMap] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(SETTLED_MONTHS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [collapsedMonthsMap, setCollapsedMonthsMap] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_MONTHS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SETTLED_MONTHS_STORAGE_KEY, JSON.stringify(settledMonthsMap));
    } catch {
      // ignore
    }
  }, [settledMonthsMap]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_MONTHS_STORAGE_KEY, JSON.stringify(collapsedMonthsMap));
    } catch {
      // ignore
    }
  }, [collapsedMonthsMap]);

  const settledMonthKeys = useMemo(() => {
    return new Set<string>(settledMonthsMap[activeProfileId] || []);
  }, [settledMonthsMap, activeProfileId]);

  const collapsedMonthKeys = useMemo(() => {
    return new Set<string>(collapsedMonthsMap[activeProfileId] || []);
  }, [collapsedMonthsMap, activeProfileId]);

  const handleToggleCollapseMonth = useCallback(
    (monthKey: string) => {
      setCollapsedMonthsMap((prev) => {
        const current = new Set(prev[activeProfileId] || []);
        if (current.has(monthKey)) {
          current.delete(monthKey);
        } else {
          current.add(monthKey);
        }
        return {
          ...prev,
          [activeProfileId]: Array.from(current),
        };
      });
    },
    [activeProfileId]
  );

  const handleToggleSettleMonth = useCallback(
    (monthKey: string, monthTitle: string) => {
      const currentlySettled = (settledMonthsMap[activeProfileId] || []).includes(monthKey);

      if (!currentlySettled) {
        // Mark as settled AND automatically collapse this month
        setSettledMonthsMap((prev) => {
          const current = new Set(prev[activeProfileId] || []);
          current.add(monthKey);
          return { ...prev, [activeProfileId]: Array.from(current) };
        });
        setCollapsedMonthsMap((prev) => {
          const current = new Set(prev[activeProfileId] || []);
          current.add(monthKey);
          return { ...prev, [activeProfileId]: Array.from(current) };
        });
        showToast(`Đã chốt sổ và thu gọn ${monthTitle}. Bấm "Mở rộng" bất cứ khi nào cần xem lại.`);
      } else {
        // Unsettle and expand
        setSettledMonthsMap((prev) => {
          const current = new Set(prev[activeProfileId] || []);
          current.delete(monthKey);
          return { ...prev, [activeProfileId]: Array.from(current) };
        });
        setCollapsedMonthsMap((prev) => {
          const current = new Set(prev[activeProfileId] || []);
          current.delete(monthKey);
          return { ...prev, [activeProfileId]: Array.from(current) };
        });
        showToast(`Đã mở chốt và hiển thị lại chi tiết ${monthTitle}.`);
      }
    },
    [settledMonthsMap, activeProfileId]
  );

  const handleCollapseAllSettled = useCallback(() => {
    const settledList = settledMonthsMap[activeProfileId] || [];
    if (settledList.length === 0) return;
    setCollapsedMonthsMap((prev) => {
      const current = new Set(prev[activeProfileId] || []);
      settledList.forEach((mk) => current.add(mk));
      return { ...prev, [activeProfileId]: Array.from(current) };
    });
    showToast('Đã thu gọn tất cả các tháng đã chốt sổ.');
  }, [settledMonthsMap, activeProfileId]);

  const handleCollapseAllMonths = useCallback(
    (allMonthKeys: string[]) => {
      setCollapsedMonthsMap((prev) => {
        const current = new Set(prev[activeProfileId] || []);
        allMonthKeys.forEach((mk) => current.add(mk));
        return { ...prev, [activeProfileId]: Array.from(current) };
      });
    },
    [activeProfileId]
  );

  const handleExpandAllMonths = useCallback(
    (allMonthKeys: string[]) => {
      setCollapsedMonthsMap((prev) => {
        const current = new Set(prev[activeProfileId] || []);
        allMonthKeys.forEach((mk) => current.delete(mk));
        return { ...prev, [activeProfileId]: Array.from(current) };
      });
    },
    [activeProfileId]
  );

  // Modals state
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [defaultMonthForNew, setDefaultMonthForNew] = useState<string>('Tháng 4');
  const [initialModalImages, setInitialModalImages] = useState<string[] | null>(null);

  const [isReceiptViewerOpen, setIsReceiptViewerOpen] = useState(false);
  const [activeReceiptExpense, setActiveReceiptExpense] = useState<ExpenseItem | null>(null);

  // Outside drag-and-drop & hover paste states
  const [uploadingExpenseId, setUploadingExpenseId] = useState<string | null>(null);
  const hoveredExpenseIdRef = useRef<string | null>(null);
  const [isGlobalDraggingFiles, setIsGlobalDraggingFiles] = useState<boolean>(false);
  const globalDragDepthRef = useRef<number>(0);
  const [droppedOutsidePayload, setDroppedOutsidePayload] = useState<{
    images: string[];
    rawFiles: File[];
  } | null>(null);
  const [droppedOutsideSearch, setDroppedOutsideSearch] = useState<string>('');
  const [droppedOutsideFilter, setDroppedOutsideFilter] = useState<'missing' | 'all'>('missing');

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPasteExcelModalOpen, setIsPasteExcelModalOpen] = useState(false);
  const [initialPastePayload, setInitialPastePayload] =
    useState<InitialClipboardPayload | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isPDFExportModalOpen, setIsPDFExportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isLanSyncModalOpen, setIsLanSyncModalOpen] = useState(false);

  // Real-time LAN / P2P Sync state
  const [lanStatus, setLanStatus] = useState<LanSyncConnectionState>('disconnected');
  const [lanRoomCode, setLanRoomCode] = useState<string>('');
  const [lanDeviceName, setLanDeviceName] = useState<string>(() => detectDeviceInfo().deviceName);
  const [lanPeers, setLanPeers] = useState<LanPeerInfo[]>([]);
  const [lanActivityLogs, setLanActivityLogs] = useState<LanActivityLogItem[]>([]);
  const lanManagerRef = useRef<LanSyncManager | null>(null);

  const handleOpenPasteExcelModal = useCallback((payload?: InitialClipboardPayload) => {
    if (payload) {
      setInitialPastePayload(payload);
    }
    setIsPasteExcelModalOpen(true);
  }, []);

  // Requirement 1: Global paste & global drag-and-drop listeners on the main screen when no modal is open
  useEffect(() => {
    const anyModalOpen =
      isExpenseModalOpen ||
      isReceiptViewerOpen ||
      isImportModalOpen ||
      isPasteExcelModalOpen ||
      isExportModalOpen ||
      isBulkModalOpen ||
      isPDFExportModalOpen ||
      isSettingsModalOpen ||
      isLanSyncModalOpen ||
      Boolean(droppedOutsidePayload);

    if (anyModalOpen || currentTab !== 'expenses') {
      setIsGlobalDraggingFiles(false);
      globalDragDepthRef.current = 0;
      return;
    }

    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // Check image in clipboard
      if (clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              // If user is hovering over a specific expense row/card, attach screenshot directly to that expense!
              const hoveredId = hoveredExpenseIdRef.current;
              if (hoveredId) {
                const targetExpense = latestDataRef.current.expenses.find(
                  (exp) => exp.id === hoveredId
                );
                if (targetExpense) {
                  setUploadingExpenseId(targetExpense.id);
                  try {
                    const compressed = await compressImage(blob, 1280, 0.7);
                    const updatedImages = [...(targetExpense.images || []), compressed];
                    const updatedExpense: ExpenseItem = {
                      ...targetExpense,
                      images: updatedImages,
                      updatedAt: Date.now(),
                    };
                    await saveExpense(updatedExpense);
                    setExpenses((prev) =>
                      prev.map((it) => (it.id === targetExpense.id ? updatedExpense : it))
                    );
                    lanManagerRef.current?.broadcastData({
                      action: 'sync:expense_upsert',
                      expense: updatedExpense,
                      timestamp: Date.now(),
                    });
                    showToast(
                      `Đã dán ảnh chụp màn hình vào khoản "${targetExpense.description}"!`
                    );
                  } catch (err) {
                    console.error('Error pasting image to hovered expense:', err);
                  } finally {
                    setUploadingExpenseId(null);
                  }
                  return;
                }
              }

              handleOpenPasteExcelModal({
                id: `global_img_${Date.now()}`,
                imageBlob: blob,
              });
              return;
            }
          }
        }
      }

      // Check Excel table in clipboard
      const htmlText = clipboardData.getData('text/html') || '';
      const plainText = clipboardData.getData('text/plain') || '';
      if (isClipboardTableLike(plainText, htmlText)) {
        e.preventDefault();
        handleOpenPasteExcelModal({
          id: `global_tbl_${Date.now()}`,
          plainText,
          htmlText,
        });
      }
    };

    const hasImageFilesInDrag = (dt: DataTransfer | null): boolean => {
      if (!dt) return false;
      if (dt.types && Array.from(dt.types).includes('Files')) {
        return true;
      }
      return false;
    };

    const extractImageFiles = (dt: DataTransfer | null): File[] => {
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

    const handleWindowDragEnter = (e: DragEvent) => {
      if (!hasImageFilesInDrag(e.dataTransfer)) return;
      e.preventDefault();
      globalDragDepthRef.current += 1;
      setIsGlobalDraggingFiles(true);
    };

    const handleWindowDragOver = (e: DragEvent) => {
      if (!hasImageFilesInDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      if (!isGlobalDraggingFiles) {
        setIsGlobalDraggingFiles(true);
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      if (!hasImageFilesInDrag(e.dataTransfer)) return;
      e.preventDefault();
      globalDragDepthRef.current = Math.max(0, globalDragDepthRef.current - 1);
      if (globalDragDepthRef.current === 0 || (e.clientX === 0 && e.clientY === 0)) {
        globalDragDepthRef.current = 0;
        setIsGlobalDraggingFiles(false);
      }
    };

    const handleWindowDrop = async (e: DragEvent) => {
      globalDragDepthRef.current = 0;
      setIsGlobalDraggingFiles(false);

      const files = extractImageFiles(e.dataTransfer);
      if (files.length === 0) return;

      e.preventDefault();
      const compressedList: string[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const compressed = await compressImage(files[i], 1280, 0.7);
          compressedList.push(compressed);
        } catch (err) {
          console.error('Error compressing globally dropped image:', err);
        }
      }

      if (compressedList.length > 0) {
        const hasMissing = latestDataRef.current.expenses.some(
          (it) => !it.images || it.images.length === 0
        );
        setDroppedOutsideFilter(hasMissing ? 'missing' : 'all');
        setDroppedOutsideSearch('');
        setDroppedOutsidePayload({
          images: compressedList,
          rawFiles: files,
        });
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('paste', handleGlobalPaste);
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [
    currentTab,
    isExpenseModalOpen,
    isReceiptViewerOpen,
    isImportModalOpen,
    isPasteExcelModalOpen,
    isExportModalOpen,
    isBulkModalOpen,
    isPDFExportModalOpen,
    isSettingsModalOpen,
    isLanSyncModalOpen,
    droppedOutsidePayload,
    isGlobalDraggingFiles,
    handleOpenPasteExcelModal,
  ]);

  // Auto-backup state (Requirement 5: JSON backup is now a contingency backup, disabled by default)
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
      return saved === null ? false : saved === 'true';
    } catch {
      return false;
    }
  });
  // Real-time Firestore Sync state (Requirements 1, 2, 3, 6, 8)
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [realtimeSyncStatus, setRealtimeSyncStatus] =
    useState<RealtimeSyncStatus>('unauthenticated');
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
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
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const isSigningInRef = useRef<boolean>(false);
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
        setHasActiveToken(Boolean(token));
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
          setNeedsReauth(false);
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

  // Listen to online/offline network status for Requirement 8 corner indicator
  useEffect(() => {
    const handleOnline = () => {
      setIsNetworkOnline(true);
      if (firebaseUid) {
        setRealtimeSyncStatus('synced');
      }
    };
    const handleOffline = () => {
      setIsNetworkOnline(false);
      setRealtimeSyncStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [firebaseUid]);

  // Requirement 1, 2, 3, 6: Listen to Firebase Auth UID and subscribe to real-time Firestore `users/{uid}/expenses`
  useEffect(() => {
    const auth = getFirebaseAuthInstance();
    let unsubscribeSnapshot: (() => void) | null = null;

    let isCancelled = false;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (user && user.uid) {
        try {
          await user.getIdToken();
        } catch {
          // Proceed with cached auth state if offline
        }
        if (isCancelled) return;

        setFirebaseUid(user.uid);
        ensureRootUserDocument(user).catch(() => {});

        unsubscribeSnapshot = subscribeToUserExpensesRealtime(
          user.uid,
          () => latestDataRef.current.expenses,
          (mergedExpenses) => {
            setExpenses(mergedExpenses);
            replaceAllExpenses(mergedExpenses).catch(() => {});
          },
          (status) => {
            setRealtimeSyncStatus(status);
          }
        );
      } else {
        setFirebaseUid(null);
        setRealtimeSyncStatus(navigator.onLine ? 'unauthenticated' : 'offline');
      }
    });

    return () => {
      isCancelled = true;
      unsubscribeAuth();
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }
    };
  }, []);

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

  // Requirement 1, 2, 3, 4: Sign in with Google (user-initiated only, guarded by isSigningIn ref + state)
  const handleGoogleLogin = async () => {
    if (isSigningInRef.current || isSigningIn || getIsSigningIn()) {
      console.debug('[Firebase Auth] Sign-in already in progress, ignoring duplicate click.');
      return;
    }

    isSigningInRef.current = true;
    setIsSigningIn(true);
    setDriveError(null);

    try {
      const result = await googleSignIn(saveCurrentContextBeforeRedirect);
      // If signInWithRedirect was triggered or popup was harmlessly cancelled, result is null
      if (!result) return;

      setDriveUser(result.user);
      setHasActiveToken(Boolean(result.accessToken));
      setNeedsReauth(false);
      showToast(
        `Đã kết nối tài khoản Google (${result.user.email || result.user.displayName}) & bật đồng bộ thời gian thực!`
      );

      if (result.accessToken) {
        await handlePostAuthDriveSync(result.accessToken, pendingRetryAfterReauthRef.current);
      }
    } catch (err: any) {
      const fbCode = err?.firebaseErrorCode || err?.code || '';
      const rawMsg = String(err?.message || '');

      // Requirement 2: Silently ignore auth/cancelled-popup-request (only debug log, no red error toast/banner)
      if (
        fbCode === 'auth/cancelled-popup-request' ||
        fbCode === 'auth/popup-closed-by-user' ||
        rawMsg.includes('auth/cancelled-popup-request')
      ) {
        console.debug('[Firebase Auth] Silently ignored cancelled popup request in UI:', err);
        return;
      }

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
    } finally {
      isSigningInRef.current = false;
      setIsSigningIn(false);
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
    isLanSyncModalOpen ||
    driveSyncModalState.isOpen ||
    isSettingsModalOpen ||
    isExpenseModalOpen ||
    isReceiptViewerOpen ||
    isImportModalOpen ||
    isExportModalOpen ||
    isBulkModalOpen ||
    isPDFExportModalOpen;

  const closeTopModal = useCallback((): boolean => {
    if (isLanSyncModalOpen) {
      setIsLanSyncModalOpen(false);
      return true;
    }
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
    isLanSyncModalOpen,
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:expenses_bulk_delete',
        expenseIds: idsToDelete,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        deleteExpensesBulkFromFirestore(firebaseUid, idsToDelete)
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:expenses_bulk_upsert',
        expenses: itemsToSave,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        syncExpensesBulkToFirestore(firebaseUid, itemsToSave)
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
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
        updatedAt: Date.now(),
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:expense_upsert',
        expense: itemWithProfile,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        syncExpenseToFirestore(firebaseUid, itemWithProfile, (updatedWithUrls) => {
          saveExpense(updatedWithUrls).catch(() => {});
        })
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
      scheduleAutoBackup(nextList);
    } catch (err: any) {
      console.error('Error saving expense:', err);
      showToast(err?.message || 'Không thể lưu khoản chi vào bộ nhớ trình duyệt.');
    }
  };

  // Action: Add Bulk Expenses from Message / Paste Excel
  const handleConfirmAddBulk = async (bulkItems: ExpenseItem[]) => {
    try {
      await saveExpensesBulk(bulkItems);
      let nextList: ExpenseItem[] = [];
      setExpenses((prev) => {
        nextList = [...bulkItems, ...prev];
        return nextList;
      });
      showToast(`Đã tách và thêm ${bulkItems.length} khoản chi!`);
      lanManagerRef.current?.broadcastData({
        action: 'sync:expenses_bulk_upsert',
        expenses: bulkItems,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        syncExpensesBulkToFirestore(firebaseUid, bulkItems)
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:expense_delete',
        expenseId: id,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        deleteExpenseFromFirestore(firebaseUid, id)
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:expense_upsert',
        expense: updated,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        syncExpenseToFirestore(firebaseUid, updated, (updatedWithUrls) => {
          saveExpense(updatedWithUrls).catch(() => {});
        })
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
      scheduleAutoBackup(nextList);
    } catch (err: any) {
      console.error('Error updating images:', err);
      showToast(err?.message || 'Không thể lưu ảnh chứng từ.');
    }
  };

  // Action: Drop image file(s) directly onto an expense row or card on the main screen ("ở ngoài")
  const handleDropFilesOnExpense = async (
    expense: ExpenseItem,
    files: Array<File | Blob>
  ) => {
    if (!files || files.length === 0) return;
    setIsGlobalDraggingFiles(false);
    globalDragDepthRef.current = 0;
    setUploadingExpenseId(expense.id);

    try {
      const newPhotos: string[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const compressed = await compressImage(files[i], 1280, 0.7);
          newPhotos.push(compressed);
        } catch (err) {
          console.error('Error compressing dropped image:', err);
        }
      }

      if (newPhotos.length > 0) {
        const updatedImages = [...(expense.images || []), ...newPhotos];
        await handleUpdateImages(expense.id, updatedImages);
        showToast(
          `Đã thả & đính kèm ${newPhotos.length} ảnh chứng từ vào "${expense.description}"!`
        );
      }
    } finally {
      setUploadingExpenseId(null);
    }
  };

  // Action: Paste screenshot from clipboard directly into a specific expense row/card on the main screen
  const handlePasteClipboardToExpense = async (expense: ExpenseItem) => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        handleOpenReceiptViewer(expense);
        showToast('Hãy bấm tổ hợp phím Ctrl+V để dán ảnh chụp màn hình vào khoản chi này.');
        return;
      }

      const items = await navigator.clipboard.read();
      const imageBlobs: Blob[] = [];
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          if (blob) imageBlobs.push(blob);
        }
      }

      if (imageBlobs.length > 0) {
        await handleDropFilesOnExpense(expense, imageBlobs);
      } else {
        showToast('Không tìm thấy ảnh trong bộ nhớ tạm. Hãy chụp màn hình (PrtScn / Win+Shift+S) trước.');
      }
    } catch {
      handleOpenReceiptViewer(expense);
      showToast('Đã mở khung chứng từ — Hãy bấm Ctrl+V để dán ảnh chụp màn hình.');
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:expense_upsert',
        expense: updated,
        timestamp: Date.now(),
      });
      if (firebaseUid) {
        setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
        syncExpenseToFirestore(firebaseUid, updated)
          .then(() => {
            if (navigator.onLine) setRealtimeSyncStatus('synced');
          })
          .catch(() => {});
      }
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:advance_upsert',
        advance: adv,
        timestamp: Date.now(),
      });
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:advance_delete',
        advanceId: id,
        timestamp: Date.now(),
      });
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:profile_upsert',
        profile: newProfile,
        timestamp: Date.now(),
      });
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:profile_upsert',
        profile: updated,
        timestamp: Date.now(),
      });
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
      lanManagerRef.current?.broadcastData({
        action: 'sync:profile_delete',
        profileId,
        timestamp: Date.now(),
      });
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
        const oldIds = expenses.map((e) => e.id);
        const saved = await replaceAllExpenses(itemsWithProfile);
        setExpenses(saved);
        setSelectedMonth('all');
        setSearchTerm('');
        showToast(`Đã thay thế toàn bộ bằng ${saved.length} khoản chi mới!`);
        lanManagerRef.current?.broadcastData({
          action: 'sync:full_state',
          mode: 'replace',
          expenses: saved,
          advances: latestDataRef.current.advances,
          profiles: latestDataRef.current.profiles,
          timestamp: Date.now(),
        });
        if (firebaseUid) {
          setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
          deleteExpensesBulkFromFirestore(firebaseUid, oldIds)
            .then(() => syncExpensesBulkToFirestore(firebaseUid, saved))
            .then(() => {
              if (navigator.onLine) setRealtimeSyncStatus('synced');
            })
            .catch(() => {});
        }
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
        lanManagerRef.current?.broadcastData({
          action: 'sync:expenses_bulk_upsert',
          expenses: itemsWithProfile,
          timestamp: Date.now(),
        });
        if (firebaseUid) {
          setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
          syncExpensesBulkToFirestore(firebaseUid, itemsWithProfile)
            .then(() => {
              if (navigator.onLine) setRealtimeSyncStatus('synced');
            })
            .catch(() => {});
        }
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

    lanManagerRef.current?.broadcastData({
      action: 'sync:full_state',
      mode,
      expenses: finalList,
      advances: restoredAdvances || latestDataRef.current.advances,
      profiles: restoredProfiles || latestDataRef.current.profiles,
      timestamp: Date.now(),
    });

    if (firebaseUid) {
      setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
      syncExpensesBulkToFirestore(firebaseUid, finalList)
        .then(() => {
          if (navigator.onLine) setRealtimeSyncStatus('synced');
        })
        .catch(() => {});
    }

    return {
      totalExpenses: finalList.length,
      totalImages,
    };
  };

  // Action: Clear All Data
  const handleClearAllData = async (): Promise<void> => {
    const oldIds = expenses.map((e) => e.id);
    await clearAllExpenses();
    await replaceAllAdvances([]);
    setExpenses([]);
    setAdvances([]);
    setSelectedMonth('all');
    setSearchTerm('');
    setOnlyMissingReceipts(false);
    setActiveReceiptExpense(null);
    lanManagerRef.current?.broadcastData({
      action: 'sync:clear_all',
      timestamp: Date.now(),
    });
    if (firebaseUid && oldIds.length > 0) {
      setRealtimeSyncStatus(navigator.onLine ? 'syncing' : 'offline');
      deleteExpensesBulkFromFirestore(firebaseUid, oldIds)
        .then(() => {
          if (navigator.onLine) setRealtimeSyncStatus('synced');
        })
        .catch(() => {});
    }
    showToast('Đã xóa toàn bộ dữ liệu chi tiêu hiện tại.');
  };

  // ============================================================================
  // REAL-TIME LAN / P2P SYNCHRONIZATION ENGINE INITIALIZATION & HANDLERS
  // ============================================================================
  const handleReceiveLanPayload = useCallback(
    async (payload: LanSyncPayload, fromPeer: { peerId: string; deviceName: string }) => {
      try {
        switch (payload.action) {
          case 'sync:full_state': {
            const incomingExpenses = Array.isArray(payload.expenses) ? payload.expenses : [];
            const mode = payload.mode || 'merge';
            let updatedExpenses: ExpenseItem[] = [];
            if (mode === 'replace') {
              updatedExpenses = await replaceAllExpenses(incomingExpenses);
            } else {
              updatedExpenses = await mergeExpensesWithExisting(
                incomingExpenses,
                latestDataRef.current.expenses
              );
            }
            setExpenses(updatedExpenses);

            if (Array.isArray(payload.advances) && payload.advances.length > 0) {
              const advMap = new Map<string, AdvancePaymentItem>();
              if (mode === 'merge') {
                latestDataRef.current.advances.forEach((a) => advMap.set(a.id, a));
              }
              payload.advances.forEach((a) => advMap.set(a.id, a));
              const savedAdv = await replaceAllAdvances(Array.from(advMap.values()));
              setAdvances(savedAdv);
            }

            if (Array.isArray(payload.profiles) && payload.profiles.length > 0) {
              const profMap = new Map<string, ExpenseProfile>();
              if (mode === 'merge') {
                latestDataRef.current.profiles.forEach((p) => profMap.set(p.id, p));
              }
              payload.profiles.forEach((p) => profMap.set(p.id, p));
              const savedProf = await replaceAllProfiles(Array.from(profMap.values()));
              setProfiles(savedProf);
            }

            showToast(
              `Đã đồng bộ LAN từ ${fromPeer.deviceName}: ${updatedExpenses.length} khoản chi!`
            );
            break;
          }

          case 'sync:expense_upsert': {
            const exp = payload.expense;
            if (!exp || !exp.id) break;
            await saveExpense(exp);
            setExpenses((prev) => {
              const exists = prev.some((it) => it.id === exp.id);
              return exists ? prev.map((it) => (it.id === exp.id ? exp : it)) : [exp, ...prev];
            });
            setActiveReceiptExpense((prev) => (prev && prev.id === exp.id ? exp : prev));
            showToast(`LAN (${fromPeer.deviceName}): Đã cập nhật "${exp.description}"`);
            break;
          }

          case 'sync:expenses_bulk_upsert': {
            const list = Array.isArray(payload.expenses) ? payload.expenses : [];
            if (list.length === 0) break;
            const merged = await mergeExpensesWithExisting(list, latestDataRef.current.expenses);
            setExpenses(merged);
            showToast(`LAN (${fromPeer.deviceName}): Đã đồng bộ ${list.length} khoản chi!`);
            break;
          }

          case 'sync:expense_delete': {
            const id = payload.expenseId;
            if (!id) break;
            await deleteExpense(id);
            setExpenses((prev) => prev.filter((it) => it.id !== id));
            break;
          }

          case 'sync:expenses_bulk_delete': {
            const ids = Array.isArray(payload.expenseIds) ? payload.expenseIds : [];
            if (ids.length === 0) break;
            const idSet = new Set(ids);
            for (const id of ids) {
              await deleteExpense(id);
            }
            setExpenses((prev) => prev.filter((it) => !idSet.has(it.id)));
            break;
          }

          case 'sync:clear_all': {
            await clearAllExpenses();
            await replaceAllAdvances([]);
            setExpenses([]);
            setAdvances([]);
            showToast(`LAN (${fromPeer.deviceName}): Đã xóa trắng dữ liệu.`);
            break;
          }

          case 'sync:advance_upsert': {
            const adv = payload.advance;
            if (!adv || !adv.id) break;
            await saveAdvance(adv);
            setAdvances((prev) => {
              const exists = prev.some((a) => a.id === adv.id);
              return exists ? prev.map((a) => (a.id === adv.id ? adv : a)) : [adv, ...prev];
            });
            break;
          }

          case 'sync:advance_delete': {
            const advId = payload.advanceId;
            if (!advId) break;
            await deleteAdvance(advId);
            setAdvances((prev) => prev.filter((a) => a.id !== advId));
            break;
          }

          case 'sync:profile_upsert': {
            const prof = payload.profile;
            if (!prof || !prof.id) break;
            await saveProfile(prof);
            setProfiles((prev) => {
              const exists = prev.some((p) => p.id === prof.id);
              return exists ? prev.map((p) => (p.id === prof.id ? prof : p)) : [...prev, prof];
            });
            break;
          }

          case 'sync:profile_delete': {
            const profId = payload.profileId;
            if (!profId) break;
            await deleteProfile(profId);
            setProfiles((prev) => prev.filter((p) => p.id !== profId));
            break;
          }
        }
      } catch (err) {
        console.error('[LAN Sync] Error applying incoming payload:', err);
      }
    },
    []
  );

  const handleReceiveLanPayloadRef = useRef(handleReceiveLanPayload);
  useEffect(() => {
    handleReceiveLanPayloadRef.current = handleReceiveLanPayload;
  }, [handleReceiveLanPayload]);

  useEffect(() => {
    const manager = new LanSyncManager({
      onStatusChange: (st, code) => {
        setLanStatus(st);
        setLanRoomCode(code);
      },
      onPeersChange: (peerList) => {
        setLanPeers(peerList);
      },
      onReceivePayload: (payload, fromPeer) => {
        handleReceiveLanPayloadRef.current(payload, fromPeer);
      },
      onLogActivity: (item) => {
        setLanActivityLogs((prev) => [item, ...prev].slice(0, 30));
      },
      getCurrentFullState: () => latestDataRef.current,
    });
    lanManagerRef.current = manager;

    // Check URL param ?lan=XXXXXX first (e.g. from QR scan)
    let initialCode = '';
    let fromUrlParam = false;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const lanParam = params.get('lan');
      if (lanParam && lanParam.trim()) {
        initialCode = lanParam.trim();
        fromUrlParam = true;
        // Clean URL param without reload
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);
      }
    }

    if (!initialCode && getAutoJoinLanRoom()) {
      initialCode = getSavedRoomCode();
    }

    if (initialCode) {
      manager.connect(initialCode).then(() => {
        if (fromUrlParam) {
          setIsLanSyncModalOpen(true);
          setTimeout(() => {
            manager.broadcastData({
              action: 'sync:request_full',
              mode: 'merge',
              timestamp: Date.now(),
            });
          }, 1000);
        }
      });
    }

    return () => {
      manager.disconnect(false);
    };
  }, []);

  const handleConnectLanRoom = (code: string) => {
    lanManagerRef.current?.connect(code);
    showToast(`Đã mở phòng đồng bộ LAN #${code}!`);
  };

  const handleDisconnectLanRoom = () => {
    lanManagerRef.current?.disconnect(false);
    showToast('Đã ngắt kết nối phòng đồng bộ LAN.');
  };

  const handlePushFullStateToLanPeers = (mode: 'merge' | 'replace') => {
    lanManagerRef.current?.broadcastData({
      action: 'sync:full_state',
      mode,
      expenses: latestDataRef.current.expenses,
      advances: latestDataRef.current.advances,
      profiles: latestDataRef.current.profiles,
      timestamp: Date.now(),
    });
    showToast(
      `Đã phát toàn bộ ${latestDataRef.current.expenses.length} khoản chi sang các máy trong phòng LAN!`
    );
  };

  const handleRequestFullStateFromLanPeers = () => {
    lanManagerRef.current?.broadcastData({
      action: 'sync:request_full',
      mode: 'merge',
      timestamp: Date.now(),
    });
    showToast('Đang yêu cầu dữ liệu từ các máy trong phòng LAN...');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-teal-100 selection:text-teal-900 pb-20 sm:pb-12">
      {/* Requirement 10: PWA Install & Offline Status Banner */}
      <PWAInstallBanner />

      {/* Requirement 8: Small Real-Time Sync Status Indicator at the Corner of the App */}
      <div className="fixed bottom-16 sm:bottom-4 left-3 sm:left-4 z-40 pointer-events-auto">
        {!isNetworkOnline || realtimeSyncStatus === 'offline' ? (
          <div
            title="Thiết bị đang mất kết nối mạng. Mọi thay đổi được lưu vào bộ nhớ đệm (IndexedDB) và sẽ tự đẩy lên Firestore khi có mạng lại."
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-rose-300 shadow-md text-[11px] font-semibold text-rose-900"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <span>Mất mạng - sẽ đồng bộ lại khi có mạng</span>
          </div>
        ) : realtimeSyncStatus === 'syncing' ? (
          <div
            title="Đang đồng bộ dữ liệu thời gian thực lên Firebase Firestore..."
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-amber-300 shadow-md text-[11px] font-semibold text-amber-900"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span>Đang đồng bộ...</span>
          </div>
        ) : firebaseUid ? (
          <div
            title="Dữ liệu đã được đồng bộ thời gian thực trên Firebase Firestore"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-emerald-200 shadow-md text-[11px] font-semibold text-emerald-900"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <span>Đã đồng bộ</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={isSigningIn}
            onClick={handleGoogleLogin}
            title="Bấm để đăng nhập Google và bật đồng bộ thời gian thực giữa điện thoại & máy tính"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-slate-200 hover:border-teal-300 disabled:opacity-70 disabled:cursor-not-allowed shadow-md text-[11px] font-semibold text-slate-700 hover:text-teal-900 transition-colors cursor-pointer"
          >
            {isSigningIn ? (
              <>
                <RefreshCw size={11} className="animate-spin text-teal-600 shrink-0" />
                <span>Đang đăng nhập Google...</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <span>Đã đồng bộ (Lưu nội bộ • Bấm để đồng bộ Cloud)</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 size={16} className="text-teal-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Dragging Files Indicator Banner ("Drop ở ngoài") */}
      {isGlobalDraggingFiles && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-xl w-[94%]">
          <div className="bg-teal-900/95 backdrop-blur-md text-white px-4 py-3 rounded-2xl shadow-2xl border-2 border-dashed border-teal-300 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-700 flex items-center justify-center shrink-0">
              <Upload size={18} className="text-teal-200 animate-bounce" />
            </div>
            <div className="text-xs">
              <p className="font-bold text-teal-100">
                Thả ảnh trực tiếp vào dòng / thẻ chi tiêu bất kỳ bên dưới để đính kèm chứng từ
              </p>
              <p className="text-[11px] text-teal-200/90 mt-0.5">
                Hoặc thả ảnh vào vùng trống bất kỳ trên màn hình để chọn khoản chi / tạo khoản chi mới bằng AI
              </p>
            </div>
          </div>
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
        onOpenPasteExcelModal={() => handleOpenPasteExcelModal()}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenBulkModal={() => setIsBulkModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenLanSyncModal={() => setIsLanSyncModalOpen(true)}
        lanConnected={lanStatus === 'connected' && Boolean(lanRoomCode)}
        lanRoomCode={lanRoomCode}
        lanPeersCount={lanPeers.length}
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
        {/* Requirement 9: Auto Backup & Real-Time Firestore Sync Status Bar */}
        <AutoBackupBar
          realtimeSyncStatus={realtimeSyncStatus}
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
          isSigningIn={isSigningIn}
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
          onOpenLanSyncModal={() => setIsLanSyncModalOpen(true)}
          lanConnected={lanStatus === 'connected' && Boolean(lanRoomCode)}
          lanRoomCode={lanRoomCode}
          lanPeersCount={lanPeers.length}
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
              onOpenPasteExcelModal={handleOpenPasteExcelModal}
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
                onDropFilesOnExpense={handleDropFilesOnExpense}
                onPasteClipboardToExpense={handlePasteClipboardToExpense}
                onHoverExpense={(id) => {
                  hoveredExpenseIdRef.current = id;
                }}
                uploadingExpenseId={uploadingExpenseId}
                isGlobalDraggingFiles={isGlobalDraggingFiles}
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
                settledMonthKeys={settledMonthKeys}
                collapsedMonthKeys={collapsedMonthKeys}
                onToggleCollapseMonth={handleToggleCollapseMonth}
                onToggleSettleMonth={handleToggleSettleMonth}
                onCollapseAllSettled={handleCollapseAllSettled}
                onCollapseAllMonths={() =>
                  handleCollapseAllMonths(monthGroups.map((g) => g.monthKey))
                }
                onExpandAllMonths={() =>
                  handleExpandAllMonths(monthGroups.map((g) => g.monthKey))
                }
              />
            ) : (
              <CardView
                monthGroups={monthGroups}
                onEditExpense={handleEditExpense}
                onDeleteExpense={handleDeleteExpense}
                onOpenReceiptViewer={handleOpenReceiptViewer}
                onAddNewToMonth={(month) => handleOpenAddModal(month)}
                onDropFilesOnExpense={handleDropFilesOnExpense}
                onPasteClipboardToExpense={handlePasteClipboardToExpense}
                onHoverExpense={(id) => {
                  hoveredExpenseIdRef.current = id;
                }}
                uploadingExpenseId={uploadingExpenseId}
                isGlobalDraggingFiles={isGlobalDraggingFiles}
                duplicateIdsSet={duplicateIdsSet}
                missingReceiptsCount={missingReceiptsCount}
                onlyMissingReceipts={onlyMissingReceipts}
                onToggleMissingReceipts={setOnlyMissingReceipts}
                totalExpensesCount={filteredExpenses.length}
                selectedIds={selectedExpenseIds}
                onToggleSelect={handleToggleSelect}
                settledMonthKeys={settledMonthKeys}
                collapsedMonthKeys={collapsedMonthKeys}
                onToggleCollapseMonth={handleToggleCollapseMonth}
                onToggleSettleMonth={handleToggleSettleMonth}
                onCollapseAllSettled={handleCollapseAllSettled}
                onCollapseAllMonths={() =>
                  handleCollapseAllMonths(monthGroups.map((g) => g.monthKey))
                }
                onExpandAllMonths={() =>
                  handleExpandAllMonths(monthGroups.map((g) => g.monthKey))
                }
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
          onClick={() => handleOpenPasteExcelModal()}
          className="min-h-[44px] flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ClipboardPaste size={18} />
          <span className="mt-0.5">Dán Excel</span>
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
        onClose={() => {
          setIsExpenseModalOpen(false);
          setInitialModalImages(null);
        }}
        onSave={handleSaveExpense}
        editingItem={editingExpense}
        defaultMonth={defaultMonthForNew}
        existingExpenses={expenses}
        activeProfileId={activeProfileId !== 'all' ? activeProfileId : 'default'}
        initialImages={initialModalImages}
        onClearInitialImages={() => setInitialModalImages(null)}
      />

      {/* Quick Outside-Dropped Receipt Assignment Modal */}
      {droppedOutsidePayload && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setDroppedOutsidePayload(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-teal-800 to-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
                  <ImagePlus size={19} className="text-teal-300" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold">
                    Đã nhận {droppedOutsidePayload.images.length} ảnh vừa thả ở ngoài màn hình
                  </h3>
                  <p className="text-[11px] text-teal-200">
                    Chọn khoản chi bên dưới để đính kèm ngay hoặc tạo khoản chi mới từ ảnh này
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDroppedOutsidePayload(null)}
                className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
              {/* Preview of dropped images & Primary Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2.5 overflow-x-auto">
                  {droppedOutsidePayload.images.map((img, idx) => (
                    <img
                      key={idx}
                      src={img}
                      alt={`Ảnh vừa thả ${idx + 1}`}
                      className="h-16 w-16 object-cover rounded-lg border border-slate-300 shadow-2xs shrink-0"
                    />
                  ))}
                  <div className="text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">
                      {droppedOutsidePayload.images.length} ảnh đã sẵn sàng
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Mẹo: Bạn cũng có thể thả thẳng ảnh vào từng dòng/thẻ trên bảng
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const imgs = droppedOutsidePayload.images;
                      setDroppedOutsidePayload(null);
                      setEditingExpense(null);
                      setInitialModalImages(imgs);
                      if (availableMonths.length > 0) {
                        setDefaultMonthForNew(availableMonths[availableMonths.length - 1]);
                      }
                      setIsExpenseModalOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  >
                    <Sparkles size={14} />
                    <span>Tạo khoản chi mới từ ảnh này (AI đọc HĐ)</span>
                  </button>

                  {droppedOutsidePayload.rawFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const firstFile = droppedOutsidePayload.rawFiles[0];
                        setDroppedOutsidePayload(null);
                        handleOpenPasteExcelModal({
                          id: `drop_excel_${Date.now()}`,
                          imageBlob: firstFile,
                        });
                      }}
                      className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ClipboardPaste size={14} />
                      <span>Quét bảng Excel từ ảnh</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Filter & Search Existing Expenses to Attach */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Hoặc bấm chọn 1 khoản chi có sẵn để gắn ảnh ngay:
                  </span>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
                    <button
                      type="button"
                      onClick={() => setDroppedOutsideFilter('missing')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                        droppedOutsideFilter === 'missing'
                          ? 'bg-white text-amber-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Đang thiếu ảnh (
                      {
                        profileExpenses.filter(
                          (e) => !Array.isArray(e.images) || e.images.length === 0
                        ).length
                      }
                      )
                    </button>
                    <button
                      type="button"
                      onClick={() => setDroppedOutsideFilter('all')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                        droppedOutsideFilter === 'all'
                          ? 'bg-white text-teal-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Tất cả ({profileExpenses.length})
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={droppedOutsideSearch}
                    onChange={(e) => setDroppedOutsideSearch(e.target.value)}
                    placeholder="Tìm nhanh theo ngày, nội dung hoặc số tiền..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600"
                  />
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
                  {profileExpenses
                    .filter((item) => {
                      if (
                        droppedOutsideFilter === 'missing' &&
                        Array.isArray(item.images) &&
                        item.images.length > 0
                      ) {
                        return false;
                      }
                      if (droppedOutsideSearch.trim()) {
                        const q = removeVietnameseAccents(droppedOutsideSearch.trim());
                        const desc = removeVietnameseAccents(item.description);
                        const dt = removeVietnameseAccents(item.date || '');
                        const amt = String(item.amount || '');
                        return desc.includes(q) || dt.includes(q) || amt.includes(q);
                      }
                      return true;
                    })
                    .slice(0, 40)
                    .map((item) => {
                      const imgCount = Array.isArray(item.images) ? item.images.length : 0;
                      return (
                        <div
                          key={item.id}
                          className="p-2.5 sm:px-3.5 flex items-center justify-between gap-2 hover:bg-teal-50/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-mono text-slate-500 shrink-0">
                                {item.date}
                              </span>
                              <span className="font-semibold text-slate-800 truncate">
                                {item.description}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                              <span className="font-bold font-mono text-teal-800">
                                {formatVND(item.amount)}
                              </span>
                              <span className="text-slate-400">•</span>
                              <span
                                className={
                                  imgCount > 0 ? 'text-teal-600' : 'text-amber-700 font-medium'
                                }
                              >
                                {imgCount > 0 ? `Đã có ${imgCount} ảnh` : 'Chưa có ảnh'}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={async () => {
                              const imgsToAppend = droppedOutsidePayload.images;
                              setDroppedOutsidePayload(null);
                              await handleUpdateImages(item.id, [
                                ...(item.images || []),
                                ...imgsToAppend,
                              ]);
                              showToast(
                                `Đã gắn ${imgsToAppend.length} ảnh vào "${item.description}"!`
                              );
                            }}
                            className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                          >
                            Gắn vào khoản này
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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

      <PasteExcelModal
        isOpen={isPasteExcelModalOpen}
        onClose={() => setIsPasteExcelModalOpen(false)}
        existingExpenses={expenses}
        defaultMonth={
          availableMonths.length > 0
            ? availableMonths[availableMonths.length - 1]
            : 'Tháng 4'
        }
        activeProfileId={activeProfileId !== 'all' ? activeProfileId : 'default'}
        onConfirmAddBulk={handleConfirmAddBulk}
        initialPayload={initialPastePayload}
        onClearInitialPayload={() => setInitialPastePayload(null)}
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
        isSigningIn={isSigningIn}
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

      <LanSyncModal
        isOpen={isLanSyncModalOpen}
        onClose={() => setIsLanSyncModalOpen(false)}
        status={lanStatus}
        roomCode={lanRoomCode}
        deviceName={lanDeviceName}
        onUpdateDeviceName={(name) => {
          setLanDeviceName(name);
          lanManagerRef.current?.setDeviceName(name);
        }}
        peers={lanPeers}
        activityLogs={lanActivityLogs}
        localExpensesCount={expenses.length}
        localImagesCount={expenses.reduce(
          (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
          0
        )}
        onConnectRoom={handleConnectLanRoom}
        onDisconnectRoom={handleDisconnectLanRoom}
        onPushFullStateToPeers={handlePushFullStateToLanPeers}
        onRequestFullStateFromPeers={handleRequestFullStateFromLanPeers}
      />
    </div>
  );
}
