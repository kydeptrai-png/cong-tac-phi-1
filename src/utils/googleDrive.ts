import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  ExpenseItem,
  AdvancePaymentItem,
  ExpenseProfile,
  NaturalExpenseParsed,
} from '../types';
import {
  DEFAULT_PROFILE,
  ValidatedBackupResult,
  parseAndValidateBackupJSON,
  serializeBackupJSON,
} from './db';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
export const DRIVE_BACKUP_FILENAME = 'CongTacPhi_backup.json';

// Non-sensitive metadata keys in localStorage (Access token is NEVER stored in localStorage/sessionStorage)
export const USER_GOOGLE_CLIENT_ID_STORAGE = 'so_chi_tieu_google_client_id';
export const USER_FIREBASE_AUTH_DOMAIN_STORAGE = 'so_chi_tieu_firebase_auth_domain';
export const PREFERRED_AUTH_FLOW_STORAGE = 'so_chi_tieu_preferred_auth_flow';
export const PENDING_REDIRECT_MARKER_STORAGE = 'so_chi_tieu_pending_auth_redirect';
export const APP_UI_CONTEXT_STORAGE = 'so_chi_tieu_ui_context_snapshot';
export const DRAFT_EXPENSE_MODAL_STORAGE = 'so_chi_tieu_draft_expense_modal';
export const DRAFT_NATURAL_INPUT_STORAGE = 'so_chi_tieu_draft_natural_input';
export const DRAFT_BULK_MODAL_STORAGE = 'so_chi_tieu_draft_bulk_modal';

export const DRIVE_FILE_ID_STORAGE = 'so_chi_tieu_drive_backup_file_id';
export const DRIVE_LAST_SYNC_TIME_STORAGE = 'so_chi_tieu_drive_last_sync_time';
export const DRIVE_LAST_SYNC_ISO_STORAGE = 'so_chi_tieu_drive_last_sync_iso';
export const LOCAL_LAST_MODIFIED_ISO_STORAGE = 'so_chi_tieu_local_last_modified_iso';
export const AUTO_DRIVE_SYNC_ENABLED_STORAGE = 'so_chi_tieu_auto_drive_sync_enabled';

// Threshold for switching from multipart upload to resumable upload (3 MB)
const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 3 * 1024 * 1024;

/**
 * Requirement 4: Ensure authDomain in Firebase config is ALWAYS the exact deployed domain
 * (`gen-lang-client-0900718817.firebaseapp.com` or custom deployed domain),
 * and NEVER changed to `localhost` or `capacitor://localhost` when packaged as APK/TWA.
 */
export const DEFAULT_FIREBASE_AUTH_DOMAIN =
  firebaseConfig.authDomain || 'gen-lang-client-0900718817.firebaseapp.com';

export function getUserCustomAuthDomain(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(USER_FIREBASE_AUTH_DOMAIN_STORAGE)?.trim() || '';
  } catch {
    return '';
  }
}

export function setUserCustomAuthDomain(domain: string): void {
  if (typeof window === 'undefined') return;
  try {
    const cleaned = domain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (cleaned && cleaned !== 'localhost' && !cleaned.startsWith('127.0.0.1')) {
      localStorage.setItem(USER_FIREBASE_AUTH_DOMAIN_STORAGE, cleaned);
    } else {
      localStorage.removeItem(USER_FIREBASE_AUTH_DOMAIN_STORAGE);
    }
  } catch (err) {
    console.warn('Failed to save custom authDomain:', err);
  }
}

export function getEffectiveAuthDomain(): string {
  const envDomain = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  const customDomain = getUserCustomAuthDomain();
  const candidate = customDomain || envDomain || DEFAULT_FIREBASE_AUTH_DOMAIN;

  // Guard: Never allow localhost or capacitor:// schemes to overwrite authDomain in packaged APK
  if (
    !candidate ||
    candidate === 'localhost' ||
    candidate.startsWith('localhost:') ||
    candidate.startsWith('127.0.0.1') ||
    candidate.includes('capacitor://')
  ) {
    return DEFAULT_FIREBASE_AUTH_DOMAIN;
  }
  return candidate;
}

/**
 * Requirement 2: Detect if running in Standalone / TWA / Capacitor / WebView mode
 * so we automatically use `signInWithRedirect` + `getRedirectResult` instead of `signInWithPopup`.
 */
export interface StandaloneEnvironmentInfo {
  isStandalone: boolean;
  modeLabel: string;
  reasons: string[];
  details: {
    displayModeStandalone: boolean;
    isIOSStandalone: boolean;
    isTWA: boolean;
    isCapacitor: boolean;
    isAndroidWebView: boolean;
  };
}

export function detectStandaloneEnvironment(): StandaloneEnvironmentInfo {
  if (typeof window === 'undefined') {
    return {
      isStandalone: false,
      modeLabel: 'Web Browser',
      reasons: [],
      details: {
        displayModeStandalone: false,
        isIOSStandalone: false,
        isTWA: false,
        isCapacitor: false,
        isAndroidWebView: false,
      },
    };
  }

  const reasons: string[] = [];

  // 1. CSS display-mode: standalone / fullscreen / minimal-ui
  const displayModeStandalone = Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: fullscreen)').matches ||
      window.matchMedia?.('(display-mode: minimal-ui)').matches
  );
  if (displayModeStandalone) {
    reasons.push('display-mode: standalone');
  }

  // 2. iOS Safari standalone
  const isIOSStandalone = Boolean((window.navigator as any)?.standalone === true);
  if (isIOSStandalone) {
    reasons.push('navigator.standalone (iOS)');
  }

  // 3. Android TWA (Trusted Web Activity)
  const isTWA = Boolean(
    typeof document !== 'undefined' && document.referrer?.startsWith('android-app://')
  );
  if (isTWA) {
    reasons.push(`TWA (${document.referrer})`);
  }

  // 4. Capacitor runtime or VITE_CAPACITOR env variable
  const cap = (window as any).Capacitor;
  const isCapacitor = Boolean(
    cap?.isNativePlatform?.() ||
      cap?.isNative ||
      (cap?.getPlatform && cap.getPlatform() !== 'web') ||
      import.meta.env.VITE_CAPACITOR === 'true' ||
      window.location.protocol === 'capacitor:'
  );
  if (isCapacitor) {
    reasons.push('Capacitor Native/APK');
  }

  // 5. Android WebView userAgent indicator
  const ua = window.navigator.userAgent || '';
  const isAndroidWebView = Boolean(
    /; wv\b/i.test(ua) || (/Android/i.test(ua) && /Version\/\d+\.\d+/i.test(ua))
  );
  if (isAndroidWebView) {
    reasons.push('Android WebView');
  }

  const isStandalone =
    displayModeStandalone || isIOSStandalone || isTWA || isCapacitor || isAndroidWebView;

  const modeLabel = isStandalone
    ? `App đóng gói / Standalone (${reasons.join(', ')})`
    : 'Trình duyệt Web tiêu chuẩn';

  return {
    isStandalone,
    modeLabel,
    reasons,
    details: {
      displayModeStandalone,
      isIOSStandalone,
      isTWA,
      isCapacitor,
      isAndroidWebView,
    },
  };
}

