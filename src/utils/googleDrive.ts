import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  ExpenseItem,
  AdvancePaymentItem,
  ExpenseProfile,
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
export const DRIVE_FILE_ID_STORAGE = 'so_chi_tieu_drive_backup_file_id';
export const DRIVE_LAST_SYNC_TIME_STORAGE = 'so_chi_tieu_drive_last_sync_time';
export const DRIVE_LAST_SYNC_ISO_STORAGE = 'so_chi_tieu_drive_last_sync_iso';
export const LOCAL_LAST_MODIFIED_ISO_STORAGE = 'so_chi_tieu_local_last_modified_iso';
export const AUTO_DRIVE_SYNC_ENABLED_STORAGE = 'so_chi_tieu_auto_drive_sync_enabled';

// Threshold for switching from multipart upload to resumable upload (3 MB)
const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 3 * 1024 * 1024;

// Initialize Firebase App & Auth
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

// In-memory only access token cache (NEVER persisted to localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUserInfo: GoogleDriveUser | null = null;

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
  | 'UNKNOWN';

export class DriveSyncError extends Error {
  code: DriveErrorCode;
  constructor(message: string, code: DriveErrorCode = 'UNKNOWN') {
    super(message);
    this.name = 'DriveSyncError';
    this.code = code;
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
                `Đăng nhập Google thất bại: ${
                  tokenResponse.error_description || tokenResponse.error
                }`,
                tokenResponse.error === 'access_denied' ? 'PERMISSION_DENIED' : 'UNKNOWN'
              )
            );
            return;
          }

          const token = tokenResponse?.access_token;
          if (!token) {
            isSigningIn = false;
            reject(new DriveSyncError('Không nhận được mã truy cập (Access Token) từ Google.', 'UNKNOWN'));
            return;
          }

          // Check that drive.file scope was granted
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

          // Fetch user profile info via Drive about endpoint (works with drive.file scope without needing extra scopes!)
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
 * Initialize auth state listener. Call this on app load.
 */
export const initAuth = (
  onAuthSuccess?: (user: GoogleDriveUser, token: string) => void,
  onAuthFailure?: (userWithoutToken?: GoogleDriveUser | null) => void
) => {
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
        if (onAuthSuccess) onAuthSuccess(mappedUser, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure(mappedUser);
      }
    } else {
      if (cachedUserInfo?.authMethod === 'gis' && cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(cachedUserInfo, cachedAccessToken);
      } else {
        cachedAccessToken = null;
        cachedUserInfo = null;
        if (onAuthFailure) onAuthFailure(null);
      }
    }
  });
};

/**
 * Sign in with Google:
 * - If the user pasted a custom Google Client ID in Settings, uses Google Identity Services (GIS) with that Client ID.
 * - Otherwise uses Firebase Auth popup (provisioned for the app), with fallback to GIS if needed.
 */
export const googleSignIn = async (): Promise<{
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

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new DriveSyncError(
        'Không lấy được Access Token từ phiên đăng nhập Google.',
        'TOKEN_EXPIRED'
      );
    }

    cachedAccessToken = credential.accessToken;
    const mappedUser: GoogleDriveUser = {
      uid: result.user.uid,
      displayName: result.user.displayName,
      email: result.user.email,
      photoURL: result.user.photoURL,
      authMethod: 'firebase',
    };
    cachedUserInfo = mappedUser;
    return { user: mappedUser, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.warn('Firebase Auth popup error, checking GIS fallback:', error);
    // If user configured or default client ID exists and Firebase popup failed due to domain, fallback to GIS
    if (
      error?.code === 'auth/unauthorized-domain' ||
      error?.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      const fallbackClientId = getEffectiveGoogleClientId();
      if (fallbackClientId) {
        return await signInWithGIS(fallbackClientId);
      }
    }

    if (error?.code === 'auth/popup-closed-by-user') {
      throw new DriveSyncError('Đã hủy đăng nhập Google.', 'UNKNOWN');
    }

    throw new DriveSyncError(
      error?.message || 'Đăng nhập Google thất bại. Vui lòng thử lại.',
      'UNKNOWN'
    );
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
        // If trashed, clear savedFileId and search by name
        setSavedDriveFileId(null);
      } else if (checkRes.status === 404) {
        // File was deleted on Drive, clear savedFileId and search by name
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

  // 1. Serialize full backup JSON (identical to local "Sao lưu (JSON)" format)
  const jsonString = serializeBackupJSON(expenses, advances, profiles);
  const jsonBlob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const sizeBytes = jsonBlob.size;

  // 2. Resolve existing fileId so we ALWAYS update the same file instead of creating duplicates
  const existingFile = await findDriveBackupFile(token);
  const targetFileId = existingFile?.id || null;

  let uploadedMeta: { id: string; modifiedTime?: string };
  let uploadMethod: 'multipart' | 'resumable' = 'multipart';

  if (sizeBytes < RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
    // Multipart Upload for small/medium files
    uploadMethod = 'multipart';
    uploadedMeta = await performMultipartDriveUpload(token, jsonString, targetFileId);
  } else {
    // Resumable Upload for large files (several MBs due to receipt images)
    uploadMethod = 'resumable';
    uploadedMeta = await performResumableDriveUpload(token, jsonBlob, targetFileId);
  }

  const finalFileId = uploadedMeta.id;
  const finalModifiedTime = uploadedMeta.modifiedTime || new Date().toISOString();

  // Save fileId & sync timestamp for subsequent updates
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
    // Step 1: Initiate resumable upload session
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

    // Step 2: Upload the JSON file content to the session URI
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

    if (validated.exportedAt && !specificFileId) {
      // Keep Drive's modifiedTime as authoritative
    }

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

  // Reference timestamp on this device: whichever is newer between last sync and last local edit
  const syncTs = localLastSyncIso ? Date.parse(localLastSyncIso) : 0;
  const localEditTs = localLastModifiedIso ? Date.parse(localLastModifiedIso) : 0;
  const localRefTs = Math.max(
    Number.isNaN(syncTs) ? 0 : syncTs,
    Number.isNaN(localEditTs) ? 0 : localEditTs
  );

  // If this device has never synced with Drive before, treat existing Drive backup as newer
  if (localRefTs === 0) {
    return true;
  }

  // Allow 3-second tolerance for clock skew
  return driveTs - localRefTs > 3000;
}
