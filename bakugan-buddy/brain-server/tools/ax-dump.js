#!/usr/bin/env osascript -l JavaScript
// UNVERIFIED macOS automation: dumps the accessibility tree of the FRONTmost
// window as JSON to stdout. computerMac.mjs calls this exactly as
//   osascript -l JavaScript <this file>
// The app that launched the brain proxy (Terminal or the launcher) needs the
// Accessibility permission, otherwise System Events answers with
// "osascript is not allowed assistive access. (-25211)".
// The dump is capped at 80 elements with labels cut to 60 characters.
var se = Application("System Events");
var MAX_ELEMENTS = 80;
var MAX_LABEL = 60;
var MAX_DEPTH = 6;

function labelOf(el) {
  var attrs = ["name", "title", "description", "value", "help"];
  for (var i = 0; i < attrs.length; i++) {
    try {
      var value = el[attrs[i]]();
      if (value && String(value).trim()) return String(value).trim().slice(0, MAX_LABEL);
    } catch (e) {
      /* attribute not present on this element */
    }
  }
  return "";
}

function walk(el, rows, depth) {
  if (rows.length >= MAX_ELEMENTS) return;
  var role = "unknown";
  try {
    role = String(el.role());
  } catch (e) {
    /* keep unknown */
  }
  var x = 0;
  var y = 0;
  var w = 0;
  var h = 0;
  try {
    var pos = el.position();
    x = pos[0];
    y = pos[1];
  } catch (e) {
    /* no position */
  }
  try {
    var size = el.size();
    w = size[0];
    h = size[1];
  } catch (e) {
    /* no size */
  }
  rows.push({
    id: "e" + rows.length,
    role: role.slice(0, 30),
    label: labelOf(el),
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    w: Math.round(Number(w) || 0),
    h: Math.round(Number(h) || 0),
  });
  if (depth >= MAX_DEPTH) return;
  try {
    var children = el.uiElements();
    for (var i = 0; i < children.length && rows.length < MAX_ELEMENTS; i++) {
      walk(children[i], rows, depth + 1);
    }
  } catch (e) {
    /* leaf element */
  }
}

function run() {
  var rows = [];
  try {
    var procs = se.processes.whose({ frontmost: { _equals: true } });
    if (procs.length > 0) {
      var win = procs[0].windows[0];
      if (win) walk(win, rows, 0);
    }
  } catch (e) {
    return JSON.stringify({ elements: [], error: String(e) });
  }
  return JSON.stringify({ elements: rows });
}
