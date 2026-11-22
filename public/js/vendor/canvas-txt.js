// src/font.ts
function buildFont({
  fontStyle,
  fontVariant,
  fontWeight,
  fontSize,
  font
}) {
  const family = font.includes(" ") && !/['",]/.test(font) ? `"${font}"` : font;
  let out = "";
  if (fontStyle) out += fontStyle + " ";
  if (fontVariant) out += fontVariant + " ";
  if (fontWeight) out += fontWeight + " ";
  return out + fontSize + "px " + family;
}

// src/wrap.ts
var wordSegmenter;
var graphemeSegmenter;
function segmentWords(text) {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    wordSegmenter ??= new Intl.Segmenter(void 0, { granularity: "word" });
    return Array.from(wordSegmenter.segment(text), (s) => s.segment);
  }
  return text.split(/(\s+)/).filter((s) => s !== "");
}
function segmentGraphemes(text) {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    graphemeSegmenter ??= new Intl.Segmenter(void 0, {
      granularity: "grapheme"
    });
    return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}
function isWhitespaceSegment(segment) {
  if (segment === " ") return true;
  const c = segment.charCodeAt(0);
  if (c > 32 && c !== 160 && c < 5760) return false;
  return segment.trim() === "";
}
function breakToken(token, opts) {
  const { width, measureSeg, measureLine } = opts;
  const parts = [];
  let current = "";
  let currentWidth = 0;
  for (const grapheme of segmentGraphemes(token)) {
    const candidateWidth = measureLine ? measureLine(current + grapheme) : currentWidth + measureSeg(grapheme);
    if (current !== "" && candidateWidth > width) {
      parts.push({ text: current, width: currentWidth });
      current = grapheme;
      currentWidth = measureLine ? measureLine(grapheme) : measureSeg(grapheme);
    } else {
      current += grapheme;
      currentWidth = candidateWidth;
    }
  }
  parts.push({ text: current, width: currentWidth });
  return parts;
}
function wrapParagraph(paragraph, opts) {
  const { width, measureSeg, measureLine } = opts;
  const whole = paragraph.trim();
  if (whole === "") return [{ text: "", width: 0 }];
  if (measureLine) {
    const wholeWidth = measureLine(whole);
    if (wholeWidth <= width) return [{ text: whole, width: wholeWidth }];
  }
  const lines = [];
  let lineText = "";
  let lineWidth = 0;
  let pendingText = "";
  let pendingWidth = 0;
  const flush = () => {
    if (lineText !== "") lines.push({ text: lineText, width: lineWidth });
    lineText = "";
    lineWidth = 0;
    pendingText = "";
    pendingWidth = 0;
  };
  const startLine = (segment, segmentWidth) => {
    if (segmentWidth > width) {
      const parts = breakToken(segment, opts);
      for (const part of parts.slice(0, -1)) lines.push(part);
      const last = parts[parts.length - 1];
      lineText = last.text;
      lineWidth = last.width;
    } else {
      lineText = segment;
      lineWidth = segmentWidth;
    }
  };
  for (const segment of segmentWords(paragraph)) {
    if (isWhitespaceSegment(segment)) {
      if (lineText === "") continue;
      pendingText += segment;
      if (!measureLine) pendingWidth += measureSeg(segment);
      continue;
    }
    const segmentWidth = measureSeg(segment);
    if (lineText === "") {
      startLine(segment, segmentWidth);
      continue;
    }
    const candidateWidth = measureLine ? measureLine(lineText + pendingText + segment) : lineWidth + pendingWidth + segmentWidth;
    if (candidateWidth <= width) {
      lineText += pendingText + segment;
      lineWidth = candidateWidth;
      pendingText = "";
      pendingWidth = 0;
    } else {
      flush();
      startLine(segment, segmentWidth);
    }
  }
  flush();
  if (lines.length === 0) lines.push({ text: "", width: 0 });
  return lines;
}
function wrapText(text, opts) {
  return text.split("\n").map((p) => wrapParagraph(p, opts));
}

