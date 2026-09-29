/**
 * Unified File Saver Utility for Web, PWA, and Capacitor / Android WebView
 * 
 * Requirement 2:
 * "Hàm lưu file dùng chung (một chỗ duy nhất): mọi thao tác tải file (Excel, PDF, sao lưu JSON)
 * đều gọi hàm này. Mặc định tải bằng Blob + thẻ <a download>. Nếu phát hiện đang chạy trong
 * Capacitor/WebView thì dùng Filesystem + Share của Capacitor để lưu vào bộ nhớ máy, vì tải Blob
 * không hoạt động trong WebView."
 */

export interface SaveFileOptions {
  blob: Blob;
  fileName: string;
  mimeType?: string;
  title?: string;
  text?: string;
}

export interface SaveFileResult {
  success: boolean;
  method: 'browser_blob' | 'capacitor_share' | 'capacitor_filesystem' | 'android_bridge' | 'web_share';
  pathOrUri?: string;
  error?: string;
}

/**
 * Converts a Blob to raw Base64 string (without the data:...;base64, prefix)
 */
export async function blobToBase64Raw(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64Index = reader.result.indexOf(',');
        const raw = base64Index !== -1 ? reader.result.substring(base64Index + 1) : reader.result;
        resolve(raw);
      } else {
        reject(new Error('FileReader result is not a string'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Checks if the app is running in a native Android wrapper (Capacitor, Cordova, or custom WebView)
 */
export function isNativeAppOrWebView(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Capacitor global check
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() || cap?.isNative) return true;
  if (cap?.Plugins?.Filesystem) return true;

  // 2. Android JavaScript bridge interface
  if (typeof (window as any).AndroidSaveFile === 'function' || (window as any).Android) {
    return true;
  }

  // 3. Cordova / PhoneGap / Ionic
  if ((window as any).cordova || (window as any).PhoneGap) return true;

  return false;
}

/**
 * Single, unified entry point for saving / downloading any file across all environments.
 */
export async function saveOrDownloadFile({
  blob,
  fileName,
  mimeType,
  title,
  text,
}: SaveFileOptions): Promise<SaveFileResult> {
  const cleanFileName = fileName.replace(/[\/\\?%*:|"<> ]/g, '_');
  const type = mimeType || blob.type || 'application/octet-stream';

  // -------------------------------------------------------------
  // 1. Try Android Native JS Bridge (if app is wrapped in custom Android WebView)
  // -------------------------------------------------------------
  const win = typeof window !== 'undefined' ? (window as any) : {};
  if (typeof win.AndroidSaveFile === 'function') {
    try {
      const base64 = await blobToBase64Raw(blob);
      win.AndroidSaveFile(cleanFileName, base64, type);
      return { success: true, method: 'android_bridge' };
    } catch (err) {
      console.warn('AndroidSaveFile bridge failed, falling back...', err);
    }
  }

  if (win.Android && typeof win.Android.saveFile === 'function') {
    try {
      const base64 = await blobToBase64Raw(blob);
      win.Android.saveFile(cleanFileName, base64, type);
      return { success: true, method: 'android_bridge' };
    } catch (err) {
      console.warn('Android.saveFile bridge failed, falling back...', err);
    }
  }

  if (win.Android && typeof win.Android.downloadFile === 'function') {
    try {
      const base64 = await blobToBase64Raw(blob);
      win.Android.downloadFile(base64, cleanFileName, type);
      return { success: true, method: 'android_bridge' };
    } catch (err) {
      console.warn('Android.downloadFile bridge failed, falling back...', err);
    }
  }

  // -------------------------------------------------------------
  // 2. Try Capacitor Plugins: Filesystem + Share (for Capacitor Android APKs)
  // -------------------------------------------------------------
  const cap = typeof window !== 'undefined' ? (window as any).Capacitor : null;
  const Filesystem = cap?.Plugins?.Filesystem;
  const Share = cap?.Plugins?.Share;

  if (Filesystem) {
    try {
      const base64Data = await blobToBase64Raw(blob);

      // Attempt saving to DOCUMENTS or CACHE
      let writeResult: any;
      try {
        writeResult = await Filesystem.writeFile({
          path: cleanFileName,
          data: base64Data,
          directory: 'DOCUMENTS',
          recursive: true,
        });
      } catch (docErr) {
        // Fallback to CACHE directory if DOCUMENTS is restricted
        writeResult = await Filesystem.writeFile({
          path: cleanFileName,
          data: base64Data,
          directory: 'CACHE',
          recursive: true,
        });
      }

      const fileUri = writeResult?.uri;

      // If Share plugin is available, trigger native Android Share / Save to Downloads dialog
      if (Share && fileUri) {
        try {
          await Share.share({
            title: title || cleanFileName,
            text: text || `Tải xuống ${cleanFileName}`,
            url: fileUri,
            dialogTitle: `Lưu ${cleanFileName}`,
          });
          return { success: true, method: 'capacitor_share', pathOrUri: fileUri };
        } catch (shareErr) {
          console.warn('Capacitor Share cancelled or failed, file is saved in storage:', shareErr);
          return { success: true, method: 'capacitor_filesystem', pathOrUri: fileUri };
        }
      }

      return { success: true, method: 'capacitor_filesystem', pathOrUri: fileUri };
    } catch (capErr: any) {
      console.warn('Capacitor Filesystem write failed, falling back to browser download:', capErr);
    }
  }

  // -------------------------------------------------------------
  // 3. Web Share API fallback (if supported and on mobile device)
  // -------------------------------------------------------------
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.canShare &&
      navigator.share &&
      typeof File !== 'undefined'
    ) {
      const testFile = new File([blob], cleanFileName, { type });
      if (navigator.canShare({ files: [testFile] })) {
        // Only attempt Web Share if user triggered and not in desktop Chrome
        const isMobileUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobileUserAgent) {
          try {
            await navigator.share({
              files: [testFile],
              title: title || cleanFileName,
            });
            return { success: true, method: 'web_share' };
          } catch (shareEx) {
            // User cancelled share or dismissed dialog, continue to standard anchor
            console.log('Web share cancelled or rejected, using standard anchor download');
          }
        }
      }
    }
  } catch {
    // Ignore share check error
  }

  // -------------------------------------------------------------
  // 4. Default: Standard Browser Blob download with <a download>
  // -------------------------------------------------------------
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanFileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      try {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // Ignore cleanup error
      }
    }, 3000);

    return { success: true, method: 'browser_blob' };
  } catch (err: any) {
    console.error('All download methods failed:', err);
    return {
      success: false,
      method: 'browser_blob',
      error: err?.message || 'Không thể tải file.',
    };
  }
}
