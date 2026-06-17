/* Vercel Speed Insights initialization
   Tracks Core Web Vitals and performance metrics
   Uses dynamic import to load the Speed Insights module */

(function initSpeedInsights() {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') return;

  // Dynamically import and initialize Speed Insights
  import('https://cdn.jsdelivr.net/npm/@vercel/speed-insights@1/dist/index.mjs')
    .then(module => {
      if (module && typeof module.injectSpeedInsights === 'function') {
        module.injectSpeedInsights();
        console.log('[Speed Insights] Successfully initialized');
      }
    })
    .catch(err => {
      console.warn('[Speed Insights] Failed to load:', err);
    });
})();
