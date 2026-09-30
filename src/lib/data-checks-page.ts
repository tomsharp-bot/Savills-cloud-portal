import { readFileSync } from "node:fs";
import path from "node:path";

/** Offline Data Review practice v4 page, hosted unchanged except for the portal bar. */
export const DATA_REVIEW_FILENAME = "data-review-practice-v4.html";

export function dataReviewPagePath(): string {
  return path.join(process.cwd(), "views", "data-checks", DATA_REVIEW_FILENAME);
}

/**
 * Pieces of the practice page that must survive hosting. If one of these is
 * missing, the file is not the v4 page Tom has been using.
 */
export const DATA_REVIEW_MARKERS = [
  'id="cellRead"',
  'data-tab="builder"',
  "File builder",
  "Import data from an existing MDF",
  'data-tab="grid"',
  "Master Data File",
  'id="photoBox"',
  "approve Auto issue",
  "showSaveFilePicker",
] as const;

const BAR_CSS = `
.scp-host{position:relative;z-index:40;flex:none;background:#0b1f33;color:#fff;font-family:"Segoe UI",system-ui,sans-serif}
.scp-host .topbar{background:#0b1f33;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.scp-host .topbar .brand{color:#fff;font-weight:700;text-decoration:none;white-space:nowrap}
.scp-host .topbar .brand:hover{text-decoration:underline}
.scp-host .topbar .right{display:flex;align-items:center;gap:12px;font-size:.9rem;flex-wrap:wrap;justify-content:flex-end}
.scp-host .topbar a.linkish,.scp-host .topbar button.linkish{background:transparent;border:0;color:#cde0f5;cursor:pointer;text-decoration:underline;padding:0;font:inherit;line-height:inherit}
.scp-host .topbar a.data-checks-nav{font-weight:700;color:#fff;text-decoration:none}
.scp-host .topbar a.data-checks-nav:hover{text-decoration:underline}
.scp-host .topbar .role-pill{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25)}
.scp-host .inline-form{display:inline;margin:0}
.scp-host .scp-back{margin:0;padding:6px 20px 10px;background:#0b1f33}
.scp-host .scp-back a{color:#fff;font-weight:700;text-decoration:none;font-size:.95rem}
.scp-host .scp-back a:hover{text-decoration:underline}
body{display:flex;flex-direction:column;height:100%;min-height:100%;overflow:hidden}
#scp-app{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
body>.restoreBar{top:168px}
`;

export type DataChecksBoot = {
  fileId: string;
  fileName: string;
  fileUrl: string;
  saveUrl: string;
  listUrl: string;
};

export type DataChecksPageOptions = {
  /** Link back to the live-file list. */
  backHref?: string;
  /** When set, the validator opens this stored master and writes Save Master back to it. */
  boot?: DataChecksBoot;
};

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function readDataReviewPage(): string {
  return readFileSync(dataReviewPagePath(), "utf8");
}

/**
 * Put the portal top bar above the practice page and keep the tool in the
 * remaining viewport. The practice markup, stylesheet, and scripts stay intact.
 * Fixed overlays (lightbox, loading, toasts, and anything the script appends
 * to document.body) stay on the body so they are not clipped.
 */
export function assembleDataChecksPage(
  sourceHtml: string,
  topbarHtml: string,
  options: DataChecksPageOptions = {}
): string {
  for (const marker of DATA_REVIEW_MARKERS) {
    if (!sourceHtml.includes(marker)) {
      throw new Error(`Data Review page is missing ${marker}`);
    }
  }
  let html = sourceHtml.replace(
    "<title>Data Review (practice v4)</title>",
    "<title>Data Checks — Savills Cloud Portal</title>"
  );
  if (!html.includes("<title>Data Checks — Savills Cloud Portal</title>")) {
    throw new Error("Data Review page title was not found.");
  }
  const headEnd = html.indexOf("</head>");
  const bodyAt = html.indexOf("<body>");
  const lbAt = html.indexOf('<div id="lb">');
  if (headEnd < 0 || bodyAt < 0 || lbAt < 0 || !(headEnd < bodyAt && bodyAt < lbAt)) {
    throw new Error("Data Review page structure was not recognised.");
  }
  html = html.slice(0, headEnd) + `<style id="scp-data-checks-bar">${BAR_CSS}</style>` + html.slice(headEnd);
  const bodyAt2 = html.indexOf("<body>");
  const lbAt2 = html.indexOf('<div id="lb">');
  const open = html.slice(0, bodyAt2 + "<body>".length);
  const app = html.slice(bodyAt2 + "<body>".length, lbAt2);
  const tail = html.slice(lbAt2);
  const back = options.backHref
    ? `<p class="scp-back"><a href="${escHtml(options.backHref)}">Back to live files</a></p>`
    : "";
  const boot = options.boot ? dataChecksBootMarkup(options.boot) : "";
  const page = `${open}\n<div class="scp-host">\n${topbarHtml}\n${back}\n</div>\n<div id="scp-app">${app}</div>\n${tail}`;
  const end = page.lastIndexOf("</body>");
  if (end < 0) return page + boot;
  return page.slice(0, end) + boot + page.slice(end);
}

