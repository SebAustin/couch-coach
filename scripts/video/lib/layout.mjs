/**
 * Frame geometry for the composed clips (1920x1080). Everything stays above CAPTION_TOP so the burned-in
 * captions sit on the plain background. All boxes use even pixel values (yuv420p).
 *   split: phone on the left, 810 px tall (status bar and Safari bars cropped), Fire TV on the right ~1400x788.
 *   tv:    Fire TV alone, 1536x864 at the top (1600x900 would run 30 px into the caption band).
 */
export const CANVAS = { w: 1920, h: 1080 };
export const CAPTION_TOP = 870;
export const PHONE_LABEL = 'PHONE · screen recording';
export const TV_LABEL = 'FIRE TV · device capture';

const PANEL_TOP = 48; // leaves a label row above the panels
const LABEL_ABOVE = 34; // label baseline box sits this far above its panel
const MIN_MARGIN = 24;

export const even = (n) => 2 * Math.round(n / 2);

/** Status bar (~5.5%) and Safari's bottom toolbar + home indicator (~11%) of a portrait iPhone recording. */
export function defaultPhoneCrop({ h }) {
  return { top: even(h * 0.055), bottom: even(h * 0.11), left: 0, right: 0 };
}

/**
 * @param {{ phoneSrc: { w: number, h: number }, crop?: { top: number, bottom: number, left: number, right: number },
 *           phoneH?: number, tvW?: number }} opts
 */
export function splitLayout({ phoneSrc, crop = defaultPhoneCrop(phoneSrc), phoneH = 810, tvW = 1400 }) {
  const c = { x: crop.left, y: crop.top, w: phoneSrc.w - crop.left - crop.right, h: phoneSrc.h - crop.top - crop.bottom };
  if (c.w <= 0 || c.h <= 0) throw new Error(`phone crop leaves nothing: ${JSON.stringify(crop)}`);
  const phoneW = even((phoneH * c.w) / c.h);
  const tvWidth = even(Math.min(tvW, CANVAS.w - phoneW - 3 * MIN_MARGIN));
  const tvH = even((tvWidth * 9) / 16);
  const margin = Math.floor((CANVAS.w - phoneW - tvWidth) / 3 / 2) * 2;
  const phone = { x: margin, y: PANEL_TOP, w: phoneW, h: phoneH };
  const tv = { x: margin + phoneW + margin, y: PANEL_TOP, w: tvWidth, h: tvH };
  if (phone.y + phone.h > CAPTION_TOP || tv.y + tv.h > CAPTION_TOP) throw new Error('split layout runs into the caption band');
  return {
    layout: 'split',
    canvas: CANVAS,
    captionTop: CAPTION_TOP,
    crop: c,
    phone,
    tv,
    labels: [
      { text: PHONE_LABEL, x: phone.x, y: phone.y - LABEL_ABOVE },
      { text: TV_LABEL, x: tv.x, y: tv.y - LABEL_ABOVE },
    ],
  };
}

export function tvLayout({ tvW = 1536 } = {}) {
  const w = even(tvW);
  const h = even((w * 9) / 16);
  if (h > CAPTION_TOP) throw new Error(`a ${w}x${h} TV runs into the caption band (y > ${CAPTION_TOP})`);
  const tv = { x: even((CANVAS.w - w) / 2), y: even((CAPTION_TOP - h) / 2), w, h };
  return {
    layout: 'tv',
    canvas: CANVAS,
    captionTop: CAPTION_TOP,
    tv,
    // In the left margin, top-aligned with the panel: there is no room above a full-height TV.
    labels: [{ text: TV_LABEL, x: Math.max(16, tv.x - 168), y: tv.y + 8, w: Math.min(152, tv.x - 32), stacked: true }],
  };
}
