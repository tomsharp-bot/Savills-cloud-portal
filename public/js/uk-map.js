(function () {
  var canvas = document.getElementById("uk-map-canvas");
  if (!canvas) return;
  var canPlace = canvas.getAttribute("data-can-place") === "1";
  var select = document.getElementById("uk-map-project");
  var pins = canvas.querySelector(".uk-map-pins");
  if (!pins) return;

  function appUrl(path) {
    var base = typeof window.APP_BASE_PATH === "string" ? window.APP_BASE_PATH : "";
    if (!path) return base || "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    return base + path;
  }

  function roundPercent(n) {
    return Math.round(n * 100) / 100;
  }

  function pointFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var x = roundPercent(((ev.clientX - rect.left) / rect.width) * 100);
    var y = roundPercent(((ev.clientY - rect.top) / rect.height) * 100);
    if (x < 0) x = 0;
    if (x > 100) x = 100;
    if (y < 0) y = 0;
    if (y > 100) y = 100;
    return { x: x, y: y };
  }

  function findPin(id) {
    var buttons = pins.querySelectorAll("[data-map-pin]");
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute("data-map-pin") === id) return buttons[i];
    }
    return null;
  }

  function createPin(id, name) {
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className = "uk-map-pin";
    pin.setAttribute("data-map-pin", id);
    pin.setAttribute("aria-label", name);
    var dot = document.createElement("span");
    dot.className = "uk-map-pin-dot";
    dot.setAttribute("aria-hidden", "true");
    var label = document.createElement("span");
    label.className = "uk-map-pin-label";
    label.textContent = name;
    pin.appendChild(dot);
    pin.appendChild(label);
    pins.appendChild(pin);
    return pin;
  }

  function save(id, x, y) {
    return fetch(appUrl("/projects/" + encodeURIComponent(id) + "/map"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ x: x, y: y }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || "Could not save the pin.");
        return data;
      });
    });
  }

  function place(id, name, point) {
    var pin = findPin(id);
    var previous = pin ? { left: pin.style.left, top: pin.style.top, saved: pin.getAttribute("data-saved") === "1" } : null;
    if (!pin) pin = createPin(id, name);
    pin.style.left = point.x + "%";
    pin.style.top = point.y + "%";
    save(id, point.x, point.y).then(function () {
      pin.setAttribute("data-saved", "1");
    }).catch(function (err) {
      if (previous && previous.saved) {
        pin.style.left = previous.left;
        pin.style.top = previous.top;
      } else if (pin.parentNode) {
        pin.parentNode.removeChild(pin);
      }
      window.alert(err.message || "Could not save the pin.");
    });
  }

  if (!canPlace || !select) return;

  canvas.addEventListener("click", function (ev) {
    if (ev.target.closest && ev.target.closest(".uk-map-pin")) return;
    var id = select.value;
    if (!id) return;
    var point = pointFromEvent(ev);
    if (!point) return;
    var name = select.options[select.selectedIndex].textContent || "";
    place(id, name, point);
  });

  var drag = null;
  canvas.addEventListener("pointerdown", function (ev) {
    var pin = ev.target.closest ? ev.target.closest(".uk-map-pin") : null;
    if (!pin) return;
    ev.preventDefault();
    var point = pointFromEvent(ev);
    drag = {
      pin: pin,
      id: pin.getAttribute("data-map-pin"),
      startLeft: pin.style.left,
      startTop: pin.style.top,
      moved: false,
      pointerId: ev.pointerId,
      point: point,
    };
    if (pin.setPointerCapture) pin.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    var point = pointFromEvent(ev);
    if (!point) return;
    drag.pin.style.left = point.x + "%";
    drag.pin.style.top = point.y + "%";
    drag.point = point;
    drag.moved = true;
  });
  function finishDrag(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    var done = drag;
    drag = null;
    if (!done.moved || !done.point || !done.id) return;
    save(done.id, done.point.x, done.point.y).catch(function (err) {
      done.pin.style.left = done.startLeft;
      done.pin.style.top = done.startTop;
      window.alert(err.message || "Could not save the pin.");
    });
  }
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
})();
