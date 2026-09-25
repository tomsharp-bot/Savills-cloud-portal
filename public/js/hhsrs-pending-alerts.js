/* Shared new-Pending alerts for HHSRS Reporter and the portal home page.
   One localStorage marker is shared across tabs. The first run on a browser
   only records a baseline. Later polls and page loads alert for unclaimed
   cases newer than that marker. Claimed and stale cases stay quiet. */
(function (factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.HhsrsPendingAlerts = api;
  api.start();
})(function () {
  var MARKER_KEY = "hhsrsPendingAlertMarker";
  var DESKTOP_ON_KEY = "hhsrsDesktopAlertsOn";
  var SEEN_CAP = 300;
  var VISIBLE_GAP_MS = 15000;
  var PAUSE_TEXT = "Alerts are paused. The login may have expired.";

  var memoryMarker = null;
  var started = false;
  var paused = false;
  var pollInFlight = false;
  var lastPollAt = 0;
  var pollTimer = null;
  var alertAudio = null;

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

  function shouldPausePoll(info) {
    if (!info || info.redirected || !info.ok) return true;
    var ct = String(info.contentType || "");
    if (ct.indexOf("json") === -1) return true;
    if (info.pendingIsArray === false) return true;
    return false;
  }

  function homeNoticeText(count) {
    if (count === 1) return "New HHSRS case waiting in Pending";
    return count + " new HHSRS cases waiting in Pending";
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

  function desktopNotify(item, cfg) {
    if (!item || !desktopAlertsOn()) return;
    var summary = item.summary || [item.category, item.rating].filter(Boolean).join(" · ");
    var body = [item.projectName, item.fullAddress, summary].filter(Boolean).join(" — ");
    var href = cfg.surface === "home" ? pendingUrl(cfg) : reviewUrl(cfg, item.id);
    try {
      var note = new Notification("New HHSRS hazard", {
        body: body,
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

  function showHomeNotice(fresh, cfg) {
    var box = document.getElementById("hhsrs-home-alert");
    if (!box || !fresh.length) return;
    var text = document.getElementById("hhsrs-home-alert-text");
    var link = document.getElementById("hhsrs-home-alert-link");
    if (text) text.textContent = homeNoticeText(fresh.length);
    if (link) link.href = pendingUrl(cfg);
    box.hidden = false;
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
  }

  function present(fresh, cfg) {
    if (!fresh.length) return;
    if (cfg.surface === "home") showHomeNotice(fresh, cfg);
    else showToast(fresh, cfg);
    var limit = Math.min(fresh.length, 3);
    for (var n = 0; n < limit; n++) desktopNotify(fresh[n], cfg);
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
        present(fresh, cfg);
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
    if (cfg.surface === "home") {
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape") return;
        var box = document.getElementById("hhsrs-home-alert");
        if (box) box.hidden = true;
      });
    }
  }

  function start() {
    if (started || typeof document === "undefined") return;
    started = true;
    var cfg = readConfig();
    wireChrome(cfg);
    pollPending(cfg);
    pollTimer = setInterval(function () {
      pollPending(cfg);
    }, cfg.pollMs);
    document.addEventListener("visibilitychange", function () {
      if (paused || document.visibilityState !== "visible") return;
      if (Date.now() - lastPollAt < VISIBLE_GAP_MS) return;
      pollPending(cfg);
    });
  }

  return {
    resolvePendingAlerts: resolvePendingAlerts,
    shouldPausePoll: shouldPausePoll,
    homeNoticeText: homeNoticeText,
    desktopAlertsOn: desktopAlertsOn,
    unlockAlertSound: unlockAlertSound,
    start: start,
  };
});
