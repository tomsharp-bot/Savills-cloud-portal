import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildProjectOverview, PROJECT_PROGRESS_CHANGE_TOAST } from "./hhsrs-reporter-overview.js";
import { HHSRS_PROJECT_ROSTER, REPORTER_DEMO_PROJECTS, hhsrsKey, matchDemoProject, progressNameForCase } from "./hhsrs-reporter-projects.js";

const root = process.cwd();

describe("HHSRS project overview from Project Progress", () => {
  it("lists current projects as active and archived projects as completed", () => {
    const view = buildProjectOverview({
      projects: [
        { name: "Onward", stage: "current" },
        { name: "Test 3", stage: "upcoming" },
        { name: "Flagship", stage: "archive" },
      ],
      liveCounts: {
        "Onward 2026": { waiting: 2, completed: 4 },
        Flagship: { waiting: 0, completed: 1 },
        "Harbour Homes": { waiting: 3, completed: 1 },
      },
    });
    const onward = view.active.find((row) => row.name === "Onward");
    assert.ok(onward);
    assert.equal(onward.waiting, 2);
    assert.equal(onward.completed, 4);
    assert.equal(onward.status, "In progress");
    assert.equal(onward.template, "Onward");
    assert.equal(view.active.some((row) => row.name === "Test 3"), false);
    assert.equal(view.active.some((row) => row.name === "Harbour Homes"), false);
    assert.equal(view.archived.some((row) => row.name === "Flagship" && row.completed === 1), true);
    assert.equal(view.totals.activeProjects, 1);
    assert.equal(view.totals.archived, 1);
    assert.equal(view.totals.waiting, 2);
  });

  it("maps Colin names onto Project Progress names and keeps email rules", () => {
    assert.equal(hhsrsKey("Onward"), "Onward 2026");
    assert.equal(hhsrsKey("Vico 2026"), "Vico 2026 8k");
    assert.equal(hhsrsKey("Bristol Ph2"), "Bristol Council 2025");
    assert.equal(progressNameForCase("Onward 2026", ["Onward", "Vico 2026"]), "Onward");
    assert.equal(progressNameForCase("Somewhere else", ["Onward"]), "Somewhere else");
    assert.equal(matchDemoProject("Onward")?.template, "Onward");
    assert.equal(matchDemoProject("Vico 2026")?.extras.vulnerabilities, true);
    assert.equal(matchDemoProject("Bristol Ph2")?.name, "Bristol Council 2025");
    assert.equal(matchDemoProject("Onward Liverpool 2026")?.template, "Onward");
    assert.equal(PROJECT_PROGRESS_CHANGE_TOAST, "Change this on Project Progress.");
  });

  it("points archive changes at Project Progress and keeps the overview shell", () => {
    const overview = readFileSync(path.join(root, "views/hhsrs-reporter/project-overview.ejs"), "utf8");
    const sidebar = readFileSync(path.join(root, "views/hhsrs-reporter/partials/sidebar.ejs"), "utf8");
    const mainLog = readFileSync(path.join(root, "views/hhsrs-reporter/main-log.ejs"), "utf8");
    const css = readFileSync(path.join(root, "public/css/hhsrs-reporter.css"), "utf8");

    assert.doesNotMatch(overview, /po-by-hint/);
    assert.doesNotMatch(overview, /D&M/);
    assert.match(overview, /List comes from Project Progress/);
    assert.match(overview, /Total overview/);
    assert.match(overview, /By project/);
    assert.match(overview, /Completed on Project Progress/);
    assert.match(overview, /baseUrl\('\/projects'\)/);
    assert.doesNotMatch(overview, /data-archive-project/);
    assert.doesNotMatch(overview, /data-restore-project/);
    assert.doesNotMatch(overview, /id="po-archive-confirm"/);
    assert.match(overview, /<details class="panel po-archived-details"/);
    assert.doesNotMatch(overview, /<details[^>]*open/);
    assert.match(overview, />Complete</);

    assert.match(sidebar, /Dashboard/);
    assert.match(sidebar, /Project overview/);
    assert.match(sidebar, /project-overview/);
    assert.doesNotMatch(sidebar, /tab-ico"[^>]*>0[123]</);
    assert.match(sidebar, /<svg/);

    assert.match(mainLog, /panel-head review-head/);
    assert.doesNotMatch(mainLog, /dealt-head/);

    assert.match(css, /\.po-table\s*\{[\s\S]*?table-layout:\s*fixed/);
    assert.match(css, /#po-project-select\s*\{[\s\S]*?width:\s*18rem/);
    assert.match(css, /\.side-tabs \.tab-link\.active\s*\{[\s\S]*?background:\s*var\(--savills-yellow\)/);

    const saxon = REPORTER_DEMO_PROJECTS.find((project) => project.name === "Saxon Weald 2026 Phase 4");
    assert.match(saxon?.hint || "", /damp and mould/);
    assert.doesNotMatch(saxon?.hint || "", /D&M/);
    assert.equal(
      HHSRS_PROJECT_ROSTER.some((project) => /D&M/.test(project.hint)),
      false
    );
  });
});
