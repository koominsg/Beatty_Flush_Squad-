/*
 * Flush Squad Command — backend adapter for GitHub Pages.
 *
 * The app was first built as a Claude artifact, where it calls
 * claude.use("db") and claude.use("downloads"). This file provides the
 * same two capabilities using Firebase Cloud Firestore and a normal
 * browser download, so index.html runs unchanged on any static host.
 */
(function () {
  "use strict";

  let dbPromise = null;

  function configLooksReal(cfg) {
    return cfg && cfg.apiKey && cfg.projectId && !/YOUR_|REPLACE/i.test(cfg.apiKey + cfg.projectId);
  }

  function initDb() {
    if (dbPromise) return dbPromise;
    dbPromise = (async () => {
      const cfg = window.FIREBASE_CONFIG;
      if (typeof firebase === "undefined" || !configLooksReal(cfg)) {
        console.warn("[Flush Squad] Firebase not configured. Edit config.js.");
        return null;
      }
      try {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        const fs = firebase.firestore();
        return makeDb(fs);
      } catch (e) {
        console.error("[Flush Squad] Could not start Firebase:", e);
        return null;
      }
    })();
    return dbPromise;
  }

  // Short lease on a document so only one teacher can claim a request.
  function makeAcquire(fs, ref) {
    return async function acquire(opts) {
      const holder = String((opts && opts.holder) || "anon");
      const ttl = Math.min(600000, Math.max(1000, (opts && opts.ttlMs) || 30000));
      const leaseRef = fs.collection("_leases").doc(ref.path.replace(/\//g, "__"));
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(leaseRef);
        const now = Date.now();
        if (snap.exists) {
          const l = snap.data();
          if (l.expiresAt > now && l.holder !== holder) {
            return { acquired: false, expiresAt: new Date(l.expiresAt).toISOString() };
          }
        }
        const exp = now + ttl;
        tx.set(leaseRef, { holder, expiresAt: exp });
        return { acquired: true, holder, expiresAt: new Date(exp).toISOString() };
      });
    };
  }

  function makeDb(fs) {
    return {
      doc(path) {
        const ref = fs.doc(path);
        ref.acquire = makeAcquire(fs, ref);
        return ref;
      },
      collection(path) {
        return fs.collection(path);
      },
    };
  }

  const downloads = {
    async save({ filename, data }) {
      const type = /\.csv$/i.test(filename) ? "text/csv;charset=utf-8"
        : /\.json$/i.test(filename) ? "application/json" : "text/plain;charset=utf-8";
      const blob = data instanceof Blob ? data : new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { status: "saved" };
    },
  };

  window.claude = {
    async use(name) {
      if (name === "db") return initDb();
      if (name === "downloads") return downloads;
      return null;
    },
  };
})();
