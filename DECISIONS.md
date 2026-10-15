

## Insights (W17, Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Glaze's own design, from data the student already has: Canvas's on-time/late/missing/excused flags, grades by lib/gradecalc.js, Better To Do's plans and the streak's best | another extension's "Wrapped" (hosted, contents unknown); minutes spent, time-of-day habits | No new tracking. Canvas's own flags (extensions and late policies included) decide "on time"; Glaze doesn't second-guess them. |
| A course's trend is Canvas's current score recomputed after each graded item, in due-date order, one point a day | Raw item percentages | The line ends on the grade Canvas shows, and weights and drops apply from the first point. Letters-only courses show no numbers. |
| One small record per site and user (`insights:<origin>/<uid>`), this term's only, written through the broker ('glaze:insights') with its fetch time and a clear watermark; reused for six hours | Re-asking Canvas on every open; no cache | Opens at once; a slow answer from another tab can't overwrite a newer one or bring back what was cleared. |
| A plan is kept when the work was handed in or ticked off by the end of its day (focus sessions: the last one's day); ticks with no known time are left out | Counting a plan as kept when work met its due date | That is what a plan promises; unknown times can't be judged honestly. |
| Weeks start on Monday | Following Better To Do's week start | One rule for now; revisit if students ask. |
| The PNG is drawn on a canvas in the palette's colors and saved through a blob link, only on a trusted click with user activation | An SVG-to-image export; a data: URL | No data: URLs in the page; a script can't start a download. |
