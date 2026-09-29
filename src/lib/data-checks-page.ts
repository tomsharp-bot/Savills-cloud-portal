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
  'id="baseDrop"',
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
body{display:flex;flex-direction:column;height:100%;min-height:100%;overflow:hidden}
#scp-app{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
body>.restoreBar{top:132px}
`;

export function readDataReviewPage(): string {
  return readFileSync(dataReviewPagePath(), "utf8");
}

/**
 * Put the portal top bar above the practice page and keep the tool in the
 * remaining viewport. The practice markup, stylesheet, and scripts stay intact.
 * Fixed overlays (lightbox, loading, toasts, and anything the script appends
 * to document.body) stay on the body so they are not clipped.
 */
export function assembleDataChecksPage(sourceHtml: string, topbarHtml: string): string {
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
  return `${open}\n<div class="scp-host">\n${topbarHtml}\n</div>\n<div id="scp-app">${app}</div>\n${tail}`;
}