export type AuthFlowPreference = 'auto' | 'redirect' | 'popup';

export function getPreferredAuthFlowMode(): AuthFlowPreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const val = localStorage.getItem(PREFERRED_AUTH_FLOW_STORAGE);
    if (val === 'redirect' || val === 'popup' || val === 'auto') return val;
    return 'auto';
  } catch {
    return 'auto';
  }
}

export function setPreferredAuthFlowMode(mode: AuthFlowPreference): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFERRED_AUTH_FLOW_STORAGE, mode);
  } catch {
    // ignore
  }
}

export function shouldUseRedirectFlow(): boolean {
  const pref = getPreferredAuthFlowMode();
  if (pref === 'redirect') return true;
  if (pref === 'popup') return false;
  return detectStandaloneEnvironment().isStandalone;
}

// Initialize Firebase App & Auth with verified authDomain
const resolvedFirebaseConfig = {
  ...firebaseConfig,
  authDomain: getEffectiveAuthDomain(),
};

const app = initializeApp(resolvedFirebaseConfig);
const auth = getAuth(app);

// Ensure persistence is browserLocalPersistence so redirect state is preserved across navigation
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] setPersistence warning:', err);
});

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'select_account',
});

// In-memory only access token cache (NEVER persisted to localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUserInfo: GoogleDriveUser | null = null;

// Diagnostic log of the latest getRedirectResult / Auth operation for debugging on Android
export interface AuthDiagnosticLog {
  timestamp: string;
  flowUsed: 'redirect' | 'popup' | 'gis' | 'startup_check';
  authDomain: string;
  currentOrigin: string;
  environment: string;
  redirectResultParams?: Record<string, any> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

let lastAuthDiagnosticLog: AuthDiagnosticLog | null = null;

export function getLastAuthDiagnosticLog(): AuthDiagnosticLog | null {
  return lastAuthDiagnosticLog;
}

export interface GoogleDriveUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  authMethod: 'firebase' | 'gis';
}

export interface DriveBackupMetadata {
  id: string;
  name: string;
  modifiedTime: string;
  size?: number;
}

export type DriveErrorCode =
  | 'OFFLINE'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'MISSING_CLIENT_ID'
  | 'FIREBASE_AUTH_ERROR'
  | 'UNKNOWN';

export class DriveSyncError extends Error {
  code: DriveErrorCode;
  firebaseErrorCode?: string;
  constructor(
    message: string,
    code: DriveErrorCode = 'UNKNOWN',
    firebaseErrorCode?: string
  ) {
    super(message);
    this.name = 'DriveSyncError';
    this.code = code;
    this.firebaseErrorCode = firebaseErrorCode;
  }
}

/**
 * Requirement 3: Format Firebase Auth error with explicit Firebase error code
 * (`auth/invalid-action-code`, `auth/unauthorized-domain`, etc.) so it is clearly shown on screen.
 */
export function formatFirebaseAuthError(error: any, context: string): DriveSyncError {
  const fbCode: string = error?.code || 'auth/unknown-error';
  const rawMsg: string = error?.message || 'Lỗi không xác định từ Firebase Authentication';

  console.error(`[Firebase Auth Error in ${context}]`, {
    code: fbCode,
    message: rawMsg,
    email: error?.customData?.email || error?.email || null,
    customData: error?.customData || null,
    authDomain: getEffectiveAuthDomain(),
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    href: typeof window !== 'undefined' ? window.location.href : '',
    standalone: detectStandaloneEnvironment(),
    rawError: error,
  });

  let friendlyExplanation = '';

  switch (fbCode) {
    case 'auth/invalid-action-code':
      friendlyExplanation =
        `Lỗi [${fbCode}] ("The requested action is invalid"): Phiên chuyển hướng đăng nhập trên firebaseapp.com không hợp lệ hoặc đã hết hạn do trình duyệt trong APK/TWA chặn trạng thái trung gian. ` +
        `Cách khắc phục: (1) Hãy thử chọn chế độ "Luôn dùng Redirect" hoặc dán Google Client ID trong Cài đặt; (2) Kiểm tra tên miền "${window.location.hostname}" và "${getEffectiveAuthDomain()}" đã có trong Firebase Console → Authentication → Settings → Authorized domains.`;
      break;

    case 'auth/unauthorized-domain':
      friendlyExplanation =
        `Lỗi [${fbCode}]: Tên miền hiện tại (${window.location.origin}) chưa được cấp phép trong Firebase Authentication. ` +
        `Vui lòng vào Firebase Console → Authentication → Settings → Authorized domains và thêm "${window.location.hostname}".`;
      break;

    case 'auth/operation-not-supported-in-this-environment':
      friendlyExplanation =
        `Lỗi [${fbCode}]: Môi trường hiện tại (WebView / APK) không hỗ trợ phương thức đăng nhập này hoặc chưa bật DOM Storage. Ứng dụng đã chuyển sang chế độ Redirect.`;
      break;

    case 'auth/web-storage-unsupported':
      friendlyExplanation =
        `Lỗi [${fbCode}]: Trình duyệt hoặc WebView đang tắt Cookie / Web Storage của bên thứ ba nên không lưu được phiên đăng nhập.`;
      break;

    case 'auth/popup-blocked':
      friendlyExplanation =
        `Lỗi [${fbCode}]: Cửa sổ đăng nhập (Popup) bị chặn trên thiết bị này. Vui lòng thử lại để đăng nhập bằng chế độ chuyển hướng (Redirect).`;
      break;

    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      friendlyExplanation = `Lỗi [${fbCode}]: Cửa sổ đăng nhập Google đã bị đóng trước khi hoàn tất (${rawMsg}).`;
      break;

    case 'auth/network-request-failed':
      friendlyExplanation = `Lỗi [${fbCode}]: Lỗi kết nối mạng khi liên lạc với máy chủ xác thực Google Firebase.`;
      break;

    default:
      friendlyExplanation = `Lỗi xác thực Firebase [${fbCode}] khi ${context}: ${rawMsg}`;
      break;
  }

  return new DriveSyncError(friendlyExplanation, 'FIREBASE_AUTH_ERROR', fbCode);
}

