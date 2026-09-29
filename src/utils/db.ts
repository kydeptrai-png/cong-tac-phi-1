import {
  ExpenseItem,
  AdvancePaymentItem,
  ExpenseProfile,
  DescriptionSuggestion,
} from '../types';
import { removeVietnameseAccents } from './categories';
import { saveOrDownloadFile } from './fileSaver';

/**
 * Requirement 3: Request persistent storage from browser / Android system
 * so the operating system doesn't automatically evict IndexedDB data on low storage.
 */
export async function requestPersistentStorage(): Promise<{
  persisted: boolean;
  quota?: number;
  usage?: number;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { persisted: false };
  }

  try {
    let isPersisted = false;
    if (navigator.storage.persisted) {
      isPersisted = await navigator.storage.persisted();
    }

    if (!isPersisted && navigator.storage.persist) {
      isPersisted = await navigator.storage.persist();
    }

    let quota: number | undefined;
    let usage: number | undefined;
    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      quota = estimate.quota;
      usage = estimate.usage;
    }

    return { persisted: isPersisted, quota, usage };
  } catch (err) {
    console.warn('Persistent storage request failed:', err);
    return { persisted: false };
  }
}

const DB_NAME = 'ExpenseTrackerDB';
const DB_VERSION = 3;
const STORE_NAME = 'expenses';
const ADVANCES_STORE_NAME = 'advances';
const PROFILES_STORE_NAME = 'profiles';
const META_STORE_NAME = 'meta';

export const BACKUP_FORMAT_VERSION = 3;

export const DEFAULT_PROFILE: ExpenseProfile = {
  id: 'default',
  name: 'Hồ sơ công tác mặc định',
  description: 'Sổ chi tiêu & công tác phí chính',
  createdAt: 1700000000000,
};

export interface BackupDataPayload {
  app: 'SoChiTieuCongTacPhi';
  version: number;
  exportedAt: string;
  totalExpenses: number;
  totalImages: number;
  expenses: ExpenseItem[];
  advances?: AdvancePaymentItem[];
  profiles?: ExpenseProfile[];
}

export interface ValidatedBackupResult {
  items: ExpenseItem[];
  advances: AdvancePaymentItem[];
  profiles: ExpenseProfile[];
  version: number;
  totalExpenses: number;
  totalImages: number;
  totalAmount: number;
  exportedAt?: string;
}

/**
 * Checks whether an error is a storage quota error (QuotaExceededError)
 * and returns a clear Vietnamese explanation for the user.
 */
export function formatStorageError(error: unknown): string {
  console.error('[IndexedDB Storage Error]:', error);

  if (error && typeof error === 'object') {
    const errObj = error as { name?: string; message?: string; code?: number };
    const name = errObj.name || '';
    const msg = (errObj.message || '').toLowerCase();
    const code = errObj.code;

    if (
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      code === 22 ||
      code === 1014 ||
      msg.includes('quota') ||
      msg.includes('storage')
    ) {
      return 'Hết dung lượng bộ nhớ trình duyệt (QuotaExceededError). File sao lưu chứa nhiều ảnh chứng từ vượt quá dung lượng trống của thiết bị. Vui lòng giải phóng bộ nhớ hoặc xóa bớt dữ liệu trình duyệt.';
    }

    if (errObj.message) {
      return `Lỗi bộ nhớ trình duyệt: ${errObj.message}`;
    }
  }

  return 'Không thể ghi dữ liệu vào bộ nhớ trình duyệt (IndexedDB).';
}

let hasRequestedStoragePersist = false;

function openDB(): Promise<IDBDatabase> {
  if (!hasRequestedStoragePersist && typeof window !== 'undefined') {
    hasRequestedStoragePersist = true;
    requestPersistentStorage().then((status) => {
      if (status.persisted) {
        console.log('[Storage]: Persistent storage enabled on Android/Browser.');
      }
    }).catch(() => {});
  }

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      const err = new Error('Trình duyệt của bạn không hỗ trợ IndexedDB để lưu trữ dữ liệu và ảnh.');
      console.error('[IndexedDB openDB Error]:', err);
      reject(err);
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('month', 'month', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(ADVANCES_STORE_NAME)) {
        const advStore = db.createObjectStore(ADVANCES_STORE_NAME, { keyPath: 'id' });
        advStore.createIndex('profileId', 'profileId', { unique: false });
      }
      if (!db.objectStoreNames.contains(PROFILES_STORE_NAME)) {
        db.createObjectStore(PROFILES_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error('[IndexedDB openDB Error]:', request.error);
      reject(request.error || new Error('Không thể mở cơ sở dữ liệu IndexedDB.'));
    };
  });
}

