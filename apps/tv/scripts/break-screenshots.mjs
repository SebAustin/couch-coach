#!/usr/bin/env node
/**
 * Worst-case ("break-ui") screenshots of the TV screens in headless Chrome at 1920x1080, saved to
 * docs/screenshots/break-*.png. Uses the Expo web target plus the existing synthetic phone, so no new app code and
 * no APK change is needed:
 *
 *   - Members: GET /members is intercepted and answered with long, unbreakable, non-Latin and emoji names, 13 of them.
 *   - Live: 106 Reps, all six Faults on every Rep (Form Score 0), a 40-character unbreakable Member name, a 600-character Cue.
 *   - Live: Form Score 100 (no Faults).
 *   - Recap: 10 Sets and the 600-character Cue as the Coach's note.
 *
 *   yarn dev:web                          # terminal 1 (http://localhost:8082)
 *   node scripts/break-screenshots.mjs    # terminal 2
 *
 * Env: CHROME_PATH (default: macOS Google Chrome), TV_URL (default http://localhost:8082)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../docs/screenshots');
const base = process.env.TV_URL ?? 'http://localhost:8082';
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const apiBase = /"apiBaseUrl":\s*"([^"]+)"/.exec(
  readFileSync(join(here, '../packages/shared-ui/src/config.generated.ts'), 'utf8'),
)?.[1];
if (!apiBase) throw new Error('apiBaseUrl not found in config.generated.ts (run yarn sync)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

const LONG_NAME = 'Supercalifragilisticexpialidocious_Xy'; // 37 characters, no break opportunity
const FORTY = 'Wolfeschlegelsteinhausenbergerdorff0123'; // 40 characters, no break opportunity
const CUE_600 =
  'Strong work on that Set. Your depth was good on the first few Reps, and then it faded: Reps 40 to 70 stopped above parallel, ' +
  'and from there your knees drifted in on almost every Rep, which is what dragged the Form Score down. Next time, start the ' +
  'Set a little slower so you have something left at the end, push your knees out over your toes as you sit back, and keep ' +
  'your chest tall rather than folding forward. If your heels start to lift, narrow the stance a touch and think about ' +
  'pressing through the whole foot. Take a full minute of rest, shake out your legs, and we will go again with a shorter ' +
  'Set of ten so every Rep is a good one.'; // 640 characters
const MEMBER_NAMES = [
  'Maya', 'Jon', LONG_NAME, '王小明', 'محمد علي', '\u{1F3CB}\u{FE0F} Lifter',
  '\u{1F984}\u{1F984}\u{1F984}', 'Σωκράτης Παπαδόπουλος',
  'Alex', 'Sam', 'Priya', 'Chen', 'Zoe',
];

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--hide-scrollbars', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1920, height: 1080 },
});

async function newPage(members) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('pageerror:', e.message));
  if (members) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().startsWith(`${apiBase}/members`)) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ members }),
        });
      } else {
        req.continue();
      }
    });
  }
  return page;
}

const shot = async (page, name) => {
  await page.screenshot({ path: join(out, `break-${name}.png`) });
  console.log(`saved break-${name}.png`);
};

// ---- 1. Members ------------------------------------------------------------------------------------------
const now = Date.now();
const asMembers = (names) =>
  names.map((name, i) => ({ memberId: `m${i}`, name: name.slice(0, 40), lastSeenAt: now - i * 3_600_000 }));
{
  const page = await newPage(asMembers(MEMBER_NAMES)); // 13 Members: 11 shown compactly plus the "most recent" note
  await page.goto(base, { waitUntil: 'networkidle2' });
  await sleep(2500);
  await shot(page, '01-members-13');
  await page.close();
}
{
  const page = await newPage(asMembers([FORTY, LONG_NAME, '\u{1F3CB}\u{FE0F} Lifter', '王小明', 'Alex', 'Sam', 'Priya']));
  await page.goto(base, { waitUntil: 'networkidle2' });
  await sleep(2500);
  await page.keyboard.press('ArrowDown'); // focus moves down a row and keeps its column
  await sleep(500);
  await shot(page, '02-members-7-long-names');
  await page.close();
}

// ---- Live and Recap, driven by the synthetic phone ---------------------------------------------------------
async function withPhone(syntheticArgs, run) {
  const phone = spawn(process.execPath, [join(here, 'publish-synthetic.mjs'), ...syntheticArgs], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let log = '';
  const session = await new Promise((resolve, reject) => {
    phone.stdout.on('data', (chunk) => {
      log += chunk;
      const m = log.match(/Session ([0-9a-f]{32}) for (.+)/);
      if (m) resolve({ id: m[1] });
    });
    phone.on('exit', () => reject(new Error('synthetic phone exited early')));
  });
  const waitFor = async (re, ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (re.test(log)) return true;
      await sleep(200);
    }
    return false;
  };
  try {
    await run({ session, waitFor });
  } finally {
    phone.kill();
  }
}

const attachUrl = (id, name) => `${base}/?attach=1&s=${id}&m=demo&n=${encodeURIComponent(name)}`;

// 2. Live: 106 Reps (3 digits), all six Faults on every Rep (Form Score 0), a 40-character name, then a 600-character Cue.
await withPhone(
  ['--wait', '8', '--reps', '106', '--rep-seconds', '0.2', '--faults',
   'shallow_depth,knees_caving,torso_lean,heels_rising,arms_not_overhead,feet_not_wide', '--every-rep',
   '--end-delay', '30', '--cue', CUE_600],
  async ({ session, waitFor }) => {
    const page = await newPage(null);
    await page.goto(attachUrl(session.id, FORTY), { waitUntil: 'networkidle2' });
    await sleep(1500);
    await waitFor(/rep 106 /, 120_000);
    await sleep(1200);
    await shot(page, '03-live-106reps-6faults-score0');
    await waitFor(/cue sent/, 40_000);
    await sleep(1500);
    await shot(page, '04-live-cue-600-chars');
    await page.close();
  },
);

// 3. Live: Form Score 100 (no Faults) and a lone Rep count.
await withPhone(['--wait', '8', '--reps', '4', '--faults', '', '--end-delay', '4'], async ({ session, waitFor }) => {
  const page = await newPage(null);
  await page.goto(attachUrl(session.id, 'Maya'), { waitUntil: 'networkidle2' });
  await sleep(1500);
  await waitFor(/rep 4 /, 60_000);
  await sleep(1200);
  await shot(page, '05-live-score-100');
  await page.close();
});

// 4. Recap: 10 Sets, long name, 600-character Coach's note.
await withPhone(
  ['--wait', '8', '--sets', '10', '--reps', '3', '--rep-seconds', '0.3', '--faults', 'knees_caving,torso_lean',
   '--end', '--end-delay', '0', '--cue', CUE_600],
  async ({ session, waitFor }) => {
    const page = await newPage(null);
    await page.goto(attachUrl(session.id, FORTY), { waitUntil: 'networkidle2' });
    await sleep(1500);
    await waitFor(/control end_session sent/, 180_000);
    await sleep(2000);
    await shot(page, '06-recap-10-sets-600-char-note');
    await page.close();
  },
);

await browser.close();
