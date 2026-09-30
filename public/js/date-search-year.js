// Date search boxes use the browser's date control, whose year can grow past 4 digits.
// Reject a fifth typed or pasted digit on every date search, and leave other edits alone.
(function () {
  if (window.__dateSearchYearLimit) return;
  window.__dateSearchYearLimit = true;

  var YEAR = /^(\d+)-(\d{2})-(\d{2})$/;

  function parts(value) {
    var match = YEAR.exec(value || "");
    if (!match) return null;
    return { year: match[1], month: match[2], day: match[3] };
  }

  function limitValue(previous, proposed) {
    var next = parts(proposed);
    if (!next || next.year.length <= 4) return proposed;
    var prev = parts(previous);
    if (prev && prev.year.length <= 4 && next.month === prev.month && next.day === prev.day) return previous;
    return next.year.slice(0, 4) + "-" + next.month + "-" + next.day;
  }

  function digitCount(year) {
    var n = Number(year);
    if (!n) return 1;
    return String(n).length;
  }

  function isDateSearch(el) {
    if (!el || el.nodeType !== 1 || el.tagName !== "INPUT") return false;
    if (String(el.type || "").toLowerCase() !== "date") return false;
    if (el.hasAttribute("data-date-search")) return true;
    var form = el.form;
    if (!form) return false;
    return /^get$/i.test(form.getAttribute("method") || "");
  }

  var state = new WeakMap();

  function readState(el) {
    var current = state.get(el);
    if (current) return current;
    current = { yearDigits: 0, emptyYearDigits: 0, segment: 0, previous: el.value || "" };
    state.set(el, current);
    return current;
  }

  function noteYearEdit(el) {
    var current = readState(el);
    var proposed = el.value || "";
    var limited = limitValue(current.previous, proposed);
    if (limited !== proposed) {
      el.value = limited;
      current.yearDigits = 4;
      current.emptyYearDigits = 0;
      current.previous = limited;
      return;
    }
    var next = parts(proposed);
    var prev = parts(current.previous);
    if (next && (!prev || (next.month === prev.month && next.day === prev.day && next.year !== prev.year))) {
      if (!prev) current.yearDigits = 1;
      else if (Number(next.year) === Number(prev.year) * 10 + (Number(next.year) % 10)) current.yearDigits += 1;
      else current.yearDigits = digitCount(next.year);
      current.emptyYearDigits = 0;
    }
    current.previous = el.value || "";
  }

  function clearTyping(current) {
    current.yearDigits = 0;
    current.emptyYearDigits = 0;
  }

  document.addEventListener("keydown", function (event) {
    var el = event.target;
    if (!isDateSearch(el)) return;
    var current = readState(el);
    var key = event.key;
    if (key === "ArrowRight") {
      if (current.segment >= 0) current.segment = Math.min(2, current.segment + 1);
      clearTyping(current);
      return;
    }
    if (key === "ArrowLeft") {
      if (current.segment >= 0) current.segment = Math.max(0, current.segment - 1);
      clearTyping(current);
      return;
    }
    if (key === "ArrowUp" || key === "ArrowDown" || key === "Tab" || key === "Backspace" || key === "Delete" || key === "Home" || key === "End") {
      clearTyping(current);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!/^[0-9]$/.test(key)) return;
    current.previous = el.value || "";
    var yearFull = current.yearDigits >= 4;
    var emptyYearFull = current.segment === 2 && !current.previous && current.emptyYearDigits >= 4;
    if (yearFull || emptyYearFull) {
      event.preventDefault();
      return;
    }
    if (current.segment === 2 && !current.previous) current.emptyYearDigits += 1;
  }, true);

  document.addEventListener("input", function (event) {
    if (!isDateSearch(event.target)) return;
    noteYearEdit(event.target);
  }, true);

  document.addEventListener("paste", function (event) {
    var el = event.target;
    if (!isDateSearch(el)) return;
    var text = event.clipboardData ? String(event.clipboardData.getData("text") || "") : "";
    text = text.trim();
    var current = readState(el);
    current.previous = el.value || "";
    var digits = /^(\d{5,})$/.exec(text);
    var iso = /^(\d{5,})-(\d{1,2})-(\d{1,2})$/.exec(text);
    var dmy = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{5,})$/.exec(text);
    if (!digits && !iso && !dmy) {
      clearTyping(current);
      return;
    }
    event.preventDefault();
    var year;
    var month;
    var day;
    var existing = parts(el.value);
    if (digits) {
      if (!existing) return;
      year = digits[1].slice(0, 4);
      month = existing.month;
      day = existing.day;
    } else if (iso) {
      year = iso[1].slice(0, 4);
      month = iso[2].padStart(2, "0");
      day = iso[3].padStart(2, "0");
    } else {
      day = dmy[1].padStart(2, "0");
      month = dmy[2].padStart(2, "0");
      year = dmy[3].slice(0, 4);
    }
    var next = year + "-" + month + "-" + day;
    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) el.value = next;
    current.yearDigits = 4;
    current.emptyYearDigits = 0;
    current.previous = el.value || "";
  }, true);

  document.addEventListener("focusin", function (event) {
    if (!isDateSearch(event.target)) return;
    var current = readState(event.target);
    clearTyping(current);
    current.segment = 0;
    current.previous = event.target.value || "";
  }, true);

  document.addEventListener("pointerdown", function (event) {
    if (!isDateSearch(event.target)) return;
    var current = readState(event.target);
    clearTyping(current);
    current.segment = -1;
  }, true);
})();
