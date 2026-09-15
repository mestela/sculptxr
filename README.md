# SculptXR (v3.39.0)

WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptxr_ar.jpg)
<br>*SculptXR running natively on a Quest 3 in AR/passthrough mode.*

## Overview
This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

Watch a demo of the Feb 27 build [here.](https://www.youtube.com/watch?v=h7nVgpOmaXs)

Try the latest build [here!](https://tokeru.com/sculptxr/)

*   **v3.39.0**: **A range slider, Maya's way**: a new lane reading **global start, range start, range end, global end**, whose track always spans the whole global range — and the ruler above now follows the **playback** range, which is the point of having two of them. The global range is **typed** (10px grips were unusable, and a field reaches the VR numpad); the playback range is **dragged** by 30px handles that carry their own frame number, straddle the bar edge, and open that number for typing when released without moving. Handles take half the bar each with **no minimum** — any floor above half makes them overlap on the narrow range that needed the help, so it could be moved but never shortened. The inline editor is border-box and sized to fit its text rather than the control it replaces. Plus: changing the timeline length **fits the view** when nothing is keyed (watched, not hooked — the length is written from eight places; and the empty test asks about keys, not tracks), and the cyan **mesh outline is gated to Grab and Select**, since while sculpting it only sits between your eye and the surface.
*   **v3.38.0**: **Audio on the timeline**: load a clip and it plays against the transport, scrubs under the playhead, follows the playback speed and draws its waveform behind the frame numbers. The file is decoded whole up front, so scrubbing is **not a seek** — you stop the node and `start(when, offset)` a new one at the sample you want, which is sample-accurate. The engine **follows** the transport rather than hooking it: `sync()` runs once per frame and reconciles, so every one of the ~25 places that write `_animPlaying` works without knowing audio exists. `AudioContext`'s clock corrects the transport's drift, but refuses to when the two disagree by more than a quarter second — that is a seek or a loop wrap, not drift. Speed changes **re-rate** the running node (pitched, like a tape machine) with the clock anchor re-cut before the rate, not after. Dragging is **granular scrubbing** — short overlapping windows at the playhead, tunable under Audio Scrub — and a press always sounds, ignoring the throttle, because silence waiting for movement is what read as lag. Audio loads through the ordinary **Import** (and drag-and-drop), which is the path that works on Vision Pro, where a canvas menu's synthetic clicks cannot open a file picker at all. Also: the transport can no longer be pushed off the right edge of a narrow timeline by the buttons to its left.
*   **v3.36.0**: **A Select tool, and a lot of things that could not be selected**: a tool with no verb — its stroke methods are overridden to nothing and `start` returns false, so pressing cannot nudge what you were only pointing at — with **the other controller's trigger** as the multi-select modifier, read on the trigger edge per hand. Meshes get the rig's own two colours as a wire box on their bounds: **yellow for preselection, cyan for selection**, yellow winning on a mesh that is both. Rig nodes are pickable only while something marking them is DRAWN, so hiding the rig lets the reach fall through to the meshes; and a mesh parented to a joint (a hinge, a servo) now beats the joint it hangs on, which the skin-protecting rule had made unselectable. **Locked** now means cannot be moved rather than cannot be picked — including Grab's VR air fallback, which never went through picking. Duplicate, instance and mirror re-hang a copy where its source hangs, so a part under a joint stops coming out many times too big. New **Mirror** (position and rotation both reflected; the eye-rig toggle is now **Mirror Eye**), an all-quad **Cylinder** that Reverse can walk back down, and clicking empty space in the outliner drops the selection.

[View Full Release History](docs/releases.md)

## Supported Platforms
It should work on any WebXR compatible device. So far I've tested on:
- Quest 2 and Quest 3 browser in standalone
- Google Chrome on Windows PCVR via Meta Link and Quest 3

## Instructions
### Basics
Press the 'Enter VR' button. If you're on a device that supports passthrough, press the 'Enter AR' button.

The right controller is the primary sculpting tool. The left controller contains a mini menu to change tool, radius, intensity, negative mode, toggle wireframe.

Right trigger will sculpt. Holding down left trigger while using right trigger will smooth.

The A button will engage 'negative' mode, so a brush build up will become a brush carve for example.

The X button will launch the full VR Menu.

Pushing the left controller thumbstick left/right will undo/redo.

Pushing the right controller thumbstick up/down will change radius.

Grip controls should work as expected, single grip will rotate/translate, both grip controls will scale the world.

Saving and loading will often pop up a dialog in non-vr mode. If you choose an option and see nothing, tap the meta button to drop back into 2d mode, you'll probably find a file dialog waiting for you.

If you're left handed, you can swap the controllers from the **Settings** menu.

### Voxels

In the tool combobox is a Voxel tool. This is a basic 'air draw toothpaste in 3d' tool like Adobe Medium, it has a sub palette of 4 modes, add, sub, inflate, deflate. It also lets you change the voxel resolution, and 'bake to mesh' will convert the voxel to regular polygons for further sculpting.

### Desktop spectator mode

If running on PCVR, the desktop will be in a spectator mode. It is a live preview of your sculpt from a stationary camera. You can move this camera with the regular mouse/tablet controls, and use the desktop sculpting tools. This means if there are certain operations easier to do in desktop, you can swap between them easily.

In the desktop UI under Camera -> Spectator mode, you can decide how the desktop mode should behave:

- **VR View (Mirror)** - a direct mirror of the VR view.
- **Desktop** - the standard view, a stationary view that can be controlled independantly of the VR view
- **Tracked** - A hybrid of VR View and desktop; it will match the orientation and scale of the VR View, but can be offset, and because it doesn't inherit translation, isn't as jittery or motion sickness inducing. Good for demos, working with a general audience.
- **Stationary (6DOF)** - Inspired by Dreams on the Playstation, this mode lets you use 6dof controllers with your monitor. More details below.

### Stationary (6DOF) Dreams mode
Before starting, cover the light sensor in the quest headset with something opaque (it's inside the headset between the lenses). 

Start SculptXR, Enter VR. Now remove the headset, and place it on your desk facing you. Make sure its slightly off the edge of the desk so that the lower fisheye cameras can see the floor.

Select Stationary (6DOF) from the Camera -> Spectator on desktop, sit back at least 50cm from the headset.

You should now see the sculpt and your controllers on screen. Start sculpting! It takes a little time to get used to without the stereo cues, use the radius circle indicator and the spherical indicator to judge your depth.

If the default position feels uncomfortable (too high, too far away, too shifted left or right), use the mouse to adjust. Scrollwheel will move near/far, middle mouse will pan up/down/left/right. 

My usual method is to adjust the view with the mouse so that the controllers feel comfortable in my lap, then use the grip controls to pull the sculpt into a comfortable position.

#### Stationary mode and tracking issues
My understanding is the Quest 3 makes a few (perfectly valid!) assumptions about tracking:

- It can always see the floor
- The headset is always moving a little bit so it can keep getting updates on where it is
- The controllers are held in a natural grip out front, below, with the 'face' of the controller facing the cameras.

When I first tested this Dreams mode putting the headset on my desk, I kept having the controllers drift and act strange. I eventually realised what was happening:

- It couldn't see the floor
- The headset was perfectly static, so it wasn't getting regular updates of where it was in space
- The controllers were showing their backside to the cameras, and often either too close or off to the sides near the headset 'ears'.

The Quest 3 is simply not designed for this tracking scenario. Hence you gotta help it a little. When placing it on your desk, ensure it's hanging off the edge a little so the cameras can see the floor. Careful, the quest 3 is  front heavy and likes to tip forward! If you have a way to mount it higher with more stability, perfect. 

By shifting yourself further back, you're more likely to keep the controllers in sight of the cameras at all times.

Despite not being designed to track the back of the controllers, the Quest 3 does a pretty good job. I find if controllers start to drift (usually because I've kept the controllers in a hard to track position for too long), just 'showing the face' of the controllers to the headset by tilting them forward for a second will reset tracking.


#### Stationary mode and standby
The quest 3 will go into standby mode if it thinks you're not using it. Covering the light sensor helps trick it, but if the headset hasn't moved for 2 minutes, it assumes it's not on your head and goes into standby. Currently I just tap or nudge the headset every 30 seconds. There are developer options to better control this, but I haven't tested them.



## Clear Browser Cache
The browser on the Quest 3 and Chrome desktop love to aggresively cache javascript files. This plays havok with SculptXR where I'm frequently updating files.

Here's what I do to clear the cache.

### Desktop Chrome

1. R.click on the page, Inspect
2. Network tab, 'Disable Cache' toggle, turn it on.
3. Application tab, Storage, 'Clear site data'
4. If the Inspect tab doesn't have enough room, the Network or Applications tab might be under the >> button in the top bar.

![](assets/console_network.jpg)
<br>*Network, Disable Cache*<br>

![](assets/console_application.jpg)
<br>*Application, Storage, Clear site data*<br>

![](assets/console_hidden.jpg)
<br>*Options sometimes hidden under >> menu*<br>

### Quest 3 browser

1. Click the 3 dots button in the top right of the browser
2. Clear Browsing Data
3. Clear Data



## Original Project Resources
- Live Demo: [stephaneginier.com/sculptgl](http://stephaneginier.com/sculptgl)
- Website: [stephaneginier.com](http://stephaneginier.com/)
- Galaxy XR Troubleshooting: [docs/galaxyxr.md](docs/galaxyxr.md)

## Credits
- Original SculptGL by [Stéphane Ginier](http://stephaneginier.com/).
- Raw environments from [HDRI Haven](https://hdrihaven.com/hdris).
- Quad Remeshing powered by [quadrs](https://crates.io/crates/quadrs), an experimental Rust port of Instant Meshes.
