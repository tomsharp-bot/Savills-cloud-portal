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

function FakeFormData(this: { parts: Array<[string, unknown]> }) {
  this.parts = [];
}
FakeFormData.prototype.append = function (this: { parts: Array<[string, unknown]> }, name: string, value: unknown) {
  this.parts.push([name, value]);
};

function bootReview(opts: {
  storage: ReturnType<typeof memoryStorage>;
  fetchImpl: () => Promise<unknown>;
  caseId?: string;
  mode?: string;
  withSend?: boolean;
  withAbandon?: boolean;
  assign?: (url: string) => void;
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

  el("input", "hhsrs-to");
  el("input", "hhsrs-cc");
  el("input", "hhsrs-bcc");
  el("input", "hhsrs-subject");
  el("textarea", "hhsrs-body");
  el("textarea", "rv-notes");
  el("select", "rv-project", { value: "Gateway 2026" });
  (ids["rv-project"].options as Array<{ value: string }>).push({ value: "Gateway 2026" });
  el("select", "rv-rating");
  el("fieldset", "rv-case-fields");
  el("p", "rv-project-hint");
  el("button", "btn-generate-email");
  const emailDraft = el("section", "rv-email-draft");
  const scrollCalls: unknown[] = [];
  emailDraft.scrollIntoView = (opts: unknown) => {
    scrollCalls.push(opts);
  };
  emailDraft.getBoundingClientRect = () => ({ top: 640, height: 900, bottom: 1540, left: 0, right: 400, width: 400 });
  emailDraft.scrollCalls = scrollCalls;
  el("p", "rv-email-empty-hint");
  el("span", "rv-email-badge");
  el("p", "rv-draft-status");
  el("section", "rv-case-panel");
  el("a", "btn-create-plain-email");
  if (opts.withSend) {
    el("button", "btn-send-email");
    el("div", "ck-overlay", { hidden: true });
    el("div", "ck-body");
    el("input", "ck-tick", { type: "checkbox" });
    el("label", "ck-tick-label");
    el("button", "ck-send");
    el("button", "ck-back");
    el("form", "rv-send-form");
    el("input", "rv-send-to");
    el("input", "rv-send-cc");
    el("input", "rv-send-bcc");
    el("input", "rv-send-subject");
    el("textarea", "rv-send-body");
    el("div", "rv-send-photo-fields");
    el("input", "rv-address");
    el("input", "rv-uprn");
    el("select", "rv-hazard");
    el("input", "rv-surveyor");
    el("input", "rv-survey-date");
    el("p", "rv-send-line", { hidden: false });
  }
  if (opts.withAbandon) {
    el("form", "abandon-claim-form");
    el("button", "btn-abandon-claim");
  }

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
    body: {
      dataset: {} as Record<string, string>,
      appendChild() {},
      removeChild() {},
      addEventListener() {},
      removeEventListener() {},
      contains() {
        return false;
      },
      querySelector() {
        return null;
      },
    },
    visibilityState: "visible",
  };

  const windowObj: Record<string, unknown> = {
    HHSRS_REPORTER: {
      base: "/HHSRSreporter",
      mode: opts.mode || "filled",
      caseId: opts.caseId === undefined ? "case-kept" : opts.caseId,
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
      assign(url: string) {
        if (opts.assign) opts.assign(url);
      },
    },
    alert() {},
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
    FormData: FakeFormData,
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
            "hhsrs-to": "kept-to@example.com",
            "hhsrs-cc": "kept-cc@example.com",
            "hhsrs-bcc": "kept-bcc@example.com",
            "hhsrs-subject": "Kept subject",
            "hhsrs-body": "Kept draft body",
          },
          caseDetailsLocked: false,
        },
      }),
    });
    const { ids, listeners } = bootReview({ storage, fetchImpl: pendingFetch });
    assert.equal(ids["hhsrs-body"].value, "Kept draft body");
    assert.equal(ids["hhsrs-bcc"].value, "kept-bcc@example.com");
    assert.equal(ids["rv-notes"].value, "Typed site notes");
    assert.equal(storage.getItem("undefined"), null);
    assert.equal(storage.getItem("hhsrs-review-last-key-v1"), "case-kept");

    const pagehide = listeners.filter((listener) => listener.target === "window" && listener.type === "pagehide");
    assert.ok(pagehide.length > 0);
    pagehide.forEach((listener) => listener.fn());

    const saved = JSON.parse(storage.getItem("hhsrs-review-drafts-v1") || "{}");
    assert.equal(saved["case-kept"].email["hhsrs-body"], "Kept draft body");
    assert.equal(saved["case-kept"].email["hhsrs-bcc"], "kept-bcc@example.com");
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
    assert.equal(ids["hhsrs-to"].value, "to@example.com");
    assert.equal(ids["hhsrs-cc"].value, "cc@example.com");
    assert.equal(ids["hhsrs-bcc"].value, "archive@example.com");
    assert.equal(ids["hhsrs-body"].value, "Generated body");

    draft = { ...draft, to: "next@example.com", cc: "", bcc: "", subject: "Next", body: "Next body" };
    click.fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ids["hhsrs-to"].value, "next@example.com");
    assert.equal(ids["hhsrs-bcc"].value, "");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const scrolled = ids["rv-email-draft"].scrollCalls as Array<{ behavior: string; block: string }>;
    assert.equal(scrolled.length, 2);
    assert.equal(scrolled[0].behavior, "auto");
    assert.equal(scrolled[0].block, "start");
    assert.equal(scrolled[1].block, "start");
  });

  it("does not scroll to the email draft when Generate email fails", async () => {
    const storage = memoryStorage();
    const { ids, listeners } = bootReview({
      storage,
      fetchImpl: () =>
        Promise.resolve({
          ok: false,
          headers: { get: () => "application/json" },
          json: async () => ({ ok: false, error: "Could not prepare the client email." }),
        }),
    });
    const click = listeners.find((listener) => listener.target === "btn-generate-email" && listener.type === "click");
    assert.ok(click);
    click.fn();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(ids["rv-email-draft"].scrollCalls, []);
    assert.equal(ids["hhsrs-body"].value, "");
  });

  it("drops the held blank email after send so leaving the page cannot put it back", async () => {
    const storage = memoryStorage({
      "hhsrs-review-drafts-v1": JSON.stringify({
        blank: {
          project: "Gateway 2026",
          fields: { "rv-notes": "Same email" },
          email: {
            "hhsrs-to": "kept-to@example.com",
            "hhsrs-cc": "",
            "hhsrs-bcc": "",
            "hhsrs-subject": "Kept subject",
            "hhsrs-body": "Kept draft body",
          },
        },
      }),
    });
    let assigned = "";
    const { ids, listeners, windowObj } = bootReview({
      storage,
      caseId: "",
      mode: "blank",
      withSend: true,
      assign(url) {
        assigned = url;
      },
      fetchImpl: () =>
        Promise.resolve({
          json: async () => ({ ok: true, redirect: "/HHSRSreporter/review/sent-case" }),
        }),
    });
    assert.equal(ids["hhsrs-body"].value, "Kept draft body");
    (ids["ck-tick"] as { checked: boolean }).checked = true;
    const submit = listeners.find((listener) => listener.target === "rv-send-form" && listener.type === "submit");
    assert.ok(submit);
    submit.fn({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(assigned, "/HHSRSreporter/review/sent-case");
    listeners
      .filter((listener) => listener.target === "window" && listener.type === "pagehide")
      .forEach((listener) => listener.fn());
    const saved = JSON.parse(storage.getItem("hhsrs-review-drafts-v1") || "{}");
    assert.equal(saved.blank, undefined);
    assert.equal((windowObj.sessionStorage as { getItem: (key: string) => string | null }).getItem("hhsrs-review-sent-clear"), "1");
  });

  it("abandons a generated email draft so leaving cannot put it back", () => {
    const storage = memoryStorage({
      "hhsrs-review-drafts-v1": JSON.stringify({
        "case-kept": {
          project: "Gateway 2026",
          fields: { "rv-notes": "Typed site notes" },
          email: {
            "hhsrs-to": "kept-to@example.com",
            "hhsrs-cc": "",
            "hhsrs-bcc": "",
            "hhsrs-subject": "Generated subject",
            "hhsrs-body": "Generated draft body",
          },
          caseDetailsLocked: true,
        },
      }),
    });
    const { ids, listeners, windowObj } = bootReview({
      storage,
      withAbandon: true,
      fetchImpl: pendingFetch,
    });
    assert.equal(ids["hhsrs-body"].value, "Generated draft body");
    assert.equal(ids["hhsrs-to"].value, "kept-to@example.com");
    const click = listeners.find((listener) => listener.target === "btn-abandon-claim" && listener.type === "click");
    assert.ok(click);
    click.fn();
    listeners
      .filter((listener) => listener.target === "window" && listener.type === "pagehide")
      .forEach((listener) => listener.fn());
    const saved = JSON.parse(storage.getItem("hhsrs-review-drafts-v1") || "{}");
    assert.equal(saved["case-kept"], undefined);
    assert.equal(ids["hhsrs-body"].value, "");
    assert.equal(ids["hhsrs-to"].value, "");
    assert.equal(
      (windowObj.sessionStorage as { getItem: (key: string) => string | null }).getItem("hhsrs-review-abandoned"),
      "1"
    );
  });
});