/**
 * Requirement 5: Save & Restore App State and Unsaved Input Drafts across `signInWithRedirect`
 */
export interface AppUIContextSnapshot {
  currentTab: 'expenses' | 'dashboard';
  viewMode: 'table' | 'card';
  activeProfileId: string;
  selectedMonth: string;
  searchTerm: string;
  startDate: string;
  endDate: string;
  minAmount: number | '';
  maxAmount: number | '';
  receiptFilter: 'all' | 'has_receipt' | 'no_receipt';
  onlyMissingReceipts: boolean;
  openModal: 'none' | 'expense' | 'bulk' | 'settings' | 'export' | 'import' | 'pdf';
  editingExpense: ExpenseItem | null;
  defaultMonthForNew: string;
  pendingDriveSyncAfterAuth: boolean;
  savedAt: number;
}

export function saveAppUIContextSnapshot(snapshot: AppUIContextSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(APP_UI_CONTEXT_STORAGE, JSON.stringify(snapshot));
    localStorage.setItem(APP_UI_CONTEXT_STORAGE, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Could not save UI context snapshot:', err);
  }
}

export function loadAppUIContextSnapshot(): AppUIContextSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      sessionStorage.getItem(APP_UI_CONTEXT_STORAGE) ||
      localStorage.getItem(APP_UI_CONTEXT_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUIContextSnapshot;
    // Valid for 30 minutes
    if (Date.now() - (parsed.savedAt || 0) > 30 * 60 * 1000) {
      clearAppUIContextSnapshot();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAppUIContextSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(APP_UI_CONTEXT_STORAGE);
    localStorage.removeItem(APP_UI_CONTEXT_STORAGE);
  } catch {
    // ignore
  }
}

// Drafts for ExpenseModal, NaturalExpenseInput, BulkMessageModal so unsaved input is never lost on redirect
export interface ExpenseModalDraft {
  editingItemId: string | null;
  description: string;
  amount: number | '';
  month: string;
  date: string;
  notes: string;
  images: string[];
  naturalText: string;
  updatedAt: number;
}

export function saveExpenseModalDraft(draft: ExpenseModalDraft | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!draft) {
      sessionStorage.removeItem(DRAFT_EXPENSE_MODAL_STORAGE);
      localStorage.removeItem(DRAFT_EXPENSE_MODAL_STORAGE);
    } else {
      const serialized = JSON.stringify(draft);
      sessionStorage.setItem(DRAFT_EXPENSE_MODAL_STORAGE, serialized);
      localStorage.setItem(DRAFT_EXPENSE_MODAL_STORAGE, serialized);
    }
  } catch {
    // Ignore quota errors if many large images in draft
  }
}

export function loadExpenseModalDraft(): ExpenseModalDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      sessionStorage.getItem(DRAFT_EXPENSE_MODAL_STORAGE) ||
      localStorage.getItem(DRAFT_EXPENSE_MODAL_STORAGE);
    if (!raw) return null;
    return JSON.parse(raw) as ExpenseModalDraft;
  } catch {
    return null;
  }
}

export interface NaturalInputDraft {
  inputText: string;
  preview: NaturalExpenseParsed | null;
  isEditingPreview: boolean;
  editDate: string;
  editAmount: number | string;
  editDescription: string;
}

export function saveNaturalInputDraft(draft: NaturalInputDraft | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!draft || (!draft.inputText.trim() && !draft.preview)) {
      sessionStorage.removeItem(DRAFT_NATURAL_INPUT_STORAGE);
      localStorage.removeItem(DRAFT_NATURAL_INPUT_STORAGE);
    } else {
      const serialized = JSON.stringify(draft);
      sessionStorage.setItem(DRAFT_NATURAL_INPUT_STORAGE, serialized);
      localStorage.setItem(DRAFT_NATURAL_INPUT_STORAGE, serialized);
    }
  } catch {
    // ignore
  }
}

export function loadNaturalInputDraft(): NaturalInputDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      sessionStorage.getItem(DRAFT_NATURAL_INPUT_STORAGE) ||
      localStorage.getItem(DRAFT_NATURAL_INPUT_STORAGE);
    if (!raw) return null;
    return JSON.parse(raw) as NaturalInputDraft;
  } catch {
    return null;
  }
}

export interface BulkModalDraft {
  rawText: string;
  previewRows: Array<{
    tempId: string;
    date: string;
    amount: number;
    description: string;
  }>;
  duplicateAction: 'skip' | 'keep';
}

export function saveBulkModalDraft(draft: BulkModalDraft | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!draft || (!draft.rawText.trim() && draft.previewRows.length === 0)) {
      sessionStorage.removeItem(DRAFT_BULK_MODAL_STORAGE);
      localStorage.removeItem(DRAFT_BULK_MODAL_STORAGE);
    } else {
      const serialized = JSON.stringify(draft);
      sessionStorage.setItem(DRAFT_BULK_MODAL_STORAGE, serialized);
      localStorage.setItem(DRAFT_BULK_MODAL_STORAGE, serialized);
    }
  } catch {
    // ignore
  }
}

export function loadBulkModalDraft(): BulkModalDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      sessionStorage.getItem(DRAFT_BULK_MODAL_STORAGE) ||
      localStorage.getItem(DRAFT_BULK_MODAL_STORAGE);
    if (!raw) return null;
    return JSON.parse(raw) as BulkModalDraft;
  } catch {
    return null;
  }
}

function setPendingRedirectMarker(pending: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (pending) {
      localStorage.setItem(
        PENDING_REDIRECT_MARKER_STORAGE,
        JSON.stringify({ startedAt: Date.now(), href: window.location.href })
      );
    } else {
      localStorage.removeItem(PENDING_REDIRECT_MARKER_STORAGE);
    }
  } catch {
    // ignore
  }
}

