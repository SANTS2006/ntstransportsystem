// Runs before the page paints, so a dark-mode visitor never sees a white flash. A separate file (not
// inline) because the site's content security policy only allows scripts from its own address.
(function () {
  try {
    var saved = localStorage.getItem('nts-theme');
    var dark =
      saved === 'dark' ||
      (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch {
    /* storage blocked: follow the light default */
  }
})();
