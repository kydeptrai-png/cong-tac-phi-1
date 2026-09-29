import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Requirement 8: Global error listener for unhandled promises and window errors
// Intercepts unhandled rejections and suppresses fatal crashes / white screens
window.addEventListener('unhandledrejection', (event) => {
  // Always prevent default to prevent unhandled promise rejection errors in console
  event.preventDefault();

  const reason = event.reason;
  const reasonStr = String(reason?.message || reason || '');

  // Ignore benign background errors (WebSocket, Vite HMR, ServiceWorker iframe sandbox)
  if (
    reasonStr.includes('WebSocket') ||
    reasonStr.includes('vite') ||
    reasonStr.includes('HMR') ||
    reasonStr.includes('ServiceWorker') ||
    reasonStr.includes('service worker') ||
    reasonStr.includes('SecurityError') ||
    reasonStr.includes('Failed to fetch') ||
    reasonStr.includes('ResizeObserver')
  ) {
    return;
  }

  console.warn('Unhandled rejection handled gracefully:', reasonStr);
});

window.onerror = (message, source, lineno, colno, error) => {
  const msgStr = String(message || '');

  // Ignore benign Vite dev / WebSocket / iframe errors
  if (
    msgStr.includes('WebSocket') ||
    msgStr.includes('vite') ||
    msgStr.includes('HMR') ||
    msgStr.includes('ServiceWorker') ||
    msgStr.includes('service worker') ||
    msgStr.includes('ResizeObserver')
  ) {
    return true; // suppress
  }

  console.warn('Global error handled gracefully:', msgStr);
  return true; // prevent white screen / fatal browser crash
};

// Requirement 1: Register Service Worker for full offline PWA & Android APK cache
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('Phiên bản mới đã sẵn sàng.');
                }
              });
            }
          });
        })
        .catch(() => {
          // Gracefully ignore service worker registration errors in dev/sandbox
        });
    } catch {
      // Ignore
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
