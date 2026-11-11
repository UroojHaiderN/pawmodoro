# Pawmodoro

A cute, hand-drawn pomodoro timer with a cat buddy (or a bunny, if you prefer).

- Focus and break timer with paw prints that fill in as you finish sessions
- A task list, and your buddy cheers when you check something off
- Water and stretch nudges that count up while the timer runs
- **Float**: in Chrome or Edge on a computer, the float button pops the timer into a small window that stays on top of every other window and app
- Paper, Night and Glass themes, plus a mini mode
- Installable as an app, and works offline once it has loaded

## Run it locally

It's a static site with no build step:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

- `index.html` is the landing page, with the Mac download and a link to the web app
- `app/index.html` and `app/app.js` are the timer itself: tasks, nudges and the floating window
- `palettes.css` holds the color palettes, shared by both pages
- `sw.js` and `manifest.webmanifest` make the timer installable and offline-friendly
- `icons/` holds the app icons
- `mac/` is the Mac app: a small Swift wrapper around the web app. Build it with `mac/build.sh`
