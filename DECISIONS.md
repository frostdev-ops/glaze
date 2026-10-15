

## Insights (W17, Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Glaze's own design, from data the student already has: Canvas's on-time/late/missing/excused flags, grades by lib/gradecalc.js, Better To Do's plans and the streak's best | another extension's "Wrapped" (hosted, contents unknown); minutes spent, time-of-day habits | No new tracking. Canvas's own flags (extensions and late policies included) decide "on time"; Glaze doesn't second-guess them. |
| A course's trend is Canvas's current score recomputed after each graded item, in due-date order, one point a day; with a current grading period, each period's own score (each starts afresh), and First, Now and Change are the current period's | Raw item percentages; one line across periods | The line ends on the grade Canvas shows (its current score is the current period's), and weights and drops apply from the first point. Letters-only courses show no numbers (Codex W17 review). |
| One small record per site and user (`insights:<origin>/<uid>`), one term at a time, written through the broker ('glaze:insights') with its fetch time and a clear watermark; reused for six hours. The newest answer wins whatever its term | Re-asking Canvas on every open; a record per term | Opens at once; a slow answer from another tab (another term's too) can't overwrite a newer one or bring back what was cleared. Only the current term is shown, so older terms aren't worth keeping. |
| Caps far above a real course (100 courses, 2,000 items, 400 grade points); anything a cap or Canvas's paging leaves out is counted and the view names it | Small caps (300 items) | A capped list silently changed the shares (Codex W17 review). |
| Every request refuses redirects and is made only while Insights is on and its view's load is current; a next page only on this site. A course that can't be read keeps the saved summary | Following redirects; checking only between courses | Nothing leaves the student's Canvas, and turning Insights off stops it at once (Codex W17 review). |
| A plan is kept when the work was handed in or ticked off by the end of its day (focus sessions: the last one's day); ticks with no known time are left out | Counting a plan as kept when work met its due date | That is what a plan promises; unknown times can't be judged honestly. |
| Weeks start on Monday | Following Better To Do's week start | One rule for now; revisit if students ask. |
| The PNG is drawn on a canvas in the palette's colors and saved through a blob link, only on a trusted click with user activation | An SVG-to-image export; a data: URL | No data: URLs in the page; a script can't start a download. |
