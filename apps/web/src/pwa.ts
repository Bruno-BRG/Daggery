/** Registers the service worker in production builds. The dev server keeps Vite's own module loading. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Service worker registration failed', error));
  });
}
