(function () {
  var dataEl = document.getElementById("programme-data");
  if (!dataEl) return;
  var DATA = JSON.parse(dataEl.textContent);

  var PROJECT_STYLE = {
    "MTVH": "c-MTVH",
    "Onward": "c-Onward",
    "LFHA 2026": "c-LFHA",
    "LFHA": "c-LFHA",
    "Vico 2026": "c-Vico",
    "Vico": "c-Vico",
    "Holiday": "c-Holiday",
    "Festive Period": "c-Festive",
    "OTHER WORK": "c-OTHER",
    "Cornwall 2026 Ph2": "c-Cornwall",
    "Cornwall": "c-Cornwall",
    "BPHA 2026 ACQ": "c-BPHA",
    "BPHA ACQ": "c-BPHA",
    "A2D Ph4": "c-A2D",
    "Awaiting Start": "c-Awaiting",
    "Southern Blocks": "c-Southern",
    "Flagship": "c-Flagship",
    "Radius Ph1": "c-Radius",
    "Saxon Weald Ph 4": "c-Saxon",
    "Bristol Ph2": "c-Bristol"
  };
  var EXTRA = ["c-MTVH", "c-Onward", "c-LFHA", "c-Vico", "c-Cornwall", "c-BPHA", "c-A2D", "c-Southern", "c-Flagship", "c-Radius", "c-Saxon", "c-Bristol"];

  function isHoliday(val) {
    if (!val) return false;
    return /holiday|festive|leave|annual leave|bank holiday/i.test(String(val));
  }

  function hashClass(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
    return EXTRA[h % EXTRA.length];
  }

  function classForName(name) {
    if (!name) return "c-note";
    if (PROJECT_STYLE[name]) return PROJECT_STYLE[name];
    if (isHoliday(name)) return "c-Holiday";
    var keys = Object.keys(PROJECT_STYLE);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (name.indexOf(k) === 0 || k.indexOf(name) === 0) return PROJECT_STYLE[k];
    }
    return hashClass(name);
  }

  function shortLabel(v) {
    if (v === "Festive Period") return "Festive";
    if (v === "Cornwall 2026 Ph2") return "Cornwall";
    if (v === "BPHA 2026 ACQ") return "BPHA ACQ";
    if (v === "LFHA 2026") return "LFHA";
    if (v === "Vico 2026") return "Vico";
    if (v === "OTHER WORK") return "Other";
    if (v === "Awaiting Start") return "Awaiting";
    if (v.length > 12) return v.slice(0, 11) + "…";
    return v;
  }

  function styleFor(val) {
    if (!val) return { cls: "empty", short: "" };
    return { cls: classForName(val), short: shortLabel(val) };
  }

  function fmtWeek(iso) {
    var d = new Date(iso + "T00:00:00");
    var dd = String(d.getDate()).padStart(2, "0");
    var mmm = d.toLocaleString("en-GB", { month: "short" });
    var yy = String(d.getFullYear()).slice(2);
    return { dd: dd, mmm: mmm, yy: yy, label: dd + " " + mmm + " " + yy };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isAgencyFlag(flag) {
    var f = String(flag || "").trim().toUpperCase();
    return f === "F" || f === "E";
  }

  var tickMap = Object.assign({}, DATA.ticks || {});
  var appliedMap = Object.assign({}, DATA.applied || {});
  var dirty = false;
  var saveTimer = null;

  function mapGet(map, name) {
    if (!name) return true;
    if (Object.prototype.hasOwnProperty.call(map, name)) return !!map[name];
    return true;
  }
  function isTicked(name) { return mapGet(tickMap, name); }
  function isApplied(name) { return mapGet(appliedMap, name); }
  function setTick(name, on, silent) {
    if (!name) return;
    tickMap[name] = !!on;
    if (!silent) dirty = true;
  }

  function readTicksFromDomIntoMap() {
    document.querySelectorAll("input.active-cb").forEach(function (cb) {
      if (cb.dataset.name) setTick(cb.dataset.name, cb.checked, true);
    });
  }

  function boardBody() {
    return {
      ticks: tickMap,
      applied: appliedMap,
      surveyors: (DATA.rows || []).map(function (r) {
        return { name: r.name, flag: r.flag || "", weeks: r.weeks || [] };
      }),
      admins: (DATA.admins || []).map(function (r) {
        return { name: r.name, flag: r.flag || "", weeks: r.weeks || [] };
      })
    };
  }

  function markSave(text) {
    var el = document.getElementById("saveState");
    if (el) el.textContent = text || "";
  }

  function saveBoard() {
    if (!DATA.saveUrl) return Promise.resolve(false);
    dirty = false;
    markSave("Saving…");
    return fetch(DATA.saveUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(boardBody())
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || body.ok !== true) throw new Error("save failed");
        markSave("Saved");
        return true;
      });
    }).catch(function () {
      dirty = true;
      markSave("Not saved");
      showToast("Could not save the board. Check you are still signed in.");
      return false;
    });
  }

  function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBoard, 400);
  }

  window.addEventListener("pagehide", function () {
    if (!dirty || !DATA.saveUrl || !navigator.sendBeacon) return;
    var blob = new Blob([JSON.stringify(boardBody())], { type: "application/json" });
    navigator.sendBeacon(DATA.saveUrl, blob);
  });

  var orderNote = document.getElementById("orderNote");
  if (orderNote) {
    orderNote.textContent =
      ((DATA.notes && DATA.notes.surveyorOrder) ? DATA.notes.surveyorOrder + " " : "") +
      "Active + Refresh controls who appears on the board. " +
      ((DATA.notes && DATA.notes.dndNote) ? DATA.notes.dndNote : "");
  }
  var projCap = document.getElementById("projCap");
  if (projCap) projCap.textContent = (DATA.notes && DATA.notes.projectsCaption) || "";

  function collectPaletteProjects() {
    var seen = new Set();
    var ordered = [];
    function add(name) {
      var n = String(name || "").trim();
      if (!n || seen.has(n)) return;
      seen.add(n);
      ordered.push(n);
    }
    var P = DATA.projects || {};
    (P.current || []).forEach(function (p) { add(p.project); });
    (P.upcoming || []).forEach(function (p) { add(p.project); });
    (P.completed || []).forEach(function (p) { add(p.project); });
    ["Holiday", "Festive Period", "OTHER WORK"].forEach(add);
    function scan(list) {
      (list || []).forEach(function (r) {
        (r.weeks || []).forEach(function (v) { if (v) add(v); });
      });
    }
    scan(DATA.rows);
    scan(DATA.admins);
    return ordered;
  }

  function buildPalette() {
    var palette = document.getElementById("palette");
    palette.innerHTML = "";
    var lab = document.createElement("span");
    lab.className = "palette-label";
    lab.textContent = "Projects:";
    palette.appendChild(lab);
    collectPaletteProjects().forEach(function (name) {
      var st = styleFor(name);
      var tile = document.createElement("span");
      tile.className = "palette-tile " + st.cls;
      if (isHoliday(name)) tile.classList.add("leave");
      tile.textContent = st.short || name;
      tile.title = name + " — drag onto a surveyor week to stamp";
      tile.draggable = true;
      tile.dataset.project = name;
      palette.appendChild(tile);
    });
    var hint = document.createElement("span");
    hint.className = "palette-hint";
    hint.textContent = "Drag a coloured tile onto the grid to assign that project. Drag cells to move existing blocks.";
    palette.appendChild(hint);
  }
  buildPalette();

  var seedPools = DATA.pools || {};
  var seedAgency = (seedPools.agency_not_on_project || []).slice();
  var seedTeam = (seedPools.team_not_live || []).slice();

  function fillPool(ulId, people) {
    var ul = document.getElementById(ulId);
    ul.innerHTML = "";
    if (!people || !people.length) {
      var empty = document.createElement("li");
      empty.className = "pool-empty";
      empty.textContent = "None listed";
      ul.appendChild(empty);
      return;
    }
    people.forEach(function (p) {
      var li = document.createElement("li");
      if (p.fromGrid) li.classList.add("from-grid");
      if (p.fromGrid) {
        var hit = document.createElement("label");
        hit.className = "active-hit pool-active-hit";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "active-cb pool-active-cb";
        cb.checked = isTicked(p.name);
        cb.dataset.name = p.name;
        cb.title = "Active — tick then hit Refresh to return to the board";
        cb.setAttribute("aria-label", "Active: " + p.name);
        cb.addEventListener("change", function () {
          setTick(p.name, cb.checked);
          scheduleSave();
        });
        hit.appendChild(cb);
        li.appendChild(hit);
      }
      var flag = document.createElement("span");
      flag.className = "flag" + (p.flag ? " on" : "");
      flag.textContent = p.flag || "·";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = p.name;
      li.appendChild(flag);
      li.appendChild(name);
      li.title = (p.flag ? p.flag + " · " : "") + p.name;
      ul.appendChild(li);
    });
  }

  function rebuildPools() {
    var agency = seedAgency.map(function (p) { return { flag: p.flag || "", name: p.name, fromGrid: false }; });
    var team = seedTeam.map(function (p) { return { flag: p.flag || "", name: p.name, fromGrid: false }; });
    var seenA = new Set(agency.map(function (p) { return p.name; }));
    var seenT = new Set(team.map(function (p) { return p.name; }));
    function pushInactive(person) {
      if (isApplied(person.name)) return;
      var entry = { flag: person.flag || "", name: person.name, fromGrid: true };
      if (isAgencyFlag(person.flag)) {
        if (!seenA.has(person.name)) { agency.push(entry); seenA.add(person.name); }
      } else if (!seenT.has(person.name)) {
        team.push(entry);
        seenT.add(person.name);
      }
    }
    (DATA.rows || []).forEach(pushInactive);
    (DATA.admins || []).forEach(pushInactive);
    fillPool("agencyPool", agency);
    fillPool("teamPool", team);
    return { agency: agency, team: team };
  }

  var thead = document.querySelector("#matrix thead");
  var tbody = document.querySelector("#matrix tbody");
  var hr = document.createElement("tr");
  hr.innerHTML = '<th class="activecol" title="Active on programme board">Active</th><th class="surveyor">Surveyor</th><th class="flagcol" title="F / E agency marker">F/E</th>';
  DATA.weeks.forEach(function (w) {
    var f = fmtWeek(w);
    var th = document.createElement("th");
    th.innerHTML = '<span class="d">' + f.dd + " " + f.mmm + '</span><span class="m">' + f.yy + "</span>";
    th.title = "Week commencing " + f.label;
    hr.appendChild(th);
  });
  thead.appendChild(hr);

  var rowStore = [];

  function paintCell(span, val, personName, wi) {
    var st = styleFor(val);
    span.className = "cell " + st.cls + (val ? "" : " empty");
    span.textContent = st.short;
    if (isHoliday(val)) span.classList.add("leave");
    span.dataset.value = val || "";
    span.dataset.wi = String(wi);
    var wk = fmtWeek(DATA.weeks[wi]).label;
    if (val) {
      span.title = (personName || "Admin") + " · wc " + wk + " · " + val + " (drag to move)";
      span.draggable = true;
    } else {
      span.title = (personName || "Admin") + " · wc " + wk + " (drop a project here)";
      span.draggable = false;
    }
  }

  function appendPersonRow(row, opts) {
    opts = opts || {};
    var storeIdx = rowStore.length;
    var weeks = (row.weeks || DATA.weeks.map(function () { return ""; })).slice();
    while (weeks.length < DATA.weeks.length) weeks.push("");
    var name = row.name || "Admin";
    rowStore.push({
      kind: opts.admin ? "admin" : "row",
      index: opts.admin ? (opts.adminIndex | 0) : (opts.rowIndex | 0),
      name: name,
      flag: row.flag || "",
      weeks: weeks
    });
    var tr = document.createElement("tr");
    if (opts.admin) tr.classList.add("admin-row");
    tr.dataset.store = String(storeIdx);
    var tdA = document.createElement("td");
    tdA.className = "activecol";
    var label = document.createElement("label");
    label.className = "active-hit";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "active-cb";
    cb.checked = isTicked(name);
    cb.dataset.name = name;
    cb.title = "Active — include on the programme board (hit Refresh to apply)";
    cb.setAttribute("aria-label", "Active: " + name);
    cb.addEventListener("change", function () {
      setTick(name, cb.checked);
      scheduleSave();
    });
    label.appendChild(cb);
    tdA.appendChild(label);
    tr.appendChild(tdA);
    var tdN = document.createElement("td");
    tdN.className = "surveyor";
    tdN.textContent = name;
    tr.appendChild(tdN);
    var tdF = document.createElement("td");
    tdF.className = "flagcol";
    tdF.textContent = row.flag || "";
    tr.appendChild(tdF);
    weeks.forEach(function (val, wi) {
      var td = document.createElement("td");
      td.className = "week-cell";
      var span = document.createElement("span");
      paintCell(span, val, name, wi);
      span.dataset.store = String(storeIdx);
      td.appendChild(span);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  function appendAdminHeader() {
    var ah = document.createElement("tr");
    ah.className = "admin-sep";
    ah.title = (DATA.notes && DATA.notes.adminNote) || "Admin rows below";
    var td = document.createElement("td");
    td.colSpan = 3 + DATA.weeks.length;
    td.setAttribute("aria-label", "Admin section");
    ah.appendChild(td);
    tbody.appendChild(ah);
  }

  function refreshMeta(poolState) {
    var activeSurveyors = (DATA.rows || []).filter(function (r) { return isApplied(r.name); }).length;
    var activeAdmins = (DATA.admins || []).filter(function (a) { return isApplied(a.name); }).length;
    var agencyN = poolState ? poolState.agency.length : 0;
    var teamN = poolState ? poolState.team.length : 0;
    document.getElementById("meta").textContent =
      activeSurveyors + " surveyors on board · " + DATA.weeks.length + " weeks · " +
      activeAdmins + " admin on board · pools: " + agencyN + " agency / " + teamN + " team";
  }

  function rebuildMatrix() {
    readTicksFromDomIntoMap();
    tbody.innerHTML = "";
    rowStore = [];
    (DATA.rows || []).forEach(function (row, i) {
      if (isApplied(row.name)) appendPersonRow(row, { rowIndex: i });
    });
    appendAdminHeader();
    (DATA.admins || []).forEach(function (a, i) {
      if (isApplied(a.name)) appendPersonRow(a, { admin: true, adminIndex: i });
    });
    refreshMeta(rebuildPools());
  }

  function applyTicksToBoard() {
    readTicksFromDomIntoMap();
    appliedMap = Object.assign({}, tickMap);
    (DATA.rows || []).forEach(function (r) { appliedMap[r.name] = isTicked(r.name); });
    (DATA.admins || []).forEach(function (a) { appliedMap[a.name] = isTicked(a.name); });
    dirty = true;
  }

  rebuildMatrix();

  function saveScope(projectId, text) {
    if (!DATA.scopeUrl || !projectId) return;
    fetch(DATA.scopeUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ projectId: projectId, surveyTypes: text })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || body.ok !== true) throw new Error("scope");
        showToast("Survey types saved");
      });
    }).catch(function () {
      showToast("Could not save survey types.");
    });
  }

  function fillProjTable(tbodyId, list) {
    var tb = document.querySelector("#" + tbodyId + " tbody");
    if (!tb) return;
    tb.innerHTML = "";
    if (!list || !list.length) {
      var tr = document.createElement("tr");
      tr.className = "empty-sec";
      tr.innerHTML = '<td colspan="4">None in Project Progress.</td>';
      tb.appendChild(tr);
      return;
    }
    list.forEach(function (p) {
      var tr = document.createElement("tr");
      var cls = classForName(p.project);
      tr.innerHTML =
        '<td><span class="pill ' + cls + '">' + esc(p.project) + "</span></td>" +
        '<td class="num">' + esc(String(p.numbers == null ? "" : p.numbers)) + "</td>" +
        '<td><span class="scope-edit" contenteditable="true" spellcheck="false" data-project-id="' + esc(p.id) + '" title="Starts from Project Progress survey types — click to edit">' + esc(p.surveyTypes || "") + "</span></td>" +
        '<td class="lead" title="Project manager from Project Progress">' + esc(p.lead || "") + "</td>";
      tb.appendChild(tr);
    });
    tb.querySelectorAll(".scope-edit").forEach(function (el) {
      el.addEventListener("blur", function () {
        saveScope(el.getAttribute("data-project-id"), el.textContent.trim());
      });
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); el.blur(); }
      });
    });
  }

  var P = DATA.projects || {};
  fillProjTable("projCurrent", P.current);
  fillProjTable("projUpcoming", P.upcoming);
  fillProjTable("projCompleted", P.completed);

  var drag = null;
  var toast = document.getElementById("dndToast");
  var toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.style.display = "none"; }, 2200);
  }

  function cellSpanFromEvent(e) {
    var t = e.target;
    if (!t) return null;
    if (t.classList && t.classList.contains("cell")) return t;
    if (t.closest) return t.closest(".cell");
    return null;
  }

  function setAssignment(storeIdx, wi, value) {
    var rec = rowStore[storeIdx];
    if (!rec) return;
    rec.weeks[wi] = value || "";
    if (rec.kind === "row" && DATA.rows[rec.index]) DATA.rows[rec.index].weeks[wi] = value || "";
    if (rec.kind === "admin" && DATA.admins[rec.index]) DATA.admins[rec.index].weeks[wi] = value || "";
    var span = tbody.querySelector('span.cell[data-store="' + storeIdx + '"][data-wi="' + wi + '"]');
    if (span) paintCell(span, value || "", rec.name, wi);
    scheduleSave();
  }

  function clearDropMarks() {
    tbody.querySelectorAll(".cell.drop-target, .cell.paint-preview, .cell.dragging").forEach(function (el) {
      el.classList.remove("drop-target", "paint-preview", "dragging");
    });
  }

  var paletteEl = document.getElementById("palette");
  paletteEl.addEventListener("dragstart", function (e) {
    var tile = e.target && e.target.closest ? e.target.closest(".palette-tile") : null;
    if (!tile || !tile.dataset.project) { e.preventDefault(); return; }
    drag = { fromPalette: true, value: tile.dataset.project, store: -1, wi: -1 };
    tile.classList.add("dragging");
    e.dataTransfer.setData("text/plain", tile.dataset.project);
    e.dataTransfer.effectAllowed = "copy";
    showToast("Stamping “" + tile.dataset.project + "”. Drop on a week. Shift+drop paints a run.");
  });
  paletteEl.addEventListener("dragend", function () {
    paletteEl.querySelectorAll(".palette-tile.dragging").forEach(function (el) { el.classList.remove("dragging"); });
    clearDropMarks();
    drag = null;
  });

  tbody.addEventListener("dragstart", function (e) {
    var span = cellSpanFromEvent(e);
    if (!span || !span.draggable || !span.dataset.value) { e.preventDefault(); return; }
    drag = { fromPalette: false, store: +span.dataset.store, wi: +span.dataset.wi, value: span.dataset.value };
    span.classList.add("dragging");
    e.dataTransfer.setData("text/plain", span.dataset.value);
    e.dataTransfer.effectAllowed = "copyMove";
    showToast("Moving “" + span.dataset.value + "”. Hold Shift to paint a run.");
  });
  tbody.addEventListener("dragend", function () {
    clearDropMarks();
    drag = null;
  });
  tbody.addEventListener("dragover", function (e) {
    var span = cellSpanFromEvent(e);
    if (!span || drag == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = (drag.fromPalette || e.shiftKey) ? "copy" : "move";
    clearDropMarks();
    if (!drag.fromPalette) {
      var src = tbody.querySelector('span.cell[data-store="' + drag.store + '"][data-wi="' + drag.wi + '"]');
      if (src) src.classList.add("dragging");
    }
    span.classList.add("drop-target");
    if (e.shiftKey) {
      var store = +span.dataset.store;
      var wi = +span.dataset.wi;
      for (var i = wi; i < Math.min(wi + 3, DATA.weeks.length); i++) {
        var s = tbody.querySelector('span.cell[data-store="' + store + '"][data-wi="' + i + '"]');
        if (s) s.classList.add("paint-preview");
      }
    }
  });
  tbody.addEventListener("drop", function (e) {
    var span = cellSpanFromEvent(e);
    if (!span || drag == null) return;
    e.preventDefault();
    var destStore = +span.dataset.store;
    var destWi = +span.dataset.wi;
    var value = drag.value;
    var fromPalette = !!drag.fromPalette;
    var same = !fromPalette && destStore === drag.store && destWi === drag.wi;
    var weeks = 1;
    if (e.shiftKey) {
      var ans = window.prompt("Paint how many weeks with “" + value + "” from this cell?", "3");
      if (ans == null) { clearDropMarks(); drag = null; return; }
      weeks = Math.max(1, Math.min(40, parseInt(ans, 10) || 1));
    }
    if (fromPalette || !same) {
      if (!fromPalette && !e.shiftKey) setAssignment(drag.store, drag.wi, "");
      for (var i = 0; i < weeks; i++) {
        var wi = destWi + i;
        if (wi >= DATA.weeks.length) break;
        setAssignment(destStore, wi, value);
      }
      var who = rowStore[destStore] ? rowStore[destStore].name : "";
      showToast((fromPalette ? "Stamped " : (e.shiftKey ? "Painted " : "Moved ")) + "“" + value + "” → " + who);
    }
    clearDropMarks();
    drag = null;
  });

  var brush = null;
  tbody.addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !e.altKey) return;
    var span = cellSpanFromEvent(e);
    if (!span || !span.dataset.value) return;
    e.preventDefault();
    brush = { value: span.dataset.value };
    span.classList.add("paint-preview");
    showToast("Painting “" + brush.value + "”. Release to finish.");
  });
  tbody.addEventListener("mouseover", function (e) {
    if (!brush) return;
    var span = cellSpanFromEvent(e);
    if (!span) return;
    setAssignment(+span.dataset.store, +span.dataset.wi, brush.value);
    span.classList.add("paint-preview");
  });
  window.addEventListener("mouseup", function () {
    if (!brush) return;
    brush = null;
    clearDropMarks();
  });
  tbody.addEventListener("dblclick", function (e) {
    var span = cellSpanFromEvent(e);
    if (!span) return;
    var store = +span.dataset.store;
    var wi = +span.dataset.wi;
    var cur = span.dataset.value || "";
    var ans = window.prompt("Set the project for this week (blank to clear). Type Holiday for leave.", cur);
    if (ans == null) return;
    setAssignment(store, wi, ans.trim());
  });

  document.getElementById("btnPdf").addEventListener("click", function () {
    showToast("Opening print — choose Save as PDF.");
    setTimeout(function () { window.print(); }, 200);
  });
  document.getElementById("btnRefresh").addEventListener("click", function () {
    applyTicksToBoard();
    rebuildMatrix();
    saveBoard().then(function (ok) {
      if (ok) showToast("Board refreshed. Active people stay on the grid; unticked people move to the pools.");
    });
  });
})();
