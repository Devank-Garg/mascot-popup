# Mascot Popup — Desktop Scheduler

A lightweight Electron app that pops up your 3D mascot (GLB format) on a
schedule. Frameless, transparent window floating in the corner of your screen.

---

## Quick start

### 1. Add your mascot file

Copy your GLB file into the `assets/` folder and rename it:

```
assets/mascot.glb
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run in development

```bash
npm start
```

The app will appear in your system tray. Right-click the tray icon to
**Show mascot now** (for testing) or to quit.

---

## Changing the schedule

Open `main.js` and edit the `SCHEDULE` constant near the top of the file.
It uses standard cron syntax:

```
'second minute hour day-of-month month day-of-week'
```

| Schedule string        | When it fires                  |
|------------------------|-------------------------------|
| `'0 9 * * 1-5'`        | Every weekday at 9:00 AM       |
| `'0 9 * * *'`          | Every day at 9:00 AM           |
| `'0 9,17 * * *'`       | Daily at 9:00 AM and 5:00 PM   |
| `'0 9 * * 1'`          | Every Monday at 9:00 AM        |
| `'*/1 * * * *'`        | Every minute (for testing)     |

---

## Other settings (also in `main.js`)

| Constant         | Default         | What it controls                                |
|------------------|-----------------|-------------------------------------------------|
| `WINDOW_WIDTH`   | `320`           | Width of the popup window in pixels             |
| `WINDOW_HEIGHT`  | `400`           | Height of the popup window                      |
| `SCREEN_EDGE`    | `'bottom-right'`| Where the window appears on screen              |
| `AUTO_HIDE_MS`   | `8000`          | Milliseconds before auto-dismissing (0 = never) |

---

## Build a distributable .exe

```bash
npm run build
```

The installer will be output to `dist/`. It installs silently and starts
the app automatically. The app runs in the background (system tray only —
no taskbar entry).

---

## File structure

```
mascot-popup/
├── main.js              ← Main process: scheduler, window, tray
├── preload.js           ← Secure IPC bridge
├── renderer/
│   └── index.html       ← Transparent window + Three.js GLB viewer
├── assets/
│   ├── mascot.glb       ← YOUR FILE GOES HERE
│   └── tray-icon.png    ← 16×16 tray icon (replace with your own)
└── package.json
```

---

## Tips

- **Animations**: If your GLB has animation clips, the first one plays
  automatically on popup.
- **Auto-spin**: The model slowly rotates by default. To disable, set
  `controls.autoRotate = false` in `renderer/index.html`.
- **Drag to move**: Click and drag anywhere on the window to reposition it.
- **Close button**: Hover over the window to reveal the × button.
- **Run on Windows startup**: Add a shortcut to the built `.exe` in
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
