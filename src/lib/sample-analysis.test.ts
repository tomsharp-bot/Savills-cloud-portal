import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  areaTargetFor,
  buildSampleAnalysis,
  comparePatchNames,
  formatSamplePercent,
  hasAnyVisit,
  type SampleAsset,
} from "./sample-analysis.js";

function asset(partial: Partial<SampleAsset> & Pick<SampleAsset, "kind">): SampleAsset {
  return {
    patch: "",
    omitAsset: false,
    assetStatus: "No Visit",
    surveyType: "",
    external: "",
    surveyor: "",
    visit1: "",
    visit2: "",
    visit3: "",
    ...partial,
  };
}

describe("Sample Analysis metrics", () => {
  it("rounds an 80% area target the way the spreadsheet does", () => {
    const target = { projectTargetValue: 80, projectTargetUnit: "percent" as const };
    assert.equal(areaTargetFor(428, target), 342);
    assert.equal(areaTargetFor(1135, target), 908);
    assert.equal(areaTargetFor(284, target), 227);
    assert.equal(formatSamplePercent(285, 31069), "0.9%");
    assert.equal(formatSamplePercent(285, 38837), "0.7%");
    assert.equal(formatSamplePercent(0, 10), "0%");
    assert.equal(formatSamplePercent(4, 0), "0%");
  });

  it("sorts patch names with patch 2 before patch 10", () => {
    assert.deepEqual(["Patch 10", "Patch 2", "Patch 1"].sort(comparePatchNames), [
      "Patch 1",
      "Patch 2",
      "Patch 10",
    ]);
  });

  it("builds one row per patch and leaves omitted and blank patches out of the counts", () => {
    const analysis = buildSampleAnalysis({
      projectTargetValue: 80,
      projectTargetUnit: "percent",
      assets: [
        asset({ kind: "dwelling", patch: "Patch 2", assetStatus: "Full Survey", surveyor: "PM" }),
        asset({ kind: "dwelling", patch: "Patch 2", assetStatus: "No Access", visit1: "01/02/2026" }),
        asset({ kind: "dwelling", patch: "Patch 2", assetStatus: "Ext-Only", external: "Yes" }),
        asset({ kind: "dwelling", patch: "Patch 2", assetStatus: "No Visit", external: "Yes" }),
        asset({ kind: "dwelling", patch: "Patch 2", assetStatus: "Full Survey", omitAsset: true }),
        asset({ kind: "dwelling", patch: "  ", assetStatus: "Full Survey" }),
        asset({ kind: "dwelling", patch: "", assetStatus: "No Visit" }),
        asset({ kind: "block", patch: "Patch 2", assetStatus: "Full Survey" }),
        asset({ kind: "block", patch: "Patch 2", assetStatus: "No Visit" }),
        asset({ kind: "block", patch: "Patch 2", assetStatus: "Full Survey", omitAsset: true }),
        asset({ kind: "garage", patch: "Patch 1", assetStatus: "Ext-Only" }),
        asset({ kind: "garage", patch: "Patch 1", assetStatus: "No Visit" }),
        asset({ kind: "dwelling", patch: " Patch 1 ", assetStatus: "No Visit" }),
      ],
      patchMeta: [{ patch: "Patch 2", areaName: "North", surveyorInitials: "pm" }],
    });

    assert.deepEqual(
      analysis.patches.map((row) => row.patch),
      ["Patch 1", "Patch 2"]
    );
    const north = analysis.patches[1];
    assert.equal(north.areaName, "North");
    assert.equal(north.surveyorInitials, "PM");
    assert.equal(north.dwellings.total, 4);
    assert.equal(north.dwellings.target, 3);
    assert.equal(north.dwellings.fullDone, 1);
    assert.equal(north.dwellings.toDo, 2);
    assert.equal(north.dwellings.pctDone, formatSamplePercent(1, 3));
    assert.equal(north.dwellings.visitedYes, 2);
    assert.equal(north.dwellings.visitedNo, 2);
    assert.equal(north.dwellings.extDone, 1);
    assert.equal(north.dwellings.extToDo, 1);
    assert.deepEqual(north.blocks, { total: 2, done: 1, toDo: 1 });

    const south = analysis.patches[0];
    assert.equal(south.dwellings.total, 1);
    assert.deepEqual(south.garages, { total: 2, done: 1, toDo: 1 });

    assert.equal(analysis.patchTotals?.dwellings.fullDone, 1);
    assert.equal(analysis.patchTotals?.dwellings.total, 5);
    assert.equal(analysis.overview.dwellings.total, 8);
    assert.equal(analysis.overview.dwellings.omitted, 1);
    assert.equal(analysis.overview.dwellings.viable, 7);
    assert.equal(analysis.overview.dwellings.completed, 1);
    assert.equal(analysis.overview.dwellings.pctProjectDone, formatSamplePercent(1, 5));
    assert.equal(analysis.overview.dwellings.accessRate, formatSamplePercent(1, 2));
    assert.equal(analysis.overview.dwellings.extDone, 1);
    assert.equal(analysis.overview.dwellings.extToDo, 1);
    assert.equal(analysis.overview.blocks.total, 3);
    assert.equal(analysis.overview.blocks.viable, 2);
    assert.equal(analysis.overview.blocks.completed, 1);
    assert.equal(analysis.overview.blocks.remaining, 1);
    assert.equal(analysis.overview.garages.total, 2);
    assert.equal(analysis.overview.garages.completed, 1);
    assert.equal(analysis.overview.garages.remaining, 1);
  });

  it("counts visit outcomes in the access-rate denominator and ignores external-only with no visit", () => {
    const outcomes = [
      "No Access",
      "Appt Made Not Kept",
      "Access Refused",
      "Void",
      "Full Survey",
    ];
    for (const assetStatus of outcomes) {
      assert.equal(hasAnyVisit(asset({ kind: "dwelling", assetStatus })), true, assetStatus);
    }
    assert.equal(hasAnyVisit(asset({ kind: "dwelling", assetStatus: "No Visit", visit1: "02/03/2026" })), true);
    assert.equal(hasAnyVisit(asset({ kind: "dwelling", assetStatus: "Ext-Only" })), false);
    assert.equal(
      hasAnyVisit(asset({ kind: "dwelling", assetStatus: "Ext-Only", visit2: "04/04/2026" })),
      true
    );

    const analysis = buildSampleAnalysis({
      projectTargetValue: 80,
      projectTargetUnit: "percent",
      assets: [
        asset({ kind: "dwelling", patch: "A", assetStatus: "Full Survey" }),
        asset({ kind: "dwelling", patch: "A", assetStatus: "Access Refused" }),
        asset({ kind: "dwelling", patch: "A", assetStatus: "No Visit" }),
        asset({ kind: "dwelling", patch: "A", assetStatus: "Ext-Only" }),
        asset({ kind: "dwelling", patch: "A", assetStatus: "Full Surveys" }),
      ],
    });
    assert.equal(analysis.overview.dwellings.completed, 2);
    assert.equal(analysis.overview.dwellings.accessRate, formatSamplePercent(2, 3));
    assert.equal(analysis.overview.dwellings.pctProjectDone, formatSamplePercent(2, 5));
    assert.equal(analysis.patches[0].dwellings.visitedYes, 3);
    assert.equal(analysis.patches[0].dwellings.visitedNo, 2);
    assert.equal(analysis.patches[0].dwellings.extDone, 1);
  });

  it("lets full surveys go past the target so To Do can be negative", () => {
    const analysis = buildSampleAnalysis({
      projectTargetValue: 50,
      projectTargetUnit: "percent",
      assets: [
        asset({ kind: "dwelling", patch: "A", assetStatus: "Full Survey", surveyor: "DS" }),
        asset({ kind: "dwelling", patch: "A", assetStatus: "Full Survey", surveyor: "DS" }),
      ],
    });
    assert.equal(analysis.patches[0].dwellings.target, 1);
    assert.equal(analysis.patches[0].dwellings.fullDone, 2);
    assert.equal(analysis.patches[0].dwellings.toDo, -1);
    assert.equal(analysis.overview.dwellings.remaining, -1);
  });

  it("shares a count target across patches", () => {
    const analysis = buildSampleAnalysis({
      projectTargetValue: 10,
      projectTargetUnit: "count",
      assets: [
        asset({ kind: "dwelling", patch: "A" }),
        asset({ kind: "dwelling", patch: "A" }),
        asset({ kind: "dwelling", patch: "B" }),
        asset({ kind: "dwelling", patch: "" }),
      ],
    });
    assert.equal(analysis.patches[0].dwellings.target, 7);
    assert.equal(analysis.patches[1].dwellings.target, 3);
    assert.equal(analysis.overview.dwellings.projectTarget, "10");
  });

  it("prefers surveyors allocated to the project, otherwise stock surveyors", () => {
    const assets = [
      asset({ kind: "dwelling", patch: "A", assetStatus: "Full Survey", surveyor: "PM" }),
      asset({ kind: "block", patch: "A", assetStatus: "Full Survey", surveyor: "AS" }),
      asset({ kind: "dwelling", patch: "A", assetStatus: "No Visit", surveyor: "ZZ" }),
    ];
    const known = [
      { id: "1", name: "Peter May", initials: "PM" },
      { id: "2", name: "Alex Surveyor", initials: "AS" },
      { id: "3", name: "Idle Person", initials: "IP" },
    ];
    const allocated = buildSampleAnalysis({
      projectTargetValue: 80,
      projectTargetUnit: "percent",
      assets,
      allocatedSurveyors: [known[2], known[0]],
      knownSurveyors: known,
    });
    assert.equal(allocated.usedProjectPersonnel, true);
    assert.deepEqual(
      allocated.surveyors.map((row) => row.initials),
      ["IP", "PM"]
    );
    const peter = allocated.surveyors.find((row) => row.initials === "PM");
    assert.equal(peter?.dwellingsDone, 1);
    assert.equal(peter?.active, true);
    assert.equal(allocated.surveyors.find((row) => row.initials === "IP")?.dwellingsDone, 0);
    assert.equal(allocated.surveyorTotals?.dwellingsDone, 1);

    const fromStock = buildSampleAnalysis({
      projectTargetValue: 80,
      projectTargetUnit: "percent",
      assets,
      knownSurveyors: known,
    });
    assert.equal(fromStock.usedProjectPersonnel, false);
    assert.deepEqual(
      fromStock.surveyors.map((row) => [row.name, row.initials]),
      [
        ["Alex Surveyor", "AS"],
        ["Peter May", "PM"],
        ["ZZ", "ZZ"],
      ]
    );
    assert.equal(fromStock.surveyors.find((row) => row.initials === "AS")?.blocksDone, 1);
    assert.equal(fromStock.surveyorTotals?.blocksDone, 1);
  });

  it("counts MTVH completion wording and leaves access attempts out of Full Survey", () => {
    const analysis = buildSampleAnalysis({
      projectTargetValue: 100,
      projectTargetUnit: "percent",
      assets: [
        asset({ kind: "dwelling", patch: "Patch 8", assetStatus: "Completed" }),
        asset({ kind: "dwelling", patch: "Patch 8", assetStatus: "Access Attempted" }),
        asset({ kind: "dwelling", patch: "Patch 8", assetStatus: "No Visit Recorded" }),
        asset({ kind: "dwelling", patch: "Patch 8", assetStatus: "Resident refused access" }),
        asset({ kind: "dwelling", patch: "Patch 8", assetStatus: "Ext-Only" }),
        asset({ kind: "dwelling", patch: "Patch 8", assetStatus: "No Visit" }),
        asset({ kind: "dwelling", patch: "", assetStatus: "Completed" }),
      ],
    });
    const patch = analysis.patches[0];
    assert.equal(patch.dwellings.fullDone, 1);
    assert.equal(patch.dwellings.extDone, 1);
    assert.equal(patch.dwellings.visitedYes, 3);
    assert.equal(analysis.overview.dwellings.completed, 1);
    assert.equal(analysis.overview.dwellings.extDone, 1);
    assert.equal(analysis.overview.dwellings.pctProjectDone, formatSamplePercent(1, 6));
    assert.equal(analysis.overview.dwellings.accessRate, formatSamplePercent(1, 3));
  });

  it("counts Surveyed By before Surveyor, and keeps an unmatched Surveyed By value", () => {
    const known = [
      { id: "1", name: "Peter May", initials: "PM" },
      { id: "2", name: "Alex Surveyor", initials: "AS" },
    ];
    const analysis = buildSampleAnalysis({
      projectTargetValue: 100,
      projectTargetUnit: "percent",
      allocatedSurveyors: known,
      knownSurveyors: known,
      assets: [
        asset({
          kind: "dwelling",
          patch: "Patch 8",
          assetStatus: "Full Survey Completed",
          surveyedBy: "pm",
          surveyor: "AS",
        }),
        asset({
          kind: "dwelling",
          patch: "Patch 8",
          assetStatus: "Ext Only",
          surveyedBy: "  ",
          surveyor: "AS",
        }),
        asset({
          kind: "dwelling",
          patch: "Patch 8",
          assetStatus: "Survey Complete",
          surveyedBy: "ZZ",
          surveyor: "PM",
        }),
        asset({
          kind: "dwelling",
          patch: "Patch 8",
          assetStatus: "No Visit",
          surveyor: "ZZ",
        }),
        asset({
          kind: "block",
          patch: "Patch 8",
          assetStatus: "completed",
          surveyedBy: "zz",
          surveyor: "PM",
        }),
      ],
    });
    const patch = analysis.patches[0];
    assert.equal(patch.patch, "Patch 8");
    assert.equal(patch.dwellings.fullDone, 2);
    assert.equal(patch.dwellings.extDone, 1);
    assert.equal(patch.blocks.done, 1);
    assert.equal(analysis.overview.dwellings.completed, 2);
    assert.equal(analysis.overview.dwellings.extDone, 1);
    assert.equal(analysis.overview.dwellings.pctProjectDone, formatSamplePercent(2, 4));
    assert.equal(analysis.overview.dwellings.accessRate, formatSamplePercent(2, 2));
    const peter = analysis.surveyors.find((row) => row.initials === "PM");
    const alex = analysis.surveyors.find((row) => row.initials === "AS");
    const zz = analysis.surveyors.find((row) => row.initials === "ZZ");
    assert.equal(peter?.dwellingsDone, 1);
    assert.equal(alex?.dwellingsDone, 0);
    assert.equal(alex?.extDone, 1);
    assert.equal(zz?.dwellingsDone, 1);
    assert.equal(zz?.blocksDone, 1);
    assert.equal(zz?.name, "ZZ");
    assert.deepEqual(
      analysis.surveyors.map((row) => row.initials),
      ["AS", "PM", "ZZ"]
    );
    const route = readFileSync(join(process.cwd(), "src/routes/projects.ts"), "utf8");
    assert.match(route, /surveyedBy:\s*true/);
  });
});

