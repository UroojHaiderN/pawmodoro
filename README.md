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

- `index.html` holds the page and its styles
- `app.js` holds the timer, tasks, nudges and floating window
- `sw.js` and `manifest.webmanifest` make it installable and offline-friendly
- `icons/` holds the app icons
