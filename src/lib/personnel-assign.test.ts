import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignmentSlots, assignableProjects, packProjectSlots, SURVEYOR_PROJECT_SLOTS } from "./personnel-assign.js";

function project(partial: { id: string; name: string; stage: string; createdAt: string }) {
  return { ...partial, createdAt: new Date(partial.createdAt) };
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, name);
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") {
      depth += 1;
      seen = true;
    } else if (source[i] === "}") {
      depth -= 1;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

describe("surveyor project dropdowns", () => {
  const catalogue = [
    project({ id: "old", name: "Flagship 2024", stage: "archive", createdAt: "2024-01-01T00:00:00Z" }),
    project({ id: "next", name: "Onward 2027", stage: "upcoming", createdAt: "2026-08-01T00:00:00Z" }),
    project({ id: "live", name: "LFHA 2026", stage: "current", createdAt: "2026-02-01T00:00:00Z" }),
    project({ id: "soon", name: "MTVH 2027", stage: "upcoming", createdAt: "2026-06-01T00:00:00Z" }),
    project({ id: "now", name: "Cornwall 2026 Ph2", stage: "current", createdAt: "2026-04-01T00:00:00Z" }),
  ];

  it("lists Current then Upcoming under the same names, and leaves archived projects out", () => {
    const listed = assignableProjects(catalogue);
    assert.deepEqual(
      listed.map((row) => row.name),
      ["LFHA 2026", "Cornwall 2026 Ph2", "MTVH 2027", "Onward 2027"]
    );
    assert.equal(listed.some((row) => row.stage === "archive" || row.name === "Flagship 2024"), false);
  });

  it("gives each surveyor five slots and packs assigned projects to the left", () => {
    assert.equal(SURVEYOR_PROJECT_SLOTS, 5);
    const slots = assignmentSlots(
      ["old", "next", "now", "extra-archived"],
      assignableProjects(catalogue).map((row) => row.id)
    );
    assert.deepEqual(slots, ["now", "next", "", "", ""]);
    assert.deepEqual(assignmentSlots([], ["live"]), ["", "", "", "", ""]);
  });

  it("packs gaps left and keeps the order of filled boxes", () => {
    assert.deepEqual(packProjectSlots(["", "b", "", "a", ""]), ["b", "a", "", "", ""]);
    assert.deepEqual(packProjectSlots(["c", "", "", "a", "b"]), ["c", "a", "b", "", ""]);
    assert.deepEqual(packProjectSlots(["", "", "", "", ""]), ["", "", "", "", ""]);
    assert.deepEqual(packProjectSlots(["a", "b", "c", "d", "e"]), ["a", "b", "c", "d", "e"]);
  });

  it("uses the same pack on the Personnel page Refresh button", () => {
    const appJs = readFileSync("public/js/app.js", "utf8");
    const pack = vm.runInNewContext(`${extractFunction(appJs, "packProjectSlots")}\npackProjectSlots`) as (
      values: string[]
    ) => string[];
    const samples = [
      ["", "b", "", "a", ""],
      ["c", "", "", "a", "b"],
      ["", "", "", "", ""],
      ["a", "b", "c", "d", "e"],
    ];
    for (const sample of samples) {
      assert.equal(JSON.stringify(pack(sample)), JSON.stringify(packProjectSlots(sample)));
    }
    assert.match(appJs, /surveyor-assign-refresh/);
    assert.match(appJs, /select\[data-access\]/);
    assert.match(appJs, /granted: false/);
    assert.match(appJs, /granted: true/);
    const save = extractFunction(appJs, "saveSurveyorProjectChange");
    assert.match(save, /\/access/);
  });

  it("renders five dropdowns for surveyors and leaves client ticks alone", () => {
    const page = readFileSync("views/personnel.ejs", "utf8");
    const surveyors = page.slice(page.indexOf("A. Surveyors"), page.indexOf("B. Clients"));
    const clients = page.slice(page.indexOf("B. Clients"), page.indexOf("C. Admins"));
    assert.match(surveyors, /personnel-surveyors/);
    assert.match(surveyors, /id="surveyor-assign-refresh"/);
    assert.match(surveyors, /slot < 5/);
    assert.match(surveyors, /assignProjects/);
    assert.match(surveyors, /<%= p\.name %>/);
    assert.match(surveyors, /data-access="<%= s\.id %>"/);
    assert.doesNotMatch(surveyors, /type="checkbox"[^>]*data-access/);
    assert.doesNotMatch(surveyors, /col-tick/);
    assert.match(clients, /type="checkbox" data-access="<%= c\.id %>"/);
    assert.match(clients, /col-tick/);
    const route = readFileSync("src/routes/personnel.ts", "utf8");
    assert.match(route, /assignableProjects/);
    assert.match(route, /assignmentSlots/);
    assert.match(route, /stage: \{ in: \["current", "upcoming"\] \}/);
  });
});
