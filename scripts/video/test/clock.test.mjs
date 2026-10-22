import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestOffset, makeTvToMac, nsToMs, parseDfAvailableKb, parseIndex } from '../lib/clock.mjs';

const near = (a, b, eps = 0.001) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('nsToMs keeps microsecond precision of a 19-digit nanosecond stamp', () => {
  near(nsToMs('1729512345123456789'), 1729512345123.4568);
  near(nsToMs(' 1729512345000000000\n'), 1729512345000);
});

test('nsToMs rejects anything that is not a nanosecond stamp', () => {
  assert.throws(() => nsToMs('1729512345N'), /not a nanosecond/);
  assert.throws(() => nsToMs('12345'), /not a nanosecond/);
});

test('bestOffset keeps the fastest round trip and measures TV minus the Mac midpoint', () => {
  const r = bestOffset([
    { macBefore: 1000, macAfter: 1100, tvMs: 6060 },
    { macBefore: 2000, macAfter: 2020, tvMs: 7012 },
    { macBefore: 3000, macAfter: 3090, tvMs: 8000 },
  ]);
  assert.equal(r.rttMs, 20);
  assert.equal(r.offsetMs, 5002);
  assert.equal(r.tvMs, 7012);
  assert.equal(r.n, 3);
});

test('bestOffset refuses an empty sample list', () => {
  assert.throws(() => bestOffset([]), /no clock samples/);
});

test('makeTvToMac interpolates drift between the start and stop measurements', () => {
  const tvToMac = makeTvToMac({ start: { offsetMs: 5000, tvMs: 10_000 }, stop: { offsetMs: 5010, tvMs: 20_000 } });
  assert.equal(tvToMac(15_000), 15_000 - 5005);
  assert.equal(tvToMac(10_000), 5000);
});

test('makeTvToMac uses a constant offset when only the start was measured', () => {
  const tvToMac = makeTvToMac({ start: { offsetMs: -250, tvMs: 10_000 } });
  assert.equal(tvToMac(99_000), 99_250);
});

test('parseIndex reads chunk start/end stamps, exit codes and the clock method', () => {
  const index = [
    'clock date',
    'pid 1234',
    '01 1729512345000000000 start',
    '01 1729512515000000000 end 0',
    '02 1729512515200000000 start',
    '02 1729512600000000000 end 130',
    'done 1729512600100000000',
    '',
  ].join('\n');
  const r = parseIndex(index);
  assert.equal(r.method, 'date');
  assert.equal(r.chunks.length, 2);
  assert.deepEqual(r.chunks[0], { name: '01', startTvMs: 1729512345000, endTvMs: 1729512515000, exit: 0 });
  assert.equal(r.chunks[1].startTvMs, 1729512515200);
  assert.equal(r.chunks[1].exit, 130);
  assert.equal(r.doneTvMs, 1729512600100);
});

test('parseIndex leaves endTvMs null for a chunk that is still recording', () => {
  const r = parseIndex('clock epochrealtime\n01 1729512345000000000 start\n');
  assert.equal(r.chunks[0].endTvMs, null);
  assert.equal(r.doneTvMs, null);
});

test('parseDfAvailableKb reads toybox df (1K blocks)', () => {
  const df = 'Filesystem      1K-blocks    Used Available Use% Mounted on\n/dev/fuse         5596440 1234567   4361873  23% /storage/emulated\n';
  assert.equal(parseDfAvailableKb(df), 4361873);
});

test('parseDfAvailableKb reads the older Size/Used/Free df with unit suffixes', () => {
  const df = 'Filesystem               Size     Used     Free   Blksize\n/sdcard                  5.2G     1.1G     4.1G   4096\n';
  assert.equal(parseDfAvailableKb(df), Math.round(4.1 * 1024 * 1024));
});
