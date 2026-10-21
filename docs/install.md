# Install

## Chrome

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh).

### Load unpacked (development)

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Open your Blackboard Ultra, Canvas or Moodle site and click the Glaze icon.

## Firefox

Install Glaze from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/glaze/).
Version 3.3.2 is available for desktop Firefox 140 or newer and Firefox for Android 142 or newer.

1. Open the listing in Firefox and choose **Add to Firefox**.
2. Review and confirm Firefox's installation prompt, then open Glaze from the Extensions menu.
3. Open your Blackboard Ultra, Canvas or Moodle site and reload. Check Glaze's site access if it does not appear.

The store installation stays installed after Firefox restarts and receives updates through Firefox.
Before replacing a temporary development copy, save **Export settings** and Notes **Export all**,
then import both backups into the store copy. Keep backups private: they include share keys.
Google Calendar sign-in sync is not included in Firefox; calendar-file (.ics) export is available.
Firefox supports declarative mod parts and does not run code mods.

### Temporary installation (development)

From the Firefox compatibility branch, run `sh scripts/package-firefox.sh`, open
`about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick
`dist/glaze-v<version>-firefox.zip`. A temporary add-on is removed when Firefox quits.

For the dedicated Firefox for Android emulator, launcher and validation checklist, see
[Firefox for Android testing](firefox-android.md).

## Safari on Mac

[Download the Mac app](https://github.com/frostdev-ops/glaze/releases/download/v3.3.2/glaze-3.3.2-safari-macos.dmg): signed and notarized, attached to each release on
[GitHub Releases](https://github.com/frostdev-ops/glaze/releases). It runs
on Intel and Apple Silicon Macs with macOS 12 or newer. Glaze's styling needs Safari 17.2 or newer;
the frosted-glass blur needs Safari 18.

1. Open the `.dmg`, open **Glaze** and click **Install Glaze**. It copies itself into Applications
   (your own `~/Applications` if you aren't an administrator) and reopens from there. Dragging it into
   **Applications** works too. (A `.zip` of the same app is there too.)
2. Glaze shows an illustrated guide. Use its button to open Safari's Extensions settings, tick Glaze,
   then allow it on your Blackboard, Canvas or Moodle site. The guide ticks off the first step as soon as Safari turns Glaze on.

The downloaded Mac app checks `https://frostdev.io/projects/glaze/appcast.xml` about once a day
while Glaze is in use and downloads updates from GitHub. Sparkle system profiling is disabled.
Background checks stay silent and skip updates that need user interaction; opening Glaze yourself
can show the standard updater interface. An installation previously prepared through that interface
may still show its existing progress window when a background check finishes it. The Mac App Store
and iPhone/iPad apps use App Store updates and include no Sparkle updater.

Open Glaze to see its installed version and update source. In the downloaded Mac app, **Updates**
lets you check now, choose automatic checks, and choose automatic downloads and installation.
Turning off automatic checks also stops check requests from Safari from starting a check. Update
approvals, when needed, come from macOS and Sparkle during installation. App Store builds instead
offer **Open App Store**; automatic App Store updates are controlled by the system's app-update settings.

The setup app does not need to stay open, launch at login, or use iOS Background App Refresh.
Safari manages the extension's background work. The guide checks extension status only while it is
active and refreshes when you return from Settings. An enabled extension still needs access to your
school's website, in each Safari profile where you use it; private browsing has its own permission.
**Next steps and permissions** explains these controls and how to open the editor's sample page.

## iPhone and iPad

Glaze for Safari on iPhone and iPad needs iOS or iPadOS 18 or newer. It comes from the same App Store
listing as the Mac app; buying or installing on one platform covers the other.

1. Install **Glaze** and open it. It shows a two-step guide.
2. Turn Glaze on in **Settings › Apps › Safari › Extensions › Glaze** by switching on
   **Allow Extension**. On iOS 26.2 and newer, the guide's **Open Settings** button takes you to
   Safari's extension settings, and the guide ticks the step off as soon as Glaze is on.
3. Open your Blackboard Ultra, Canvas or Moodle site in Safari and tap the extensions button in the address bar (a puzzle
   piece; on iPhone it can be in the page menu at the left of the address). Tap **Glaze**, then **Always Allow…** and **Always Allow on This Website**, and reload the page.

The popup and the editor are under the same button. The editor also opens from Settings › Apps › Safari ›
Extensions › Glaze › Settings.