function getPendingRedirectMarker(): { startedAt: number; href: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_REDIRECT_MARKER_STORAGE);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get/Set User's custom Google Client ID in localStorage (similar to Gemini API Key)
 */
export function getUserGoogleClientId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(USER_GOOGLE_CLIENT_ID_STORAGE)?.trim() || '';
  } catch {
    return '';
  }
}

export function setUserGoogleClientId(clientId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = clientId.trim();
    if (trimmed) {
      localStorage.setItem(USER_GOOGLE_CLIENT_ID_STORAGE, trimmed);
    } else {
      localStorage.removeItem(USER_GOOGLE_CLIENT_ID_STORAGE);
    }
  } catch (err) {
    console.warn('Failed to save Google Client ID:', err);
  }
}

export function getDefaultGoogleClientId(): string {
  return firebaseConfig.oAuthClientId || '';
}

export function getEffectiveGoogleClientId(): string {
  return getUserGoogleClientId() || getDefaultGoogleClientId();
}

/**
 * Get/Set Saved Drive File ID so we ALWAYS update the exact same file on Google Drive
 */
export function getSavedDriveFileId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(DRIVE_FILE_ID_STORAGE)?.trim() || null;
  } catch {
    return null;
  }
}

export function setSavedDriveFileId(fileId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (fileId) {
      localStorage.setItem(DRIVE_FILE_ID_STORAGE, fileId);
    } else {
      localStorage.removeItem(DRIVE_FILE_ID_STORAGE);
    }
  } catch {
    // ignore
  }
}

/**
 * Get/Set Drive sync timestamps & auto-sync preference
 */
export function getLastDriveSyncTime(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(DRIVE_LAST_SYNC_TIME_STORAGE);
  } catch {
    return null;
  }
}

export function getLastDriveSyncIso(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(DRIVE_LAST_SYNC_ISO_STORAGE);
  } catch {
    return null;
  }
}

export function saveDriveSyncTimestamp(isoTime: string): string {
  const dateObj = new Date(isoTime || Date.now());
  const formatted =
    dateObj.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) +
    ' ' +
    dateObj.toLocaleDateString('vi-VN');

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(DRIVE_LAST_SYNC_TIME_STORAGE, formatted);
      localStorage.setItem(DRIVE_LAST_SYNC_ISO_STORAGE, dateObj.toISOString());
    } catch {
      // ignore
    }
  }
  return formatted;
}

export function getLocalLastModifiedIso(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LOCAL_LAST_MODIFIED_ISO_STORAGE);
  } catch {
    return null;
  }
}

export function markLocalDataModified(): string {
  const nowIso = new Date().toISOString();
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_LAST_MODIFIED_ISO_STORAGE, nowIso);
    } catch {
      // ignore
    }
  }
  return nowIso;
}

export function getAutoDriveSyncEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(AUTO_DRIVE_SYNC_ENABLED_STORAGE);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setAutoDriveSyncEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTO_DRIVE_SYNC_ENABLED_STORAGE, String(enabled));
  } catch {
    // ignore
  }
}

/**
 * Dynamically load Google Identity Services (GIS) script in browser if needed
 */
let gisScriptPromise: Promise<void> | null = null;

export function loadGoogleIdentityServicesScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new DriveSyncError('Không thể tải thư viện Google Identity Services.', 'OFFLINE'))
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisScriptPromise = null;
      reject(
        new DriveSyncError(
          'Không thể tải thư viện Google Identity Services. Vui lòng kiểm tra kết nối mạng.',
          'OFFLINE'
        )
      );
    };
    document.head.appendChild(script);
  });

  return gisScriptPromise;
}

/**
 * Authenticate via Google Identity Services (GIS) browser TokenClient
 * Requests scope https://www.googleapis.com/auth/drive.file
 */
export async function signInWithGIS(
  customClientId?: string,
  loginHint?: string
): Promise<{ user: GoogleDriveUser; accessToken: string }> {
  const clientId = (customClientId || getEffectiveGoogleClientId()).trim();
  if (!clientId) {
    throw new DriveSyncError(
      'Chưa có Google Client ID. Vui lòng mở Cài đặt để dán Google Client ID của bạn.',
      'MISSING_CLIENT_ID'
    );
  }

  await loadGoogleIdentityServicesScript();
  const oauth2 = (window as any).google?.accounts?.oauth2;
  if (!oauth2) {
    throw new DriveSyncError(
      'Thư viện Google Identity Services chưa sẵn sàng trên trình duyệt.',
      'UNKNOWN'
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        hint: loginHint || cachedUserInfo?.email || undefined,
        callback: async (tokenResponse: any) => {
          if (tokenResponse?.error) {
            isSigningIn = false;
            reject(
              new DriveSyncError(
                `Đăng nhập Google (GIS) thất bại [${tokenResponse.error}]: ${
                  tokenResponse.error_description || tokenResponse.error
                }`,
                tokenResponse.error === 'access_denied' ? 'PERMISSION_DENIED' : 'UNKNOWN',
                tokenResponse.error
              )
            );
            return;
          }

          const token = tokenResponse?.access_token;
          if (!token) {
            isSigningIn = false;
            reject(
              new DriveSyncError('Không nhận được mã truy cập (Access Token) từ Google.', 'UNKNOWN')
            );
            return;
          }

          if (
            token2HasRequiredScope(tokenResponse, 'https://www.googleapis.com/auth/drive.file') ===
            false
          ) {
            isSigningIn = false;
            reject(
              new DriveSyncError(
                'Bạn chưa tích chọn cấp quyền truy cập file Google Drive (drive.file). Vui lòng đăng nhập lại và tích chọn quyền Drive.',
                'PERMISSION_DENIED'
              )
            );
            return;
          }

          cachedAccessToken = token;
          const driveUser = await fetchDriveUserInfo(token);
          cachedUserInfo = driveUser;
          isSigningIn = false;
          resolve({ user: driveUser, accessToken: token });
        },
        error_callback: (err: any) => {
          isSigningIn = false;
          if (err?.type === 'popup_closed') {
            reject(new DriveSyncError('Đã đóng cửa sổ đăng nhập Google.', 'UNKNOWN'));
          } else if (err?.type === 'popup_failed_to_open') {
            reject(
              new DriveSyncError(
                'Trình duyệt chặn cửa sổ bật lên (Popup). Vui lòng cho phép mở popup.',
                'UNKNOWN'
              )
            );
          } else {
            reject(
              new DriveSyncError(
                `Không thể mở đăng nhập Google (${err?.type || 'Lỗi kết nối'}).`,
                'UNKNOWN'
              )
            );
          }
        },
      });

      isSigningIn = true;
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (e: any) {
      isSigningIn = false;
      reject(new DriveSyncError(e?.message || 'Lỗi khởi tạo đăng nhập Google.', 'UNKNOWN'));
    }
  });
}

