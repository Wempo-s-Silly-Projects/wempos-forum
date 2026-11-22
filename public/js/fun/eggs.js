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

// Easter eggs (Batch M #7), behind one "Easter eggs" switch: typing the
// Konami code anywhere outside a text field opens a Matter.js gravity toy
// (forum-coloured balls tumbling in a box) with a fairy-dust cursor trail
// (cursor-effects). Close or Escape removes both completely. One keydown
// listener asks the switch at key time, so turning it off needs no reload;
// reduced motion never starts anything that moves. No Oneko cat: its sprite
// art carries no AGPL-compatible licence, so it is not vendored.
import { t } from "../i18n.js";
import { ensureFunStyles } from "./loader.js";
import { isFunOn, prefersReducedMotion } from "./settings.js";

// Mirrors constants.mjs (pinned equal by tests/batch-m-fun.test.mjs).
export const FUN_GRAVITY_BODIES_MAX = 24;
export const KONAMI = Object.freeze([
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
]);
const TOY_WIDTH = 360;
const TOY_HEIGHT = 300;
const WALL = 20;
const BALL_COLORS = Object.freeze(["#e8a33d", "#5b8def", "#e25d7a", "#4fb39a", "#9a6fd8"]);
const ESCAPE = "Escape";

const isTypingTarget = (target) => {
  const tag = String(target?.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
};

// A matcher fed one key at a time; true when the last keys spell KONAMI.
export function konamiMatcher() {
  let position = 0;
  return (key) => {
    const expected = KONAMI[position];
    const pressed = key.length === 1 ? key.toLowerCase() : key;
    if (pressed === expected) position += 1;
    else position = pressed === KONAMI[0] ? 1 : 0;
    if (position < KONAMI.length) return false;
    position = 0;
    return true;
  };
}

function createToyOverlay(doc) {
  const overlay = doc.createElement("section");
  overlay.className = "fun-toy";
  overlay.setAttribute("aria-label", t("fun.toyTitle"));
  const canvas = doc.createElement("canvas");
  canvas.className = "fun-toy-canvas";
  canvas.width = TOY_WIDTH;
  canvas.height = TOY_HEIGHT;
  canvas.setAttribute("aria-hidden", "true");
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "button button-secondary fun-toy-close";
  close.textContent = t("common.close");
  overlay.append(canvas, close);
  return { overlay, canvas, close };
}

function buildWorld(Matter, canvas) {
  const { Bodies, Composite, Engine, Render, Runner } = Matter;
  const engine = Engine.create();
  const render = Render.create({
    canvas, engine, options: { width: TOY_WIDTH, height: TOY_HEIGHT, wireframes: false, background: "transparent" },
  });
  const walls = [
    Bodies.rectangle(TOY_WIDTH / 2, TOY_HEIGHT + WALL / 2, TOY_WIDTH, WALL, { isStatic: true }),
    Bodies.rectangle(-WALL / 2, TOY_HEIGHT / 2, WALL, TOY_HEIGHT, { isStatic: true }),
    Bodies.rectangle(TOY_WIDTH + WALL / 2, TOY_HEIGHT / 2, WALL, TOY_HEIGHT, { isStatic: true }),
  ];
  const balls = Array.from({ length: FUN_GRAVITY_BODIES_MAX }, (_, index) => Bodies.circle(
    WALL + ((index * 53) % (TOY_WIDTH - 2 * WALL)), -index * 18, 10 + (index % 3) * 4,
    { restitution: 0.6, render: { fillStyle: BALL_COLORS[index % BALL_COLORS.length] } },
  ));
  Composite.add(engine.world, walls);
  Composite.add(engine.world, balls);
  const runner = Runner.create();
  Render.run(render);
  Runner.run(runner, engine);
  return () => {
    Runner.stop(runner);
    Render.stop(render);
    Composite.clear(engine.world, false);
    Engine.clear(engine);
  };
}

// Opens the toy; resolves to a stop() that removes every trace.
export async function startParty(env) {
  const { doc } = env;
  const [Matter, cursorEffects] = await Promise.all([env.load("matter"), env.load("cursorEffects")]);
  ensureFunStyles(doc);
  const { overlay, canvas, close } = createToyOverlay(doc);
  doc.body.append(overlay);
  const stopWorld = buildWorld(Matter, canvas);
  const trail = cursorEffects.fairyDustCursor({ colors: BALL_COLORS });
  let stopped = false;
  const onKey = (event) => { if (event.key === ESCAPE) stop(); };
  function stop() {
    if (stopped) return;
    stopped = true;
    doc.removeEventListener("keydown", onKey);
    stopWorld();
    trail?.destroy?.();
    overlay.remove();
  }
  close.addEventListener("click", stop);
  doc.addEventListener("keydown", onKey);
  close.focus?.();
  return stop;
}

// Installs the one Konami listener; returns its remover.
export function installEasterEggs(env) {
  const matches = konamiMatcher();
  let running = null;
  const start = env.start ?? (() => startParty(env));
  const onKey = (event) => {
    if (isTypingTarget(event.target) || typeof event.key !== "string") return;
    if (!matches(event.key) || running || env.doc.body?.querySelector?.(".fun-toy")) return;
    if (!isFunOn("easterEggs", env.storage) || prefersReducedMotion(env.win)) return;
    running = Promise.resolve(start()).catch(() => null).finally(() => { running = null; });
  };
  env.doc.addEventListener("keydown", onKey);
  return () => env.doc.removeEventListener("keydown", onKey);
}
