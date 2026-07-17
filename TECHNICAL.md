# Technical Overview

How the pieces of Mascot Popup fit together, and which library is responsible for what.

## Architecture at a glance

```
main.js (Electron main process)
  ├─ creates a frameless, transparent, always-on-top BrowserWindow
  ├─ positions it at a screen corner
  ├─ schedules when it appears (node-cron)
  └─ owns the tray icon / app lifecycle

preload.js (contextBridge)
  └─ exposes a minimal `window.mascot` API to the renderer
     (dismiss, moveWindow) — the only channel between the two worlds

renderer/index.html (Electron renderer process)
  ├─ Three.js: loads/renders the 3D mascot (assets/color_model.glb)
  └─ plain HTML/CSS: the speech bubble, close button, loading/error states

config.json (project root — read by BOTH main.js and the renderer)
  └─ schedule, tray name, messages, bubble/mascot tuning — no code changes needed
```

Electron gives the app its own transparent, borderless, always-on-top OS window;
Three.js is only responsible for what's drawn *inside* that window's `<canvas>`.
Neither library knows about the other — `preload.js` is the sole bridge, and it's
intentionally tiny (two one-way messages) since `contextIsolation` is on and the
renderer has no direct Node.js access.

## Electron — desktop shell & scheduling

Electron wraps a Chromium renderer and a Node.js "main" process in one app. Here it provides:

