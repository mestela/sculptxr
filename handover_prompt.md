# Next Session Objectives: Animation DAW UX Polish

The user has requested the following improvements for the next development cycle:

1. **Playhead Visibility**: Ensure the vertical playhead line is visible by default immediately upon loading the animation tab, even if the playback time is 0.0s.
2. **Timeline Initialization**: Synchronize the visual zoom/bounds of the timeline renderer to precisely match the default `Loop Start` and `Loop End` values on initial load.
3. **Thumbwheel Slider Mode**: Update the standard VR slider interaction logic to function as a relative encoder (thumbwheel). When a user clicks anywhere on the slider bar, it should lock the current value as a baseline offset. Moving the pointer left/right from the initial click coordinate should relatively increment/decrement the value, rather than instantly snapping the value to the absolute physical coordinate of the pointer.

## Modified Files in This Session
- `/src/Version.js`
- `index.html`
- `docs/releases.md`
- `README.md`
