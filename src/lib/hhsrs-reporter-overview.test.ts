import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildProjectOverview, ARCHIVE_DISABLED_TITLE } from "./hhsrs-reporter-overview.js";
import { HHSRS_PROJECT_ROSTER, REPORTER_DEMO_PROJECTS } from "./hhsrs-reporter-projects.js";

const root = process.cwd();

describe("HHSRS project overview", () => {
  it("uses Colin demo counts and seeds archived projects when nothing is live", () => {
    const view = buildProjectOverview({
      hasLiveSubmissions: false,
      liveCounts: {},
      overrides: [],
    });
    const onward = view.active.find((row) => row.name === "Onward 2026");
    const saxon = view.active.find((row) => row.name === "Saxon Weald 2026 Phase 4");
    assert.ok(onward);
    assert.equal(onward.waiting, 2);
    assert.equal(onward.status, "In progress");
    assert.equal(onward.canArchive, false);
    assert.ok(saxon);
    assert.equal(saxon.waiting, 0);
    assert.equal(saxon.status, "Complete");
    assert.equal(saxon.canArchive, true);
    assert.equal(
      view.archived.some((row) => row.name === "Flagship 2026" && row.completed === 28),
      true
    );
    assert.equal(
      view.active.some((row) => row.name === "Flagship 2026"),
      false
    );
    assert.equal(view.totals.archived, 7);
    assert.ok(view.totals.waiting > 0);
  });

  it("prefers live submission counts and still lists unknown live projects", () => {
    const view = buildProjectOverview({
      hasLiveSubmissions: true,
      liveCounts: {
        "Onward 2026": { waiting: 1, completed: 4 },
        "Gateway 2026": { waiting: 0, completed: 2 },
        "Harbour Homes": { waiting: 3, completed: 1 },
      },
      overrides: [],
    });
    const onward = view.active.find((row) => row.name === "Onward 2026");
    const gateway = view.active.find((row) => row.name === "Gateway 2026");
    const harbour = view.active.find((row) => row.name === "Harbour Homes");
    assert.equal(onward?.waiting, 1);
    assert.equal(onward?.completed, 4);
    assert.equal(onward?.canArchive, false);
    assert.equal(gateway?.status, "Complete");
    assert.equal(gateway?.canArchive, true);
    assert.equal(harbour?.waiting, 3);
    assert.equal(harbour?.status, "In progress");
    assert.equal(harbour?.template, "—");
  });

  it("lets an archive override hide a complete project and a restore bring a seed back", () => {
    const archived = buildProjectOverview({
      hasLiveSubmissions: false,
      liveCounts: {},
      overrides: [{ name: "Gateway 2026", archived: true, completed: 6 }],
    });
    assert.equal(
      archived.active.some((row) => row.name === "Gateway 2026"),
      false
    );
    assert.equal(
      archived.archived.some((row) => row.name === "Gateway 2026" && row.completed === 6),
      true
    );

    const restored = buildProjectOverview({
      hasLiveSubmissions: false,
      liveCounts: {},
      overrides: [{ name: "Flagship 2026", archived: false, completed: 28 }],
    });
    const flagship = restored.active.find((row) => row.name === "Flagship 2026");
    assert.ok(flagship);
    assert.equal(flagship.status, "Complete");
    assert.equal(flagship.canArchive, true);
    assert.equal(
      restored.archived.some((row) => row.name === "Flagship 2026"),
      false
    );
  });

  it("keeps project-rule hints off the overview page and spells damp and mould on review", () => {
    const overview = readFileSync(path.join(root, "views/hhsrs-reporter/project-overview.ejs"), "utf8");
    const sidebar = readFileSync(path.join(root, "views/hhsrs-reporter/partials/sidebar.ejs"), "utf8");
    const mainLog = readFileSync(path.join(root, "views/hhsrs-reporter/main-log.ejs"), "utf8");
    const css = readFileSync(path.join(root, "public/css/hhsrs-reporter.css"), "utf8");

    assert.doesNotMatch(overview, /po-by-hint/);
    assert.doesNotMatch(overview, /you can archive it/i);
    assert.doesNotMatch(overview, /D&M/);
    assert.match(overview, /Total overview/);
    assert.match(overview, /By project/);
    assert.match(overview, /id="po-archive-confirm"/);
    assert.match(overview, /Archive when project is complete\./);
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
    assert.equal(ARCHIVE_DISABLED_TITLE, "Archive when project is complete.");
  });
});