/**
 * Migrate any legacy localStorage expense data into IndexedDB if present,
 * then remove from localStorage to avoid 5MB localStorage quota issues.
 */
async function migrateLegacyLocalStorageIfNeeded(): Promise<ExpenseItem[] | null> {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const legacyKeys = ['expenses', 'expense_items', 'so_chi_tieu_data', 'expenseTrackerData'];
  for (const key of legacyKeys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const validated = parseAndValidateBackupJSON(raw);
        if (validated.items.length > 0) {
          await replaceAllExpenses(validated.items);
          window.localStorage.removeItem(key);
          return validated.items;
        }
      }
    } catch (e) {
      console.warn(`[Migration] Bỏ qua khóa localStorage "${key}":`, e);
    }
  }
  return null;
}

export async function isDBInitialized(): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.close();
        resolve(false);
        return;
      }
      const tx = db.transaction(META_STORE_NAME, 'readonly');
      const store = tx.objectStore(META_STORE_NAME);
      const req = store.get('initialized');
      req.onsuccess = () => {
        db.close();
        resolve(Boolean(req.result?.value));
      };
      req.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

export async function markDBInitialized(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(META_STORE_NAME, 'readwrite');
      tx.objectStore(META_STORE_NAME).put({ key: 'initialized', value: true, updatedAt: Date.now() });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch (e) {
    console.warn('Không thể đánh dấu trạng thái khởi tạo DB:', e);
  }
}

