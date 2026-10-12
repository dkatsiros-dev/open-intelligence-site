// Waitlist forms. The page ships a "Request an invite" GitHub link; the forms stay hidden
// until GET /api/waitlist reports {open: true} (storage bound), then submit as JSON
// without a page reload. Any failure leaves or restores the link.
(function () {
  "use strict";

  var API = "/api/waitlist";
  var forms = document.querySelectorAll("[data-waitlist]");
  var links = document.querySelectorAll("[data-waitlist-fallback]");
  if (!forms.length || typeof fetch !== "function") return;

  function show(open) {
    var i;
    for (i = 0; i < forms.length; i++) forms[i].hidden = !open;
    for (i = 0; i < links.length; i++) links[i].hidden = open;
  }

  function status(form, cls, text) {
    var el = form.querySelector(".wl-status");
    el.className = "wl-status" + (cls ? " " + cls : "");
    el.textContent = text;
  }

  var ERRORS = {
    invalid_email: "That email address does not look right.",
    rate_limited: "Too many requests from this network. Please try again in an hour.",
    closed: "The waitlist is closed right now. Please use the invite link instead."
  };

  function submit(e) {
    var form = e.target;
    e.preventDefault();
    var btn = form.querySelector("button[type=submit]");
    var data = {
      email: form.elements.email.value.trim(),
      note: form.elements.note.value.trim(),
      website: form.elements.website.value
    };
    btn.disabled = true;
    status(form, "", "Sending…");
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (res) {
        if (res.r.ok && res.j.ok) {
          form.reset();
          status(form, "ok", "Thanks. You are on the list; we will email you when an invite is ready.");
          return;
        }
        status(form, "err", ERRORS[res.j.error] || "Something went wrong. Please try again later.");
        if (res.j.error === "closed") show(false);
      })
      .catch(function () { status(form, "err", "Could not reach the server. Please try again later."); })
      .then(function () { btn.disabled = false; });
  }

  for (var i = 0; i < forms.length; i++) forms[i].addEventListener("submit", submit);

  fetch(API, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { show(!!(j && j.open === true)); })
    .catch(function () { show(false); });
})();