// src/cache.ts
var MAX_SEGMENTS_PER_FONT = 1e4;
var segmentCaches = /* @__PURE__ */ new Map();
var metricsCache = /* @__PURE__ */ new Map();
function getSegmentCache(cacheKey) {
  let cache = segmentCaches.get(cacheKey);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    segmentCaches.set(cacheKey, cache);
  }
  return cache;
}
function cacheSegmentWidth(cache, segment, width) {
  if (cache.size >= MAX_SEGMENTS_PER_FONT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(segment, width);
}
function getCachedFontMetrics(cacheKey) {
  return metricsCache.get(cacheKey);
}
function setCachedFontMetrics(cacheKey, metrics) {
  metricsCache.set(cacheKey, metrics);
}
var MAX_RESULTS = 500;
var layoutResults = /* @__PURE__ */ new Map();
var splitResults = /* @__PURE__ */ new Map();
function setWithEviction(map, key, value) {
  if (map.size >= MAX_RESULTS) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
}
function getCachedLayout(key) {
  return layoutResults.get(key);
}
function setCachedLayout(key, layout) {
  setWithEviction(layoutResults, key, layout);
}
function getCachedSplit(key) {
  return splitResults.get(key);
}
function setCachedSplit(key, lines) {
  setWithEviction(splitResults, key, lines);
}
function clearMeasurementCache() {
  segmentCaches.clear();
  metricsCache.clear();
  layoutResults.clear();
  splitResults.clear();
}

// src/layout.ts
var ELLIPSIS = "\u2026";
function resolveConfig(config) {
  return {
    width: config.width,
    height: config.height,
    font: config.font ?? "Arial",
    fontSize: config.fontSize ?? 14,
    fontWeight: config.fontWeight ?? "",
    fontStyle: config.fontStyle ?? "",
    fontVariant: config.fontVariant ?? "",
    lineHeight: config.lineHeight,
    letterSpacing: config.letterSpacing,
    direction: config.direction,
    align: config.align ?? "center",
    vAlign: config.vAlign ?? "middle",
    justify: config.justify ?? false,
    overflow: config.overflow ?? "visible",
    maxLines: config.maxLines,
    cache: config.cache ?? true
  };
}
function fontMetrics(ctx) {
  const m = ctx.measureText("Mg");
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  return { ascent, descent, height: ascent + descent };
}
function ellipsize(line, measure, width) {
  if (measure(line + ELLIPSIS) <= width) return line + ELLIPSIS;
  const graphemes = segmentGraphemes(line);
  while (graphemes.length > 0) {
    graphemes.pop();
    const candidate = graphemes.join("").trimEnd() + ELLIPSIS;
    if (measure(candidate) <= width) return candidate;
  }
  return ELLIPSIS;
}
function justifyWords(line, measure, width) {
  const chunks = line.split(/\s+/).filter(Boolean);
  if (chunks.length < 2) return null;
  const wordWidths = chunks.map(measure);
  const totalWordWidth = wordWidths.reduce((sum, w) => sum + w, 0);
  const gap = (width - totalWordWidth) / (chunks.length - 1);
  if (gap <= 0) return null;
  const words = [];
  let x = 0;
  for (let i = 0; i < chunks.length; i++) {
    words.push({ text: chunks[i], x });
    x += wordWidths[i] + gap;
  }
  return words;
}
function freezeLayout(layout) {
  for (const line of layout.lines) {
    if (line.words) {
      for (const word of line.words) Object.freeze(word);
      Object.freeze(line.words);
    }
    Object.freeze(line);
  }
  Object.freeze(layout.lines);
  return Object.freeze(layout);
}
var KEY_SEP = "";
function layoutMemoKey(text, cfg, font, letterSpacing, direction) {
  return text + KEY_SEP + cfg.width + KEY_SEP + (cfg.height ?? "") + KEY_SEP + font + KEY_SEP + (cfg.lineHeight ?? "") + KEY_SEP + letterSpacing + KEY_SEP + direction + KEY_SEP + cfg.align + KEY_SEP + cfg.vAlign + KEY_SEP + (cfg.justify ? 1 : 0) + KEY_SEP + cfg.overflow + KEY_SEP + (cfg.maxLines ?? "");
}
function layoutText(ctx, text, config) {
  const cfg = resolveConfig(config);
  const font = buildFont(cfg);
  const useCache = cfg.cache !== false;
  const effLetterSpacing = cfg.letterSpacing ?? ctx.letterSpacing ?? "";
  const effDirection = cfg.direction ?? ctx.direction ?? "";
  let memoKey;
  if (useCache) {
    memoKey = layoutMemoKey(text, cfg, font, effLetterSpacing, effDirection);
    const memoized = getCachedLayout(memoKey);
    if (memoized !== void 0) return memoized;
  }
  const prevFont = ctx.font;
  const prevLetterSpacing = ctx.letterSpacing;
  const prevDirection = ctx.direction;
  ctx.font = font;
  if (cfg.letterSpacing !== void 0 && "letterSpacing" in ctx) {
    ctx.letterSpacing = cfg.letterSpacing;
  }
  if (cfg.direction !== void 0 && "direction" in ctx) {
    ctx.direction = cfg.direction;
  }
  try {
    const cacheKey = `${font}|${effLetterSpacing}|${effDirection}`;
    const segmentCache = useCache ? getSegmentCache(cacheKey) : /* @__PURE__ */ new Map();
    const measureSeg = (s) => {
      let w = segmentCache.get(s);
      if (w === void 0) {
        w = ctx.measureText(s).width;
        cacheSegmentWidth(segmentCache, s, w);
      }
      return w;
    };
    let measureLine;
    const lineCache = /* @__PURE__ */ new Map();
    const measureLineExact = (s) => {
      let w = lineCache.get(s);
      if (w === void 0) {
        w = ctx.measureText(s).width;
        lineCache.set(s, w);
      }
      return w;
    };
    if (!useCache) measureLine = measureLineExact;
    const paragraphs = wrapText(text, {
      width: cfg.width,
      measureSeg,
      measureLine
    });
    let flat = paragraphs.flatMap(
      (para) => para.map((line, i) => ({
        text: line.text,
        width: line.width,
        justified: cfg.justify && i < para.length - 1
      }))
    );
    let metrics = useCache ? getCachedFontMetrics(cacheKey) : void 0;
    if (!metrics) {
      metrics = fontMetrics(ctx);
      if (useCache) setCachedFontMetrics(cacheKey, metrics);
    }
    const lineHeight = cfg.lineHeight ?? metrics.height;
    let limit = cfg.maxLines ?? Infinity;
    if (cfg.overflow !== "visible" && cfg.height !== void 0) {
      limit = Math.min(limit, Math.floor(cfg.height / lineHeight));
    }
    let clipped = false;
    if (flat.length > limit) {
      flat = flat.slice(0, Math.max(limit, 0));
      clipped = true;
      if (cfg.overflow === "ellipsis" && flat.length > 0) {
        const last = flat[flat.length - 1];
        last.text = ellipsize(last.text, measureLineExact, cfg.width);
        last.width = measureLineExact(last.text);
        last.justified = false;
      }
    }
    const textHeight = flat.length * lineHeight;
    const boxHeight = cfg.height ?? textHeight;
    let offsetTop = 0;
    if (cfg.vAlign === "middle") offsetTop = (boxHeight - textHeight) / 2;
    else if (cfg.vAlign === "bottom") offsetTop = boxHeight - textHeight;
    const leading = lineHeight - metrics.height;
    let maxWidth = 0;
    const lines = flat.map((line, i) => {
      const words = line.justified ? justifyWords(line.text, measureSeg, cfg.width) : null;
      const width = words ? cfg.width : line.width;
      maxWidth = Math.max(maxWidth, width);
      let x = 0;
      if (cfg.align === "center") x = (cfg.width - width) / 2;
      else if (cfg.align === "right") x = cfg.width - width;
      const y = offsetTop + i * lineHeight + leading / 2 + metrics.ascent;
      return { text: line.text, x, y, width, words };
    });
    const layout = {
      lines,
      width: maxWidth,
      height: textHeight,
      lineHeight,
      font,
      letterSpacing: cfg.letterSpacing,
      direction: cfg.direction,
      clipped
    };
    if (memoKey !== void 0) {
      freezeLayout(layout);
      setCachedLayout(memoKey, layout);
    }
    return layout;
  } finally {
    ctx.font = prevFont;
    if (prevLetterSpacing !== void 0 && "letterSpacing" in ctx) {
      ctx.letterSpacing = prevLetterSpacing;
    }
    if (prevDirection !== void 0 && "direction" in ctx) {
      ctx.direction = prevDirection;
    }
  }
}

// src/draw.ts
function drawTextLayout(ctx, layout, { x, y, style }) {
  const prevFont = ctx.font;
  const prevAlign = ctx.textAlign;
  const prevBaseline = ctx.textBaseline;
  const prevLetterSpacing = ctx.letterSpacing;
  const prevDirection = ctx.direction;
  const prevFill = ctx.fillStyle;
  const prevStroke = ctx.strokeStyle;
  const prevLineWidth = ctx.lineWidth;
  ctx.font = layout.font;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (layout.letterSpacing !== void 0 && "letterSpacing" in ctx) {
    ctx.letterSpacing = layout.letterSpacing;
  }
  if (layout.direction !== void 0 && "direction" in ctx) {
    ctx.direction = layout.direction;
  }
  if (style?.fill !== void 0) ctx.fillStyle = style.fill;
  const stroke = style?.stroke !== void 0 && typeof ctx.strokeText === "function";
  if (stroke) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth ?? 1;
  }
  try {
    for (const line of layout.lines) {
      if (line.words) {
        for (const word of line.words) {
          ctx.fillText(word.text, x + line.x + word.x, y + line.y);
          if (stroke) ctx.strokeText(word.text, x + line.x + word.x, y + line.y);
        }
      } else {
        ctx.fillText(line.text, x + line.x, y + line.y);
        if (stroke) ctx.strokeText(line.text, x + line.x, y + line.y);
      }
    }
  } finally {
    ctx.font = prevFont;
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBaseline;
    if (prevLetterSpacing !== void 0 && "letterSpacing" in ctx) {
      ctx.letterSpacing = prevLetterSpacing;
    }
    if (prevDirection !== void 0 && "direction" in ctx) {
      ctx.direction = prevDirection;
    }
    if (prevFill !== void 0) ctx.fillStyle = prevFill;
    if (prevStroke !== void 0) ctx.strokeStyle = prevStroke;
    if (prevLineWidth !== void 0) ctx.lineWidth = prevLineWidth;
  }
}
var DEBUG_COLOR = "#0C8CE9";
function drawDebug(ctx, config) {
  if (!ctx.strokeRect || !ctx.beginPath || !ctx.moveTo || !ctx.lineTo || !ctx.stroke) {
    return;
  }
  const { x, y, width, height } = config;
  const prevStroke = ctx.strokeStyle;
  const prevLineWidth = ctx.lineWidth;
  const prevAlpha = ctx.globalAlpha;
  ctx.strokeStyle = DEBUG_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width, height);
  const anchorX = config.align === "left" ? x : config.align === "right" ? x + width : x + width / 2;
  const anchorY = config.vAlign === "top" ? y : config.vAlign === "bottom" ? y + height : y + height / 2;
  ctx.setLineDash?.([4, 4]);
  if (prevAlpha !== void 0) ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(anchorX + 0.5, y);
  ctx.lineTo(anchorX + 0.5, y + height);
  ctx.moveTo(x, anchorY + 0.5);
  ctx.lineTo(x + width, anchorY + 0.5);
  ctx.stroke();
  ctx.setLineDash?.([]);
  if (prevAlpha !== void 0) ctx.globalAlpha = prevAlpha;
  if (prevStroke !== void 0) ctx.strokeStyle = prevStroke;
  if (prevLineWidth !== void 0) ctx.lineWidth = prevLineWidth;
}
function drawText(ctx, text, config) {
  const fontSize = config.fontSize ?? 14;
  if (config.width <= 0 || config.height <= 0 || fontSize <= 0) {
    return { height: 0, width: 0, lines: [] };
  }
  const layout = layoutText(ctx, text, config);
  drawTextLayout(ctx, layout, { x: config.x, y: config.y, style: config.style });
  if (config.debug) drawDebug(ctx, config);
  return {
    height: layout.height,
    width: layout.width,
    lines: layout.lines.map((line) => line.text)
  };
}

