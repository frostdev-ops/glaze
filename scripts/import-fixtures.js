// The PDF and picture fixtures for the import tests (W23, test/import.test.js), made headless from the HTML below with
// Chrome's own print to PDF and screenshots, so they can be made again: a typed timetable, a syllabus and a transcript
// (PDF), a syllabus in two columns, the transcript scanned (each page a picture in a PDF, no text layer), the timetable
// as a screenshot (PNG, WebP) and as a phone photo (tilted, soft, JPEG), and behind a password (macOS's PDFKit, through
// swift). The class schedule as it shows on the local Canvas comes from scripts/import-check.js. Every name, school and
// grade here was made up for these tests.
//   NODE_PATH=/path/to/node_modules node scripts/import-fixtures.js   (needs playwright)
//   CHROME=/path/to/chrome runs that browser instead of Chrome for Testing.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.join(__dirname, '../test/fixtures/import');
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const page = (body, css = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><style>
body { margin: 0; padding: 36px 44px; font: 11pt/1.4 Helvetica, Arial, sans-serif; color: #111; background: #fff; }
h1 { font-size: 17pt; margin: 0 0 6px; } h2 { font-size: 12.5pt; margin: 18px 0 6px; } p { margin: 4px 0; }
table { border-collapse: collapse; margin: 6px 0; } th, td { text-align: left; padding: 4px 16px 4px 0; border-bottom: 1px solid #bbb; }
th { font-weight: 700; } ${css}</style><body>${body}</body></html>`;

const TIMETABLE = page(`<h1>Fall 2026 Class Schedule</h1>
<p>Sam Taylor · Student ID 900123456 · Frostdale College</p>
<p>Classes begin August 24, 2026. Last day of classes December 11, 2026.</p>
<table><tr><th>Course</th><th>Title</th><th>Days</th><th>Time</th><th>Location</th></tr>
<tr><td>BIO 1100</td><td>Principles of Biology</td><td>MWF</td><td>9:00 AM - 9:50 AM</td><td>Science Hall 120</td></tr>
<tr><td>BIO 1100L</td><td>Principles of Biology Lab</td><td>T</td><td>2:00 PM - 4:50 PM</td><td>Science Hall 214</td></tr>
<tr><td>ENG 1100</td><td>Composition I</td><td>TR</td><td>11:00 AM - 12:15 PM</td><td>Humanities 302</td></tr>
<tr><td>MATH 1350</td><td>Calculus I</td><td>MTWR</td><td>1:00 PM - 1:50 PM</td><td>Math Building 105</td></tr>
<tr><td>HIST 2010</td><td>World History to 1500</td><td>MW</td><td>3:30 PM - 4:45 PM</td><td>Library 210</td></tr></table>
<p>No classes: Labor Day, September 7, 2026; Thanksgiving break, November 25-27, 2026.</p>`);

const SYLLABUS = page(`<h1>BIO 1100: Principles of Biology, Fall 2026</h1>
<p>Instructor: Dr. Amara Okafor</p><p>Email: aokafor@frostdale.edu</p><p>Office: Science Hall 214</p>
<p>Office hours: Tuesdays and Thursdays 2:00-3:30 PM</p>
<p>Lecture: MWF 9:00-9:50 AM, Science Hall 120</p><p>Lab: Tuesday 2:00-4:50 PM, Science Hall 214</p>
<h2>About the course</h2>
<p>This course introduces the chemistry of life, cells, genetics, evolution and ecology. Each week has three lectures and one
lab. Bring the lab manual to every lab; safety glasses are provided. Readings are listed in the course modules on Canvas.</p>
<h2>Grading</h2>
<table><tr><td>Homework</td><td>20%</td></tr><tr><td>Lab reports</td><td>25%</td></tr><tr><td>Midterm exam</td><td>20%</td></tr><tr><td>Final exam</td><td>35%</td></tr></table>
<h2>Grading scale</h2>
<table><tr><td>A</td><td>93-100</td></tr><tr><td>A-</td><td>90-92.99</td></tr><tr><td>B+</td><td>87-89.99</td></tr><tr><td>B</td><td>83-86.99</td></tr>
<tr><td>B-</td><td>80-82.99</td></tr><tr><td>C</td><td>70-79.99</td></tr><tr><td>D</td><td>60-69.99</td></tr><tr><td>F</td><td>below 60</td></tr></table>
<h2>Important dates</h2>
<p>Midterm exam: Wednesday, October 14, 2026</p><p>Research paper due November 20, 2026</p><p>Final exam: December 15, 2026, 8:00-10:00 AM</p>`);

const TWO_COLUMNS = page(`<h1>HIST 2010 World History to 1500</h1><p>Frostdale College · Fall 2026 · 3 credits</p>
<div class="cols"><p>Instructor: Prof. Daniel Reyes</p><p>E-mail: dreyes@frostdale.edu</p><p>Office: Library 305</p>
<p>Office hours: Monday 1:00-2:30 PM</p><p>Class meetings: MW 3:30-4:45 PM, Library 210</p>
<h2>Course description</h2>
<p>A survey of the world's societies from the first cities to the voyages of the fifteenth century: how people farmed, traded,
prayed, ruled and fought, and how their worlds met. We read sources in translation every week and discuss them in class.
Bring the reading to each meeting.</p>
<h2>Assessment</h2>
<p>Reading responses 15%</p><p>Map quizzes 10%</p><p>Midterm exam 25%</p><p>Research paper 25%</p><p>Final exam 25%</p>
<h2>Grading scale</h2>
<p>A = 94 and above; A- = 90-93; B+ = 87-89; B = 84-86; B- = 80-83; C = 70-79; D = 60-69; F = below 60</p>
<h2>Key dates</h2>
<p>Map quiz: September 16, 2026</p><p>Midterm exam: October 21, 2026</p><p>Research paper due: November 18, 2026</p><p>Final exam: December 14, 2026</p></div>`,
'.cols { columns: 2; column-gap: 36px; } .cols h2:first-child { margin-top: 0; }');

const TRANSCRIPT = page(`<h1>Frostdale College · Unofficial Transcript</h1>
<p>Student: Sam Taylor &nbsp; ID: 900123456 &nbsp; Printed: October 1, 2026</p>
${[['Fall 2025', [['BIO 1000', 'Foundations of Biology', '3.00', 'A-', '11.10'], ['CHEM 1010', 'General Chemistry I', '4.00', 'B+', '13.20'],
  ['ENG 1000', 'Academic Writing', '3.00', 'A', '12.00'], ['MATH 1300', 'Precalculus', '3.00', 'B', '9.00']], '3.48', '13.00'],
['Spring 2026', [['PSY 1010', 'Introduction to Psychology', '3.00', 'A', '12.00'], ['CHEM 1020', 'General Chemistry II', '4.00', 'B', '12.00'],
  ['COMM 1100', 'Public Speaking', '3.00', 'A-', '11.10'], ['MATH 1340', 'Statistics', '3.00', 'B+', '9.90'], ['ART 1050', 'Drawing I', '2.00', 'P', '0.00']], '3.46', '15.00'],
['Summer 2026', [['HIST 1500', 'American History', '3.00', 'A', '12.00']], '4.00', '3.00']]
  .map(([term, rows, gpa, cr]) => `<h2>${term}</h2><table><tr><th>Course</th><th>Title</th><th>Credits</th><th>Grade</th><th>Points</th></tr>
${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table><p>Term GPA: ${gpa} &nbsp; Term credits: ${cr}</p>`).join('\n')}
<p>Cumulative GPA: 3.53 &nbsp; Cumulative credits: 31.00</p>`);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 860, height: 600 }, deviceScaleFactor: 1 });
    const pdf = async (name, html) => {
      await tab.setContent(html);
      await tab.pdf({ path: path.join(out, name), format: 'Letter', margin: { top: '0.4in', bottom: '0.4in', left: '0.3in', right: '0.3in' } });
    };
    await pdf('timetable.pdf', TIMETABLE);
    await pdf('syllabus.pdf', SYLLABUS);
    await pdf('syllabus-2col.pdf', TWO_COLUMNS);
    await pdf('transcript.pdf', TRANSCRIPT);

    // The timetable as a screenshot, as WebP, and as a phone photo: tilted 1.5°, on grey paper, soft, small, JPEG.
    await tab.setContent(TIMETABLE);
    await tab.screenshot({ path: path.join(out, 'timetable.png'), fullPage: true });
    const png = fs.readFileSync(path.join(out, 'timetable.png')).toString('base64');
    const webp = await tab.evaluate(async (src) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.9).split(',')[1];
    }, png);
    fs.writeFileSync(path.join(out, 'timetable.webp'), Buffer.from(webp, 'base64'));
    await tab.setContent(TIMETABLE.replace('<body>', '<body style="background: #c9c4bb; padding: 40px"><div style="background: #f4f1ea; padding: 28px; transform: rotate(1.5deg); filter: blur(0.6px) brightness(0.96); box-shadow: 0 0 30px #8888">').replace('</body>', '</div></body>'));
    await tab.screenshot({ path: path.join(out, 'timetable-photo.jpg'), type: 'jpeg', quality: 50, fullPage: true });

    // The transcript scanned: its page as a picture, a little tilted and grey, printed into a PDF that has no text.
    const shots = [];
    await tab.setViewportSize({ width: 816, height: 1056 });
    const scan = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
    await scan.setContent(TRANSCRIPT.replace('<body>', '<body style="background: #e9e7e2"><div style="filter: blur(0.4px) contrast(0.9); transform: rotate(0.6deg)">').replace('</body>', '</div></body>'));
    shots.push((await scan.screenshot({ type: 'jpeg', quality: 70 })).toString('base64'));
    await scan.close();
    await tab.setContent(`<!doctype html><style>@page { size: Letter; margin: 0 } body { margin: 0 } img { width: 8.5in; height: 11in; display: block }</style>${shots.map((s) => `<img src="data:image/jpeg;base64,${s}">`).join('')}`);
    await tab.pdf({ path: path.join(out, 'transcript-scan.pdf'), format: 'Letter', margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    await browser.close();
  }
  // The timetable behind a password (macOS PDFKit; Chrome can't print one).
  const swift = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-fixtures-')), 'lock.swift');
  fs.writeFileSync(swift, `import PDFKit
let a = CommandLine.arguments
let ok = PDFDocument(url: URL(fileURLWithPath: a[1]))!.write(to: URL(fileURLWithPath: a[2]), withOptions: [.userPasswordOption: "glaze-test", .ownerPasswordOption: "glaze-owner"])
if !ok { fatalError("not written") }\n`);
  try { execFileSync('swift', [swift, path.join(out, 'timetable.pdf'), path.join(out, 'locked.pdf')], { stdio: 'inherit' }); } finally { fs.rmSync(path.dirname(swift), { recursive: true, force: true }); }
  for (const f of fs.readdirSync(out).sort()) console.log(`${f}\t${fs.statSync(path.join(out, f)).size}`);
})().catch((e) => { console.error(e); process.exit(1); });
