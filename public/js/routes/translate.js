// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// The translate module's page (docs/translating.md), loaded on demand by
// route-modules.js and never while the module is off (app.js).
//   /translate          progress per language; staff also get the review queue
//   /translate/<code>   the keys of one language: English, the shipped value,
//                       and (members) a suggest box with live checks
// Values are painted with textContent; the editor and every translated value
// carry the TARGET language's lang/dir, English stays lang=en dir=ltr.
// Nothing is stored in the browser.
import { api } from "../api.js";
import { addHeading, element, main } from "../dom.js";
import { addText } from "../forms.js";
import { t, tn } from "../i18n.js";
import { state } from "../state.js";
import {
  placeholdersOf, pluralNumbersFor, suggestionProblem, translatableLocale, translateValueMax,
} from "../translate-validate.js";

// Literal keys (the i18n test checks each one exists in every table).
const FILTER_KEYS = Object.freeze({
  all: "translate.filter.all", missing: "translate.filter.missing", mine: "translate.filter.mine",
});
const ERROR_KEYS = Object.freeze({
  placeholders: "translate.error.placeholders", plural: "translate.error.plural", tooLong: "translate.error.tooLong",
  copyOfEnglish: "translate.error.copyOfEnglish", markup: "translate.error.markup",
  filtered: "translate.error.filtered", stale: "translate.error.stale", duplicate: "translate.error.duplicate",
  limit: "translate.error.limit",
});
const isStaffUser = (user) => user?.role === "owner" || user?.role === "admin";
const encode = encodeURIComponent;
let editorSerial = 0;

const errorText = (reason, max) => (Object.hasOwn(ERROR_KEYS, reason) ? t(ERROR_KEYS[reason], { max }) : "");
const failureText = (error) => errorText(error?.reason, error?.max) || error?.message || "";

function textIn(parent, tag, text, className = "", lang = "") {
  const node = addText(document, parent, tag, text, className);
  if (lang) {
    node.setAttribute("lang", lang);
    node.setAttribute("dir", lang === "en" ? "ltr" : translatableLocale(lang)?.dir ?? "ltr");
  }
  return node;
}