// src/measure.ts
function measureText(ctx, text, config) {
  const layout = layoutText(ctx, text, config);
  return {
    lines: layout.lines.map((line) => line.text),
    width: layout.width,
    height: layout.height
  };
}
function splitText({
  ctx,
  text,
  width,
  cache = true
}) {
  const stateKey = `${ctx.font}|${ctx.letterSpacing ?? ""}|${ctx.direction ?? ""}`;
  let memoKey;
  if (cache) {
    memoKey = `${stateKey}${width}${text}`;
    const memoized = getCachedSplit(memoKey);
    if (memoized !== void 0) return memoized;
  }
  const segmentCache = cache ? getSegmentCache(stateKey) : /* @__PURE__ */ new Map();
  const measureSeg = (s) => {
    let w = segmentCache.get(s);
    if (w === void 0) {
      w = ctx.measureText(s).width;
      cacheSegmentWidth(segmentCache, s, w);
    }
    return w;
  };
  let measureLine;
  if (!cache) {
    const lineCache = /* @__PURE__ */ new Map();
    measureLine = (s) => {
      let w = lineCache.get(s);
      if (w === void 0) {
        w = ctx.measureText(s).width;
        lineCache.set(s, w);
      }
      return w;
    };
  }
  const lines = wrapText(text, { width, measureSeg, measureLine }).flat().map((line) => line.text);
  if (memoKey !== void 0) {
    setCachedSplit(memoKey, Object.freeze(lines));
  }
  return lines;
}
function getTextHeight({ ctx, text, style }) {
  const prevBaseline = ctx.textBaseline;
  const prevFont = ctx.font;
  ctx.textBaseline = "bottom";
  ctx.font = style;
  const metrics = ctx.measureText(text);
  const height = metrics.fontBoundingBoxAscent !== void 0 && metrics.fontBoundingBoxDescent !== void 0 ? metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent : metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  ctx.textBaseline = prevBaseline;
  ctx.font = prevFont;
  return height;
}
export {
  clearMeasurementCache,
  drawText,
  drawTextLayout,
  getTextHeight,
  layoutText,
  measureText,
  splitText
};
//# sourceMappingURL=index.js.map