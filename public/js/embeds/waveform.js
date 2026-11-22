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

// Embeds (v5.76): a clickable waveform over same-origin audio. WaveSurfer
// decodes the file itself in the browser (Web Audio) and drives the same
// <audio> element Plyr skins, so seeking on either stays in sync. The strip
// is aria-hidden: Plyr's seek slider is the keyboard and screen-reader
// control, the waveform a pointer shortcut onto the same timeline. Its one
// shadow <style> is admitted by a CSP hash (constants.mjs).
export const WAVESURFER_SRC = "/js/vendor/wavesurfer.esm.js";
export const WAVEFORM_HEIGHT = 56;

const FALLBACK_WAVE = "#52606f";
const FALLBACK_PROGRESS = "#397357";

// Canvas colours cannot be var(); read the themed custom properties.
function waveColors(container) {
  const style = typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle(container) : null;
  const read = (name, fallback) => style?.getPropertyValue?.(name)?.trim() || fallback;
  return {
    waveColor: read("--embed-wave", FALLBACK_WAVE),
    progressColor: read("--embed-wave-progress", FALLBACK_PROGRESS),
    cursorColor: read("--embed-wave-progress", FALLBACK_PROGRESS),
  };
}

export function attachWaveform(container, media, embed, ctx) {
  container.setAttribute("aria-hidden", "true");
  ctx.loader.import(WAVESURFER_SRC).then(({ default: WaveSurfer }) => {
    if (!WaveSurfer || typeof WaveSurfer.create !== "function") throw new TypeError(WAVESURFER_SRC);
    WaveSurfer.create({
      container,
      media,
      url: embed.url,
      height: WAVEFORM_HEIGHT,
      ...waveColors(container),
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      interact: true,
      dragToSeek: true,
      autoScroll: false,
      autoCenter: false,
    });
  }).catch(() => {
    container.hidden = true;
  });
}
