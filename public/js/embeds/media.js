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

// Embeds (v5.76): same-origin video and audio. The native element renders
// first (controls, preload="metadata", never autoplay), so the post works
// even if a vendored script never loads. Plyr then skins it with translated
// labels, its icon sprite read from /js/vendor/ (never the Plyr CDN) and its
// volume memory off. HLS playlists play natively where the browser can
// (Safari) and through hls.js elsewhere: the fetch loader (the client stays
// on fetch), no blob worker, and a fetchSetup that refuses any playlist or
// segment URL off the forum's own origin.
import { t } from "../i18n.js";
import { attachWaveform } from "./waveform.js";

export const HLS_SRC = "/js/vendor/hls.light.min.mjs";
export const PLYR_SRC = "/js/vendor/plyr.min.mjs";
export const PLYR_CSS = "/js/vendor/plyr.css";
export const PLYR_ICON_URL = "/js/vendor/plyr.svg";
// Plyr only points a media element here while tearing a source down, which
// the forum never does; it is a same-origin path so even that never leaves
// the site (upstream defaults to the Plyr CDN).
export const PLYR_BLANK_VIDEO = "/js/vendor/plyr-blank.mp4";
export const HLS_MIME = "application/vnd.apple.mpegurl";

const VIDEO_CONTROLS = Object.freeze(["play-large", "play", "progress", "current-time", "mute", "volume", "fullscreen"]);
const AUDIO_CONTROLS = Object.freeze(["play", "progress", "current-time", "mute", "volume"]);

function playerLabels() {
  return {
    play: t("embed.player.play"),
    pause: t("embed.player.pause"),
    mute: t("embed.player.mute"),
    unmute: t("embed.player.unmute"),
    seek: t("embed.player.seek"),
    volume: t("embed.player.volume"),
    currentTime: t("embed.player.currentTime"),
    enterFullscreen: t("embed.player.enterFullscreen"),
    exitFullscreen: t("embed.player.exitFullscreen"),
  };
}

export function plyrOptions(kind) {
  const isAudio = kind === "audio";
  return {
    iconUrl: PLYR_ICON_URL,
    loadSprite: false,
    blankVideo: PLYR_BLANK_VIDEO,
    autoplay: false,
    autopause: true,
    clickToPlay: true,
    controls: [...(isAudio ? AUDIO_CONTROLS : VIDEO_CONTROLS)],
    settings: [],
    keyboard: { focused: true, global: false },
    tooltips: { controls: false, seek: true },
    storage: { enabled: false },
    fullscreen: { enabled: !isAudio, iosNative: true },
    i18n: playerLabels(),
  };
}

// hls.js fetchSetup: every playlist and segment request is resolved against
// the forum's origin and refused (thrown) when it lands anywhere else.
export function sameOriginFetchSetup(origin) {
  const own = new URL(origin).origin;
  return (context, initParams) => {
    const target = new URL(context.url, own);
    if (target.origin !== own) throw new TypeError(target.origin);
    return new Request(target.href, initParams);
  };
}

export function hlsConfig(origin, FetchLoader) {
  return {
    loader: FetchLoader,
    enableWorker: false,
    autoStartLoad: false,
    lowLatencyMode: false,
    fetchSetup: sameOriginFetchSetup(origin),
  };
}

const element = (document, tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function showError(document, figure) {
  if (figure.querySelector?.(".embed-error")) return;
  const note = element(document, "p", "embed-error", t("embed.loadFailed"));
  note.setAttribute("role", "status");
  figure.append(note);
}

function attachHls(document, figure, media, embed, ctx) {
  const native = typeof media.canPlayType === "function" ? media.canPlayType(HLS_MIME) : "";
  if (native) {
    media.setAttribute("src", embed.url);
    return;
  }
  ctx.loader.import(HLS_SRC).then((module) => {
    const Hls = module.default;
    if (!Hls || typeof Hls.isSupported !== "function" || !Hls.isSupported()) {
      showError(document, figure);
      return;
    }
    const hls = new Hls(hlsConfig(ctx.origin, module.FetchLoader));
    hls.attachMedia(media);
    hls.loadSource(embed.url);
    media.addEventListener("play", () => hls.startLoad(), { once: true });
  }, () => showError(document, figure));
}

function skin(media, kind, ctx) {
  ctx.loader.stylesheet(PLYR_CSS);
  ctx.loader.import(PLYR_SRC).then(({ default: Plyr }) => {
    if (typeof Plyr === "function") new Plyr(media, plyrOptions(kind));
  }, () => {
    // The native controls are the designed fallback.
  });
}

export function createMediaPlayer(document, embed, ctx) {
  const isAudio = embed.kind === "audio";
  const figure = element(document, "figure", `embed embed-media embed-${embed.kind}`);
  const media = element(document, isAudio ? "audio" : "video", "embed-media-element");
  media.setAttribute("controls", "");
  media.setAttribute("preload", "metadata");
  if (!isAudio) media.setAttribute("playsinline", "");
  media.addEventListener("error", () => showError(document, figure));
  const caption = element(document, "figcaption", "embed-caption");
  const link = element(document, "a", "embed-original", ctx.label || embed.name);
  link.setAttribute("href", embed.url);
  link.setAttribute("rel", "internal");
  caption.append(link);
  const waveform = isAudio ? element(document, "div", "embed-waveform") : null;
  figure.append(...(waveform ? [waveform] : []), media, caption);
  if (embed.kind === "hls") attachHls(document, figure, media, embed, ctx);
  else media.setAttribute("src", embed.url);
  skin(media, embed.kind, ctx);
  if (waveform) attachWaveform(waveform, media, embed, ctx);
  return figure;
}
