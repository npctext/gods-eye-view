# God’s Eye View — Mobile Experience Update

## Challenge: “27 apps in one”

The goal was to make a product described as “27 apps in one” feel like a single, coherent mobile experience, with the map as the main workspace.

- Kept the map at the center of the workflow, with tools and details appearing when needed.
- Used Explore to organize discovery and provide clear entry points into the existing features.
- Separated layer management from scene browsing and playback, giving each task a clear place in the navigation.
- Gave mobile panels a shared structure, consistent controls and familiar gestures across sections.
- Kept the visible map interactive while nonmodal panels are open. Reserved modal panels for actions that must be completed before returning to the map.
- Connected the mobile interface to existing feature controllers and shared application state.

## Mobile interface updates

### Explore and navigation

- Explore groups tools, places and events.
- A compact header provides access to search and voice.
- Layers, Scenes, Cameras and Context have separate navigation entry points.

### Settings and map tools

- Added mobile Settings for appearance, sound and API provider configuration.
- Frequently used tools can be pinned to the map.
- Compact zoom and map controls keep essential actions within reach.

### Layers and map panels

- Switch between all layers and active layers.
- Draggable panels share headers, gestures and controls.
- The map remains interactive with panels open.

### Scenes and playback

- Added a mobile scene catalog, shot lists and editing controls.
- Create, import and manage scenes from the mobile interface.
- A floating player provides progress, pause and resume controls.

### Radio

- Added a dedicated mobile Radio panel.
- Provided a separate RTL-SDR receiver screen.
- Explore shows the station and playback status, with a quick return to the player.

### Visuals and feedback

- Unified tactical surfaces, icons and typography.
- Updated the loading screen and status notices.
- Standardized headers, cards and controls across the mobile interface.

## Animations and interactions

The original mobile version had no animations. This update introduces coordinated motion for panels and visual feedback for touch interactions.

- **Shared panel timing:** A shared 280 ms setting keeps panel movement and interface updates in sync.
- **Panel transitions:** Panel changes use shared rules, with a simpler transition when browser support is limited.
- **Touch-driven panels:** Panels follow your finger as you drag, then snap into place when released.
- **Coordinated map controls:** Controls move or hide as panels expand, keeping the visible map interactive.
- **Touch feedback:** Buttons respond to touch with clear visual feedback.
- **Reduced motion and efficiency:** The app respects reduced motion settings and pauses the loading animation when hidden.

## Testing and compatibility

### Responsive layouts

- Browser checks at 320 px and 430 px.
- Panel heights, spacing and text wrapping.
- Long labels and scrollable content.
- Control alignment and horizontal overflow.

### Touch and navigation

- Open, close, collapse and restore panels.
- Drag sheets and scroll lists independently.
- Touch feedback and panel navigation.
- The map remains interactive with panels open.

### State and persistence

- Panel section and scroll position on restore.
- Saved settings and pinned tools after reload.
- Scene playback: pause, resume and seek.
- Player state when switching sections.

### Code validation

- Regression tests, JavaScript syntax and CSS parsing.
- Package checks and relevant production builds.
- Some integrations were tested with simulated data.
- Physical devices, live APIs and RTL-SDR hardware remain to be verified.
