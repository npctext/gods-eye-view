# Diagnosing a black map screen

## Save a report from your phone

1. After installing the update, reload the app once.
2. If the map turns black again, open **Settings → Save map diagnostics**.
3. The browser downloads `gev-map-diagnostics-<timestamp>.json`. You can usually find it in your phone's Downloads folder.
4. Send the file to the developer along with your phone model and a brief description of the problem.

Save the report **before reloading or closing the tab**: the log is kept in the current page's memory. Logging starts automatically; there is no switch to enable.

If the map reappears when you open the menu, save the report anyway and mention this. Diagnostics records the state before you tap Settings, the bottom navigation, or the map tools menu. If the problem disappears on its own, save the report immediately: periodic snapshots cover roughly the last two minutes while the tab is active.

If startup fails, a separate button on the loading screen lets you save a report.

## What to include with the file

- Your phone model and browser; include the browser version if known.
- Whether the interface was visible and its buttons worked.
- Whether the map appeared in the tab thumbnail or during menu animations.
- Whether Clean UI, rotating the phone, or simply waiting made the problem disappear.
- Whether you opened the app through a local Wi-Fi address or a published website.

## What the report contains

- Browser version, GPU details, viewport dimensions, and WebGL canvas dimensions.
- Up to 60 periodic state snapshots, sampled every 2 seconds, and up to 100 events.
- Render loop state, rendered frame count, time of the last frame, and idle rendering mode.
- Startup, JavaScript, rendering, and tile errors; WebGL context loss and restoration.
- Changes in tab visibility, viewport dimensions, and network availability.
- Up to 60 map resource timing entries: hostname, duration, and metadata available to the browser.
- State before opening a menu and CSS properties of the main layers above the map.
- Color statistics from a 32×32-pixel copy of the WebGL canvas at export time. The image itself is not saved.

Pixels are sampled only when saving a report; logging does not request additional frames or change the rendering mode. API keys are not read from settings; URL parameters and recognizable secrets are removed from error messages. Reports are not sent automatically.

## Interpreting the data

A black screen alone does not indicate WebGL context loss. A lack of new frames while `requestRenderMode: true` may also be normal idle behavior. A zero transfer size or unknown HTTP status does not prove a network failure: browsers restrict information about external resources.

If the WebGL canvas contains colored pixels while the phone screen is black, investigate CSS layers and browser compositing. This is a clue, not an automatic diagnosis: pixel statistics are captured at export time, and the tab thumbnail may be stale.

On desktop, you can download the same report from the console with `window.__gevMapDiagnostics.download()`. The `capture()` method returns the report object without downloading it.
