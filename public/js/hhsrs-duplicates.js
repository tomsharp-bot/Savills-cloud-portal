(function () {
  var openId = "";

  function pairEl(id) {
    return document.getElementById("dup-pair-" + id);
  }

  function rowEl(id) {
    return document.querySelector('tr[data-dup-id="' + id + '"]');
  }

  function buttonEl(id) {
    return document.querySelector('[data-dup-toggle="' + id + '"]');
  }

  function paint(id, open) {
    var pair = pairEl(id);
    var row = rowEl(id);
    var button = buttonEl(id);
    if (!pair || !button) return;
    pair.classList.toggle("is-open", open);
    if (row) row.classList.toggle("is-open", open);
    button.textContent = open ? "Close duplicate" : "View duplicate";
  }

  function toggle(id) {
    if (!id) return;
    var willOpen = openId !== id;
    if (openId) paint(openId, false);
    openId = "";
    if (willOpen) {
      paint(id, true);
      openId = id;
    }
  }

  document.querySelectorAll("tr[data-dup-id]").forEach(function (row) {
    var id = row.getAttribute("data-dup-id");
    row.addEventListener("click", function (event) {
      if (event.target.closest("a, button, input, textarea, select, label")) return;
      if (openId === id) return;
      toggle(id);
    });
    row.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (openId === id) return;
      toggle(id);
    });
  });

  document.querySelectorAll("[data-dup-toggle]").forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      toggle(button.getAttribute("data-dup-toggle"));
    });
  });

  var initial = document.querySelector(".dup-pair.is-open");
  if (initial) openId = initial.getAttribute("data-pair-id") || "";
})();
