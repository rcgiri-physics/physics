// Answer keys are not written into the page as plain text: build.py scrambles each question's answer
// (and its explanation) with a key derived from the page and question number, and this decodes them in
// the browser. It doesn't stop a determined person (nothing that reaches a browser can), but simple
// scrapers that copy the HTML get questions without answers. Must match scramble() in build.py.
(function () {
  const SALT = 'pd-k1';
  function stream(seed, n) {
    let h = 2166136261;
    for (const b of new TextEncoder().encode(seed)) h = Math.imul(h ^ b, 16777619) >>> 0;
    const out = new Uint8Array(n);
    let a = h;
    for (let i = 0; i < n; i++) {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a) >>> 0;
      t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) >>> 0;
      out[i] = ((t ^ (t >>> 14)) >>> 0) & 255;
    }
    return out;
  }
  // Returns the decoded object, or null if the value is missing or damaged.
  window.pdUnlock = function (id, value) {
    try {
      const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
      const key = stream(SALT + ':' + id, bytes.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i];
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  };
})();
