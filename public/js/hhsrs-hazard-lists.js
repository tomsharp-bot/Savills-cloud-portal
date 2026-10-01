/* Swaps the blank Review hazard list when the project changes.
   Onward and Vico (rating scheme OLD) use the old 29 categories.
   Every other project keeps the current 21. Ratings stay with the reporter script. */
(function () {
  var cfg = window.HHSRS_REPORTER || {};
  var lists = cfg.categoryOptions;
  var hazard = document.getElementById("rv-hazard");
  var rating = document.getElementById("rv-rating");
  var project = document.getElementById("rv-project");
  if (!hazard || hazard.tagName !== "SELECT" || !lists || !project) return;

  function schemeFor(name) {
    var raw = String(name || "").trim();
    var projects = cfg.demoProjects || [];
    var aliases = cfg.projectAliases || {};
    var key = aliases[raw] || aliases[raw.toLowerCase()] || raw;
    var wanted = String(key).toLowerCase();
    for (var i = 0; i < projects.length; i++) {
      if (String(projects[i].name || "").toLowerCase() === wanted) {
        return projects[i].ratingScheme === "OLD" ? "OLD" : "NEW";
      }
    }
    if (/^onward\b/i.test(raw) || /^vico\b/i.test(raw)) return "OLD";
    return "NEW";
  }

  function sync() {
    var scheme = schemeFor(project.value);
    if (hazard.getAttribute("data-scheme") === scheme) return;
    var list = lists[scheme] || lists.NEW || [];
    if (!list.length) return;
    var current = hazard.value;
    hazard.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select…";
    hazard.appendChild(placeholder);
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i];
      hazard.appendChild(opt);
    }
    hazard.value = current && list.indexOf(current) >= 0 ? current : "";
    hazard.setAttribute("data-scheme", scheme);
  }

  sync();
  if (rating && window.MutationObserver) {
    var observer = new MutationObserver(sync);
    observer.observe(rating, { childList: true });
  }
  project.addEventListener("change", sync);
})();
