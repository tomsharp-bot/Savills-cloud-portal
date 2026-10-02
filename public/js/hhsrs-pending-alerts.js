/* Shared new-Pending alerts for every admin portal page and HHSRS Reporter.
   One localStorage marker records what this browser has already handled.
   One leader tab polls and raises the desktop notification. Other open tabs
   only show the small in-page notice. A minimised or background leader keeps
   its timer; Chrome may slow that to about once a minute. */
(function (factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.HhsrsPendingAlerts = api;
  api.start();
})(function () {
  var MARKER_KEY = "hhsrsPendingAlertMarker";
  var LEADER_KEY = "hhsrsPendingAlertLeader";
  var BROADCAST_KEY = "hhsrsPendingAlertBroadcast";
  var DESKTOP_ON_KEY = "hhsrsDesktopAlertsOn";
  var CHANNEL_NAME = "hhsrs-pending-alerts";
  var SEEN_CAP = 300;
  var VISIBLE_GAP_MS = 15000;
  /* Longer than Chrome's background timer clamp so a minimised leader is not replaced. */
  var LEADER_TTL_MS = 150000;
  var PAUSE_TEXT = "Alerts are paused. The login may have expired.";
  var tabId = String(Date.now()) + "-" + Math.random().toString(36).slice(2);

  var memoryMarker = null;
  var started = false;
  var paused = false;
  var pollInFlight = false;
  var lastPollAt = 0;
  var pollTimer = null;
  var alertAudio = null;
  var channel = null;
  var displayed = {};
  var activeCfg = null;
  var isLeader = false;
  var releaseLockWait = null;

  function usingWebLocks() {
    return typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function";
  }

  function rememberIds(existing, extra) {
    var next = existing.slice();
    var have = {};
    var i;
    for (i = 0; i < next.length; i++) have[next[i]] = true;
    for (i = 0; i < extra.length; i++) {
      var id = extra[i];
      if (!id || have[id]) continue;
      have[id] = true;
      next.push(id);
    }
    if (next.length > SEEN_CAP) next = next.slice(next.length - SEEN_CAP);
    return next;
  }

  function newestCreatedAt(rows) {
    var max = "";
    for (var i = 0; i < rows.length; i++) {
      var at = rows[i] && rows[i].createdAt ? String(rows[i].createdAt) : "";
      if (at > max) max = at;
    }
    return max;
  }

  function normaliseMarker(value) {
    if (!value || typeof value.lastSeenAt !== "string" || !Array.isArray(value.seenIds)) return null;
    var seenIds = [];
    for (var i = 0; i < value.seenIds.length; i++) {
      if (typeof value.seenIds[i] === "string" && value.seenIds[i]) seenIds.push(value.seenIds[i]);
    }
    return { lastSeenAt: value.lastSeenAt, seenIds: rememberIds([], seenIds) };
  }

  /* First run (no marker) records the current backlog and alerts nothing.
     Later, unclaimed rows newer than lastSeenAt alert once. Ids already in
     seenIds are skipped so a second tab does not raise the same alert. */
  function resolvePendingAlerts(marker, pending, nowIso) {
    var rows = [];
    var list = Array.isArray(pending) ? pending : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id) rows.push(list[i]);
    }
    var stored = normaliseMarker(marker);
    if (!stored) {
      return {
        alert: [],
        marker: {
          lastSeenAt: newestCreatedAt(rows) || nowIso || "",
          seenIds: rememberIds(
            [],
            rows.map(function (row) {
              return row.id;
            })
          ),
        },
      };
    }
    var seen = {};
    for (var s = 0; s < stored.seenIds.length; s++) seen[stored.seenIds[s]] = true;
    var alert = [];
    var touched = [];
    for (var n = 0; n < rows.length; n++) {
      var row = rows[n];
      if (seen[row.id]) {
        touched.push(row.id);
        continue;
      }
      var createdAt = row.createdAt ? String(row.createdAt) : "";
      var newer = !stored.lastSeenAt || createdAt > stored.lastSeenAt;
      if (!newer || row.claimStatus === "claimed" || row.claimStatus === "stale") {
        touched.push(row.id);
        continue;
      }
      alert.push(row);
      touched.push(row.id);
    }
    var lastSeenAt = stored.lastSeenAt;
    var newest = newestCreatedAt(rows);
    if (newest > lastSeenAt) lastSeenAt = newest;
    return {
      alert: alert,
      marker: {
        lastSeenAt: lastSeenAt,
        seenIds: rememberIds(stored.seenIds, touched),
      },
    };
  }

  /* True while a leader record is still inside the ttl window. */
  function leaderHoldsLock(record, now, ttl) {
    if (!record || typeof record.id !== "string" || !record.id) return false;
    if (typeof record.at !== "number" || typeof now !== "number") return false;
    var windowMs = typeof ttl === "number" ? ttl : LEADER_TTL_MS;
    return now - record.at < windowMs;
  }

  function readLeaderRecord() {
    try {
      var raw = localStorage.getItem(LEADER_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.id !== "string" || typeof parsed.at !== "number") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function ensureLeader() {
    var now = Date.now();
    var current = readLeaderRecord();
    if (leaderHoldsLock(current, now, LEADER_TTL_MS) && current.id !== tabId) return false;
    var next = { id: tabId, at: now };
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify(next));
      var confirmed = readLeaderRecord();
      return !!(confirmed && confirmed.id === tabId);
    } catch (e) {
      /* One window with storage blocked still polls. */
      return true;
    }
  }

  function releaseLeader() {
    if (releaseLockWait) {
      var done = releaseLockWait;
      releaseLockWait = null;
      isLeader = false;
      done();
      return;
    }
    var current = readLeaderRecord();
    if (current && current.id === tabId) {
      try {
        localStorage.removeItem(LEADER_KEY);
      } catch (e) {
        /* ignore */
      }
    }
    isLeader = false;
  }

  function requestLeaderLock() {
    if (!usingWebLocks()) {
      isLeader = true;
      return;
    }
    navigator.locks.request(CHANNEL_NAME, function () {
      isLeader = true;
      if (activeCfg && !paused) pollPending(activeCfg);
      return new Promise(function (resolve) {
        releaseLockWait = function () {
          isLeader = false;
          resolve();
        };
      });
    }).catch(function () {
      isLeader = true;
    });
  }

  function shouldPausePoll(info) {
    if (!info || info.redirected || !info.ok) return true;
    var ct = String(info.contentType || "");
    if (ct.indexOf("json") === -1) return true;
    if (info.pendingIsArray === false) return true;
    return false;
  }

  function homeNoticeRest(count) {
    if (!count || count <= 1) return "waiting in Pending";
    return "· " + count + " new cases waiting in Pending";
  }

  function homeNoticeText(count) {
    return "New HHSRS Hazard " + homeNoticeRest(count);
  }

  function readStorageMarker() {
    try {
      var raw = localStorage.getItem(MARKER_KEY);
      if (!raw) return null;
      return normaliseMarker(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function loadMarker() {
    var stored = readStorageMarker();
    if (stored) {
      memoryMarker = stored;
      return stored;
    }
    return memoryMarker;
  }

  function saveMarker(marker) {
    var clean = normaliseMarker(marker);
    if (!clean) return;
    memoryMarker = clean;
    try {
      localStorage.setItem(MARKER_KEY, JSON.stringify(clean));
    } catch (e) {
      /* in-memory marker still stops a same-tab repeat */
    }
  }

  function claimFresh(pending, nowIso) {
    var result = resolvePendingAlerts(loadMarker(), pending, nowIso);
    /* Record ids before the toast or notification so another open tab skips them. */
    saveMarker(result.marker);
    var latest = loadMarker();
    if (!latest || !result.alert.length) return result.alert;
    var owned = {};
    for (var i = 0; i < result.marker.seenIds.length; i++) owned[result.marker.seenIds[i]] = true;
    var raced = false;
    for (var j = 0; j < result.alert.length; j++) {
      if (!owned[result.alert[j].id] || latest.seenIds.indexOf(result.alert[j].id) === -1) raced = true;
    }
    if (!raced && latest.lastSeenAt === result.marker.lastSeenAt) return result.alert;
    var again = resolvePendingAlerts(latest, pending, nowIso);
    saveMarker(again.marker);
    return again.alert;
  }

  function readConfig() {
    var home = window.HHSRS_PENDING_ALERTS || {};
    var reporter = window.HHSRS_REPORTER || {};
    var surface = home.surface || "";
    if (!surface) surface = document.getElementById("hhsrs-home-alert") ? "home" : "reporter";
    return {
      base: home.base || reporter.base || "/HHSRSreporter",
      pollMs: Number(home.alertsPollMs || reporter.alertsPollMs) || 30000,
      surface: surface,
    };
  }

  function pendingUrl(cfg) {
    return cfg.base || "/HHSRSreporter";
  }

  function reviewUrl(cfg, id) {
    return pendingUrl(cfg) + "/review/" + encodeURIComponent(id);
  }

  function desktopAlertsOn() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    try {
      if (localStorage.getItem(DESKTOP_ON_KEY) === "0") return false;
    } catch (e) {
      /* permission granted is enough when storage is blocked */
    }
    return true;
  }

  function desktopAlertCopy(item) {
    var project = item && item.projectName ? String(item.projectName).trim() : "";
    var rating = item && item.rating ? String(item.rating).trim() : "";
    var parts = [];
    if (project) parts.push(project);
    if (rating) parts.push(rating);
    return { title: "🔴 New HHSRS Hazard", body: parts.join(" · ") };
  }

  function desktopNotify(item, cfg) {
    if (!item || !desktopAlertsOn()) return;
    var copy = desktopAlertCopy(item);
    var href = cfg.surface === "reporter" ? reviewUrl(cfg, item.id) : pendingUrl(cfg);
    try {
      var note = new Notification(copy.title, {
        body: copy.body,
        tag: "hhsrs-" + item.id,
        requireInteraction: true,
      });
      note.onclick = function () {
        window.focus();
        window.location.href = href;
        note.close();
      };
    } catch (e) {
      /* in-page notice already shown */
    }
  }

  function hideToast() {
    var toast = document.getElementById("hhsrs-alert-toast");
    if (toast) toast.classList.remove("is-visible");
  }

  function alertAudioContext() {
    if (alertAudio) return alertAudio;
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      alertAudio = new AudioCtx();
    } catch (e) {
      return null;
    }
    return alertAudio;
  }

  /* Browsers block audio until a gesture. Resume during that click so later
     polls can chime. If resume fails, the toast still shows with no sound. */
  function unlockAlertSound() {
    var ctx = alertAudioContext();
    if (!ctx || typeof ctx.resume !== "function") return;
    try {
      var pending = ctx.resume();
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (e) {
      /* toast still shows */
    }
  }

  function playTone(ctx, frequency, startAt, duration) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.04, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function playAlertChime() {
    var ctx = alertAudioContext();
    if (!ctx || ctx.state !== "running") return;
    try {
      var startAt = ctx.currentTime + 0.01;
      playTone(ctx, 523.25, startAt, 0.16);
      playTone(ctx, 659.25, startAt + 0.11, 0.2);
    } catch (e) {
      /* toast still shows */
    }
  }

  function showToast(fresh, cfg) {
    var toast = document.getElementById("hhsrs-alert-toast");
    if (!toast || !fresh.length) return;
    var item = fresh[0];
    var extra = fresh.length - 1;
    var kicker = document.getElementById("hhsrs-toast-kicker");
    var title = document.getElementById("hhsrs-toast-title");
    var body = document.getElementById("hhsrs-toast-body");
    var open = document.getElementById("hhsrs-toast-open");
    if (kicker) kicker.textContent = fresh.length === 1 ? "New hazard" : fresh.length + " new hazards";
    if (title) title.textContent = item.fullAddress || "New pending issue";
    if (body) {
      var summary = item.summary || [item.category, item.rating].filter(Boolean).join(" · ");
      var text = [item.projectName, summary].filter(Boolean).join(" — ");
      if (extra === 1) text += " + 1 more new hazard is waiting.";
      else if (extra > 1) text += " + " + extra + " more new hazards are waiting.";
      body.textContent = text;
    }
    if (open) open.href = reviewUrl(cfg, item.id);
    toast.classList.add("is-visible");
    playAlertChime();
  }

  function showPortalNotice(fresh, cfg) {
    var box = document.getElementById("hhsrs-home-alert");
    if (!box || !fresh.length) return;
    var rest = document.getElementById("hhsrs-home-alert-rest");
    var link = document.getElementById("hhsrs-home-alert-link");
    if (rest) rest.textContent = homeNoticeRest(fresh.length);
    if (link) link.href = pendingUrl(cfg);
    box.hidden = false;
  }

  function unseenCases(fresh) {
    var next = [];
    for (var i = 0; i < fresh.length; i++) {
      var item = fresh[i];
      if (!item || !item.id || displayed[item.id]) continue;
      displayed[item.id] = true;
      next.push(item);
    }
    return next;
  }

  function publish(msg) {
    if (channel) {
      try {
        channel.postMessage(msg);
      } catch (e) {
        /* followers still hear the localStorage copy */
      }
    }
    try {
      localStorage.setItem(BROADCAST_KEY, JSON.stringify(msg));
    } catch (e2) {
      /* this tab already showed its own notice */
    }
  }

  var lastSurfaceKey = "";

  function applyBroadcast(msg, cfg) {
    if (!msg || msg.from === tabId) return;
    if (msg.type === "paused") {
      if (paused) return;
      paused = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      showPaused();
      return;
    }
    if (msg.type === "cases" && Array.isArray(msg.items)) {
      present(msg.items, cfg, false);
      var key =
        String(msg.at || "") +
        ":" +
        msg.items
          .map(function (item) {
            return item && item.id;
          })
          .join(",");
      if (key === lastSurfaceKey) return;
      lastSurfaceKey = key;
      if (onReporterSurface()) {
        queueSurfaceSync({
          waitingCount: typeof msg.waitingCount === "number" ? msg.waitingCount : null,
          shownCount: readWaitingCount(),
          alertFired: true,
        });
      }
    }
  }

  function showPaused() {
    var el = document.getElementById("hhsrs-alerts-paused");
    if (!el) {
      el = document.createElement("div");
      el.id = "hhsrs-alerts-paused";
      el.className = "hhsrs-alerts-paused is-fixed";
      el.setAttribute("role", "status");
      el.textContent = PAUSE_TEXT;
      document.body.appendChild(el);
      return;
    }
    if (!el.textContent) el.textContent = PAUSE_TEXT;
    el.hidden = false;
  }

  function pauseAlerts() {
    if (paused) return;
    paused = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    showPaused();
    publish({ type: "paused", from: tabId, at: Date.now() });
    releaseLeader();
  }

  /* True when the latest waiting total differs from the number on screen. */
  function countsDiffer(waitingCount, shownCount) {
    if (typeof waitingCount !== "number" || typeof shownCount !== "number") return false;
    return waitingCount !== shownCount;
  }

  function pendingCaseIdFromHref(href) {
    var text = String(href || "");
    var match = text.match(/\/review\/([^/?#]+)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }

  function cleanQueueIds(ids) {
    var out = [];
    var seen = {};
    var list = Array.isArray(ids) ? ids : [];
    var i;
    for (i = 0; i < list.length; i++) {
      var id = list[i] ? String(list[i]) : "";
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  /* Keep the rows already on screen, in the order the user is looking at.
     New ids from the current sort are inserted beside the neighbour they
     follow in that sort. A row the user has open stays even if it has left
     the queue. */
  function planPendingQueuePatch(liveIds, freshIds, openId) {
    var live = cleanQueueIds(liveIds);
    var fresh = cleanQueueIds(freshIds);
    var open = openId ? String(openId) : "";
    var freshSet = {};
    var i;
    for (i = 0; i < fresh.length; i++) freshSet[fresh[i]] = true;
    var result = [];
    var kept = {};
    for (i = 0; i < live.length; i++) {
      var id = live[i];
      if (freshSet[id] || (open && id === open)) {
        result.push(id);
        kept[id] = true;
      }
    }
    for (i = 0; i < fresh.length; i++) {
      var nextId = fresh[i];
      if (kept[nextId]) continue;
      var insertAt = result.length;
      var placed = false;
      var j;
      for (j = i - 1; j >= 0; j--) {
        var prevAt = result.indexOf(fresh[j]);
        if (prevAt !== -1) {
          insertAt = prevAt + 1;
          placed = true;
          break;
        }
      }
      if (!placed) {
        for (j = i + 1; j < fresh.length; j++) {
          var nextAt = result.indexOf(fresh[j]);
          if (nextAt !== -1) {
            insertAt = nextAt;
            break;
          }
        }
      }
      result.splice(insertAt, 0, nextId);
      kept[nextId] = true;
    }
    return result;
  }

  function sameQueueIds(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    var i;
    for (i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  /* Decide whether a poll or alert may patch counts, refresh the pending
     queue, or only offer a manual list refresh. Typing in a review form, or
     focus inside the review list, blocks that swap. The Pending list still
     refreshes in place so an open row is kept. */
  function planPendingSurface(state) {
    var countChanged = countsDiffer(state.waitingCount, state.shownCount);
    var wants = !!(state.force || state.alertFired || countChanged || state.listStale);
    var hasList = !!(state.hasPendingList || state.hasReviewList);
    var reviewUnsafe = !!state.hasReviewList && (!!state.focusInsideList || !!state.typingInReview);
    var unsafe = !state.force && reviewUnsafe;
    return {
      updateCounts: !!(countChanged || state.alertFired || state.force),
      refreshList: !!(hasList && wants && !unsafe),
      showNotice: !!(hasList && wants && unsafe),
    };
  }

  var listStale = false;
  var queuedSync = null;
  var syncScheduled = false;
  var swapInFlight = false;
  var swapAgain = false;
  var swapForce = false;

  function onReporterSurface() {
    if (typeof document === "undefined") return false;
    return !!(
      document.getElementById("not-actioned") ||
      document.getElementById("rv-also-waiting") ||
      document.querySelector(".side-summary")
    );
  }

  function pendingListEl() {
    return document.getElementById("not-actioned") || document.getElementById("rv-also-waiting");
  }

  function readWaitingCountIn(root) {
    if (!root || !root.querySelectorAll) return null;
    var rows = root.querySelectorAll(".side-summary-row");
    var i;
    for (i = 0; i < rows.length; i++) {
      var label = rows[i].querySelector("span");
      var strong = rows[i].querySelector("strong");
      if (!label || !strong) continue;
      if (label.textContent.replace(/\s+/g, " ").trim() !== "Waiting") continue;
      var n = parseInt(String(strong.textContent).trim(), 10);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function readWaitingCount() {
    return readWaitingCountIn(document);
  }

  function setCountBadge(link, className, count) {
    if (!link) return;
    var badge = link.querySelector("." + className);
    if (!count) {
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = className;
      link.appendChild(badge);
    }
    badge.textContent = String(count);
  }

  function markClear(el, clear) {
    if (!el || !el.classList) return;
    if (clear) el.classList.add("is-clear");
    else el.classList.remove("is-clear");
  }

  function applyWaitingCount(count) {
    if (typeof count !== "number" || !isFinite(count) || count < 0) return;
    var clear = count === 0;
    var rows = document.querySelectorAll(".side-summary-row");
    var i;
    for (i = 0; i < rows.length; i++) {
      var label = rows[i].querySelector("span");
      var strong = rows[i].querySelector("strong");
      if (!label || !strong) continue;
      if (label.textContent.replace(/\s+/g, " ").trim() !== "Waiting") continue;
      strong.textContent = String(count);
    }
    var dashboard = document.querySelector('#side-tabs a.tab-link[title="Dashboard"]');
    if (dashboard && dashboard.classList) {
      var dashBadge = dashboard.querySelector(".tab-badge");
      if (dashBadge && dashBadge.parentNode) dashBadge.parentNode.removeChild(dashBadge);
      var wait = dashboard.querySelector(".tab-wait");
      if (clear) {
        dashboard.classList.remove("needs-attention");
        dashboard.classList.add("is-clear");
        if (wait && wait.parentNode) wait.parentNode.removeChild(wait);
      } else {
        dashboard.classList.remove("is-clear");
        dashboard.classList.add("needs-attention");
        if (!wait) {
          var label = dashboard.querySelector(".tab-label");
          if (label) {
            wait = document.createElement("span");
            wait.className = "tab-wait";
            label.appendChild(wait);
          }
        }
        if (wait) wait.textContent = " " + String(count);
      }
    }
    var steps = document.querySelectorAll(".step-tabs a");
    for (i = 0; i < steps.length; i++) {
      if ((steps[i].textContent || "").indexOf("Pending Issues") !== -1) {
        setCountBadge(steps[i], "step-badge", count);
        markClear(steps[i], clear);
      }
    }
    var pendingPanel = document.getElementById("not-actioned");
    if (pendingPanel) {
      markClear(pendingPanel, clear);
      var panelBadge = pendingPanel.querySelector(".count-received");
      if (clear) {
        if (panelBadge && panelBadge.parentNode) panelBadge.parentNode.removeChild(panelBadge);
      } else if (panelBadge) {
        panelBadge.textContent = String(count) + " need action";
      } else {
        var head = pendingPanel.querySelector(".panel-head");
        if (head) {
          panelBadge = document.createElement("span");
          panelBadge.className = "count count-received";
          panelBadge.textContent = String(count) + " need action";
          head.appendChild(panelBadge);
        }
      }
    }
  }

  function listBusy(list) {
    if (!list) return false;
    var active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement && list.contains(active)) return true;
    if (list.querySelector(".photo-att-icon.is-pop-open")) return true;
    return false;
  }

  function typingInReview() {
    var active = document.activeElement;
    if (!active || !active.tagName) return false;
    var tag = active.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return false;
    if (active.type === "hidden") return false;
    var review = document.getElementById("review-workspace");
    var list = document.getElementById("rv-also-waiting");
    if (!review || !review.contains(active)) return false;
    if (list && list.contains(active)) return false;
    return true;
  }

  function hideRefreshNotice() {
    var note = document.getElementById("hhsrs-list-refresh");
    if (note) note.hidden = true;
  }

  function showRefreshNotice(list) {
    if (!list || !list.parentNode) return;
    var note = document.getElementById("hhsrs-list-refresh");
    if (!note) {
      note = document.createElement("div");
      note.id = "hhsrs-list-refresh";
      note.className = "hhsrs-list-refresh";
      note.setAttribute("role", "status");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hhsrs-list-refresh-btn";
      btn.textContent = "New issue, refresh list";
      btn.addEventListener("click", function () {
        queueSurfaceSync({
          waitingCount: readWaitingCount(),
          shownCount: readWaitingCount(),
          force: true,
          listStale: true,
          alertFired: true,
        });
      });
      note.appendChild(btn);
    }
    if (note.parentNode !== list.parentNode || note.nextSibling !== list) {
      list.parentNode.insertBefore(note, list);
    }
    note.hidden = false;
  }

  function pendingRowId(row) {
    if (!row || !row.querySelector) return "";
    var link = row.querySelector("a[href*='/review/']");
    if (!link) return "";
    return pendingCaseIdFromHref(link.getAttribute("href"));
  }

  function findPendingRow(list, id) {
    if (!list || !id) return null;
    var rows = list.querySelectorAll("tbody tr");
    var i;
    for (i = 0; i < rows.length; i++) {
      if (pendingRowId(rows[i]) === id) return rows[i];
    }
    return null;
  }

  /* The row the user is in: an expanded or selected row, an open photo, or
     the row that holds focus. */
  function openPendingRowId(list) {
    if (!list || !list.querySelector) return "";
    var marked = list.querySelector("tr.is-open, tr.is-sel, .photo-att-icon.is-pop-open");
    var row = null;
    if (marked) {
      if (marked.matches && marked.matches("tr")) row = marked;
      else if (marked.closest) row = marked.closest("tr");
    }
    if (!row && typeof document !== "undefined") {
      var active = document.activeElement;
      if (active && active.closest && list.contains(active)) row = active.closest("tr");
    }
    return pendingRowId(row);
  }

  function queueRowIds(body) {
    var ids = [];
    if (!body) return ids;
    var rows = body.querySelectorAll("tr");
    var i;
    for (i = 0; i < rows.length; i++) {
      var id = pendingRowId(rows[i]);
      if (id) ids.push(id);
    }
    return ids;
  }

  function pageScroll() {
    var root = document.scrollingElement || document.documentElement;
    return {
      x: window.pageXOffset || (root && root.scrollLeft) || 0,
      y: window.pageYOffset || (root && root.scrollTop) || 0,
    };
  }

  function queueWrap(list) {
    if (!list || !list.querySelector) return null;
    return list.querySelector(".pending-issues-wrap") || list.querySelector(".table-wrap");
  }

  function rowInView(row) {
    if (!row || !row.getBoundingClientRect) return false;
    var rect = row.getBoundingClientRect();
    var height = window.innerHeight || 0;
    return rect.bottom > 0 && rect.top < height;
  }

  /* Remember what is on screen. An open row in view stays put, so a photo
     pop does not drift. Otherwise the first visible row stays put once the
     page is scrolled. At the top of the page the window scroll stays, and a
     new case can appear in the list. Sideways scroll is always kept. */
  function captureQueueView(list) {
    var wrap = queueWrap(list);
    var scroll = pageScroll();
    var panel = list.getBoundingClientRect();
    var openId = openPendingRowId(list);
    var openRow = openId ? findPendingRow(list, openId) : null;
    var anchor = null;
    var holdOpen = !!(openRow && rowInView(openRow));
    if (holdOpen) anchor = { id: openId, top: openRow.getBoundingClientRect().top };
    if (!anchor) {
      var rows = list.querySelectorAll("tbody tr");
      var i;
      for (i = 0; i < rows.length; i++) {
        if (!rowInView(rows[i])) continue;
        var id = pendingRowId(rows[i]);
        if (!id) continue;
        anchor = { id: id, top: rows[i].getBoundingClientRect().top };
        break;
      }
    }
    return {
      x: scroll.x,
      y: scroll.y,
      left: wrap ? wrap.scrollLeft : 0,
      top: wrap ? wrap.scrollTop : 0,
      panelHeight: panel.height,
      panelBottom: panel.bottom,
      anchor: anchor,
      lockScroll: !holdOpen && scroll.y <= 1,
    };
  }

  function restoreQueueView(list, saved) {
    if (!saved) return;
    window.scrollTo(saved.x, saved.y);
    if (!saved.lockScroll) {
      var delta = 0;
      if (saved.anchor && saved.anchor.id) {
        var row = findPendingRow(list, saved.anchor.id);
        if (row) delta = row.getBoundingClientRect().top - saved.anchor.top;
        else if (saved.panelBottom <= 0) delta = list.getBoundingClientRect().height - saved.panelHeight;
      } else if (saved.panelBottom <= 0) {
        delta = list.getBoundingClientRect().height - saved.panelHeight;
      }
      if (delta) window.scrollBy(0, delta);
    }
    var wrap = queueWrap(list);
    if (wrap) {
      wrap.scrollLeft = saved.left;
      wrap.scrollTop = saved.top;
    }
  }

  function isQueueChrome(node) {
    return !!(node && node.classList && (node.classList.contains("panel-head") || node.classList.contains("waiting-banner")));
  }

  function keepQueueControl(node) {
    if (!node) return false;
    if (node.tagName === "FORM") return true;
    return !!(node.classList && node.classList.contains("pending-sort-bar"));
  }

  /* Swap the empty message or the table. Leave the sort bar and any filters. */
  function replaceQueueTail(live, fresh) {
    var remove = [];
    var child = live.firstElementChild;
    while (child) {
      if (!isQueueChrome(child) && !keepQueueControl(child)) remove.push(child);
      child = child.nextElementSibling;
    }
    var i;
    for (i = 0; i < remove.length; i++) {
      if (remove[i].parentNode) remove[i].parentNode.removeChild(remove[i]);
    }
    var hasSort = !!live.querySelector(".pending-sort-bar");
    var hasForm = !!live.querySelector("form");
    child = fresh.firstElementChild;
    while (child) {
      var isSort = !!(child.classList && child.classList.contains("pending-sort-bar"));
      var isForm = child.tagName === "FORM";
      if (!isQueueChrome(child) && !(isSort && hasSort) && !(isForm && hasForm)) {
        live.appendChild(document.importNode(child, true));
      }
      child = child.nextElementSibling;
    }
  }

  function patchPendingQueue(live, fresh) {
    if (!live || !fresh) return;
    var liveBody = live.querySelector("tbody");
    var freshBody = fresh.querySelector("tbody");
    var openId = openPendingRowId(live);
    if (!liveBody || !freshBody) {
      var view = captureQueueView(live);
      live.style.overflowAnchor = "none";
      if (openId && liveBody && !freshBody) {
        var staying = liveBody.querySelectorAll("tr");
        var s;
        for (s = 0; s < staying.length; s++) {
          var stayId = pendingRowId(staying[s]);
          if (stayId && stayId !== openId && staying[s].parentNode) staying[s].parentNode.removeChild(staying[s]);
        }
      } else if (!openId) {
        replaceQueueTail(live, fresh);
      }
      restoreQueueView(live, view);
      live.style.overflowAnchor = "";
      return;
    }
    var liveIds = queueRowIds(liveBody);
    var freshIds = queueRowIds(freshBody);
    var order = planPendingQueuePatch(liveIds, freshIds, openId);
    if (sameQueueIds(liveIds, order)) return;
    var view = captureQueueView(live);
    live.style.overflowAnchor = "none";
    var freshRows = freshBody.querySelectorAll("tr");
    var freshById = {};
    var i;
    for (i = 0; i < freshRows.length; i++) {
      var freshId = pendingRowId(freshRows[i]);
      if (freshId && !freshById[freshId]) freshById[freshId] = freshRows[i];
    }
    var liveRows = liveBody.querySelectorAll("tr");
    for (i = 0; i < liveRows.length; i++) {
      var existingId = pendingRowId(liveRows[i]);
      if (!existingId) continue;
      if (order.indexOf(existingId) === -1 && liveRows[i].parentNode) liveRows[i].parentNode.removeChild(liveRows[i]);
    }
    for (i = 0; i < order.length; i++) {
      var id = order[i];
      var node = findPendingRow(live, id);
      if (!node && freshById[id]) node = document.importNode(freshById[id], true);
      if (!node || !liveBody.rows) continue;
      var current = liveBody.rows[i];
      if (current !== node) liveBody.insertBefore(node, current || null);
    }
    restoreQueueView(live, view);
    live.style.overflowAnchor = "";
  }

  function swapPendingList(live, fresh) {
    if (live.id === "not-actioned") {
      patchPendingQueue(live, fresh);
      return;
    }
    var liveWrap = live.querySelector(".table-wrap");
    var top = liveWrap ? liveWrap.scrollTop : 0;
    if (live.id === "rv-also-waiting") {
      var details = live.querySelector("details");
      var freshDetails = fresh.querySelector("details");
      if (details && details.open && freshDetails) freshDetails.open = true;
    }
    live.replaceWith(fresh);
    var freshWrap = fresh.querySelector(".table-wrap");
    if (freshWrap && top) freshWrap.scrollTop = top;
  }

  function finishSwap(ok) {
    swapInFlight = false;
    var again = swapAgain;
    swapAgain = false;
    if (again && pendingListEl()) fetchListHtml(swapForce);
    return ok;
  }

  function fetchListHtml(force) {
    if (swapInFlight) {
      swapAgain = true;
      if (force) swapForce = true;
      return;
    }
    swapInFlight = true;
    swapForce = !!force;
    var url = window.location.pathname + window.location.search;
    fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "text/html" },
    })
      .then(function (res) {
        var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        if (!res.ok || res.redirected || ct.indexOf("html") === -1) return null;
        return res.text();
      })
      .then(function (html) {
        if (!html || typeof DOMParser === "undefined") return false;
        var doc = new DOMParser().parseFromString(html, "text/html");
        if (!doc.querySelector(".side-summary")) return false;
        var live = pendingListEl();
        if (!live) {
          var onlyCount = readWaitingCountIn(doc);
          if (typeof onlyCount === "number") applyWaitingCount(onlyCount);
          return true;
        }
        var fresh = doc.getElementById(live.id);
        if (!fresh) return false;
        if (live.id !== "not-actioned" && !swapForce && (listBusy(live) || (live.id === "rv-also-waiting" && typingInReview()))) {
          listStale = true;
          showRefreshNotice(live);
          return false;
        }
        swapPendingList(live, fresh);
        var docCount = readWaitingCountIn(doc);
        if (typeof docCount === "number") applyWaitingCount(docCount);
        listStale = false;
        hideRefreshNotice();
        return true;
      })
      .catch(function () {
        return false;
      })
      .then(function (ok) {
        if (!ok && pendingListEl()) {
          listStale = true;
          showRefreshNotice(pendingListEl());
        }
        finishSwap(ok);
      });
  }

  function flushSurfaceSync() {
    syncScheduled = false;
    var opts = queuedSync || {};
    queuedSync = null;
    if (!onReporterSurface()) return;
    var list = pendingListEl();
    var plan = planPendingSurface({
      waitingCount: opts.waitingCount,
      shownCount: typeof opts.shownCount === "number" ? opts.shownCount : readWaitingCount(),
      hasPendingList: !!(list && list.id === "not-actioned"),
      hasReviewList: !!(list && list.id === "rv-also-waiting"),
      focusInsideList: listBusy(list),
      typingInReview: typingInReview(),
      listStale: !!(opts.listStale || listStale),
      alertFired: !!opts.alertFired,
      force: !!opts.force,
    });
    if (plan.updateCounts && typeof opts.waitingCount === "number") applyWaitingCount(opts.waitingCount);
    if (plan.showNotice) {
      listStale = true;
      showRefreshNotice(list);
    }
    if (!plan.refreshList) return;
    fetchListHtml(!!opts.force);
  }

  function queueSurfaceSync(opts) {
    opts = opts || {};
    if (!queuedSync) {
      queuedSync = { alertFired: false, force: false, listStale: false, waitingCount: null, shownCount: null };
    }
    if (opts.alertFired) queuedSync.alertFired = true;
    if (opts.force) queuedSync.force = true;
    if (opts.listStale || listStale) queuedSync.listStale = true;
    if (typeof opts.waitingCount === "number") queuedSync.waitingCount = opts.waitingCount;
    if (typeof opts.shownCount === "number") queuedSync.shownCount = opts.shownCount;
    if (syncScheduled) return;
    syncScheduled = true;
    Promise.resolve().then(flushSurfaceSync);
  }

  function present(fresh, cfg, notifyDesktop, waitingCount) {
    var unseen = unseenCases(fresh);
    if (!unseen.length) return;
    if (cfg.surface === "reporter") showToast(unseen, cfg);
    else showPortalNotice(unseen, cfg);
    if (!notifyDesktop) return;
    for (var n = 0; n < unseen.length; n++) desktopNotify(unseen[n], cfg);
    var msg = { type: "cases", from: tabId, at: Date.now(), items: unseen };
    if (typeof waitingCount === "number") msg.waitingCount = waitingCount;
    publish(msg);
  }

  function pollPending(cfg) {
    if (paused || pollInFlight) return;
    pollInFlight = true;
    lastPollAt = Date.now();
    var url = pendingUrl(cfg) + "/pending-alerts.json";
    fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        if (shouldPausePoll({ ok: res.ok, redirected: res.redirected, contentType: ct, pendingIsArray: true })) {
          pauseAlerts();
          return null;
        }
        return res.json().then(
          function (data) {
            var pendingIsArray = !!(data && Array.isArray(data.pending));
            if (shouldPausePoll({ ok: true, redirected: false, contentType: ct, pendingIsArray: pendingIsArray })) {
              pauseAlerts();
              return null;
            }
            return data;
          },
          function () {
            pauseAlerts();
            return null;
          }
        );
      })
      .then(function (data) {
        if (!data) return;
        var fresh = claimFresh(data.pending, new Date().toISOString());
        var waitingCount = typeof data.waitingCount === "number" ? data.waitingCount : null;
        present(fresh, cfg, true, waitingCount);
        if (!onReporterSurface()) return;
        queueSurfaceSync({
          waitingCount: waitingCount,
          shownCount: readWaitingCount(),
          alertFired: fresh.length > 0,
        });
      })
      .catch(function () {
        pauseAlerts();
      })
      .then(function () {
        pollInFlight = false;
      });
  }

  function wireChrome(cfg) {
    var dismissBtn = document.getElementById("hhsrs-toast-dismiss");
    if (dismissBtn) dismissBtn.addEventListener("click", hideToast);
    var homeDismiss = document.getElementById("hhsrs-home-alert-dismiss");
    if (homeDismiss) {
      homeDismiss.addEventListener("click", function () {
        var box = document.getElementById("hhsrs-home-alert");
        if (box) box.hidden = true;
      });
    }
    if (document.getElementById("hhsrs-alert-toast")) {
      document.addEventListener("pointerdown", unlockAlertSound, true);
      document.addEventListener("keydown", function (ev) {
        unlockAlertSound();
        if (ev.key === "Escape") hideToast();
      }, true);
    }
    if (cfg.surface !== "reporter") {
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape") return;
        var box = document.getElementById("hhsrs-home-alert");
        if (box) box.hidden = true;
      });
    }
  }

  function openChannel(cfg) {
    if (typeof BroadcastChannel !== "function") return;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch (e) {
      channel = null;
      return;
    }
    channel.onmessage = function (ev) {
      applyBroadcast(ev.data, cfg);
    };
  }

  function onStorage(ev) {
    if (ev.key !== BROADCAST_KEY || !ev.newValue || !activeCfg) return;
    try {
      applyBroadcast(JSON.parse(ev.newValue), activeCfg);
    } catch (e) {
      /* ignore a bad broadcast payload */
    }
  }

  function tick(cfg) {
    if (paused) return;
    if (usingWebLocks()) {
      if (!isLeader) return;
      pollPending(cfg);
      return;
    }
    if (!ensureLeader()) return;
    isLeader = true;
    pollPending(cfg);
  }

  function start() {
    if (started || typeof document === "undefined") return;
    started = true;
    var cfg = readConfig();
    if (document.getElementById("hhsrs-alert-toast")) cfg.surface = "reporter";
    activeCfg = cfg;
    wireChrome(cfg);
    openChannel(cfg);
    window.addEventListener("pagehide", releaseLeader);
    window.addEventListener("storage", onStorage);
    /* Keep polling while the window is minimised. Chrome may clamp the timer
       to about once a minute; that is still often enough for a desktop pop-up.
       Web Locks keeps a single leader until that tab closes. */
    if (usingWebLocks()) requestLeaderLock();
    else tick(cfg);
    pollTimer = setInterval(function () {
      tick(cfg);
    }, cfg.pollMs);
    document.addEventListener("visibilitychange", function () {
      if (paused || document.visibilityState !== "visible") return;
      if (Date.now() - lastPollAt < VISIBLE_GAP_MS) return;
      tick(cfg);
    });
  }

  return {
    resolvePendingAlerts: resolvePendingAlerts,
    shouldPausePoll: shouldPausePoll,
    leaderHoldsLock: leaderHoldsLock,
    homeNoticeText: homeNoticeText,
    desktopAlertCopy: desktopAlertCopy,
    desktopAlertsOn: desktopAlertsOn,
    unlockAlertSound: unlockAlertSound,
    countsDiffer: countsDiffer,
    pendingCaseIdFromHref: pendingCaseIdFromHref,
    planPendingQueuePatch: planPendingQueuePatch,
    patchPendingQueue: patchPendingQueue,
    planPendingSurface: planPendingSurface,
    start: start,
  };
});
