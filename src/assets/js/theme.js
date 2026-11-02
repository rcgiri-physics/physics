// Runs before the page is drawn (loaded without defer) so a saved light/dark choice never flashes.
// site.js wires up the sun/moon button. Without a saved choice the device setting is used.
(function () {
  try {
    var t = localStorage.getItem('pd-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* storage blocked: follow the device */ }
})();
