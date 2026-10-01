import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  getDocFromServer,
  Timestamp,
  Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadString,
  getDownloadURL,
} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { ExpenseItem } from '../types';
import {
  getSavedAccessToken,
  uploadReceiptDataUrlToDrive,
} from './googleDrive';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export type RealtimeSyncStatus = 'unauthenticated' | 'synced' | 'syncing' | 'offline' | 'error';

let firestoreInstance: Firestore | null = null;
let persistenceInitialized = false;
let connectionValidated = false;

export function getFirebaseAppInstance() {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuthInstance() {
  return getAuth(getFirebaseAppInstance());
}

export function getFirestoreInstance(): Firestore {
  const app = getFirebaseAppInstance();
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
  if (!persistenceInitialized && typeof window !== 'undefined') {
    persistenceInitialized = true;
    // Requirement 2: Enable Firestore IndexedDB offline persistence
    enableIndexedDbPersistence(firestoreInstance).catch((err) => {
      if (err?.code === 'failed-precondition') {
        // Multiple tabs open, fallback to multi-tab IndexedDB persistence
        enableMultiTabIndexedDbPersistence(firestoreInstance!).catch(() => {});
      }
    });
  }
  if (!connectionValidated && typeof window !== 'undefined') {
    connectionValidated = true;
    testFirestoreConnection();
  }
  return firestoreInstance;
}

async function testFirestoreConnection() {
  try {
    const db = getFirestoreInstance();
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const auth = getFirebaseAuthInstance();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function sanitizeFirestoreId(rawId: string): string {
  const cleaned = (rawId || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!cleaned) return `exp_${Date.now()}`;
  return cleaned.slice(0, 120);
}

export function isDataUrl(str: string): boolean {
  return typeof str === 'string' && str.trim().startsWith('data:');
}

/**
 * Parse day, monthNum, year from ExpenseItem.date (DD/MM/YYYY) and ExpenseItem.month ("Tháng M/YYYY")
 */
export function extractDayMonthYearFromExpense(item: ExpenseItem): {
  day: number;
  monthNum: number;
  year: number;
} {
  let day = 1;
  let monthNum = 1;
  let year = new Date().getFullYear();

  const dateMatch = (item.date || '').trim().match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (dateMatch) {
    const d = parseInt(dateMatch[1], 10);
    const m = parseInt(dateMatch[2], 10);
    if (d >= 1 && d <= 31) day = d;
    if (m >= 1 && m <= 12) monthNum = m;
    if (dateMatch[3]) {
      const y = parseInt(dateMatch[3], 10);
      year = y < 100 ? 2000 + y : y;
    }
  }

  const monthMatch = (item.month || '').match(/(\d{1,2})(?:[\/\.](\d{4}))?/);
  if (monthMatch) {
    const m = parseInt(monthMatch[1], 10);
    if (m >= 1 && m <= 12 && !dateMatch) {
      monthNum = m;
    }
    if (monthMatch[2]) {
      const y = parseInt(monthMatch[2], 10);
      if (y >= 1970 && y <= 2200) year = y;
    }
  }

  if (year < 1970 || year > 2200) year = new Date().getFullYear();
  return { day, monthNum, year };
}

/**
 * Requirement 4: Upload receipt image (base64 data URL) to Firebase Storage or Google Drive
 * so Firestore document ONLY stores image URLs (< 2KB) instead of raw base64 (> 1MB limit).
 */
export async function uploadReceiptImageToCloudUrl(
  uid: string,
  expenseId: string,
  imageIndex: number,
  imageStr: string
): Promise<string | null> {
  if (!imageStr || typeof imageStr !== 'string') return null;
  if (!isDataUrl(imageStr)) {
    return imageStr.slice(0, 2048);
  }

  // 1. Try Firebase Storage first
  try {
    const app = getFirebaseAppInstance();
    if (firebaseConfig.storageBucket) {
      const storage = getStorage(app);
      const safeExpId = sanitizeFirestoreId(expenseId);
      const path = `users/${uid}/receipts/${safeExpId}_${imageIndex}.jpg`;
      const fileRef = storageRef(storage, path);
      await uploadString(fileRef, imageStr, 'data_url');
      const downloadUrl = await getDownloadURL(fileRef);
      if (downloadUrl && downloadUrl.length <= 2048) {
        return downloadUrl;
      }
    }
  } catch (err) {
    console.warn('[CloudSync] Firebase Storage upload fallback to Drive:', err);
  }

  // 2. Fallback to Google Drive if accessToken is available
  try {
    const token = getSavedAccessToken();
    if (token) {
      const driveUrl = await uploadReceiptDataUrlToDrive(
        imageStr,
        `Receipt_${sanitizeFirestoreId(expenseId)}_${imageIndex}.jpg`,
        token
      );
      if (driveUrl && driveUrl.length <= 2048) {
        return driveUrl;
      }
    }
  } catch (err) {
    console.warn('[CloudSync] Google Drive receipt image upload failed:', err);
  }

  return null;
}

/**
 * Resolve all images of an ExpenseItem into cloud URLs (never returning data: URLs for Firestore).
 */
export async function resolveCloudImageUrlsForExpense(
  uid: string,
  item: ExpenseItem
): Promise<{ cloudUrls: string[]; updatedLocalImages: string[]; hasConvertedAny: boolean }> {
  const rawImages = Array.isArray(item.images) ? item.images.slice(0, 30) : [];
  const cloudUrls: string[] = [];
  const updatedLocalImages: string[] = [];
  let hasConvertedAny = false;

  for (let i = 0; i < rawImages.length; i++) {
    const img = rawImages[i];
    if (!isDataUrl(img)) {
      if (typeof img === 'string' && img.length > 0 && img.length <= 2048) {
        cloudUrls.push(img);
        updatedLocalImages.push(img);
      }
    } else {
      const uploadedUrl = await uploadReceiptImageToCloudUrl(uid, item.id, i, img);
      if (uploadedUrl) {
        cloudUrls.push(uploadedUrl);
        updatedLocalImages.push(uploadedUrl);
        hasConvertedAny = true;
      } else {
        // Keep base64 locally in IndexedDB, but DO NOT include in Firestore cloudUrls
        updatedLocalImages.push(img);
      }
    }
  }

  return { cloudUrls, updatedLocalImages, hasConvertedAny };
}

/**
 * Build Firestore document payload adhering strictly to firestore.rules and firebase-blueprint.json
 */
export function buildFirestoreExpensePayload(
  uid: string,
  item: ExpenseItem,
  cloudImageUrls?: string[]
) {
  const safeId = sanitizeFirestoreId(item.id);
  const { day, monthNum, year } = extractDayMonthYearFromExpense(item);
  const safeUrls = (
    cloudImageUrls ??
    (Array.isArray(item.images) ? item.images.filter((u) => !isDataUrl(u)) : [])
  )
    .filter((u) => typeof u === 'string' && u.length > 0 && u.length <= 2048)
    .slice(0, 30);

  const cleanDesc = (item.description || 'Khoản chi').trim().slice(0, 1950) || 'Khoản chi';
  const cleanNotes = item.notes ? item.notes.trim().slice(0, 1950) : '';
  const cleanDate = (item.date || `${String(day).padStart(2, '0')}/${String(monthNum).padStart(2, '0')}/${year}`)
    .trim()
    .slice(0, 60);
  const cleanMonth = (item.month || `Tháng ${monthNum}/${year}`).trim().slice(0, 60);
  const nowMs = typeof item.updatedAt === 'number' && item.updatedAt > 0 ? item.updatedAt : Date.now();
  const createdMs = typeof item.createdAt === 'number' && item.createdAt > 0 ? item.createdAt : nowMs;

  const payload: Record<string, any> = {
    id: safeId,
    ownerId: uid,
    day,
    monthNum,
    year,
    date: cleanDate,
    month: cleanMonth,
    amount: Number(item.amount) || 0,
    description: cleanDesc,
    comment: cleanNotes,
    notes: cleanNotes,
    imageUrls: safeUrls,
    images: safeUrls,
    profileId: (item.profileId || 'default').slice(0, 120),
    createdAt: createdMs,
    updatedAt: serverTimestamp(),
    updatedAtMs: nowMs,
  };

  if (item.sheetName && item.sheetName.trim()) {
    payload.sheetName = item.sheetName.trim().slice(0, 120);
  }

  return payload;
}

/**
 * Convert Firestore document data back to ExpenseItem
 */
export function firestoreDocToExpenseItem(
  data: Record<string, any>,
  localExisting?: ExpenseItem
): ExpenseItem {
  let updatedAtMs = Date.now();
  if (data.updatedAt instanceof Timestamp) {
    updatedAtMs = data.updatedAt.toMillis();
  } else if (typeof data.updatedAt === 'number') {
    updatedAtMs = data.updatedAt;
  } else if (typeof data.updatedAtMs === 'number') {
    updatedAtMs = data.updatedAtMs;
  }

  const remoteUrls: string[] = Array.isArray(data.imageUrls)
    ? data.imageUrls
    : Array.isArray(data.images)
    ? data.images
    : [];

  // Preserve local base64 images if remote doesn't have uploaded URLs yet
  const localImages = Array.isArray(localExisting?.images) ? localExisting!.images : [];
  const mergedImages =
    remoteUrls.length > 0
      ? remoteUrls
      : localImages;

  const noteText =
    typeof data.comment === 'string' && data.comment.trim()
      ? data.comment.trim()
      : typeof data.notes === 'string' && data.notes.trim()
      ? data.notes.trim()
      : undefined;

  return {
    id: String(data.id || ''),
    month: String(data.month || `Tháng ${data.monthNum || 1}/${data.year || new Date().getFullYear()}`),
    date: String(
      data.date ||
        `${String(data.day || 1).padStart(2, '0')}/${String(data.monthNum || 1).padStart(2, '0')}/${
          data.year || new Date().getFullYear()
        }`
    ),
    amount: Number(data.amount) || 0,
    description: String(data.description || 'Khoản chi'),
    images: mergedImages,
    notes: noteText,
    sheetName: typeof data.sheetName === 'string' ? data.sheetName : undefined,
    profileId: typeof data.profileId === 'string' ? data.profileId : 'default',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : updatedAtMs,
    updatedAt: updatedAtMs,
  };
}

/**
 * Ensure root user document `/users/{uid}` exists
 */
export async function ensureRootUserDocument(user: User): Promise<void> {
  if (!user?.uid) return;
  const db = getFirestoreInstance();
  const path = `users/${user.uid}`;
  try {
    await setDoc(
      doc(db, 'users', user.uid),
      {
        ownerId: user.uid,
        displayName: (user.displayName || user.email || 'Người dùng').slice(0, 190),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    // Only throw structured error on permission error
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

/**
 * Sync a single ExpenseItem to Firestore `users/{uid}/expenses/{expenseId}`
 * and upload any base64 receipt images in the background.
 */
export async function syncExpenseToFirestore(
  uid: string,
  item: ExpenseItem,
  onLocalImagesUpdated?: (updatedItem: ExpenseItem) => void
): Promise<void> {
  if (!uid) return;
  const db = getFirestoreInstance();
  const safeId = sanitizeFirestoreId(item.id);
  const path = `users/${uid}/expenses/${safeId}`;

  // Step 1: Write expense immediately with any existing URLs (stripping raw base64)
  const payload = buildFirestoreExpensePayload(uid, item);
  try {
    await setDoc(doc(db, 'users', uid, 'expenses', safeId), payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
    throw error;
  }

  // Step 2: If item has any base64 images, upload them to Storage / Drive and update Firestore with URLs
  const hasBase64Images = Array.isArray(item.images) && item.images.some((img) => isDataUrl(img));
  if (hasBase64Images) {
    try {
      const { cloudUrls, updatedLocalImages, hasConvertedAny } =
        await resolveCloudImageUrlsForExpense(uid, item);
      if (hasConvertedAny && cloudUrls.length > 0) {
        const updatedItem: ExpenseItem = {
          ...item,
          images: updatedLocalImages,
          updatedAt: Date.now(),
        };
        const updatedPayload = buildFirestoreExpensePayload(uid, updatedItem, cloudUrls);
        await setDoc(doc(db, 'users', uid, 'expenses', safeId), updatedPayload);
        onLocalImagesUpdated?.(updatedItem);
      }
    } catch (imgErr) {
      console.warn('[CloudSync] Background receipt image upload warning:', imgErr);
    }
  }
}

/**
 * Sync multiple ExpenseItems to Firestore in chunks of 400
 */
export async function syncExpensesBulkToFirestore(
  uid: string,
  items: ExpenseItem[]
): Promise<void> {
  if (!uid || items.length === 0) return;
  const db = getFirestoreInstance();
  const CHUNK_SIZE = 400;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const item of chunk) {
      const safeId = sanitizeFirestoreId(item.id);
      const ref = doc(db, 'users', uid, 'expenses', safeId);
      batch.set(ref, buildFirestoreExpensePayload(uid, item));
    }
    try {
      await batch.commit();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.WRITE, `users/${uid}/expenses`);
      }
      throw error;
    }
  }
}

/**
 * Delete a single ExpenseItem from Firestore
 */
export async function deleteExpenseFromFirestore(uid: string, expenseId: string): Promise<void> {
  if (!uid || !expenseId) return;
  const db = getFirestoreInstance();
  const safeId = sanitizeFirestoreId(expenseId);
  const path = `users/${uid}/expenses/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'expenses', safeId));
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
    throw error;
  }
}

/**
 * Delete multiple ExpenseItems from Firestore
 */
export async function deleteExpensesBulkFromFirestore(
  uid: string,
  expenseIds: string[]
): Promise<void> {
  if (!uid || expenseIds.length === 0) return;
  const db = getFirestoreInstance();
  const CHUNK_SIZE = 400;

  for (let i = 0; i < expenseIds.length; i += CHUNK_SIZE) {
    const chunk = expenseIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const id of chunk) {
      const safeId = sanitizeFirestoreId(id);
      batch.delete(doc(db, 'users', uid, 'expenses', safeId));
    }
    try {
      await batch.commit();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.DELETE, `users/${uid}/expenses`);
      }
      throw error;
    }
  }
}

/**
 * Requirement 3, 6, 8: Subscribe to real-time changes on `users/{uid}/expenses` using `onSnapshot`
 * with `includeMetadataChanges: true` and Last-Write-Wins (`updatedAt`) conflict resolution.
 */
export function subscribeToUserExpensesRealtime(
  uid: string,
  getLocalExpenses: () => ExpenseItem[],
  onRemoteExpensesUpdated: (mergedExpenses: ExpenseItem[]) => void,
  onSyncStatusChanged: (status: RealtimeSyncStatus) => void
): () => void {
  const db = getFirestoreInstance();
  const expensesColRef = collection(db, 'users', uid, 'expenses');
  let initialMergeCompleted = false;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    onSyncStatusChanged('offline');
  } else {
    onSyncStatusChanged('syncing');
  }

  const unsubscribe = onSnapshot(
    expensesColRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        onSyncStatusChanged('offline');
      } else if (snapshot.metadata.hasPendingWrites) {
        onSyncStatusChanged('syncing');
      } else {
        onSyncStatusChanged('synced');
      }

      const currentLocal = getLocalExpenses();
      const localMap = new Map<string, ExpenseItem>();
      currentLocal.forEach((item) => {
        localMap.set(sanitizeFirestoreId(item.id), item);
      });

      const remoteMap = new Map<string, ExpenseItem>();
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const safeId = sanitizeFirestoreId(data.id || docSnap.id);
        const existingLocal = localMap.get(safeId);
        const parsed = firestoreDocToExpenseItem(
          { ...data, id: existingLocal?.id || data.id || docSnap.id },
          existingLocal
        );
        remoteMap.set(safeId, parsed);
      });

      // Handle explicit deletions from another device
      let hasDeletedAny = false;
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          const removedId = sanitizeFirestoreId(change.doc.id);
          if (localMap.has(removedId)) {
            localMap.delete(removedId);
            hasDeletedAny = true;
          }
        }
      });

      // Initial sync: Push local expenses that are newer or missing on Firestore (Last-Write-Wins)
      if (!initialMergeCompleted) {
        initialMergeCompleted = true;
        const itemsToPushToCloud: ExpenseItem[] = [];
        const hasRealExpenses =
          remoteMap.size > 0 ||
          currentLocal.some((item) => !item.id.startsWith('sample_'));

        currentLocal.forEach((localItem) => {
          // Do not push initial sample placeholders if real expenses exist on cloud
          if (hasRealExpenses && localItem.id.startsWith('sample_') && remoteMap.size > 0) {
            localMap.delete(sanitizeFirestoreId(localItem.id));
            return;
          }

          const safeId = sanitizeFirestoreId(localItem.id);
          const remoteItem = remoteMap.get(safeId);
          if (!remoteItem) {
            itemsToPushToCloud.push(localItem);
          } else if ((localItem.updatedAt || 0) > (remoteItem.updatedAt || 0) + 2000) {
            // Local is newer -> Last-Write-Wins pushes local to Firestore
            itemsToPushToCloud.push(localItem);
          }
        });

        if (itemsToPushToCloud.length > 0) {
          syncExpensesBulkToFirestore(uid, itemsToPushToCloud).catch((err) => {
            console.warn('[CloudSync] Initial local-to-cloud push error:', err);
          });
        }
      }

      // Build merged list using Last-Write-Wins (Requirement 6)
      const mergedMap = new Map<string, ExpenseItem>();

      // Start with remote items
      remoteMap.forEach((remoteItem, safeId) => {
        const localItem = localMap.get(safeId);
        if (localItem && (localItem.updatedAt || 0) > (remoteItem.updatedAt || 0) + 1000) {
          mergedMap.set(safeId, localItem);
        } else {
          mergedMap.set(safeId, remoteItem);
        }
      });

      // Include any local items not yet in remote (if not deleted and not superseded sample data)
      if (remoteMap.size === 0 && !hasDeletedAny) {
        localMap.forEach((localItem, safeId) => {
          if (!mergedMap.has(safeId)) {
            mergedMap.set(safeId, localItem);
          }
        });
      }

      const mergedList = Array.from(mergedMap.values()).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      );

      onRemoteExpensesUpdated(mergedList);
    },
    (error) => {
      onSyncStatusChanged('error');
      console.warn('[CloudSync] onSnapshot error:', error);
    }
  );

  return unsubscribe;
}

export { onAuthStateChanged };
