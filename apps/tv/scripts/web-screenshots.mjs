#!/usr/bin/env node
/**
 * Drives the Expo web target in headless Chrome at 1920x1080 and saves a screenshot of each screen to
 * docs/screenshots/web-*.png. Pair and Members use the real API; Live/Recap are driven by
 * scripts/publish-synthetic.mjs publishing into a real Session, exactly like a phone would.
 *
 *   yarn dev:web                       # terminal 1 (http://localhost:8082)
 *   node scripts/web-screenshots.mjs   # terminal 2
 *
 * Env: CHROME_PATH (default: macOS Google Chrome), TV_URL (default http://localhost:8082)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../docs/screenshots');
const base = process.env.TV_URL ?? 'http://localhost:8082';
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--hide-scrollbars', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.warn('pageerror:', e.message));
const shot = async (name) => {
  await page.screenshot({ path: join(out, `web-${name}.png`) });
  console.log(`saved web-${name}.png`);
};
const press = async (key, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key);
    await sleep(250);
  }
};

// 1. Members, then Add member modal
await page.goto(base, { waitUntil: 'networkidle2' });
await sleep(2500);
await shot('01-members');
await press('ArrowRight');
await press('Enter');
await sleep(800);
await shot('02-add-member');
await press('Escape');
await sleep(500);

// 2. Pair (real POST /session)
await press('ArrowLeft');
await press('Enter');
await sleep(4000);
await shot('03-pair');

// 3. Live, driven by the synthetic phone
const synthetic = spawn(
  process.execPath,
  [join(here, 'publish-synthetic.mjs'), '--wait', '8', '--reps', '5', '--faults', 'knees_caving', '--end', '--end-delay', '12', '--cue',
    'Good depth. Your knees drifted in on Reps 2 and 4, so push them out over your toes. Same again, and slow the way down.'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
let log = '';
const sessionId = await new Promise((resolve, reject) => {
  synthetic.stdout.on('data', (chunk) => {
    log += chunk;
    process.stdout.write(chunk);
    const m = log.match(/Session ([0-9a-f]{32}) for (.+)/);
    if (m) resolve({ id: m[1], name: m[2] });
  });
  synthetic.on('exit', () => reject(new Error('synthetic phone exited early')));
});
await page.goto(`${base}/?attach=1&s=${sessionId.id}&m=demo&n=${encodeURIComponent(sessionId.name)}`, { waitUntil: 'networkidle2' });
await sleep(1500);
await shot('04-live-ready'); // hello + skeleton, before the Set
const waitFor = async (re, ms) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (re.test(log)) return true;
    await sleep(200);
  }
  return false;
};
await waitFor(/rep 2 /, 40000);
await sleep(900);
await shot('05-live-fault'); // after a rep with a Fault
await press('ArrowDown'); // first D-pad press reveals the End session focus
await shot('06-live-focus');
await waitFor(/set 1 end/, 40000);
await sleep(1200);
await shot('07-live-thinking');
await waitFor(/cue sent/, 20000);
await sleep(1200);
await shot('08-live-cue');
await page.keyboard.press('d'); // debug overlay
await sleep(1200);
await shot('09-live-debug');
await page.keyboard.press('d');
await press('Escape'); // dismiss the Cue
await press('Escape'); // open the confirm dialog
await sleep(600);
await shot('10-live-end-confirm');
await press('Enter'); // Keep going (default)
await sleep(300);
await waitFor(/control end_session sent/, 30000);
await sleep(1500);
await shot('11-recap');

synthetic.kill();
await browser.close();
