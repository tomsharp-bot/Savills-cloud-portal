(function () {
  function $(id) {
    return document.getElementById(id);
  }

  document.querySelectorAll("tr[data-dup-id]").forEach(function (row) {
    function openRow() {
      var id = row.getAttribute("data-dup-id");
      if (!id) return;
      var url = new URL(window.location.href);
      url.searchParams.set("open", id);
      window.location.assign(url.pathname + "?" + url.searchParams.toString());
    }
    row.addEventListener("click", function (e) {
      if (e.target.closest("a, button, input, textarea, select, label")) return;
      openRow();
    });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openRow();
      }
    });
  });

  var ask = $("dup-restore-ask");
  var mainFoot = $("dup-foot-main");
  var confirmFoot = $("dup-foot-confirm");
  var noBtn = $("dup-restore-no");
  if (ask && mainFoot && confirmFoot) {
    ask.addEventListener("click", function () {
      mainFoot.hidden = true;
      confirmFoot.hidden = false;
      var yes = confirmFoot.querySelector("button[type='submit']");
      if (yes) yes.focus();
    });
  }
  if (noBtn && mainFoot && confirmFoot) {
    noBtn.addEventListener("click", function () {
      confirmFoot.hidden = true;
      mainFoot.hidden = false;
      if (ask) ask.focus();
    });
  }

  function closePanel() {
    var url = new URL(window.location.href);
    if (!url.searchParams.has("open")) return;
    url.searchParams.delete("open");
    var query = url.searchParams.toString();
    window.location.assign(url.pathname + (query ? "?" + query : ""));
  }

  var scrim = $("dup-scrim");
  if (scrim) scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !$("dup-panel")) return;
    if (confirmFoot && !confirmFoot.hidden && mainFoot) {
      confirmFoot.hidden = true;
      mainFoot.hidden = false;
      return;
    }
    closePanel();
  });
})();
