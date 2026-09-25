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
    if (msg.type === "cases" && Array.isArray(msg.items)) present(msg.items, cfg, false);
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

  function present(fresh, cfg, notifyDesktop) {
    var unseen = unseenCases(fresh);
    if (!unseen.length) return;
    if (cfg.surface === "reporter") showToast(unseen, cfg);
    else showPortalNotice(unseen, cfg);
    if (!notifyDesktop) return;
    for (var n = 0; n < unseen.length; n++) desktopNotify(unseen[n], cfg);
    publish({ type: "cases", from: tabId, at: Date.now(), items: unseen });
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
        present(fresh, cfg, true);
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
    start: start,
  };
});
