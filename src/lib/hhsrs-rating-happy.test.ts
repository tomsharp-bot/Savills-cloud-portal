import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const script = readFileSync("public/js/hhsrs-reporter.js", "utf8");

type Listener = { type: string; fn: (ev?: { preventDefault?: () => void }) => void; target: string };

function memoryStorage() {
  const data = new Map<string, string>();
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
  };
}

type FakeEl = Record<string, unknown> & {
  id: string;
  classList: { add: (...n: string[]) => void; remove: (...n: string[]) => void; toggle: (n: string, force?: boolean) => boolean; contains: (n: string) => boolean };
  getAttribute: (name: string) => string | null;
};

function bootReview() {
  const listeners: Listener[] = [];
  const nodes: FakeEl[] = [];
  const ids: Record<string, FakeEl> = {};

  function makeEl(tag: string, id: string, props: Record<string, unknown> = {}): FakeEl {
    const classes = new Set<string>();
    const el = {
      id,
      tagName: tag.toUpperCase(),
      type: tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text",
      value: "",
      checked: false,
      readOnly: false,
      hidden: false,
      disabled: false,
      required: false,
      textContent: "",
      className: "",
      dataset: {} as Record<string, string>,
      style: {},
      options: [] as Array<{ value: string; textContent: string }>,
      parentElement: null,
      classList: {
        add(...names: string[]) {
          names.forEach((name) => name && classes.add(name));
        },
        remove(...names: string[]) {
          names.forEach((name) => classes.delete(name));
        },
        toggle(name: string, force?: boolean) {
          const on = force === undefined ? !classes.has(name) : !!force;
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
        contains(name: string) {
          return classes.has(name);
        },
      },
      addEventListener(type: string, fn: Listener["fn"]) {
        listeners.push({ type, fn, target: id });
      },
      removeEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      getAttribute(name: string) {
        if (name === "class") return el.className || null;
        return null;
      },
      appendChild(child: { value?: string; textContent?: string }) {
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
      focus() {},
    } as FakeEl;
    Object.assign(el, props);
    String(el.className || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((name) => classes.add(name));
    if (id) ids[id] = el;
    nodes.push(el);
    return el;
  }

  function queryAll(selector: string): FakeEl[] {
    if (selector === ".office-needed") return nodes.filter((node) => node.classList.contains("office-needed"));
    if (selector.includes("[required]")) return nodes.filter((node) => node.required);
    const star = /^\[data-office-star="([^"]+)"\]$/.exec(selector);
    if (star) return nodes.filter((node) => node.getAttribute("data-office-star") === star[1]);
    if (selector === ".email-draft-panel") return nodes.filter((node) => node.classList.contains("email-draft-panel"));
    return [];
  }

  makeEl("div", "review-workspace");
  makeEl("select", "rv-project", { value: "Gateway 2026" });
  makeEl("select", "rv-rating", { value: "Low", required: true });
  makeEl("input", "rv-rating-happy", { type: "checkbox", checked: false });
  makeEl("textarea", "rv-notes", { value: "Loose socket." });
  makeEl("input", "rv-hazard", { value: "Electrical Hazards" });
  makeEl("input", "rv-address", { value: "1 High Street" });
  makeEl("input", "rv-uprn", { value: "100" });
  makeEl("input", "hhsrs-to", { value: "office@example.com" });
  makeEl("input", "hhsrs-cc");
  makeEl("input", "hhsrs-bcc");
  makeEl("input", "hhsrs-subject", { value: "Subject" });
  makeEl("textarea", "hhsrs-body", { value: "Body" });
  makeEl("span", "rv-email-badge", { textContent: "Generated" });
  makeEl("section", "rv-email-draft", { className: "email-draft-panel is-pre-generate" });
  makeEl("p", "rv-send-line");
  makeEl("button", "btn-send-email");
  makeEl("div", "ck-overlay", { hidden: true });
  makeEl("div", "ck-body");
  makeEl("input", "ck-tick", { type: "checkbox" });
  makeEl("label", "ck-tick-label");
  makeEl("button", "ck-send");
  makeEl("button", "ck-back");
  makeEl("form", "rv-send-form");
  makeEl("input", "rv-restrictor-count");
  makeEl("input", "rv-restrictor-locations");
  makeEl("input", "rv-restrictor-material");
  makeEl("input", "rv-call-ref");
  const star = (id: string, key: string) => {
    const node = makeEl("span", id, { hidden: true });
    node.getAttribute = (name: string) => (name === "data-office-star" ? key : null);
    return node;
  };
  star("star-count", "restrictorMissingCount");
  star("star-locations", "restrictorLocations");
  star("star-material", "restrictorMaterial");
  star("star-call", "clientCallReference");

  const document = {
    getElementById(id: string) {
      return ids[id] || null;
    },
    querySelector(selector: string) {
      return queryAll(selector)[0] || null;
    },
    querySelectorAll(selector: string) {
      return queryAll(selector);
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
      style: {},
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
      mode: "filled",
      caseId: "case-1",
      initialProject: "Gateway 2026",
      casePhotos: [],
      waitingIds: [],
      alertsPollMs: 60000,
      send: { configured: true, sent: false, maxBytes: 20 * 1024 * 1024 },
      surveyorCheck: {
        rating: "Low",
        clientCallReference: "",
        callOutcome: "",
        callNotes: "",
        restrictorMissingCount: "",
        restrictorLocations: "",
        restrictorMaterial: "",
      },
      demoProjects: [
        {
          name: "Gateway 2026",
          template: "Standard",
          ratingScheme: "NEW",
          extras: {},
          to: ["office@example.com"],
          cc: [],
          bcc: [],
          hint: "Gateway",
        },
      ],
    },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    location: { search: "", pathname: "/HHSRSreporter/review/case-1", href: "http://127.0.0.1/HHSRSreporter/review/case-1" },
    alert() {},
    history: { replaceState() {} },
    document,
    addEventListener() {},
    removeEventListener() {},
    scrollBy() {},
    requestAnimationFrame(fn: () => void) {
      fn();
    },
    fetch: () => Promise.resolve({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ pending: [] }) }),
    setInterval() {
      return 0;
    },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    URL,
    console,
    getComputedStyle() {
      return { position: "static" };
    },
  };
  windowObj.window = windowObj;

  vm.runInNewContext(
    script,
    {
      window: windowObj,
      document,
      localStorage: windowObj.localStorage,
      sessionStorage: windowObj.sessionStorage,
      fetch: windowObj.fetch,
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
    },
    { filename: "hhsrs-reporter.js" }
  );

  function fire(id: string, type: string, ev?: { preventDefault?: () => void }) {
    listeners.filter((listener) => listener.target === id && listener.type === type).forEach((listener) => listener.fn(ev));
  }

  return { ids, fire };
}

