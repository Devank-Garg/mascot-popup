const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const cron = require('node-cron');

let mascotWindow = null;
let tray = null;
let scheduledTask = null;

// ─── Schedule Configuration ───────────────────────────────────────────────
// Edit this to change when the mascot appears.
// Format: 'second minute hour day month weekday'
// Examples:
//   '0 9 * * 1-5'   → Every weekday at 9:00 AM
//   '0 9 * * *'     → Every day at 9:00 AM
//   '0 9,17 * * *'  → Every day at 9:00 AM and 5:00 PM
//   '*/30 * * * *'  → Every 30 minutes (for testing)
const SCHEDULE = '0 9 * * 1-5'; // Weekdays at 9:00 AM

// ─── Window Settings ──────────────────────────────────────────────────────
const WINDOW_WIDTH  = 240;
const WINDOW_HEIGHT = 300;
const SCREEN_EDGE   = 'bottom-right'; // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
const AUTO_HIDE_MS  = 0;             // ms before auto-dismissing (0 = stay until clicked) — 0 for now, mascot always stays up

// ─── Window creation ──────────────────────────────────────────────────────
function createMascotWindow() {
  if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.show();
    mascotWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  const margin = 20;
  const positions = {
    'bottom-right': { x: sw - WINDOW_WIDTH - margin,  y: sh - WINDOW_HEIGHT - margin },
    'bottom-left':  { x: margin,                       y: sh - WINDOW_HEIGHT - margin },
    'top-right':    { x: sw - WINDOW_WIDTH - margin,  y: margin },
    'top-left':     { x: margin,                       y: margin },
  };
  const pos = positions[SCREEN_EDGE] || positions['bottom-right'];

  mascotWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,           // no title bar
    transparent: true,      // transparent background
    alwaysOnTop: true,      // floats above other windows
    skipTaskbar: true,      // doesn't appear in taskbar
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mascotWindow.loadFile('renderer/index.html');

  // Slide in from bottom
  mascotWindow.setOpacity(0);
  mascotWindow.show();
  fadeIn(mascotWindow);

  // Auto-hide after delay
  if (AUTO_HIDE_MS > 0) {
    setTimeout(() => dismissMascot(), AUTO_HIDE_MS);
  }

  mascotWindow.on('closed', () => { mascotWindow = null; });
}

function fadeIn(win, step = 0) {
  if (!win || win.isDestroyed()) return;
  const opacity = Math.min(1, step / 10);
  win.setOpacity(opacity);
  if (step < 10) setTimeout(() => fadeIn(win, step + 1), 30);
}

function fadeOut(win, step = 10) {
  if (!win || win.isDestroyed()) return;
  const opacity = Math.max(0, step / 10);
  win.setOpacity(opacity);
  if (step > 0) {
    setTimeout(() => fadeOut(win, step - 1), 30);
  } else {
    win.close();
  }
}

function dismissMascot() {
  if (mascotWindow && !mascotWindow.isDestroyed()) {
    fadeOut(mascotWindow);
  }
}

// ─── IPC: renderer can ask to dismiss ─────────────────────────────────────
ipcMain.on('dismiss', () => dismissMascot());

// ─── IPC: renderer drags the mascot to move the window ────────────────────
ipcMain.on('move-window', (event, data) => {
  // Defensive: ensure we received numeric dx/dy from the renderer.
  const dx = data && typeof data.dx !== 'undefined' ? Number(data.dx) : 0;
  const dy = data && typeof data.dy !== 'undefined' ? Number(data.dy) : 0;

  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    console.warn('[mascot] Ignoring invalid move-window args:', data);
    return;
  }

  if (mascotWindow && !mascotWindow.isDestroyed()) {
    const [x, y] = mascotWindow.getPosition();
    // Round to integers — some native APIs expect integer pixel positions
    const nx = Math.round(x + dx);
    const ny = Math.round(y + dy);
    try {
      mascotWindow.setPosition(nx, ny);
    } catch (err) {
      console.error('[mascot] Failed to setPosition:', err, 'args:', { x, y, dx, dy, nx, ny });
    }
  }
});

// ─── Tray icon ────────────────────────────────────────────────────────────
function createTray() {
  // Blank 16x16 tray icon (replace tray-icon.png with your own if desired)
  const icon = nativeImage.createFromPath(
    path.join(__dirname, 'assets', 'tray-icon.png')
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Mascot Scheduler');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show mascot now', click: () => createMascotWindow() },
    { type: 'separator' },
    { label: `Schedule: ${SCHEDULE}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => createMascotWindow());
}

// ─── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();

  // For now: mascot stays up all the time, so show it immediately on launch.
  createMascotWindow();

  // Start the scheduler
  scheduledTask = cron.schedule(SCHEDULE, () => {
    console.log(`[mascot] Scheduled trigger: ${new Date().toLocaleTimeString()}`);
    createMascotWindow();
  });

  console.log(`[mascot] Running. Scheduled: "${SCHEDULE}"`);
  console.log('[mascot] Right-click the tray icon to show manually or quit.');
});

app.on('window-all-closed', (e) => {
  // Keep the process alive (tray app — no dock window needed)
  e.preventDefault();
});

app.on('before-quit', () => {
  if (scheduledTask) scheduledTask.stop();
});