export async function getAllExpenses(): Promise<ExpenseItem[]> {
  try {
    const migrated = await migrateLegacyLocalStorageIfNeeded();
    if (migrated) return migrated;

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = ((request.result as ExpenseItem[]) || []).map((item, idx) =>
          normalizeExpenseItem(item, idx)
        );
        items.sort(
          (a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt
        );
        db.close();
        resolve(items);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu từ IndexedDB:', error);
    return [];
  }
}

export async function saveExpense(item: ExpenseItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(normalizeExpenseItem(item, 0));

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
    tx.onabort = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

export async function saveExpensesBulk(items: ExpenseItem[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = db.objectStoreNames.contains(META_STORE_NAME)
      ? [STORE_NAME, META_STORE_NAME]
      : [STORE_NAME];
    const tx = db.transaction(storeNames, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    items.forEach((item, idx) => {
      store.put(normalizeExpenseItem(item, idx));
    });

    if (db.objectStoreNames.contains(META_STORE_NAME)) {
      tx.objectStore(META_STORE_NAME).put({
        key: 'initialized',
        value: true,
        updatedAt: Date.now(),
      });
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
    tx.onabort = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

/**
 * Atomically replaces all expenses (and their receipt images) inside a single IndexedDB transaction.
 */
export async function replaceAllExpenses(items: ExpenseItem[]): Promise<ExpenseItem[]> {
  const normalizedItems = items.map((item, idx) => normalizeExpenseItem(item, idx));
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const storeNames = db.objectStoreNames.contains(META_STORE_NAME)
      ? [STORE_NAME, META_STORE_NAME]
      : [STORE_NAME];
    const tx = db.transaction(storeNames, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.clear();
    for (const item of normalizedItems) {
      store.put(item);
    }

    if (db.objectStoreNames.contains(META_STORE_NAME)) {
      tx.objectStore(META_STORE_NAME).put({
        key: 'initialized',
        value: true,
        updatedAt: Date.now(),
      });
    }

    tx.oncomplete = () => {
      db.close();
      resolve(normalizedItems);
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
    tx.onabort = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

/**
 * Merges restored expenses with existing expenses in IndexedDB.
 * If an expense ID already exists, it updates it; otherwise it appends it.
 */
export async function mergeExpensesWithExisting(
  incomingItems: ExpenseItem[],
  existingItems: ExpenseItem[]
): Promise<ExpenseItem[]> {
  const normalizedIncoming = incomingItems.map((item, idx) => normalizeExpenseItem(item, idx));
  const map = new Map<string, ExpenseItem>();

  for (const existing of existingItems) {
    map.set(existing.id, existing);
  }
  for (const inc of normalizedIncoming) {
    map.set(inc.id, inc);
  }

  const merged = Array.from(map.values());
  await replaceAllExpenses(merged);
  return merged;
}

export async function deleteExpense(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

export async function clearAllExpenses(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = db.objectStoreNames.contains(META_STORE_NAME)
      ? [STORE_NAME, META_STORE_NAME]
      : [STORE_NAME];
    const tx = db.transaction(storeNames, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    if (db.objectStoreNames.contains(META_STORE_NAME)) {
      tx.objectStore(META_STORE_NAME).put({
        key: 'initialized',
        value: true,
        updatedAt: Date.now(),
      });
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
    tx.onabort = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

function inferMonthFromDateStr(dateStr: string): string {
  if (!dateStr) return 'Tháng 1';
  // DD/MM/YYYY
  const dmy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const m = parseInt(dmy[2], 10);
    const y = parseInt(dmy[3], 10);
    if (m >= 1 && m <= 12) return `Tháng ${m}/${y}`;
  }
  // YYYY-MM-DD
  const ymd = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    if (m >= 1 && m <= 12) return `Tháng ${m}/${y}`;
  }
  return 'Tháng 1';
}

/**
 * Normalizes a single raw object into a clean ExpenseItem, preserving all receipt images.
 */
export function normalizeExpenseItem(raw: any, index = 0): ExpenseItem {
  const now = Date.now();
  const id =
    typeof raw?.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim()
      : `exp_restored_${now}_${index}_${Math.random().toString(36).substring(2, 7)}`;

  const rawAmount = raw?.amount ?? raw?.so_tien ?? 0;
  const parsedAmount =
    typeof rawAmount === 'number'
      ? rawAmount
      : Number(String(rawAmount).replace(/[^\d.-]/g, '')) || 0;

  const description =
    String(raw?.description ?? raw?.dien_giai ?? '').trim() || 'Khoản chi';

  const date = String(raw?.date ?? raw?.ngay ?? '').trim();
  const month =
    typeof raw?.month === 'string' && raw.month.trim().length > 0
      ? raw.month.trim()
      : inferMonthFromDateStr(date);

  // Extract images from images / receipts / image fields
  let images: string[] = [];
  const rawImages = raw?.images ?? raw?.receipts ?? raw?.photos;
  if (Array.isArray(rawImages)) {
    images = rawImages
      .filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
      .map((img) => img.trim());
  } else if (typeof raw?.image === 'string' && raw.image.trim().length > 0) {
    images = [raw.image.trim()];
  }

  const sheetName =
    typeof raw?.sheetName === 'string' && raw.sheetName.trim().length > 0
      ? raw.sheetName.trim()
      : undefined;

  const notes =
    typeof raw?.notes === 'string' && raw.notes.trim().length > 0
      ? raw.notes.trim()
      : undefined;

  const profileId =
    typeof raw?.profileId === 'string' && raw.profileId.trim().length > 0
      ? raw.profileId.trim()
      : 'default';

  const createdAt =
    typeof raw?.createdAt === 'number' && !Number.isNaN(raw.createdAt)
      ? raw.createdAt
      : now + index;
  const updatedAt =
    typeof raw?.updatedAt === 'number' && !Number.isNaN(raw.updatedAt)
      ? raw.updatedAt
      : createdAt;

  return {
    id,
    month,
    date,
    amount: parsedAmount,
    description,
    images,
    ...(sheetName ? { sheetName } : {}),
    ...(notes ? { notes } : {}),
    profileId,
    createdAt,
    updatedAt,
  };
}

export function normalizeAdvanceItem(raw: any, index = 0): AdvancePaymentItem {
  const now = Date.now();
  const id =
    typeof raw?.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim()
      : `adv_${now}_${index}_${Math.random().toString(36).substring(2, 6)}`;
  const profileId =
    typeof raw?.profileId === 'string' && raw.profileId.trim().length > 0
      ? raw.profileId.trim()
      : 'default';
  const amount =
    typeof raw?.amount === 'number'
      ? raw.amount
      : Number(String(raw?.amount || 0).replace(/[^\d.-]/g, '')) || 0;
  const date =
    typeof raw?.date === 'string' && raw.date.trim().length > 0
      ? raw.date.trim()
      : new Date().toLocaleDateString('vi-VN');
  const note = typeof raw?.note === 'string' ? raw.note.trim() : '';
  const createdAt =
    typeof raw?.createdAt === 'number' && !Number.isNaN(raw.createdAt)
      ? raw.createdAt
      : now + index;

  return {
    id,
    profileId,
    date,
    amount,
    note,
    createdAt,
  };
}

export function normalizeProfileItem(raw: any, index = 0): ExpenseProfile {
  const now = Date.now();
  const id =
    typeof raw?.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim()
      : `prof_${now}_${index}`;
  const name =
    typeof raw?.name === 'string' && raw.name.trim().length > 0
      ? raw.name.trim()
      : 'Hồ sơ công tác';
  const description =
    typeof raw?.description === 'string' && raw.description.trim().length > 0
      ? raw.description.trim()
      : undefined;
  const createdAt =
    typeof raw?.createdAt === 'number' && !Number.isNaN(raw.createdAt)
      ? raw.createdAt
      : now + index;

  return {
    id,
    name,
    ...(description ? { description } : {}),
    createdAt,
  };
}

/**
 * Advances (Tạm ứng) IndexedDB CRUD
 */
export async function getAllAdvances(): Promise<AdvancePaymentItem[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(ADVANCES_STORE_NAME)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(ADVANCES_STORE_NAME, 'readonly');
      const req = tx.objectStore(ADVANCES_STORE_NAME).getAll();
      req.onsuccess = () => {
        const list = ((req.result as AdvancePaymentItem[]) || []).map((a, idx) =>
          normalizeAdvanceItem(a, idx)
        );
        list.sort((a, b) => b.createdAt - a.createdAt);
        db.close();
        resolve(list);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

export async function saveAdvance(item: AdvancePaymentItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ADVANCES_STORE_NAME, 'readwrite');
    tx.objectStore(ADVANCES_STORE_NAME).put(normalizeAdvanceItem(item, 0));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

export async function deleteAdvance(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ADVANCES_STORE_NAME, 'readwrite');
    tx.objectStore(ADVANCES_STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

export async function replaceAllAdvances(items: AdvancePaymentItem[]): Promise<AdvancePaymentItem[]> {
  const normalized = items.map((a, i) => normalizeAdvanceItem(a, i));
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(ADVANCES_STORE_NAME)) {
      db.close();
      resolve(normalized);
      return;
    }
    const tx = db.transaction(ADVANCES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ADVANCES_STORE_NAME);
    store.clear();
    for (const item of normalized) {
      store.put(item);
    }
    tx.oncomplete = () => {
      db.close();
      resolve(normalized);
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

/**
 * Profiles (Hồ sơ công tác) IndexedDB CRUD
 */
export async function getAllProfiles(): Promise<ExpenseProfile[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(PROFILES_STORE_NAME)) {
        db.close();
        resolve([DEFAULT_PROFILE]);
        return;
      }
      const tx = db.transaction(PROFILES_STORE_NAME, 'readonly');
      const req = tx.objectStore(PROFILES_STORE_NAME).getAll();
      req.onsuccess = () => {
        const list = ((req.result as ExpenseProfile[]) || []).map((p, idx) =>
          normalizeProfileItem(p, idx)
        );
        db.close();
        if (list.length === 0) {
          resolve([DEFAULT_PROFILE]);
        } else {
          if (!list.some((p) => p.id === 'default')) {
            list.unshift(DEFAULT_PROFILE);
          }
          resolve(list);
        }
      };
      req.onerror = () => {
        db.close();
        resolve([DEFAULT_PROFILE]);
      };
    });
  } catch {
    return [DEFAULT_PROFILE];
  }
}

export async function saveProfile(profile: ExpenseProfile): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
    tx.objectStore(PROFILES_STORE_NAME).put(normalizeProfileItem(profile, 0));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

export async function deleteProfile(id: string): Promise<void> {
  if (id === 'default') return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
    tx.objectStore(PROFILES_STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

export async function replaceAllProfiles(items: ExpenseProfile[]): Promise<ExpenseProfile[]> {
  const normalized = items.map((p, i) => normalizeProfileItem(p, i));
  if (!normalized.some((p) => p.id === 'default')) {
    normalized.unshift(DEFAULT_PROFILE);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(PROFILES_STORE_NAME)) {
      db.close();
      resolve(normalized);
      return;
    }
    const tx = db.transaction(PROFILES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROFILES_STORE_NAME);
    store.clear();
    for (const item of normalized) {
      store.put(item);
    }
    tx.oncomplete = () => {
      db.close();
      resolve(normalized);
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(new Error(formatStorageError(err)));
    };
  });
}

/**
 * Shared formatter used by "Sao lưu (JSON)" to create a versioned backup payload.
 */
export function createBackupPayload(
  expenses: ExpenseItem[],
  advances: AdvancePaymentItem[] = [],
  profiles: ExpenseProfile[] = [DEFAULT_PROFILE]
): BackupDataPayload {
  const normalizedExpenses = expenses.map((item, idx) => normalizeExpenseItem(item, idx));
  const normalizedAdvances = advances.map((adv, idx) => normalizeAdvanceItem(adv, idx));
  const normalizedProfiles = profiles.map((prof, idx) => normalizeProfileItem(prof, idx));
  const totalImages = normalizedExpenses.reduce(
    (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
    0
  );

  return {
    app: 'SoChiTieuCongTacPhi',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    totalExpenses: normalizedExpenses.length,
    totalImages,
    expenses: normalizedExpenses,
    advances: normalizedAdvances,
    profiles: normalizedProfiles,
  };
}

/**
 * Serializes expenses into a formatted JSON string with version metadata.
 */
export function serializeBackupJSON(
  expenses: ExpenseItem[],
  advances: AdvancePaymentItem[] = [],
  profiles: ExpenseProfile[] = [DEFAULT_PROFILE]
): string {
  const payload = createBackupPayload(expenses, advances, profiles);
  return JSON.stringify(payload, null, 2);
}

/**
 * Generates a timestamped filename for JSON backups:
 * e.g. Sao_luu_2026-09-28_14-30.json
 */
export function formatBackupFileNameWithTimestamp(prefix = 'Sao_luu'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${prefix}_${yyyy}-${mm}-${dd}_${hh}-${min}.json`;
}

/**
 * Downloads the backup JSON file using the unified file saver (supports Web, PWA, and Capacitor / Android WebView).
 */
export function downloadBackupJSON(
  expenses: ExpenseItem[],
  customFileName?: string,
  advances: AdvancePaymentItem[] = [],
  profiles: ExpenseProfile[] = [DEFAULT_PROFILE]
): { fileName: string; totalExpenses: number; totalImages: number } {
  const payload = createBackupPayload(expenses, advances, profiles);
  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const fileName = customFileName || formatBackupFileNameWithTimestamp('Sao_Luu_So_Chi_Tieu');

  saveOrDownloadFile({
    blob,
    fileName,
    mimeType: 'application/json',
    title: fileName,
    text: 'Bản sao lưu dữ liệu Sổ Chi Tiêu',
  });

  return {
    fileName,
    totalExpenses: payload.totalExpenses,
    totalImages: payload.totalImages,
  };
}

/**
 * Reads a File object as UTF-8 text on both mobile and desktop browsers.
 * Uses FileReader first for broad mobile compatibility and falls back to file.text().
 */
export function readBackupFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Không tìm thấy file được chọn.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else if (typeof file.text === 'function') {
        file
          .text()
          .then(resolve)
          .catch((err) => {
            console.error('[readBackupFileAsText file.text() Error]:', err);
            reject(new Error(`Không thể đọc nội dung file "${file.name}".`));
          });
      } else {
        reject(new Error(`Không thể đọc nội dung văn bản từ file "${file.name}".`));
      }
    };
    reader.onerror = () => {
      console.error('[FileReader Error]:', reader.error);
      if (typeof file.text === 'function') {
        file
          .text()
          .then(resolve)
          .catch((err) => {
            console.error('[Fallback file.text() Error]:', err);
            reject(
              new Error(
                `Không đọc được file "${file.name}" (${reader.error?.message || 'Lỗi đọc file'}).`
              )
            );
          });
      } else {
        reject(
          new Error(
            `Không đọc được file "${file.name}" (${reader.error?.message || 'Lỗi đọc file'}).`
          )
        );
      }
    };

    try {
      reader.readAsText(file, 'UTF-8');
    } catch (err) {
      console.error('[reader.readAsText Exception]:', err);
      reject(new Error(`Không thể mở file "${file.name}" để đọc.`));
    }
  });
}

/**
 * Parses and validates a JSON backup string.
 * Supports both the unified versioned payload ({ version, expenses: [...], advances: [...], profiles: [...] })
 * and legacy direct array backups ([...]).
 */
export function parseAndValidateBackupJSON(rawText: string): ValidatedBackupResult {
  const cleanedText = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanedText) {
    const err = new Error('File sao lưu trống (không có dữ liệu bên trong).');
    console.error('[Backup Validation Error]:', err);
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanedText);
  } catch (syntaxErr: any) {
    console.error('[Backup JSON.parse Error]:', syntaxErr);
    throw new Error(
      `File không đúng định dạng JSON (${
        syntaxErr?.message || 'Lỗi cú pháp'
      }). Có thể bạn đã chọn nhầm file Excel hoặc file sao lưu chưa tải về hoàn tất.`
    );
  }

  let rawExpensesList: any[] | null = null;
  let rawAdvancesList: any[] = [];
  let rawProfilesList: any[] = [];
  let version = 1;
  let exportedAt: string | undefined;

  if (Array.isArray(parsed)) {
    // Legacy format: root JSON is directly an array of ExpenseItem
    rawExpensesList = parsed;
    version = 1;
  } else if (parsed && typeof parsed === 'object') {
    if (typeof parsed.version === 'number') {
      version = parsed.version;
    }
    if (typeof parsed.exportedAt === 'string') {
      exportedAt = parsed.exportedAt;
    }

    if (Array.isArray(parsed.expenses)) {
      rawExpensesList = parsed.expenses;
    } else if (Array.isArray(parsed.items)) {
      rawExpensesList = parsed.items;
    } else if (Array.isArray(parsed.data)) {
      rawExpensesList = parsed.data;
    }

    if (Array.isArray(parsed.advances)) {
      rawAdvancesList = parsed.advances;
    }
    if (Array.isArray(parsed.profiles)) {
      rawProfilesList = parsed.profiles;
    }
  }

  if (!rawExpensesList) {
    const err = new Error(
      'Cấu trúc file sao lưu không hợp lệ: Không tìm thấy danh sách khoản chi ("expenses") trong file JSON.'
    );
    console.error('[Backup Structure Error]:', err, parsed);
    throw err;
  }

  const validItems: ExpenseItem[] = [];
  for (let i = 0; i < rawExpensesList.length; i++) {
    const row = rawExpensesList[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }

    const hasExpenseFields =
      'amount' in row ||
      'so_tien' in row ||
      'description' in row ||
      'dien_giai' in row ||
      'date' in row ||
      'ngay' in row ||
      'month' in row ||
      'images' in row;

    if (!hasExpenseFields) {
      continue;
    }

    validItems.push(normalizeExpenseItem(row, i));
  }

  if (rawExpensesList.length > 0 && validItems.length === 0) {
    const err = new Error(
      'File JSON không chứa khoản chi hợp lệ nào (thiếu các trường số tiền, diễn giải, ngày và ảnh chứng từ).'
    );
    console.error('[Backup Items Validation Error]:', err, rawExpensesList.slice(0, 3));
    throw err;
  }

  const validAdvances = rawAdvancesList
    .filter((a) => a && typeof a === 'object')
    .map((a, idx) => normalizeAdvanceItem(a, idx));

  const validProfiles = rawProfilesList
    .filter((p) => p && typeof p === 'object')
    .map((p, idx) => normalizeProfileItem(p, idx));

  const totalImages = validItems.reduce(
    (sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0),
    0
  );
  const totalAmount = validItems.reduce((sum, item) => sum + item.amount, 0);

  return {
    items: validItems,
    advances: validAdvances,
    profiles: validProfiles.length > 0 ? validProfiles : [DEFAULT_PROFILE],
    version,
    totalExpenses: validItems.length,
    totalImages,
    totalAmount,
    exportedAt,
  };
}

/**
 * Requirement 3: Duplicate Detection Utilities
 * Two expenses are considered duplicates if they have the same Date, same Amount, and identical Description.
 */
export function normalizeDateForComparison(dateStr: string): string {
  const s = (dateStr || '').trim();
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${String(parseInt(dmy[1], 10)).padStart(2, '0')}/${String(
      parseInt(dmy[2], 10)
    ).padStart(2, '0')}/${dmy[3]}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${String(parseInt(ymd[3], 10)).padStart(2, '0')}/${String(
      parseInt(ymd[2], 10)
    ).padStart(2, '0')}/${ymd[1]}`;
  }
  return s.toLowerCase();
}

export function buildDuplicateKey(date: string, amount: number, description: string): string {
  const normDate = normalizeDateForComparison(date);
  const normAmount = Math.round(Number(amount) || 0);
  const normDesc = (description || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${normDate}|${normAmount}|${normDesc}`;
}

export function findDuplicateExpenses(
  candidate: { id?: string; date: string; amount: number; description: string },
  existingList: ExpenseItem[]
): ExpenseItem[] {
  const targetKey = buildDuplicateKey(candidate.date, candidate.amount, candidate.description);
  return existingList.filter((item) => {
    if (candidate.id && item.id === candidate.id) return false;
    return buildDuplicateKey(item.date, item.amount, item.description) === targetKey;
  });
}

/**
 * Returns a Set of ExpenseItem IDs that share the same (date, amount, description) with at least one other item in the list.
 */
export function getDuplicateIdsSet(items: ExpenseItem[]): Set<string> {
  const counts = new Map<string, string[]>();
  for (const item of items) {
    const key = buildDuplicateKey(item.date, item.amount, item.description);
    if (!counts.has(key)) {
      counts.set(key, []);
    }
    counts.get(key)!.push(item.id);
  }

  const duplicateIds = new Set<string>();
  counts.forEach((ids) => {
    if (ids.length > 1) {
      ids.forEach((id) => duplicateIds.add(id));
    }
  });
  return duplicateIds;
}

/**
 * Requirement 5: Historical Description Suggestions
 * Ranks previously entered descriptions by prefix match & keyword match, prioritizing the most frequently used ones,
 * and includes the most recently used amount for quick auto-fill.
 */
export function buildDescriptionSuggestions(
  expenses: ExpenseItem[],
  query: string,
  limit = 6
): DescriptionSuggestion[] {
  // Aggregate historical descriptions
  const map = new Map<
    string,
    {
      description: string;
      count: number;
      lastAmount: number;
      lastDate: string;
      lastTimestamp: number;
    }
  >();

  for (const item of expenses) {
    const desc = (item.description || '').trim();
    if (!desc || desc === 'Khoản chi' || desc === 'Khoản chi không tiêu đề') continue;

    const key = desc.toLowerCase();
    const existing = map.get(key);
    const ts = item.updatedAt || item.createdAt || 0;

    if (!existing) {
      map.set(key, {
        description: desc,
        count: 1,
        lastAmount: item.amount,
        lastDate: item.date,
        lastTimestamp: ts,
      });
    } else {
      existing.count += 1;
      if (ts >= existing.lastTimestamp) {
        existing.description = desc;
        existing.lastAmount = item.amount;
        existing.lastDate = item.date;
        existing.lastTimestamp = ts;
      }
    }
  }

  const allStats = Array.from(map.values());
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    // Return top most used descriptions when input is focused but empty
    return allStats
      .sort((a, b) => b.count - a.count || b.lastTimestamp - a.lastTimestamp)
      .slice(0, limit)
      .map(({ description, count, lastAmount, lastDate }) => ({
        description,
        count,
        lastAmount,
        lastDate,
      }));
  }

  const normQuery = removeVietnameseAccents(cleanQuery.toLowerCase());
  const lowerQuery = cleanQuery.toLowerCase();

  const scored = allStats
    .map((entry) => {
      const lowerDesc = entry.description.toLowerCase();
      const normDesc = removeVietnameseAccents(lowerDesc);

      // Exact match (don't need to suggest if identical to what's already typed unless user wants amount)
      const isPrefixExact = lowerDesc.startsWith(lowerQuery);
      const isPrefixNoAccent = normDesc.startsWith(normQuery);
      const isSubstringExact = lowerDesc.includes(lowerQuery);
      const isSubstringNoAccent = normDesc.includes(normQuery);

      if (!isPrefixExact && !isPrefixNoAccent && !isSubstringExact && !isSubstringNoAccent) {
        return null;
      }

      let matchBoost = 0;
      if (isPrefixExact) matchBoost = 100;
      else if (isPrefixNoAccent) matchBoost = 80;
      else if (isSubstringExact) matchBoost = 40;
      else if (isSubstringNoAccent) matchBoost = 25;

      return {
        ...entry,
        score: matchBoost + entry.count * 15,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  scored.sort((a, b) => b.score - a.score || b.count - a.count || b.lastTimestamp - a.lastTimestamp);

  return scored.slice(0, limit).map(({ description, count, lastAmount, lastDate }) => ({
    description,
    count,
    lastAmount,
    lastDate,
  }));
}

