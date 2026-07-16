const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

let mascotWindow = null;
let tray = null;
let scheduledTasks = [];

// ─── Shared config (config.json at project root) ──────────────────────────
// Holds the appearance schedule, tray name, mascot messages, bubble/model
// tuning — see TECHNICAL.md. Edit that file, not this one, for day-to-day changes.
const DEFAULT_CONFIG = {
  trayName: 'SparkY',
  schedule: [{ days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], time: '09:00' }],
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    const loaded = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...loaded,
      schedule: Array.isArray(loaded.schedule) && loaded.schedule.length
        ? loaded.schedule
        : DEFAULT_CONFIG.schedule,
    };
  } catch (err) {
    console.warn('[mascot] failed to load config.json, using defaults:', err.message);
    return DEFAULT_CONFIG;
  }
}

const config = loadConfig();

// ─── Window Settings ──────────────────────────────────────────────────────
const WINDOW_WIDTH  = 460;
const WINDOW_HEIGHT = 300;
const SCREEN_EDGE   = 'bottom-right'; // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
// Auto-hide is driven by the renderer once it has cycled through every
// configured message (see renderer/index.html's runMessageSequence()).

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

// ─── Scheduling ────────────────────────────────────────────────────────────
// Converts config.json's { days: [...], time: "HH:MM" } entries into cron
// expressions and schedules one node-cron job per entry — this is what lets
// the popup fire on multiple day/time combinations, not just one.
const DAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function dayToCronNum(day) {
  const key = String(day).trim().slice(0, 3).toLowerCase();
  if (!(key in DAY_NUM)) throw new Error(`Unrecognized day name: "${day}"`);
  return DAY_NUM[key];
}

function buildCronExpression({ days, time }) {
  const [hour, minute] = String(time).split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid time "${time}", expected "HH:MM"`);
  }
  const dow = (Array.isArray(days) ? days : [days]).map(dayToCronNum).join(',');
  return `${minute} ${hour} * * ${dow}`;
}

function describeSchedule({ days, time }) {
  const dayList = Array.isArray(days) ? days.join(',') : days;
  return `${dayList} @ ${time}`;
}

function startScheduledTasks() {
  scheduledTasks = config.schedule.map((entry) => {
    try {
      const expr = buildCronExpression(entry);
      return cron.schedule(expr, () => {
        console.log(`[mascot] Scheduled trigger (${describeSchedule(entry)}): ${new Date().toLocaleTimeString()}`);
        createMascotWindow();
      });
    } catch (err) {
      console.error(`[mascot] Skipping invalid schedule entry ${JSON.stringify(entry)}:`, err.message);
      return null;
    }
  }).filter(Boolean);
}

// ─── Tray icon ────────────────────────────────────────────────────────────
function createTray() {
  // Placeholder 16x16 tray icon — replace assets/tray-icon.png with the real
  // SparkY icon whenever it's ready, no code changes needed.
  const icon = nativeImage.createFromPath(
    path.join(__dirname, 'assets', 'tray-icon.png')
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(config.trayName);

  const scheduleItems = config.schedule.map((entry) => ({
    label: describeSchedule(entry),
    enabled: false,
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: config.trayName, enabled: false },
    { type: 'separator' },
    { label: 'Show mascot now', click: () => createMascotWindow() },
    { type: 'separator' },
    { label: 'Schedule:', enabled: false },
    ...scheduleItems,
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => createMascotWindow());
}

// ─── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  startScheduledTasks();

  console.log(`[mascot] ${config.trayName} running. Schedule: ${config.schedule.map(describeSchedule).join(' | ')}`);
  console.log('[mascot] Right-click the tray icon to show manually or quit.');
});

app.on('window-all-closed', (e) => {
  // Keep the process alive (tray app — no dock window needed)
  e.preventDefault();
});

app.on('before-quit', () => {
  scheduledTasks.forEach((task) => task.stop());
});
