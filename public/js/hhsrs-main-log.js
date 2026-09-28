(function () {
  var form = document.getElementById("ml-filters");
  if (form) {
    form.addEventListener("change", function (event) {
      var target = event.target;
      if (target && target.id === "ml-q") return;
      form.submit();
    });
    var search = document.getElementById("ml-q");
    var timer = 0;
    if (search) {
      search.addEventListener("input", function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { form.submit(); }, 400);
      });
    }
  }

  document.querySelectorAll("tr[data-href]").forEach(function (row) {
    row.addEventListener("click", function (event) {
      if (event.target && event.target.closest && event.target.closest("a")) return;
      var href = row.getAttribute("data-href");
      if (href) window.location.href = href;
    });
  });

  var closeLink = document.getElementById("ml-close");
  function closePanel() {
    if (closeLink) window.location.href = closeLink.href;
  }
  var scrim = document.getElementById("ml-scrim");
  if (scrim) scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closePanel();
  });
})();
