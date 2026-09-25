import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const script = readFileSync("public/js/hhsrs-reporter.js", "utf8");

type Listener = { type: string; fn: (ev?: unknown) => void; target: string };

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    getItem(key: string) {
      const stored = data.get(String(key));
      return stored == null ? null : stored;
    },
    setItem(key: string, value: string) {
      data.set(String(key), String(value));
    },
    removeItem(key: string) {
      data.delete(String(key));
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

function makeEl(tag: string, id: string) {
  const el: Record<string, unknown> = {
    id,
    tagName: tag.toUpperCase(),
    type: tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text",
    value: "",
    checked: false,
    readOnly: false,
    hidden: false,
    disabled: false,
    textContent: "",
    className: "",
    dataset: {} as Record<string, string>,
    style: {},
    options: [] as Array<{ value: string; textContent: string }>,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild(child: { value?: string; textContent?: string; tagName?: string }) {
      if (tag === "select") {
        (el.options as Array<{ value: string; textContent: string }>).push({
          value: child.value || "",
          textContent: child.textContent || "",
        });
      }
      return child;
    },
    contains() {
      return false;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  let html = "";
  Object.defineProperty(el, "innerHTML", {
    get() {
      return html;
    },
    set(value: string) {
      html = String(value);
      if (tag === "select") el.options = [];
    },
  });
  return el;
}

function bootReview(opts: {
  storage: ReturnType<typeof memoryStorage>;
  fetchImpl: () => Promise<unknown>;
}) {
  const listeners: Listener[] = [];
  const ids: Record<string, ReturnType<typeof makeEl>> = {};
  function el(tag: string, id: string, props: Record<string, unknown> = {}) {
    const node = makeEl(tag, id);
    Object.assign(node, props);
    node.addEventListener = (type: string, fn: Listener["fn"]) => {
      listeners.push({ type, fn, target: id });
    };
    ids[id] = node;
    return node;
  }

  el("input", "rv-email-to");
  el("input", "rv-email-cc");
  el("input", "rv-email-bcc");
  el("input", "rv-email-subject");
  el("textarea", "rv-email-body");
  el("textarea", "rv-notes");
  el("select", "rv-project", { value: "Gateway 2026" });
  (ids["rv-project"].options as Array<{ value: string }>).push({ value: "Gateway 2026" });
  el("select", "rv-rating");
  el("fieldset", "rv-case-fields");
  el("p", "rv-project-hint");
  el("button", "btn-generate-email");
  el("p", "rv-email-empty-hint");
  el("span", "rv-email-badge");
  el("p", "rv-draft-status");
  el("section", "rv-case-panel");
  el("a", "btn-create-plain-email");

  const document = {
    getElementById(id: string) {
      return ids[id] || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag: string) {
      return makeEl(tag, "");
    },
    addEventListener(type: string, fn: Listener["fn"]) {
      listeners.push({ type, fn, target: "document" });
    },
    removeEventListener() {},
    body: { appendChild() {}, removeChild() {} },
    visibilityState: "visible",
  };

  const windowObj: Record<string, unknown> = {
    HHSRS_REPORTER: {
      base: "/HHSRSreporter",
      mode: "filled",
      caseId: "case-kept",
      initialProject: "Gateway 2026",
      casePhotos: [],
      waitingIds: ["case-kept"],
      alertsPollMs: 60000,
      demoProjects: [
        {
          name: "Gateway 2026",
          template: "Standard",
          ratingScheme: "NEW",
          extras: {},
          to: ["hhsrs@gatewayhousing.org.uk"],
          cc: ["gwheeler@savills.com"],
          bcc: ["archive@example.com"],
          hint: "Gateway",
        },
      ],
    },
    localStorage: opts.storage,
    sessionStorage: memoryStorage(),
    location: {
      search: "",
      pathname: "/HHSRSreporter/review/case-kept",
      href: "http://127.0.0.1/HHSRSreporter/review/case-kept",
    },
    history: { replaceState() {} },
    document,
    addEventListener(type: string, fn: Listener["fn"]) {
      listeners.push({ type, fn, target: "window" });
    },
    removeEventListener() {},
    scrollBy() {},
    requestAnimationFrame(fn: () => void) {
      fn();
    },
    fetch: opts.fetchImpl,
    setInterval() {
      return 0;
    },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    URL,
    console,
  };
  windowObj.window = windowObj;

  const sandbox = {
    window: windowObj,
    document,
    localStorage: opts.storage,
    sessionStorage: windowObj.sessionStorage,
    fetch: (...args: unknown[]) => (windowObj.fetch as (...a: unknown[]) => Promise<unknown>)(...args),
    setInterval() {
      return 0;
    },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    console,
    URL,
    Promise,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    encodeURIComponent,
    decodeURIComponent,
    RegExp,
    Error,
  };

  vm.runInNewContext(script, sandbox, { filename: "hhsrs-reporter.js" });
  return { ids, listeners, windowObj };
}

const pendingFetch = () =>
  Promise.resolve({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({ pending: [] }),
  });

describe("HHSRS review email draft restore", () => {
  it("restores a typed draft after leaving and does not overwrite it with empty fields", async () => {
    const storage = memoryStorage({
      "hhsrs-review-drafts-v1": JSON.stringify({
        "case-kept": {
          project: "Gateway 2026",
          fields: { "rv-notes": "Typed site notes" },
          email: {
            "rv-email-to": "kept-to@example.com",
            "rv-email-cc": "kept-cc@example.com",
            "rv-email-bcc": "kept-bcc@example.com",
            "rv-email-subject": "Kept subject",
            "rv-email-body": "Kept draft body",
          },
          caseDetailsLocked: false,
        },
      }),
    });
    const { ids, listeners } = bootReview({ storage, fetchImpl: pendingFetch });
    assert.equal(ids["rv-email-body"].value, "Kept draft body");
    assert.equal(ids["rv-email-bcc"].value, "kept-bcc@example.com");
    assert.equal(ids["rv-notes"].value, "Typed site notes");
    assert.equal(storage.getItem("undefined"), null);
    assert.equal(storage.getItem("hhsrs-review-last-key-v1"), "case-kept");

    const pagehide = listeners.filter((listener) => listener.target === "window" && listener.type === "pagehide");
    assert.ok(pagehide.length > 0);
    pagehide.forEach((listener) => listener.fn());

    const saved = JSON.parse(storage.getItem("hhsrs-review-drafts-v1") || "{}");
    assert.equal(saved["case-kept"].email["rv-email-body"], "Kept draft body");
    assert.equal(saved["case-kept"].email["rv-email-bcc"], "kept-bcc@example.com");
    assert.equal(saved["case-kept"].fields["rv-notes"], "Typed site notes");
    assert.equal(storage.getItem("undefined"), null);
  });

  it("fills Bcc from the generated draft when the project data includes it", async () => {
    const storage = memoryStorage();
    let draft = {
      ok: true,
      to: "to@example.com",
      cc: "cc@example.com",
      bcc: "archive@example.com",
      subject: "Subject",
      body: "Generated body",
    };
    const { ids, listeners } = bootReview({
      storage,
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => draft,
        }),
    });
    const click = listeners.find((listener) => listener.target === "btn-generate-email" && listener.type === "click");
    assert.ok(click);
    click.fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ids["rv-email-to"].value, "to@example.com");
    assert.equal(ids["rv-email-cc"].value, "cc@example.com");
    assert.equal(ids["rv-email-bcc"].value, "archive@example.com");
    assert.equal(ids["rv-email-body"].value, "Generated body");

    draft = { ...draft, to: "next@example.com", cc: "", bcc: "", subject: "Next", body: "Next body" };
    click.fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ids["rv-email-to"].value, "next@example.com");
    assert.equal(ids["rv-email-bcc"].value, "");
  });
});