/**
 * Opens the stored workbook in the existing validator and, after Save Master,
 * stores those bytes again. Leaving the page flushes the per-file autosave so
 * the next open of this file still has the work. Another file has its own key.
 */
function dataChecksBootMarkup(boot: DataChecksBoot): string {
  return `<script type="application/json" id="scp-mdf-boot">${jsonForScript(boot)}</script>
<script id="scp-mdf-bridge">
(function () {
  var el = document.getElementById("scp-mdf-boot");
  if (!el || typeof openFile !== "function" || typeof saveMaster !== "function") return;
  var cfg = JSON.parse(el.textContent || "{}");
  var key = "mdf:" + cfg.fileId;
  var origAuto = autosaveNow;
  var origOffer = offerRestore;
  var origSave = saveMaster;
  var origGet = idbGet;
  function sessionForThisFile(rec) {
    if (!rec || !rec.B) return false;
    if (rec.portalFileId) return rec.portalFileId === cfg.fileId;
    return rec.fileName === cfg.fileName;
  }
  idbGet = function (k) {
    return origGet(k).then(function (rec) {
      if (k !== "last") return rec;
      return sessionForThisFile(rec) ? rec : null;
    });
  };
  autosaveNow = async function () {
    var ok = await origAuto();
    try {
      var snap = snapshot();
      if (snap) { snap.portalFileId = cfg.fileId; await idbSet(key, snap); }
    } catch (e) {}
    return ok;
  };
  offerRestore = function () { return Promise.resolve(); };
  async function loadStored() {
    try {
      var res = await fetch(cfg.fileUrl, { credentials: "same-origin" });
      if (!res.ok) { alert("This live file could not be opened."); return; }
      var blob = await res.blob();
      var file = new File([blob], cfg.fileName, { type: "application/vnd.ms-excel.sheet.macroEnabled.12" });
      await openFile(file);
    } catch (err) {
      alert("This live file could not be opened.\\n\\n" + (err && err.message ? err.message : err));
    }
  }
  saveMaster = async function (asNew, opt) {
    var ok = await origSave(asNew, opt);
    if (!ok || !DRV.lastSaveBuf) return ok;
    try {
      var name = (MS && MS.fileName) || cfg.fileName;
      var fd = new FormData();
      fd.append("file", new Blob([DRV.lastSaveBuf], { type: "application/vnd.ms-excel.sheet.macroEnabled.12" }), name);
      fd.append("asNew", asNew ? "1" : "0");
      var res = await fetch(cfg.saveUrl, { method: "POST", body: fd, credentials: "same-origin" });
      if (!res.ok) {
        var text = await res.text();
        if (typeof toast === "function") toast("Saved on this computer, but the live file was not updated. " + text, 6000);
        return ok;
      }
      var data = await res.json();
      if (data && data.id && data.id !== cfg.fileId && data.openUrl) location.replace(data.openUrl);
    } catch (e) {
      if (typeof toast === "function") toast("Saved on this computer, but the live file was not updated.", 6000);
    }
    return ok;
  };
  var back = document.querySelector(".scp-back a");
  if (back) {
    back.addEventListener("click", function (event) {
      event.preventDefault();
      var href = back.getAttribute("href");
      Promise.race([autosaveNow(), new Promise(function (resolve) { setTimeout(resolve, 1500); })]).then(function () {
        location.href = href;
      });
    });
  }
  setTimeout(async function () {
    var rec = null;
    try { rec = await idbGet(key); } catch (e) { rec = null; }
    if (rec && rec.B && rec.dirty && rec.portalFileId === cfg.fileId) {
      try { await idbSet("last", rec); } catch (e) {}
      await origOffer();
      var later = document.getElementById("rsLater");
      var del = document.getElementById("rsDel");
      if (later) later.onclick = function () { var bar = document.getElementById("restoreBar"); if (bar) bar.remove(); loadStored(); };
      if (del) del.onclick = async function () {
        if (!confirm("Discard the autosaved session? This can’t be undone.")) return;
        try { await idbDel("last"); await idbDel(key); } catch (e) {}
        var bar = document.getElementById("restoreBar"); if (bar) bar.remove();
        loadStored();
      };
      return;
    }
    await loadStored();
  }, 350);
})();
</script>
`;
}