function button(label, className, onClick) {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function appLink(href, text) {
  const link = element("a", "", text);
  link.setAttribute("href", href);
  link.setAttribute("data-app-link", "");
  return link;
}

// ---- the overview -----------------------------------------------------------

function progressTable(locales) {
  const table = element("table", "translate-progress");
  const caption = element("caption", "", t("translate.pickLocale"));
  const body = element("tbody");
  for (const locale of locales) {
    const row = element("tr");
    const name = element("th");
    name.setAttribute("scope", "row");
    const link = appLink("/translate/" + locale.code, locale.name);
    link.setAttribute("lang", locale.code);
    name.append(link);
    const cell = element("td", "", t("translate.progress", { done: locale.done, total: locale.total, percent: locale.percent }));
    row.append(name, cell);
    body.append(row);
  }
  table.append(caption, body);
  return table;
}

async function renderOverview(context, version) {
  const data = await api("/api/translate/progress");
  if (version !== state.renderVersion) return;
  addHeading(main, t("translate.title"), 2);
  addText(document, main, "p", t("translate.intro"), "muted");
  addText(document, main, "p", t("translate.exportNote"), "muted");
  if (!context.session.user) addText(document, main, "p", t("translate.signInToHelp"), "muted");
  main.append(progressTable(data.locales));
  if (isStaffUser(context.session.user)) main.append(createQueue(null));
}

// ---- the review queue (staff) -------------------------------------------------

function queueItem(item, list) {
  const row = element("li", "translate-queue-item");
  textIn(row, "p", item.locale + " · " + item.key, "muted");
  if (item.source !== null) textIn(row, "p", item.source, "translate-source", "en");
  textIn(row, "p", item.value, "translate-value", item.locale);
  textIn(row, "p", item.author, "muted");
  if (item.stale) textIn(row, "p", t("translate.staleSource"), "muted");
  const live = element("p", "translate-live");
  live.setAttribute("aria-live", "polite");
  const act = (action) => async () => {
    try {
      await api(`/api/translate/suggestions/${item.id}/review`, { method: "POST", body: { action } });
      row.remove();
      if (!list.children.length) textIn(list, "li", t("translate.empty"), "empty-state");
    } catch (error) {
      live.textContent = failureText(error);
    }
  };
  const approve = button(t("translate.approve"), "button-secondary", act("approve"));
  approve.disabled = item.stale;
  row.append(approve, button(t("translate.reject"), "button-secondary", act("reject")), live);
  return row;
}

function createQueue(code) {
  const section = element("section", "panel translate-queue");
  addHeading(section, t("translate.reviewQueue"), 3);
  const list = element("ul", "translate-queue-list");
  section.append(list);
  const load = async (cursor) => {
    const query = new URLSearchParams({ cursor: String(cursor) });
    if (code) query.set("locale", code);
    const data = await api("/api/translate/review?" + query);
    for (const item of data.items) list.append(queueItem(item, list));
    if (!list.children.length) textIn(list, "li", t("translate.empty"), "empty-state");
    if (data.nextCursor !== null) {
      const more = button(t("translate.loadMore"), "button-secondary", () => { more.remove(); load(data.nextCursor); });
      section.append(more);
    }
  };
  load(0).catch((error) => textIn(section, "p", failureText(error), "error"));
  return section;
}

// ---- one key: suggestions + the suggest box ------------------------------------

function suggestionRow(item, code, staffView, refresh) {
  const row = element("li", "translate-suggestion");
  textIn(row, "span", item.value, "translate-value", code);
  textIn(row, "span", " — " + (item.author ?? t("translate.anonymous")), "muted");
  if (item.stale) textIn(row, "span", " " + t("translate.staleSource"), "muted");
  const live = element("span", "translate-live");
  live.setAttribute("aria-live", "polite");
  const run = (path, options) => async () => {
    try {
      await api(path, options);
      await refresh();
    } catch (error) {
      live.textContent = failureText(error);
    }
  };
  if (item.mine) {
    row.append(button(t("translate.withdraw"), "button-secondary", run(`/api/translate/suggestions/${item.id}`, { method: "DELETE" })));
  }
  if (staffView) {
    const review = (action) => run(`/api/translate/suggestions/${item.id}/review`, { method: "POST", body: { action } });
    const approve = button(t("translate.approve"), "button-secondary", review("approve"));
    approve.disabled = item.stale;
    row.append(approve, button(t("translate.reject"), "button-secondary", review("reject")));
  }
  row.append(live);
  return row;
}

function hints(box, item, code) {
  const names = placeholdersOf(item.source);
  if (names.length) {
    textIn(box, "p", t("translate.placeholders", { list: names.map((name) => "{" + name + "}").join(" ") }), "muted");
  }
  const form = item.key.endsWith(".one") ? "one" : item.key.endsWith(".other") ? "other" : "";
  if (form) textIn(box, "p", t("translate.pluralHelper", { numbers: pluralNumbersFor(code, form).join(", ") }), "muted");
}

function createEditor(item, code, user, onCount) {
  const box = element("div", "translate-editor");
  if (!user) {
    addText(document, box, "p", t("translate.signInToHelp"), "muted");
    return box;
  }
  const list = element("ul", "translate-suggestions");
  const refresh = async () => {
    const data = await api(`/api/translate/${encode(code)}/${encode(item.key)}/suggestions`);
    list.replaceChildren(...data.items.map((entry) => suggestionRow(entry, code, isStaffUser(user), refresh)));
    onCount(data.items.length);
  };
  hints(box, item, code);
  editorSerial += 1;
  const id = "translate-editor-" + editorSerial;
  const label = element("label", "", t("translate.suggestionLabel"));
  label.setAttribute("for", id);
  const input = element("textarea", "translate-input");
  input.id = id;
  input.rows = 2;
  input.maxLength = translateValueMax(item.source);
  input.setAttribute("lang", code);
  input.setAttribute("dir", translatableLocale(code)?.dir ?? "ltr");
  const creditLabel = element("label", "translate-credit");
  const credit = element("input");
  credit.type = "checkbox";
  creditLabel.append(credit, document.createTextNode(" " + t("translate.credit")));
  const live = element("p", "translate-live");
  live.setAttribute("aria-live", "polite");
  const check = () => {
    const problem = suggestionProblem({ key: item.key, value: input.value, source: item.source });
    live.textContent = problem && problem !== "empty" ? errorText(problem, translateValueMax(item.source)) : "";
    return problem;
  };
  const submit = async () => {
    if (check()) return;
    try {
      await api(`/api/translate/${encode(code)}/${encode(item.key)}/suggestions`, {
        method: "POST", body: { value: input.value, sourceHash: item.sourceHash, credit: credit.checked },
      });
      input.value = "";
      live.textContent = t("translate.submitted");
      await refresh();
      input.focus();
    } catch (error) {
      live.textContent = failureText(error);
    }
  };
  input.addEventListener("input", check);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });
  addText(document, box, "p", t("translate.privacyNote"), "muted");
  box.append(list, label, input, creditLabel, button(t("translate.submit"), "button-primary", submit), live);
  refresh().catch((error) => { live.textContent = failureText(error); });
  return box;
}

