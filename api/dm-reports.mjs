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

// DM reports (v5.18): "Report this conversation". A participant of a 1:1 DM
// thread files a report; that report is the ONLY door through which a DM
// conversation reaches staff review and the AutoMod queue (api/automod.mjs).
//   POST /api/dm/threads/:id/reports {reason}   — participant, CSRF, not banned
//   GET  /api/admin/dm-reports                  — staff: open reports
//   POST /api/admin/dm-reports/:id/resolve      — staff
import { applyWordFilter } from "./filter.mjs";
import { filterWords } from "./filterstore.mjs";
import { assertNotBanned, requireStaff, requireUser } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readJson, requiredText } from "./core/http.mjs";

const REPORT_ROUTE = /^\/api\/dm\/threads\/([0-9]{1,15})\/reports$/;
const RESOLVE_ROUTE = /^\/api\/admin\/dm-reports\/([0-9]{1,15})\/resolve$/;
const REPORT_REASON_MAX = 500;
const DESK_LIMIT = 100;

async function handleReportCreate(request, env, threadId) {
  const session = await requireUser(request, env);
  const viewerId = Number(session.user.id);
  await assertNotBanned(env, viewerId);
  await rateLimit(request, env, "report", String(viewerId));
  const db = env.FORUM_DB;
  const thread = await db.prepare("SELECT id, user_a, user_b FROM dm_threads WHERE id = ? LIMIT 1").bind(threadId).first();
  if (!thread || (Number(thread.user_a) !== viewerId && Number(thread.user_b) !== viewerId)) {
    throw new HttpError(403, "That conversation is not available.");
  }
  const body = await readJson(request);
  const reason = applyWordFilter(requiredText(body.reason, "report reason", REPORT_REASON_MAX), filterWords(env));
  const result = await db.prepare(
    "INSERT OR IGNORE INTO dm_reports (thread_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)",
  ).bind(threadId, viewerId, reason, nowSeconds()).run();
  if (Number(result.meta?.changes) !== 1) {
    throw new HttpError(409, "You already have an open report for this conversation.");
  }
  return json({ ok: true }, 201);
}

async function handleDeskList(request, env) {
  await requireStaff(request, env, false);
  const rows = (await env.FORUM_DB.prepare(
    "SELECT r.id, r.thread_id, r.reason, r.created_at, rep.username AS reporter, " +
      "CASE WHEN t.user_a = r.reporter_id THEN ub.username ELSE ua.username END AS other " +
      "FROM dm_reports r JOIN users rep ON rep.id = r.reporter_id " +
      "JOIN dm_threads t ON t.id = r.thread_id JOIN users ua ON ua.id = t.user_a JOIN users ub ON ub.id = t.user_b " +
      `WHERE r.status = 'open' ORDER BY r.created_at ASC, r.id ASC LIMIT ${DESK_LIMIT}`,
  ).all()).results || [];
  return json({
    dmReports: rows.map((row) => ({
      id: Number(row.id),
      threadId: Number(row.thread_id),
      reporter: row.reporter,
      other: row.other,
      reason: row.reason,
      createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    })),
  });
}

async function handleDeskResolve(request, env, reportId) {
  const session = await requireStaff(request, env);
  await assertNotBanned(env, session.user.id);
  const result = await env.FORUM_DB.prepare(
    "UPDATE dm_reports SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'open'",
  ).bind(nowSeconds(), reportId).run();
  if (Number(result.meta?.changes) !== 1) throw new HttpError(404, "Open report not found.");
  return json({ ok: true });
}

export async function handleDmReportRoutes(request, env, url, path, method) {
  const report = path.match(REPORT_ROUTE);
  if (report && method === "POST") return handleReportCreate(request, env, Number(report[1]));
  if (path === "/api/admin/dm-reports" && method === "GET") return handleDeskList(request, env);
  const resolve = path.match(RESOLVE_ROUTE);
  if (resolve && method === "POST") return handleDeskResolve(request, env, Number(resolve[1]));
  return null;
}