describe("Review and Create rating confirmation", () => {
  it("puts I'm happy with the rating directly under the rating box and nowhere else", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const ratingAt = review.indexOf('id="rv-rating"');
    const selectEnd = review.indexOf("</select>", ratingAt);
    const happyAt = review.indexOf('id="rv-rating-happy"');
    const notesAt = review.indexOf('id="rv-notes"');
    assert.ok(ratingAt >= 0 && selectEnd > ratingAt && happyAt > selectEnd && notesAt > happyAt);
    const underRating = review.slice(selectEnd, notesAt);
    assert.match(underRating, /I'm happy with the rating/);
    assert.equal(review.split("I'm happy with the rating").length - 1, 1);
    assert.doesNotMatch(readFileSync("views/hhsrs-reporter/find.ejs", "utf8"), /I'm happy with the rating|rv-rating-happy/);
    assert.doesNotMatch(readFileSync("views/hhsrs-site-form/form.ejs", "utf8"), /I'm happy with the rating|rv-rating-happy/);
    assert.doesNotMatch(readFileSync("views/hhsrs-site-form/review.ejs", "utf8"), /I'm happy with the rating|rv-rating-happy/);
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    assert.match(css, /#review-workspace \.office-needed,\s*\n\.hhsrs-reporter #ck-overlay \.office-needed\s*\{[^}]*outline:\s*2px solid var\(--savills-red\)/);
    assert.doesNotMatch(readFileSync("public/hhsrs-site-form/form.css", "utf8"), /office-needed/);
    const sendFn = script.slice(script.indexOf("function syncSendButton"), script.indexOf("function attachmentBytes"));
    assert.ok(sendFn.indexOf("if (cfg.findResend)") < sendFn.indexOf("!ratingConfirmed()"));
  });

  it("blocks every send until the rating tick is ticked, and outlines required controls until they are done", () => {
    const { ids, fire } = bootReview();
    const send = ids["btn-send-email"];
    const dialogSend = ids["ck-send"];
    const happy = ids["rv-rating-happy"];
    const rating = ids["rv-rating"];
    const count = ids["rv-restrictor-count"];
    const notes = ids["rv-notes"];

    assert.equal(send.disabled, true);
    assert.equal(ids["rv-send-line"].textContent, "Tick I'm happy with the rating before sending.");
    assert.equal(happy.classList.contains("office-needed"), true);
    assert.equal(rating.classList.contains("office-needed"), false);
    assert.equal(notes.classList.contains("office-needed"), false);
    assert.equal(count.classList.contains("office-needed"), false);

    let prevented = false;
    (ids["ck-tick"] as { checked: boolean }).checked = true;
    fire("ck-tick", "change");
    fire("rv-send-form", "submit", {
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(dialogSend.disabled, true);

    happy.checked = true;
    fire("rv-rating-happy", "change");
    assert.equal(send.disabled, false);
    assert.equal(dialogSend.disabled, false);
    assert.equal(happy.classList.contains("office-needed"), false);
    assert.equal(ids["rv-send-line"].textContent, "Sends the email and adds it to the Main Log.");

    happy.checked = false;
    fire("rv-rating-happy", "change");
    assert.equal(send.disabled, true);
    assert.equal(dialogSend.disabled, true);
    assert.equal(happy.classList.contains("office-needed"), true);

    happy.checked = true;
    fire("rv-rating-happy", "change");
    rating.value = "";
    fire("rv-rating", "change");
    assert.equal(rating.classList.contains("office-needed"), true);
    rating.value = "Low";
    fire("rv-rating", "change");
    assert.equal(rating.classList.contains("office-needed"), false);

    rating.value = "High - Emergency risk";
    fire("rv-rating", "change");
    assert.equal(send.disabled, true);
    assert.equal(count.classList.contains("office-needed"), true);
    assert.equal(ids["rv-restrictor-locations"].classList.contains("office-needed"), true);
    assert.equal(ids["rv-restrictor-material"].classList.contains("office-needed"), true);
    assert.equal(notes.classList.contains("office-needed"), false);

    count.value = "2";
    fire("rv-restrictor-count", "input");
    assert.equal(count.classList.contains("office-needed"), false);
    ids["rv-restrictor-locations"].value = "Hall";
    fire("rv-restrictor-locations", "input");
    ids["rv-restrictor-material"].value = "PVC";
    fire("rv-restrictor-material", "input");
    assert.equal(ids["rv-restrictor-locations"].classList.contains("office-needed"), false);
    assert.equal(ids["rv-restrictor-material"].classList.contains("office-needed"), false);
    assert.equal(send.disabled, false);

    ids["ck-overlay"].hidden = false;
    (ids["ck-tick"] as { checked: boolean }).checked = false;
    fire("ck-tick", "change");
    assert.equal(ids["ck-tick"].classList.contains("office-needed"), true);
    assert.equal(dialogSend.disabled, true);
    (ids["ck-tick"] as { checked: boolean }).checked = true;
    fire("ck-tick", "change");
    assert.equal(ids["ck-tick"].classList.contains("office-needed"), false);
    assert.equal(dialogSend.disabled, false);
  });
});
