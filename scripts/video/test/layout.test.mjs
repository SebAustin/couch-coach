import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPTION_TOP, defaultPhoneCrop, splitLayout, tvLayout } from '../lib/layout.mjs';

const bottom = (box) => box.y + box.h;
const even = (n) => n % 2 === 0;

test('defaultPhoneCrop trims the status bar and the Safari bars of an iPhone recording', () => {
  assert.deepEqual(defaultPhoneCrop({ w: 1170, h: 2532 }), { top: 140, bottom: 278, left: 0, right: 0 });
});

test('splitLayout puts an 810 px phone left and a 1400x788 TV right, clear of the caption band', () => {
  const l = splitLayout({ phoneSrc: { w: 1170, h: 2532 } });
  assert.equal(l.phone.h, 810);
  assert.equal(l.phone.w, 448);
  assert.deepEqual({ w: l.tv.w, h: l.tv.h }, { w: 1400, h: 788 });
  assert.equal(l.phone.x, 24);
  assert.equal(l.tv.x, 24 + 448 + 24);
  assert.equal(l.tv.x + l.tv.w, 1920 - 24);
  assert.equal(l.tv.y, l.phone.y);
  assert.ok(bottom(l.phone) <= CAPTION_TOP && bottom(l.tv) <= CAPTION_TOP);
  assert.deepEqual(l.crop, { x: 0, y: 140, w: 1170, h: 2114 });
  for (const box of [l.phone, l.tv]) assert.ok([box.x, box.y, box.w, box.h].every(even), JSON.stringify(box));
  assert.deepEqual(
    l.labels.map((x) => x.text),
    ['PHONE · screen recording', 'FIRE TV · device capture'],
  );
  assert.ok(l.labels.every((x) => x.y + 24 <= l.phone.y));
});

test('splitLayout shrinks the TV when a wider phone crop leaves less room', () => {
  const l = splitLayout({ phoneSrc: { w: 1080, h: 1920 }, crop: { top: 0, bottom: 0, left: 0, right: 0 } });
  assert.equal(l.phone.w, 456);
  assert.ok(l.tv.w < 1400);
  assert.ok(l.tv.x + l.tv.w <= 1920 - 24);
  assert.ok(Math.abs(l.tv.w / l.tv.h - 16 / 9) < 0.01);
});

test('tvLayout centers a 16:9 TV at the top and keeps the caption band free', () => {
  const l = tvLayout();
  assert.deepEqual(l.tv, { x: 192, y: 4, w: 1536, h: 864 });
  assert.ok(bottom(l.tv) <= CAPTION_TOP);
  assert.equal(l.labels.length, 1);
});

test('tvLayout refuses a size that would run into the captions', () => {
  assert.throws(() => tvLayout({ tvW: 1600 }), /caption band/);
});