describe("Sample Analysis UI wiring", () => {
  const root = process.cwd();

  it("puts Sample Analysis between Summary and Dwellings and keeps the mock titles", () => {
    const view = readFileSync(join(root, "views/project.ejs"), "utf8");
    const summary = view.indexOf('["summary","Summary"');
    const sample = view.indexOf('["sample-analysis","Sample Analysis"');
    const dwellings = view.indexOf('["dwellings","Dwellings"');
    assert.ok(summary >= 0 && sample > summary && dwellings > sample);
    const partial = readFileSync(join(root, "views/partials/sample-analysis.ejs"), "utf8");
    assert.match(partial, /Surveyor Breakdown/);
    assert.match(partial, /Whole Project Overview/);
    assert.doesNotMatch(partial, /Whole-job/);
    assert.match(partial, /Sample Analysis/);
    assert.match(partial, /Asset Status/);
    assert.match(partial, /sa-status/);
    assert.match(partial, /Total Dwellings:/);
    assert.match(partial, /Condition Only completed:/);
    assert.match(partial, /Condition \+ EPC completed:/);
    assert.doesNotMatch(partial, /<div class="label">Total Dwellings<\/div>/);
    assert.doesNotMatch(partial, /<div class="value">/);
    const css = readFileSync(join(root, "public/css/app.css"), "utf8");
    assert.match(css, /\.sa-patch/);
    assert.match(css, /sub-visited/);
    assert.match(css, /sb-group-dwell/);
    assert.match(css, /\.sa-status/);
    assert.match(css, /\.job-item \.label,\s*\.job-item \.value\{font-size:\.8rem/);
    const js = readFileSync(join(root, "public/js/app.js"), "utf8");
    assert.match(js, /sample-analysis\/patch/);
    assert.match(js, /sample-analysis\/schedule/);
  });

  it("removes demo account lines from the login tile", () => {
    const login = readFileSync(join(root, "views/login.ejs"), "utf8");
    assert.doesNotMatch(login, /Demo accounts/);
    assert.doesNotMatch(login, /PhilMoon2468/);
    assert.doesNotMatch(login, /phil\.m/);
    assert.match(login, /name="password"/);
  });
});
