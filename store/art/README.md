# Store artwork

Render current Glaze settings and the built-in course previews with invented data:

```sh
glaze-remote -o release/4.0.6/validation/chrome-media-refresh -- node tools/release/store-screenshots.js /out
```

The output includes a 440×280 small tile, 1400×560 marquee, the package's 128×128 icon,
five 1280×800 JPEG screenshots, and `capture.json` identifying the source version and pages.
Review the output before copying it here or uploading it. The renderer uses a disposable
browser profile, blocks outside requests, and closes its browser on success or failure.

`store/promo.html` is the editable source for both tiles. Keep promotional images focused on
the product name, supported platforms and actual interface. Do not add pricing, rankings,
status badges or version claims. Chrome rejected the previous uploaded artwork for its
“Free. Forever.” text (Red Nickel, 2026-11-09). Keep screenshots current when settings change.