function token2HasRequiredScope(tokenResponse: any, requiredScope: string): boolean {
  const oauth2 = (window as any).google?.accounts?.oauth2;
  if (oauth2 && typeof oauth2.hasGrantedAllScopes === 'function') {
    return oauth2.hasGrantedAllScopes(tokenResponse, requiredScope);
  }
  if (typeof tokenResponse?.scope === 'string') {
    return tokenResponse.scope.includes('drive.file') || tokenResponse.scope.includes('drive');
  }
  return true;
}

/**
 * Fetches basic user info from Google Drive /about endpoint using drive.file scope
 */
async function fetchDriveUserInfo(accessToken: string): Promise<GoogleDriveUser> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink,permissionId)',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.user) {
        return {
          uid: data.user.permissionId || data.user.emailAddress || 'gis_user',
          displayName: data.user.displayName || 'Người dùng Google Drive',
          email: data.user.emailAddress || null,
          photoURL: data.user.photoLink || null,
          authMethod: 'gis',
        };
      }
    }
  } catch {
    // Fallback if /about is not available
  }

  return (
    cachedUserInfo || {
      uid: 'gis_user',
      displayName: 'Tài khoản Google Drive',
      email: null,
      photoURL: null,
      authMethod: 'gis',
    }
  );
}

/**
 * Requirement 1, 2, 3, 5:
 * Initialize auth state listener AND process `getRedirectResult(auth)` when the app starts up.
 * - Logs all returned parameters from `getRedirectResult`
 * - Catches and surfaces specific Firebase error codes (`auth/invalid-action-code`, `auth/unauthorized-domain`, etc.)
 * - Restores session and triggers callback when returning from redirect login
 */
export const initAuth = (
  onAuthSuccess?: (user: GoogleDriveUser, token: string, isFromRedirect?: boolean) => void,
  onAuthFailure?: (userWithoutToken?: GoogleDriveUser | null) => void,
  onRedirectError?: (err: DriveSyncError) => void
) => {
  const envInfo = detectStandaloneEnvironment();
  const pendingRedirect = getPendingRedirectMarker();

  // Check URL for any explicit OAuth error query parameters returned from redirect handler
  if (typeof window !== 'undefined') {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlError = urlParams.get('error') || urlParams.get('errorCode');
      const urlErrorDesc = urlParams.get('error_description') || urlParams.get('errorMessage');
      if (urlError) {
        console.error('[Firebase Auth URL Error Param]:', { urlError, urlErrorDesc });
        const errObj = new DriveSyncError(
          `Lỗi trả về từ trang đăng nhập [${urlError}]: ${urlErrorDesc || urlError}`,
          'FIREBASE_AUTH_ERROR',
          urlError
        );
        if (onRedirectError) onRedirectError(errObj);
      }
    } catch {
      // ignore
    }
  }

  // Requirement 1 & 3: Call getRedirectResult(auth) on app startup and log all returned parameters
  isSigningIn = true;
  getRedirectResult(auth)
    .then((result) => {
      const credential = result ? GoogleAuthProvider.credentialFromResult(result) : null;
      const tokenFromCredential =
        credential?.accessToken || (result as any)?._tokenResponse?.oauthAccessToken || null;

      const diagnosticPayload = {
        hasResult: Boolean(result),
        hadPendingRedirectMarker: Boolean(pendingRedirect),
        operationType: result?.operationType || null,
        providerId: result?.providerId || null,
        authDomain: getEffectiveAuthDomain(),
        currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        environment: envInfo.modeLabel,
        user: result?.user
          ? {
              uid: result.user.uid,
              email: result.user.email,
              displayName: result.user.displayName,
              photoURL: result.user.photoURL,
              emailVerified: result.user.emailVerified,
            }
          : null,
        credential: credential
          ? {
              providerId: credential.providerId,
              signInMethod: credential.signInMethod,
              hasAccessToken: Boolean(credential.accessToken),
              hasIdToken: Boolean(credential.idToken),
            }
          : null,
        tokenResponseSummary: (result as any)?._tokenResponse
          ? {
              hasOauthAccessToken: Boolean((result as any)._tokenResponse.oauthAccessToken),
              email: (result as any)._tokenResponse.email || null,
              federatedId: (result as any)._tokenResponse.federatedId || null,
            }
          : null,
      };

      console.log('[Firebase Auth] getRedirectResult startup inspection:', diagnosticPayload);

      lastAuthDiagnosticLog = {
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        flowUsed: result ? 'redirect' : 'startup_check',
        authDomain: getEffectiveAuthDomain(),
        currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        environment: envInfo.modeLabel,
        redirectResultParams: diagnosticPayload,
        errorCode: null,
        errorMessage: null,
      };

      setPendingRedirectMarker(false);

      if (result && result.user) {
        const mappedUser: GoogleDriveUser = {
          uid: result.user.uid,
          displayName: result.user.displayName,
          email: result.user.email,
          photoURL: result.user.photoURL,
          authMethod: 'firebase',
        };
        cachedUserInfo = mappedUser;

        if (tokenFromCredential) {
          cachedAccessToken = tokenFromCredential;
          isSigningIn = false;
          if (onAuthSuccess) {
            onAuthSuccess(mappedUser, tokenFromCredential, true);
          }
          return;
        } else {
          // User returned from redirect but credential had no OAuth accessToken
          console.warn(
            '[Firebase Auth] getRedirectResult returned user without OAuth accessToken:',
            diagnosticPayload
          );
          isSigningIn = false;
          if (onRedirectError) {
            onRedirectError(
              new DriveSyncError(
                'Đăng nhập Redirect thành công nhưng chưa lấy được Access Token cho Google Drive. Vui lòng bấm "Đăng nhập lại" hoặc dán Google Client ID trong Cài đặt.',
                'TOKEN_EXPIRED',
                'auth/missing-oauth-access-token'
              )
            );
          }
        }
      } else {
        isSigningIn = false;
      }
    })
    .catch((error: any) => {
      isSigningIn = false;
      setPendingRedirectMarker(false);

      const formattedErr = formatFirebaseAuthError(error, 'getRedirectResult');
      lastAuthDiagnosticLog = {
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        flowUsed: 'redirect',
        authDomain: getEffectiveAuthDomain(),
        currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        environment: envInfo.modeLabel,
        redirectResultParams: {
          customData: error?.customData || null,
          email: error?.customData?.email || error?.email || null,
        },
        errorCode: error?.code || 'auth/unknown',
        errorMessage: formattedErr.message,
      };

      if (onRedirectError) {
        onRedirectError(formattedErr);
      }
    });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const mappedUser: GoogleDriveUser = {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        authMethod: 'firebase',
      };
      cachedUserInfo = mappedUser;

      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(mappedUser, cachedAccessToken, false);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure(mappedUser);
      }
    } else {
      if (cachedUserInfo?.authMethod === 'gis' && cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(cachedUserInfo, cachedAccessToken, false);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        cachedUserInfo = null;
        if (onAuthFailure) onAuthFailure(null);
      }
    }
  });
};

