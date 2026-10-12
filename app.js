// Live network panel. Endpoints may not exist yet: any failure (404, CORS,
// network, unexpected shape) falls back to a quiet "unavailable" state.
(function () {
  "use strict";

  var API = "https://api.open-intelligence.space/v1";
  var TIMEOUT_MS = 6000;

  function getJSON(path) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(API + path, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function fmt(v) {
    if (typeof v === "number" && isFinite(v)) {
      return Number.isInteger(v) ? v.toLocaleString("en-US") : String(Math.round(v * 1e4) / 1e4);
    }
    if (typeof v === "string" && v) return v;
    return null;
  }

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (obj && obj[keys[i]] !== undefined && obj[keys[i]] !== null) return obj[keys[i]];
    }
    return undefined;
  }

  function count(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return pick(v, ["total", "count"]);
    return v;
  }

  function setStat(name, value) {
    var el = document.querySelector('[data-stat="' + name + '"]');
    if (!el) return;
    el.textContent = fmt(value) || "—";
  }

  function setState(ok, msg) {
    var state = document.getElementById("net-state");
    var m = document.getElementById("net-msg");
    if (state) state.classList.toggle("off", !ok);
    if (m) m.textContent = msg;
  }

  function emptyRow(tbody, text) {
    tbody.textContent = "";
    var tr = document.createElement("tr");
    tr.className = "empty";
    var td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = text;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function rowsFrom(data) {
    if (Array.isArray(data)) return data;
    var r = pick(data, ["leaderboard", "entries", "rows", "items", "results"]);
    return Array.isArray(r) ? r : null;
  }

  function renderLeaderboard(data) {
    var tbody = document.querySelector("#leaderboard tbody");
    if (!tbody) return;
    var rows = rowsFrom(data);
    if (!rows) throw new Error("unexpected leaderboard shape");
    if (!rows.length) { emptyRow(tbody, "No verified scores yet."); return; }
    tbody.textContent = "";
    rows.slice(0, 20).forEach(function (row) {
      var tr = document.createElement("tr");
      var cells = [
        [fmt(pick(row, ["problem", "problem_id", "problem_name", "name"])) || "—", ""],
        [fmt(pick(row, ["node", "node_id", "node_label", "label"])) || "—", "mono"],
        [fmt(pick(row, ["verified_score", "best_score", "score"])) || "—", "num"]
      ];
      cells.forEach(function (c) {
        var td = document.createElement("td");
        td.textContent = c[0];
        if (c[1]) td.className = c[1];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function unavailable() {
    ["nodes", "problems", "submissions", "best"].forEach(function (k) { setStat(k, null); });
    var tbody = document.querySelector("#leaderboard tbody");
    if (tbody) emptyRow(tbody, "Leaderboard unavailable right now.");
    setState(false, "Network stats unavailable.");
  }

  if (typeof fetch !== "function") { unavailable(); return; }

  Promise.all([getJSON("/stats"), getJSON("/leaderboard").catch(function () { return null; })])
    .then(function (res) {
      var s = res[0] || {};
      var nodes = count(pick(s, ["nodes", "node_count", "active_nodes"]));
      var problems = count(pick(s, ["problems", "problem_count"]));
      var subs = count(pick(s, ["submissions", "submission_count"]));
      if (nodes === undefined && problems === undefined && subs === undefined) throw new Error("unexpected stats shape");
      setStat("nodes", nodes);
      setStat("problems", problems);
      setStat("submissions", subs);
      setState(true, "Stats from the coordinator.");

      var lb = res[1] || pick(s, ["best_scores", "leaderboard"]);
      var best = lb ? rowsFrom(lb) : null;
      setStat("best", best ? best.length : count(pick(s, ["best_scores"])));
      try {
        renderLeaderboard(lb);
      } catch (e) {
        var tbody = document.querySelector("#leaderboard tbody");
        if (tbody) emptyRow(tbody, "Leaderboard unavailable right now.");
      }
    })
    .catch(unavailable);
})();