// ---- one language -----------------------------------------------------------

function keyRow(item, code, user, body) {
  const row = element("tr", item.missing ? "translate-missing" : "");
  const keyCell = element("td");
  textIn(keyCell, "code", item.key);
  const sourceCell = element("td");
  textIn(sourceCell, "span", item.source, "translate-source", "en");
  const valueCell = element("td");
  textIn(valueCell, "span", item.value, "translate-value", code);
  const actionCell = element("td");
  const count = element("span", "muted");
  const paintCount = (n) => { count.textContent = n ? tn("translate.suggestions", n) : ""; };
  if (typeof item.pending === "number") paintCount(item.pending);
  let editorRow = null;
  const toggle = button(t("translate.submit"), "button-secondary", () => {
    if (editorRow) {
      editorRow.remove();
      editorRow = null;
      toggle.setAttribute("aria-expanded", "false");
      return;
    }
    editorRow = element("tr", "translate-editor-row");
    const cell = element("td");
    cell.colSpan = 4;
    cell.append(createEditor(item, code, user, paintCount));
    editorRow.append(cell);
    row.after(editorRow);
    toggle.setAttribute("aria-expanded", "true");
    cell.querySelector("textarea")?.focus();
  });
  toggle.setAttribute("aria-expanded", "false");
  actionCell.append(toggle, count);
  row.append(keyCell, sourceCell, valueCell, actionCell);
  body.append(row);
}

function keysTable() {
  const table = element("table", "translate-keys");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of [t("translate.key"), t("translate.source"), t("translate.current"), ""]) {
    const cell = element("th", "", label);
    cell.setAttribute("scope", "col");
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element("tbody");
  table.append(head, body);
  return { table, body };
}

function controls(user, onChange) {
  const bar = element("div", "translate-controls");
  const filterLabel = element("label", "", t("translate.filterLabel") + " ");
  const filter = element("select");
  for (const value of Object.keys(FILTER_KEYS).filter((name) => name !== "mine" || user)) {
    const option = element("option", "", t(FILTER_KEYS[value]));
    option.value = value;
    filter.append(option);
  }
  filterLabel.append(filter);
  const search = element("input");
  search.type = "search";
  search.setAttribute("aria-label", t("translate.search"));
  search.placeholder = t("translate.search");
  let timer = 0;
  filter.addEventListener("change", () => onChange(filter.value, search.value));
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(filter.value, search.value), 250);
  });
  bar.append(filterLabel, search);
  return bar;
}

async function renderLocale(route, context, version) {
  const locale = translatableLocale(route.locale);
  const user = context.session.user;
  addHeading(main, t("translate.title"), 2);
  if (!locale) {
    addText(document, main, "p", t("translate.empty"), "empty-state");
    main.append(appLink("/translate", t("translate.pickLocale")));
    return;
  }
  const name = addText(document, main, "h3", locale.name);
  name.setAttribute("lang", locale.code);
  main.append(appLink("/translate", t("translate.pickLocale")));
  const status = element("p", "muted");
  status.setAttribute("aria-live", "polite");
  const { table, body } = keysTable();
  const more = element("div", "translate-more");
  let query = { filter: "all", q: "" };
  const load = async (cursor, reset) => {
    const params = new URLSearchParams({ filter: query.filter, q: query.q, cursor: String(cursor) });
    const data = await api(`/api/translate/${encode(locale.code)}/keys?${params}`);
    if (version !== state.renderVersion) return;
    if (reset) body.replaceChildren();
    for (const item of data.items) keyRow(item, locale.code, user, body);
    status.textContent = data.total ? "" : t("translate.empty");
    more.replaceChildren();
    if (data.nextCursor !== null) more.append(button(t("translate.loadMore"), "button-secondary", () => load(data.nextCursor, false)));
  };
  main.append(controls(user, (filter, q) => {
    query = { filter, q: q.trim() };
    load(0, true).catch((error) => { status.textContent = failureText(error); });
  }), status, table, more);
  await load(0, true);
  if (isStaffUser(user) && version === state.renderVersion) main.append(createQueue(locale.code));
}

export async function renderTranslateRoute(route, context, version) {
  if (route.locale) return renderLocale(route, context, version);
  return renderOverview(context, version);
}

