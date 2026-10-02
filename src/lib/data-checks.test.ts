import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import vm from "node:vm";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import "dotenv/config";
import {
  DATA_REVIEW_MARKERS,
  assembleDataChecksPage,
  readDataReviewPage,
} from "./data-checks-page.js";

const TOPBAR = `<header class="topbar"><div class="right"><a class="linkish data-checks-nav" href="/data-checks">Data Checks</a></div></header>`;

describe("Data Review practice page hosting", () => {
  it("keeps the v4 tool and adds the portal bar above it", () => {
    const source = readDataReviewPage();
    assert.ok(Buffer.byteLength(source) > 2_000_000);
    for (const marker of DATA_REVIEW_MARKERS) {
      assert.equal(source.includes(marker), true, marker);
    }

    const page = assembleDataChecksPage(source, TOPBAR);
    assert.match(page, /<title>Data Checks — Savills Cloud Portal<\/title>/);
    assert.match(page, /class="scp-host"/);
    assert.match(page, />Data Checks</);
    assert.match(page, /id="scp-app"/);
    for (const marker of DATA_REVIEW_MARKERS) {
      assert.equal(page.includes(marker), true, marker);
    }
    assert.ok(page.indexOf('class="scp-host"') < page.indexOf('id="scp-app"'));
    assert.ok(page.indexOf('id="cellRead"') > page.indexOf('id="scp-app"'));
    assert.ok(page.indexOf('id="cellRead"') < page.indexOf('<div id="lb">'));
    assert.ok(page.indexOf('<div id="lb">') < page.indexOf('<script id="xlsxlib">'));
    assert.match(page, /id="bSaveMaster"/);
    assert.match(page, /id="mdfDrop"/);
    assert.match(page, /id="baseDrop"/);
    assert.match(page, /Build from previous Master Data File/);
    assert.match(page, /Column order kept\. No columns added\./);
    assert.match(page, /function exactFillProp/);
    assert.match(page, /id="basePreview"/);
    assert.ok(page.indexOf('id="pCreate"') < page.indexOf('id="baseDrop"'));
    assert.ok(page.indexOf('id="baseDrop"') < page.indexOf("Import data from an existing MDF"));
    assert.match(page, /B\.exactColumns/);
    assert.match(page, /function pickListHtml/);
    assert.match(page, /pickListHtml\('mdf'/);
    assert.match(page, /pickListHtml\('base'/);
    assert.match(page, /wirePickList\('mdf'\)/);
    assert.match(page, /wirePickList\('base'\)/);
    assert.match(page, /Not already in this master/);
    assert.match(page, /Tick at least one column\./);
    assert.match(page, /function weaveMdfColumns/);
    assert.match(page, /not stacked at the end/);
    assert.match(page, /cols\.splice\(0, cols\.length, \.\.\.woven\.out\)/);
    assert.match(page, /Hide HHSRS Section/);
    assert.match(page, /Selected cell/);
    assert.match(page, /Load photo folder/);
    assert.match(page, /function starterFixedColumns/);
    assert.match(page, /function baseMasterColumns/);
    assert.match(page, /function appendMdfColumns/);
  });

  it("appends ticked extra columns after Comments and Hazards and does not duplicate the fixed start", () => {
    const source = readDataReviewPage();
    const headers = previousMasterHeaders(source, "Data Horizontal DW", [
      { header: "Loft Hatch" },
      { header: "UPRN" },
      { header: "Skip Me" },
      { header: "General Comments" },
      { header: "Boiler Age" },
      { header: "Address" },
    ], new Set([0, 4]));

    const uprnAt = headers.indexOf("UPRN");
    const checkedAt = headers.indexOf("Checked?");
    const dateAt = headers.indexOf("Date");
    const surveyorAt = headers.indexOf("Surveyor");
    const addressAt = headers.indexOf("Address");
    const ageAt = headers.indexOf("Property Age");
    const photoAt = headers.indexOf("Front Elevation Photo");
    const commentsAt = headers.indexOf("General Comments");
    const hazardsAt = headers.indexOf("HHSRS Checked");
    const loftAt = headers.indexOf("Loft Hatch");
    const boilerAt = headers.indexOf("Boiler Age");

    assert.equal(uprnAt, 0);
    assert.ok(uprnAt < checkedAt && checkedAt < surveyorAt && surveyorAt < dateAt && dateAt < addressAt);
    assert.ok(addressAt < ageAt && ageAt < photoAt);
    assert.ok(photoAt < commentsAt && commentsAt < hazardsAt);
    assert.ok(loftAt > hazardsAt && boilerAt > loftAt);
    assert.equal(headers.includes("Skip Me"), false);
    assert.equal(headers.filter((h) => h === "UPRN").length, 1);
    assert.equal(headers.filter((h) => h === "Address").length, 1);
    assert.equal(headers.filter((h) => h === "General Comments").length, 1);

    const garage = previousMasterHeaders(source, "Data Horizontal GAR", [
      { header: "Loft Hatch" },
      { header: "UPRN" },
    ], new Set([0]));
    assert.equal(garage.includes("General Comments"), false);
    assert.equal(garage.includes("Front Elevation Photo"), false);
    assert.equal(garage.indexOf("UPRN"), 0);
    assert.ok(garage.indexOf("Property Age") < garage.indexOf("Loft Hatch"));
    assert.equal(garage.filter((h) => h === "UPRN").length, 1);
  });

  it("doubles the header, alternates section colours, and freezes columns on the left", () => {
    const source = readDataReviewPage();
    assert.match(source, /--hh:200px/);
    assert.match(source, /const RH = 22, GUT = 56, HH = 200/);
    assert.match(source, /ht="150"/);
    assert.match(source, /id="bFixLeft"/);
    assert.match(source, /FFD6EAF8/);
    assert.match(source, /FFFFF4CC/);
    assert.match(source, /function backfillSections/);
    assert.match(source, /xSplit="/);

    const parts = [
      "function fmt(v){",
      "function mdfNorm(s){",
      "const SEC_KINDS = {q:1, qa:1, qr:1, qq:1, y:1, ia:1, ir:1, iq:1, p:1};",
      "function sectionFromHeader(header, comps){",
      "function headerGroup(header){",
      "function sectionOfCol(col, B){",
      "function headerStripes(cols, sectionOf){",
      "function excelCol(n){",
      "function freezePaneXml(y, x){",
    ].map((needle) => extractDecl(source, needle));
    const sandbox: {
      __api?: {
        sectionFromHeader: (header: string, comps: Record<string, { section?: string }>) => string;
        headerGroup: (header: string) => string;
        sectionOfCol: (col: { section?: string; key?: string; header?: string; name?: string }, B: { comps?: Record<string, { section?: string }> }) => string;
        headerStripes: (cols: { section?: string }[], sectionOf: (col: { section?: string }) => string) => string[];
        freezePaneXml: (y: number, x: number) => string;
      };
    } = {};
    vm.runInNewContext(
      parts.join("\n") +
        "\nglobalThis.__api = { sectionFromHeader: sectionFromHeader, headerGroup: headerGroup, sectionOfCol: sectionOfCol, headerStripes: headerStripes, freezePaneXml: freezePaneXml };\n",
      sandbox
    );
    const api = sandbox.__api!;
    const of = (col: { section?: string }) => col.section || "";
    const stripes = (cols: { section?: string }[]) => JSON.stringify(api.headerStripes(cols, of));

    assert.equal(stripes([{ section: "General" }, { section: "General" }, { section: "General" }]), JSON.stringify(["hb", "hyel", "hb"]));
    assert.equal(stripes([{ section: "Roofs" }, { section: "Roofs" }, { section: "Roofs" }]), JSON.stringify(["hb", "hyel", "hb"]));
    assert.equal(
      stripes([
        { section: "General" },
        { section: "" },
        { section: "General" },
        { section: "Roofs" },
        { section: "Roofs" },
      ]),
      JSON.stringify(["hb", "", "hyel", "hb", "hyel"])
    );

    const comps = {
      "Green Energy": { section: "Roofs" },
      "Main Roof": { section: "Roofs" },
      Green: { section: "Other" },
    };
    assert.equal(api.sectionFromHeader("Green Energy - PV Panels - Age", comps), "Roofs");
    assert.equal(api.sectionFromHeader("Property Type", comps), "");
    assert.equal(api.sectionFromHeader("Not a component", comps), "");

    assert.equal(api.headerGroup("Main Roof - Age"), "Main Roof");
    assert.equal(api.headerGroup("Green Energy - PV Panels - Age"), "Green Energy");
    assert.equal(api.headerGroup("Soffits-Fascias-Bargeboards - SFB - PVCu - Age"), "Soffits-Fascias-Bargeboards");
    assert.equal(api.headerGroup("UPRN"), "");
    assert.equal(api.headerGroup("General Comments"), "");
    assert.equal(api.headerGroup("HHSRS Issue 1 Category"), "");
    assert.equal(api.headerGroup("Front Elevation Photo"), "");

    const ofEmpty = (col: { section?: string; key?: string; header?: string }) => api.sectionOfCol(col, { comps: {} });
    assert.equal(
      JSON.stringify(api.headerStripes([
        { key: "c|main roof - age|1", header: "Main Roof - Age" },
        { key: "c|main roof - covering|2", header: "Main Roof - Covering" },
        { key: "c|green energy - pv panels - age|3", header: "Green Energy - PV Panels - Age" },
        { key: "u|uprn", header: "UPRN" },
        { key: "g|comments", header: "General Comments" },
      ], ofEmpty)),
      JSON.stringify(["hb", "hyel", "hb", "", ""])
    );
    assert.equal(api.sectionOfCol({ key: "q|Green Energy|age", header: "Green Energy - PV Panels - Age" }, { comps }), "Roofs");
    assert.equal(api.sectionOfCol({ key: "q|Main Roof|age", header: "Main Roof - Age" }, { comps }), "Roofs");
    assert.match(source, /#grid \.h\.hb:not\(\.f\)/);
    assert.match(source, /#grid \.h\.hyel:not\(\.f\) \.hn\{background:#FFF4CC\}/);
    assert.match(source, /stripeBg \? ';background:' \+ stripeBg : ''/);
    assert.match(source, /style="background:\$\{stripeBg\}"/);

    const pane = api.freezePaneXml(9, 4);
    assert.match(pane, /xSplit="4"/);
    assert.match(pane, /ySplit="9"/);
    assert.match(pane, /activePane="bottomRight"/);
    assert.match(pane, /topLeftCell="E10"/);
    const rowsOnly = api.freezePaneXml(9, 0);
    assert.match(rowsOnly, /ySplit="9"/);
    assert.doesNotMatch(rowsOnly, /xSplit=/);
  });

  it("writes the tall header, left-column freeze, and section colours into the workbook", () => {
    const source = readDataReviewPage();
    const xlsxStart = source.indexOf('<script id="xlsxlib">');
    const xlsxJs = source.slice(source.indexOf(">", xlsxStart) + 1, source.indexOf("</script>", xlsxStart));
    const drvAt = source.indexOf("function drvCore(scope){");
    const ready = "post({type:'ready'});";
    const readyAt = source.indexOf(ready, drvAt);
    const drv =
      source.slice(drvAt, readyAt) +
      "scope.__api = {styleZip:styleZip};\n  " +
      ready +
      "\n}";
    const sandbox: { TextDecoder: typeof TextDecoder; TextEncoder: typeof TextEncoder; __go?: () => { sheet: string; styles: string } } = {
      TextDecoder,
      TextEncoder,
    };
    vm.runInNewContext(
      xlsxJs +
        "\n" +
        drv +
        `
var scope = {postMessage:function(){}, onmessage:null};
drvCore(scope);
globalThis.__go = function(){
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet([["Note"],["std"],["Property Type","Detachment","Main Roof"],["House","Semi","Pitched"]]);
  XLSX.utils.book_append_sheet(wb, ws, "Dwelling");
  var buf = XLSX.write(wb, {type:"array", bookType:"xlsx"});
  var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  var out = scope.__api.styleZip(u8, {Dwelling:{A3:"hb", B3:"hyel", C3:"hhr"}}, ["Dwelling"], {Dwelling:{y:3, x:2}});
  var zip = XLSX.CFB.read(out, {type:"buffer"});
  function text(name){
    for (var i = 0; i < zip.FullPaths.length; i++) {
      var p = zip.FullPaths[i].replace(/^[^\\/]*\\//, "");
      if (p === name) return new TextDecoder().decode(zip.FileIndex[i].content);
    }
    return "";
  }
  return {sheet:text("xl/worksheets/sheet1.xml"), styles:text("xl/styles.xml")};
};
`,
      sandbox
    );
    const got = sandbox.__go!();
    assert.match(got.sheet, /xSplit="2"/);
    assert.match(got.sheet, /ySplit="3"/);
    assert.match(got.sheet, /activePane="bottomRight"/);
    assert.match(got.sheet, /topLeftCell="C4"/);
    assert.match(got.sheet, /<row[^>]*\br="3"[^>]*ht="150"/);
    assert.doesNotMatch(got.sheet, /<row[^>]*\br="4"[^>]*ht="150"/);
    assert.match(got.sheet, /<c r="A3"[^>]*\ss="/);
    assert.match(got.styles, /FFD6EAF8/);
    assert.match(got.styles, /FFFFF4CC/);
    assert.match(got.styles, /wrapText="1"/);
    const a3 = /<c r="A3"[^>]*\ss="(\d+)"/.exec(got.sheet);
    const a4 = /<c r="A4"[^>]*\ss="(\d+)"/.exec(got.sheet);
    assert.ok(a3);
    assert.notEqual(a3![1], a4 ? a4[1] : "");
  });
});

function sliceBalanced(source: string, openAt: number): string {
  const open = source[openAt];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let i = openAt;
  let state: "code" | "sq" | "dq" | "tpl" = "code";
  let expr = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (state === "sq" || state === "dq") {
      const q = state === "sq" ? "'" : '"';
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === q) state = "code";
      i++;
      continue;
    }
    if (state === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`" && expr === 0) {
        state = "code";
        i++;
        continue;
      }
      if (c === "$" && n === "{") {
        expr++;
        i += 2;
        continue;
      }
      if (c === "}" && expr > 0) {
        expr--;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (c === "'") {
      state = "sq";
      i++;
      continue;
    }
    if (c === '"') {
      state = "dq";
      i++;
      continue;
    }
    if (c === "`") {
      state = "tpl";
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return source.slice(openAt, i + 1);
    }
    i++;
  }
  throw new Error("Unbalanced " + open);
}

function extractDecl(source: string, needle: string): string {
  const at = source.indexOf(needle);
  if (at < 0) throw new Error("Missing " + needle);
  if (needle.endsWith(";")) return source.slice(at, at + needle.length);
  const brace = source.indexOf("{", at);
  const bracket = source.indexOf("[", at);
  const openAt = bracket >= 0 && (brace < 0 || bracket < brace) ? bracket : brace;
  let body = source.slice(at, openAt) + sliceBalanced(source, openAt);
  if (source[at + body.length] === ";") body += ";";
  return body;
}

function previousMasterHeaders(
  source: string,
  sheet: string,
  file: { header: string }[],
  picked: Set<number>
): string[] {
  const parts = [
    "function fmt(v){",
    "const USUAL = [",
    "const PRESET_MTVH_DW = [",
    "const PRESET_MTVH_BLK = [",
    "function presetGroups(list, sheet){",
    "function photoCode(B, uprn, comp, n){",
    "function photoColDefs(B, sheet){",
    "const HH_N = 7;",
    "function hk(n, f){",
    "function hhColDefs(){",
    "function mdfNorm(s){",
    "function sheetRole(name){",
    "function starterPhotoGroups(sheetName){",
    "function starterFixedColumns(sheetName){",
    "function baseMasterColumns(sheetName, fileCols, picked, hidden){",
  ].map((needle) => extractDecl(source, needle));
  const sandbox: { __go?: (sheet: string, fileCols: { c: number; header: string; norm: string }[], picked: number[]) => string[] } = {};
  vm.runInNewContext(
    parts.join("\n") +
      "\nglobalThis.__go = function(sheet, fileCols, picked){ return baseMasterColumns(sheet, fileCols, new Set(picked), []).cols.map(function(c){ return c.header; }); };\n",
    sandbox
  );
  const norm = (s: string) => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const fileCols = file.map((col, i) => ({ c: i, header: col.header, norm: norm(col.header) }));
  return sandbox.__go!(sheet, fileCols, [...picked]);
}

async function listen(app: Express): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

async function request(
  port: number,
  method: string,
  path: string,
  opts: { cookie?: string; form?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  const text = await res.text();
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body: text,
    setCookie,
    location: res.headers.get("location"),
    cache: res.headers.get("cache-control"),
    type: res.headers.get("content-type"),
  };
}

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

describe("Data Checks route", () => {
  it("shows the full page only to Tom Sharp’s admin login", async (t) => {
    if (!process.env.DATABASE_URL?.trim()) {
      t.skip("Postgres not available");
      return;
    }
    const { createApp } = await import("../app.js");
    const { prisma } = await import("./prisma.js");
    const { hashPassword } = await import("./passwords.js");
    try {
      await prisma.user.findFirst({ where: { username: "phil.m" } });
    } catch {
      t.skip("Postgres not available");
      return;
    }

    const createdIds: string[] = [];
    const app = createApp({ basePath: "/projectprogress" });
    const { server, port } = await listen(app);
    t.after(async () => {
      server.close();
      if (createdIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
      }
    });

    const password = "DataChecksTest-2468";
    const passwordHash = await hashPassword(password);

    async function tempAdmin(input: { username: string; name: string; email: string }) {
      const row = await prisma.user.create({
        data: { ...input, role: "admin", passwordHash },
      });
      createdIds.push(row.id);
      const login = await request(port, "POST", "/projectprogress/login", {
        form: { username: input.username, password },
      });
      assert.equal(login.status, 302, input.username);
      return cookieHeader(login.setCookie);
    }

    const adminLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    if (adminLogin.status !== 302) {
      t.skip("Seeded admin login is not available");
      return;
    }
    const phil = cookieHeader(adminLogin.setCookie);

    const philProjects = await request(port, "GET", "/projectprogress/projects", { cookie: phil });
    assert.equal(philProjects.status, 200);
    assert.match(philProjects.body, /Projects Progress/);
    assert.doesNotMatch(philProjects.body, /Data Checks/);
    assert.doesNotMatch(philProjects.body, /\/data-checks/);

    const philPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: phil });
    assert.equal(philPage.status, 403);
    assert.equal(philPage.body, "Only Tom Sharp can open Data Checks.");
    assert.doesNotMatch(philPage.body, /id="cellRead"/);
    assert.doesNotMatch(philPage.body, /Master Data File/);

    const carly = await tempAdmin({
      username: "cfarrell-data-checks-test",
      name: "Carly Farrell",
      email: "cfarrell-data-checks-test@example.com",
    });
    const carlyHome = await request(port, "GET", "/projectprogress/admin", { cookie: carly });
    assert.equal(carlyHome.status, 200);
    assert.doesNotMatch(carlyHome.body, /Data Checks/);
    const carlyPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: carly });
    assert.equal(carlyPage.status, 403);
    assert.equal(carlyPage.body, "Only Tom Sharp can open Data Checks.");

    const nameOnly = await tempAdmin({
      username: "tom-name-data-checks-test",
      name: "Tom Sharp",
      email: "tom-name-data-checks-test@example.com",
    });
    const nameOnlyHome = await request(port, "GET", "/projectprogress/personnel", { cookie: nameOnly });
    assert.equal(nameOnlyHome.status, 200);
    assert.doesNotMatch(nameOnlyHome.body, /Data Checks/);
    const nameOnlyPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: nameOnly });
    assert.equal(nameOnlyPage.status, 403);

    const surveyorLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "peter.m", password: "PeterMay2468" },
    });
    assert.equal(surveyorLogin.status, 302);
    const surveyor = cookieHeader(surveyorLogin.setCookie);
    const surveyorHome = await request(port, "GET", "/projectprogress/surveyor", { cookie: surveyor });
    assert.equal(surveyorHome.status, 200);
    assert.doesNotMatch(surveyorHome.body, /Data Checks/);
    const surveyorPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: surveyor });
    assert.equal(surveyorPage.status, 403);
    assert.doesNotMatch(surveyorPage.body, /File builder/);

    const existingTom = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: "tsharp", mode: "insensitive" } },
          { email: { equals: "tsharp@savillshousing.co.uk", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (existingTom) {
      t.diagnostic("Tom Sharp’s login already exists; skipping the live page assertion");
      return;
    }

    const tom = await tempAdmin({
      username: "tsharp",
      name: "Tom Sharp",
      email: "tsharp@savillshousing.co.uk",
    });
    const tomProjects = await request(port, "GET", "/projectprogress/projects", { cookie: tom });
    assert.equal(tomProjects.status, 200);
    assert.match(tomProjects.body, /Projects Progress/);
    assert.match(tomProjects.body, /Programme/);
    assert.match(tomProjects.body, /Personnel/);
    assert.match(tomProjects.body, /href="\/projectprogress\/data-checks"/);
    assert.match(tomProjects.body, />Data Checks</);
    const reportsAt = tomProjects.body.indexOf("HHSRS site reports");
    const checksAt = tomProjects.body.indexOf(">Data Checks<");
    const nameAt = tomProjects.body.indexOf("Tom Sharp");
    assert.ok(reportsAt >= 0 && reportsAt < checksAt && checksAt < nameAt);

    const page = await request(port, "GET", "/projectprogress/data-checks", { cookie: tom });
    assert.equal(page.status, 200);
    assert.match(page.type || "", /text\/html/);
    assert.match(page.cache || "", /no-store/);
    assert.ok(Buffer.byteLength(page.body) > 2_000_000);
    assert.equal(page.body.includes("<title>Data Checks — Savills Cloud Portal</title>"), true);
    assert.equal(page.body.includes('aria-current="page"'), true);
    assert.equal(page.body.includes('href="/projectprogress/projects"'), true);
    assert.equal(page.body.includes(">Projects Progress<"), true);
    assert.equal(page.body.includes('href="/projectprogress/projects-programme"'), true);
    assert.equal(page.body.includes(">Programme<"), true);
    for (const marker of DATA_REVIEW_MARKERS) {
      assert.equal(page.body.includes(marker), true, marker);
    }
  });
});