/**
 * Sign in with Google:
 * 1. If user pasted a custom Google Client ID in Settings -> uses GIS TokenClient.
 * 2. If running in Standalone / TWA / Capacitor (`shouldUseRedirectFlow() === true`) ->
 *    saves app context & unsaved drafts, then calls `signInWithRedirect(auth, provider)`.
 * 3. Otherwise on standard web -> uses `signInWithPopup(auth, provider)`, and if popup fails
 *    or is unsupported (`auth/operation-not-supported-in-this-environment`, `auth/popup-blocked`, `auth/invalid-action-code`),
 *    automatically switches to `signInWithRedirect(auth, provider)`.
 */
export const googleSignIn = async (
  onBeforeRedirect?: () => void
): Promise<{
  user: GoogleDriveUser;
  accessToken: string;
} | null> => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new DriveSyncError(
      'Thiết bị đang ngoại tuyến. Vui lòng kết nối Internet để đăng nhập Google Drive.',
      'OFFLINE'
    );
  }

  const customClientId = getUserGoogleClientId();
  if (customClientId) {
    return await signInWithGIS(customClientId);
  }

  const envInfo = detectStandaloneEnvironment();
  const useRedirect = shouldUseRedirectFlow();

  if (useRedirect) {
    console.log('[Firebase Auth] Using signInWithRedirect for standalone/packaged environment:', {
      authDomain: getEffectiveAuthDomain(),
      origin: window.location.origin,
      envInfo,
    });
    if (onBeforeRedirect) {
      onBeforeRedirect();
    }
    setPendingRedirectMarker(true);
    try {
      isSigningIn = true;
      await signInWithRedirect(auth, provider);
      return null; // Browser will redirect
    } catch (redirectInitErr: any) {
      isSigningIn = false;
      setPendingRedirectMarker(false);
      throw formatFirebaseAuthError(redirectInitErr, 'signInWithRedirect');
    }
  }

  // Standard Web Browser: Try signInWithPopup first, fallback to signInWithRedirect if needed
  try {
    isSigningIn = true;
    console.log('[Firebase Auth] Attempting signInWithPopup on web browser...', {
      authDomain: getEffectiveAuthDomain(),
      origin: window.location.origin,
    });
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token =
      credential?.accessToken || (result as any)?._tokenResponse?.oauthAccessToken || null;

    if (!token) {
      throw new DriveSyncError(
        'Không lấy được Access Token từ phiên đăng nhập Google.',
        'TOKEN_EXPIRED'
      );
    }

    cachedAccessToken = token;
    const mappedUser: GoogleDriveUser = {
      uid: result.user.uid,
      displayName: result.user.displayName,
      email: result.user.email,
      photoURL: result.user.photoURL,
      authMethod: 'firebase',
    };
    cachedUserInfo = mappedUser;

    lastAuthDiagnosticLog = {
      timestamp: new Date().toLocaleTimeString('vi-VN'),
      flowUsed: 'popup',
      authDomain: getEffectiveAuthDomain(),
      currentOrigin: window.location.origin,
      environment: envInfo.modeLabel,
      redirectResultParams: {
        uid: mappedUser.uid,
        email: mappedUser.email,
        hasAccessToken: true,
      },
      errorCode: null,
      errorMessage: null,
    };

    return { user: mappedUser, accessToken: token };
  } catch (error: any) {
    console.error('[Firebase Auth] signInWithPopup error:', error);

    const fbCode: string = error?.code || '';
    // Automatically fallback to signInWithRedirect if popup is blocked or unsupported in environment
    if (
      fbCode === 'auth/operation-not-supported-in-this-environment' ||
      fbCode === 'auth/popup-blocked' ||
      fbCode === 'auth/invalid-action-code'
    ) {
      console.log(
        `[Firebase Auth] Popup failed with ${fbCode}, falling back to signInWithRedirect...`
      );
      if (onBeforeRedirect) {
        onBeforeRedirect();
      }
      setPendingRedirectMarker(true);
      try {
        await signInWithRedirect(auth, provider);
        return null;
      } catch (redirErr: any) {
        setPendingRedirectMarker(false);
        throw formatFirebaseAuthError(redirErr, 'signInWithRedirect (fallback)');
      }
    }

    const formatted = formatFirebaseAuthError(error, 'signInWithPopup');
    lastAuthDiagnosticLog = {
      timestamp: new Date().toLocaleTimeString('vi-VN'),
      flowUsed: 'popup',
      authDomain: getEffectiveAuthDomain(),
      currentOrigin: window.location.origin,
      environment: envInfo.modeLabel,
      redirectResultParams: null,
      errorCode: fbCode || 'auth/unknown',
      errorMessage: formatted.message,
    };
    throw formatted;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const getCurrentDriveUser = (): GoogleDriveUser | null => {
  return cachedUserInfo;
};

export const logoutGoogleDrive = async (): Promise<void> => {
  try {
    const tokenToRevoke = cachedAccessToken;
    cachedAccessToken = null;
    cachedUserInfo = null;
    await auth.signOut();
    if (tokenToRevoke && (window as any).google?.accounts?.oauth2?.revoke) {
      (window as any).google.accounts.oauth2.revoke(tokenToRevoke, () => {});
    }
  } catch (err) {
    console.warn('Sign out warning:', err);
    cachedAccessToken = null;
    cachedUserInfo = null;
  }
};

/**
 * Helper to handle Drive API HTTP errors and map them to clear Vietnamese explanations
 */
async function handleDriveApiError(res: Response, context: string): Promise<never> {
  let detail = '';
  try {
    const errJson = await res.json();
    detail = errJson?.error?.message || '';
  } catch {
    // ignore
  }

  if (res.status === 401) {
    // Clear expired token in memory so UI prompts re-login without losing data
    cachedAccessToken = null;
    throw new DriveSyncError(
      'Phiên đăng nhập Google đã hết hạn (Token hết hạn). Vui lòng bấm "Đăng nhập lại" để tiếp tục đồng bộ (dữ liệu đang nhập vẫn an toàn).',
      'TOKEN_EXPIRED'
    );
  }

  if (res.status === 403) {
    throw new DriveSyncError(
      `Không đủ quyền truy cập Google Drive (cần quyền drive.file) hoặc bộ nhớ Drive đã đầy${
        detail ? `: ${detail}` : '.'
      }`,
      'PERMISSION_DENIED'
    );
  }

  if (res.status === 404) {
    throw new DriveSyncError(
      `Không tìm thấy file sao lưu trên Google Drive (${context}).`,
      'NOT_FOUND'
    );
  }

  throw new DriveSyncError(
    `Lỗi Google Drive (${res.status}) khi ${context}${detail ? `: ${detail}` : '.'}`,
    'UNKNOWN'
  );
}

/**
 * Find the backup file `CongTacPhi_backup.json` on Google Drive:
 * 1. First checks saved `fileId` from localStorage (`DRIVE_FILE_ID_STORAGE`)
 * 2. If not found or trashed, queries Drive for `name = 'CongTacPhi_backup.json' and trashed = false`
 * 3. Caches the resolved `fileId` so future updates always target the exact same file
 */
export async function findDriveBackupFile(
  accessToken?: string
): Promise<DriveBackupMetadata | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new DriveSyncError(
      'Mất kết nối mạng. Không thể kiểm tra bản sao lưu trên Google Drive.',
      'OFFLINE'
    );
  }

  const token = accessToken || cachedAccessToken;
  if (!token) {
    throw new DriveSyncError(
      'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại Google Drive.',
      'TOKEN_EXPIRED'
    );
  }

  // 1. Check saved fileId first
  const savedFileId = getSavedDriveFileId();
  if (savedFileId) {
    try {
      const checkRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          savedFileId
        )}?fields=id,name,modifiedTime,size,trashed`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (checkRes.ok) {
        const fileData = await checkRes.json();
        if (fileData && fileData.id && !fileData.trashed) {
          return {
            id: fileData.id,
            name: fileData.name || DRIVE_BACKUP_FILENAME,
            modifiedTime: fileData.modifiedTime,
            size: fileData.size ? Number(fileData.size) : undefined,
          };
        }
        setSavedDriveFileId(null);
      } else if (checkRes.status === 404) {
        setSavedDriveFileId(null);
      } else {
        await handleDriveApiError(checkRes, 'kiểm tra file sao lưu');
      }
    } catch (err: any) {
      if (err instanceof DriveSyncError) throw err;
      throw new DriveSyncError(
        'Mất kết nối mạng khi kiểm tra file trên Google Drive.',
        'OFFLINE'
      );
    }
  }

  // 2. Search by fixed filename `CongTacPhi_backup.json`
  try {
    const q = encodeURIComponent(`name = '${DRIVE_BACKUP_FILENAME}' and trashed = false`);
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!listRes.ok) {
      await handleDriveApiError(listRes, 'tìm kiếm file sao lưu');
    }

    const listData = await listRes.json();
    const files = listData?.files;
    if (Array.isArray(files) && files.length > 0) {
      const found = files[0];
      setSavedDriveFileId(found.id);
      return {
        id: found.id,
        name: found.name || DRIVE_BACKUP_FILENAME,
        modifiedTime: found.modifiedTime,
        size: found.size ? Number(found.size) : undefined,
      };
    }

    return null;
  } catch (err: any) {
    if (err instanceof DriveSyncError) throw err;
    throw new DriveSyncError(
      'Lỗi mạng khi tìm kiếm file sao lưu trên Google Drive.',
      'OFFLINE'
    );
  }
}

/**
 * Uploads the entire app dataset (expenses, compressed images, advances, profiles)
 * as a single JSON file (`CongTacPhi_backup.json`) to Google Drive.
 * - Always UPDATES (`PATCH`) the existing file if `fileId` exists on Drive
 * - Uses Multipart upload (`uploadType=multipart`) for smaller files (< 3 MB)
 * - Uses Resumable upload (`uploadType=resumable`) for larger files (>= 3 MB with many receipt photos)
 */
export async function uploadBackupToDrive(
  expenses: ExpenseItem[],
  advances: AdvancePaymentItem[] = [],
  profiles: ExpenseProfile[] = [DEFAULT_PROFILE],
  accessToken?: string
): Promise<{
  fileId: string;
  modifiedTime: string;
  formattedSyncTime: string;
  uploadMethod: 'multipart' | 'resumable';
  sizeBytes: number;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new DriveSyncError(
      'Thiết bị đang mất mạng. Dữ liệu đã được lưu trên máy và sẽ đồng bộ khi có mạng.',
      'OFFLINE'
    );
  }

  const token = accessToken || cachedAccessToken;
  if (!token) {
    throw new DriveSyncError(
      'Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại để đồng bộ lên Drive.',
      'TOKEN_EXPIRED'
    );
  }

  const jsonString = serializeBackupJSON(expenses, advances, profiles);
  const jsonBlob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const sizeBytes = jsonBlob.size;

  const existingFile = await findDriveBackupFile(token);
  const targetFileId = existingFile?.id || null;

  let uploadedMeta: { id: string; modifiedTime?: string };
  let uploadMethod: 'multipart' | 'resumable' = 'multipart';

  if (sizeBytes < RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
    uploadMethod = 'multipart';
    uploadedMeta = await performMultipartDriveUpload(token, jsonString, targetFileId);
  } else {
    uploadMethod = 'resumable';
    uploadedMeta = await performResumableDriveUpload(token, jsonBlob, targetFileId);
  }

  const finalFileId = uploadedMeta.id;
  const finalModifiedTime = uploadedMeta.modifiedTime || new Date().toISOString();

  setSavedDriveFileId(finalFileId);
  const formattedSyncTime = saveDriveSyncTimestamp(finalModifiedTime);
  try {
    localStorage.setItem(LOCAL_LAST_MODIFIED_ISO_STORAGE, finalModifiedTime);
  } catch {
    // ignore
  }

  return {
    fileId: finalFileId,
    modifiedTime: finalModifiedTime,
    formattedSyncTime,
    uploadMethod,
    sizeBytes,
  };
}

/**
 * Multipart Upload (`uploadType=multipart`)
 */
async function performMultipartDriveUpload(
  token: string,
  jsonString: string,
  existingFileId: string | null
): Promise<{ id: string; modifiedTime?: string }> {
  const boundary = '-------CongTacPhiDriveBoundary' + Date.now().toString(16);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = existingFileId
    ? {
        name: DRIVE_BACKUP_FILENAME,
        mimeType: 'application/json',
      }
    : {
        name: DRIVE_BACKUP_FILENAME,
        mimeType: 'application/json',
        description:
          'File sao lưu tự động ứng dụng Sổ Chi Tiêu & Quản Lý Công Tác Phí (khoản chi, ảnh chứng từ, tạm ứng, hồ sơ)',
      };

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    jsonString +
    closeDelimiter;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingFileId
      )}?uploadType=multipart&fields=id,name,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size';

  const method = existingFileId ? 'PATCH' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!res.ok) {
      await handleDriveApiError(res, 'tải dữ liệu lên Google Drive (multipart)');
    }

    return await res.json();
  } catch (err: any) {
    if (err instanceof DriveSyncError) throw err;
    throw new DriveSyncError(
      'Mất kết nối mạng khi đang tải bản sao lưu lên Google Drive.',
      'OFFLINE'
    );
  }
}

/**
 * Resumable Upload (`uploadType=resumable`) for large backup files with many compressed photos
 */
async function performResumableDriveUpload(
  token: string,
  jsonBlob: Blob,
  existingFileId: string | null
): Promise<{ id: string; modifiedTime?: string }> {
  const metadata = {
    name: DRIVE_BACKUP_FILENAME,
    mimeType: 'application/json',
  };

  const initUrl = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingFileId
      )}?uploadType=resumable&fields=id,name,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,modifiedTime,size';

  const initMethod = existingFileId ? 'PATCH' : 'POST';

  try {
    const initRes = await fetch(initUrl, {
      method: initMethod,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(jsonBlob.size),
      },
      body: JSON.stringify(metadata),
    });

    if (!initRes.ok) {
      await handleDriveApiError(initRes, 'khởi tạo phiên tải lên Google Drive (resumable)');
    }

    const uploadSessionUri = initRes.headers.get('Location');
    if (!uploadSessionUri) {
      throw new DriveSyncError(
        'Không nhận được đường dẫn tải lên (Resumable Session URI) từ Google Drive.',
        'UNKNOWN'
      );
    }

    const putRes = await fetch(uploadSessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: jsonBlob,
    });

    if (!putRes.ok) {
      await handleDriveApiError(putRes, 'tải nội dung file lớn lên Google Drive');
    }

    return await putRes.json();
  } catch (err: any) {
    if (err instanceof DriveSyncError) throw err;
    throw new DriveSyncError(
      'Mất kết nối mạng khi đang tải file dung lượng lớn lên Google Drive.',
      'OFFLINE'
    );
  }
}

/**
 * Downloads and validates the backup file (`CongTacPhi_backup.json`) from Google Drive
 */
export async function downloadBackupFromDrive(
  specificFileId?: string,
  accessToken?: string
): Promise<{
  backup: ValidatedBackupResult;
  metadata: DriveBackupMetadata;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new DriveSyncError(
      'Mất kết nối mạng. Vui lòng kết nối Internet để tải dữ liệu từ Google Drive.',
      'OFFLINE'
    );
  }

  const token = accessToken || cachedAccessToken;
  if (!token) {
    throw new DriveSyncError(
      'Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại để tải dữ liệu về.',
      'TOKEN_EXPIRED'
    );
  }

  let meta: DriveBackupMetadata | null = null;
  if (specificFileId) {
    meta = {
      id: specificFileId,
      name: DRIVE_BACKUP_FILENAME,
      modifiedTime: new Date().toISOString(),
    };
  } else {
    meta = await findDriveBackupFile(token);
  }

  if (!meta || !meta.id) {
    throw new DriveSyncError(
      `Chưa tìm thấy file sao lưu "${DRIVE_BACKUP_FILENAME}" trên Google Drive của tài khoản này.`,
      'NOT_FOUND'
    );
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) {
      await handleDriveApiError(res, 'tải nội dung file sao lưu từ Google Drive');
    }

    const rawText = await res.text();
    const validated = parseAndValidateBackupJSON(rawText);

    setSavedDriveFileId(meta.id);

    return {
      backup: validated,
      metadata: meta,
    };
  } catch (err: any) {
    if (err instanceof DriveSyncError) throw err;
    throw new DriveSyncError(
      err?.message || 'Lỗi khi tải hoặc đọc dữ liệu từ Google Drive.',
      'UNKNOWN'
    );
  }
}

/**
 * Checks whether a Drive backup file is newer than the local machine's data
 */
export function isDriveBackupNewerThanLocal(
  driveModifiedIso: string,
  localLastSyncIso: string | null,
  localLastModifiedIso: string | null
): boolean {
  const driveTs = Date.parse(driveModifiedIso);
  if (Number.isNaN(driveTs)) return false;

  const syncTs = localLastSyncIso ? Date.parse(localLastSyncIso) : 0;
  const localEditTs = localLastModifiedIso ? Date.parse(localLastModifiedIso) : 0;
  const localRefTs = Math.max(
    Number.isNaN(syncTs) ? 0 : syncTs,
    Number.isNaN(localEditTs) ? 0 : localEditTs
  );

  if (localRefTs === 0) {
    return true;
  }

  return driveTs - localRefTs > 3000;
}