- **`BrowserWindow`** ([main.js:45](main.js#L45)) — the actual popup window. Configured
  `frame: false` + `transparent: true` so only the 3D model and speech bubble are
  visible, not a rectangular window chrome. `alwaysOnTop` + `skipTaskbar` make it
  behave like a floating overlay rather than a normal app window.
- **`screen`** — reads the display's work area to position the window at a screen
  corner (`SCREEN_EDGE` in [main.js:39](main.js#L39)).
- **`node-cron`** (`startScheduledTasks()`) — `config.json`'s `schedule` array holds
  one or more `{ days: [...], time: "HH:MM" }` entries; each is converted to a cron
  expression (`buildCronExpression()`) and scheduled as its own `cron.schedule(...)`
  job, so the mascot can pop up at several independent day/time combinations, not
  just one. All jobs call `createMascotWindow()`.
- **`Tray`/`Menu`** (`createTray()`) — the system tray icon, labeled with
  `config.trayName` ("SparkY"), a manual "Show mascot now" trigger for testing
  without waiting on the schedule, and a read-only listing of the active schedule
  entries.
- **`ipcMain`/`contextBridge`** ([main.js:103](main.js#L103), [preload.js](preload.js)) —
  the renderer can't touch Node.js or Electron APIs directly (`contextIsolation: true`,
  `nodeIntegration: false`, standard Electron security practice). `preload.js` exposes
  exactly two actions on `window.mascot`: `dismiss()` (close button) and
  `moveWindow(dx, dy)` (right-click-drag repositioning). Everything else in the
  renderer is sandboxed browser code.
- **Fade in/out** ([main.js:78](main.js#L78)) — plain `setOpacity()` stepping; not a
  library feature, just a manual animation on the window itself (separate from any
  Three.js/CSS animation happening inside it).

Electron has no idea what's being drawn in the window — it just gives that content
a transparent, floating, OS-level surface to live on.

## Three.js — everything inside the canvas

All 3D work lives in [renderer/index.html](renderer/index.html)'s module script.

- **`WebGLRenderer`** (`alpha: true`) — renders into a `<canvas>` with a transparent
  background, so the Electron window's transparency shows through around the model.
- **`GLTFLoader`** — loads `assets/color_model.glb` (a glTF/GLB 3D model with an
  embedded base-color/metallic-roughness/normal texture set). Textures embedded in a
  `.glb` are extracted as `blob:` URLs internally, which is why the CSP allows
  `blob:` for `img-src`/`connect-src`.
- **Auto-fit/center/rotate logic** — computes the model's bounding box to scale it to
  a consistent size (`config.mascot.sizeUnits`), center it, and lift it so its feet
  sit at y≈0. Rotation (`config.mascot.rotationDeg`) is a fixed yaw applied once on
  load — there's no auto-facing logic, it's just a tuned constant.
- **Lights** — one ambient + two directional lights (key/fill) for standard
  three-point-style lighting on the model.
- **Shadows** — `renderer.shadowMap` + the key light's shadow camera render a
  contact shadow onto an invisible `ShadowMaterial` plane positioned at the model's
  feet. `ShadowMaterial` only draws pixels where a shadow falls, so the plane itself
  never blocks the transparent background — this is what grounds the mascot instead
  of it looking like it's floating.
- **`AnimationMixer`** — currently plays `gltf.animations[0]` if the loaded model has
  any baked-in clips (neither current `.glb` does). This is the hook point for the
  waving/bowing/smiling clips being produced — see "Next: animations" below.
- **`OrbitControls`** — rotation only (`enablePan`/`enableZoom` are off); currently
  unused for user interaction since the model's rotation is fixed by config, but
  left wired in case click-to-spin is wanted later.
- **Resize handling** — keeps the renderer/camera in sync with the container's
  actual pixel size and DPR (handles the window being dragged between monitors with
  different scaling).

Three.js has no knowledge of Electron, tray icons, or scheduling — it only cares
about the `<div id="canvas-container">` it's told to render into.

## The speech bubble — plain HTML/CSS, not Three.js

The speech bubble (`#speech-bubble`) is a regular DOM element positioned with flexbox
next to `#canvas-container`, not a 3D object. Its position/size come from
`config.json` as CSS custom properties (`--bubble-x`/`--bubble-y`) and inline styles,
so it can be retuned without touching layout code.

Each time the mascot appears (scheduled or manual), `runMessageSequence()` shows
every string in `config.json`'s `messages` array in order — each for
`bubble.messageDisplaySeconds`, with a brief fade between — then calls
`window.mascot.dismiss()`, which fades the window out and closes it (the tray icon
is all that's left, ready for the next scheduled trigger or manual click).

## config.json — the one file non-engineers should edit

Read by `main.js` at startup (`fs.readFileSync`, synchronous — see `loadConfig()`)
and by the renderer via `fetch('../config.json')`. Both fall back to hardcoded
defaults if it's missing or malformed.

- `trayName` — label shown on the tray icon tooltip and context menu.
- `devMode` — when `true`: (1) shows the mascot immediately on every app
  launch, ignoring `schedule` for that launch, and (2) the renderer loops the
  message sequence forever instead of auto-dismissing after one pass, so the
  popup stays up while you're iterating on it. Set to `false` before shipping
  — the tray's "Show mascot now" item still works either way.
- `autoStartAtLogin` — when `true`, the app registers itself to launch when
  Windows starts (a per-user Registry Run entry via `app.setLoginItemSettings`,
  no admin rights needed). Only takes effect in a packaged/installed build —
  skipped under `npm start`, since the dev Electron binary isn't what you'd
  want auto-launching.
- `schedule` — array of `{ days: [...], time: "HH:MM" }`. `days` accepts full or
  3-letter names (`"Mon"`, `"Monday"`), case-insensitive. Add as many entries as
  needed for different day/time combinations.
- `messages` — array of strings shown in sequence on every popup.
- `bubble` — `offsetXPx`/`offsetYPx` (nudge from its default flex position),
  `maxWidthPx` (wrap width), `fontSizePx`, `messageDisplaySeconds` (how long each
  message in `messages` stays on screen before advancing to the next).
- `mascot` — `sizeUnits` (overall model scale), `rotationDeg` (facing angle).

## Building for distribution

`npm run build` (= `electron-builder --win --x64`) produces
`dist/Mascot Popup 1.0.0.msi` — an MSI installer, chosen specifically so it
plugs into Intune/SCCM/GPO managed deployment (native silent install/uninstall
and versioning, unlike a plain NSIS EXE). Key `package.json` `build` settings:

- `win.target: "msi"` / `msi.upgradeCode` — the upgrade code is a fixed GUID
  that must **stay the same** across future version bumps, or Windows/Intune
  will treat each release as an unrelated product instead of an upgrade.
- `msi.oneClick` + `runAfterFinish` — silent install, mascot launches right after.
- `files` — everything that must ship inside the installer (note: `electron`
  itself must stay a `devDependency`, not a `dependency` — electron-builder
  bundles the Electron runtime separately and errors if it finds `electron`
  listed as a regular dependency).
- `assets/tray-icon.png` was resized/padded to a square 256×256 canvas —
  electron-builder needs a square source image to generate a proper Windows
  `.ico` for the installer/taskbar icon; a non-square source can fail or
  produce a squashed icon.

For silent deployment via Intune, the generated MSI already supports the
standard `msiexec /i "Mascot Popup 1.0.0.msi" /quiet` install command.

### Gotcha: GLTFLoader/OrbitControls go missing in a packaged build

`renderer/index.html` does **not** import `GLTFLoader`/`OrbitControls` from
`node_modules/three/examples/jsm/` — it imports them from
`renderer/vendor/three-addons/` instead, which is a deliberate workaround, not
an accident.

`electron-builder`'s node_modules packager
(`app-builder-lib/out/util/NodeModuleCopyHelper.js`) hardcodes any top-level
directory literally named `example`/`examples` inside a package as
always-excluded when copying `node_modules` into the app — and Three.js keeps
its addons under `three/examples/jsm/`. The MSI/`--dir` build silently drops
that entire folder; `npm start` (unpackaged, reading straight off disk) is
unaffected, so this only shows up after building — the popup gets stuck on
"Loading mascot…" with `net::ERR_FILE_NOT_FOUND` for `GLTFLoader.js`/
`OrbitControls.js` in DevTools console.

The fix: `GLTFLoader.js`, `OrbitControls.js`, and `BufferGeometryUtils.js`
(the one file `GLTFLoader` imports internally) are copied into
`renderer/vendor/three-addons/`, which ships via the `renderer/**` files glob
like any other renderer asset — untouched by the node_modules exclusion rule.
The import map (`renderer/index.html`) points `three/addons/` at that vendored
copy instead of `node_modules/three/examples/jsm/`. Three's core
(`node_modules/three/build/three.module.js`) is unaffected since it isn't
under a folder named `example`/`examples`.

If Three.js is ever upgraded, re-copy those same three files from the new
`node_modules/three/examples/jsm/` into `renderer/vendor/three-addons/`
(same relative structure) rather than reverting the import map.

## Next: animations

The mascot models currently have no baked animation clips or skeleton — they're
static meshes. Once rigged/animated `.glb` exports (wave, bow, smile, idle, etc.)
are ready, the single `mixer.clipAction(gltf.animations[0]).play()` call needs to
become a small clip-name lookup with crossfading (`fadeIn`/`fadeOut` between actions)
so a specific move can be triggered per popup instead of always playing whatever
clip happens to be first in the file.
