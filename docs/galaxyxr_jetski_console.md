# Connecting to GalaxyXR Chrome Console over ADB

This document outlines the procedure for an AI assistant (running in a non-interactive shell) to connect directly to the Google Chrome remote debugging endpoint on a secondary GalaxyXR device. This allows for reading console logs without relying on local intercept terminal proxies.

## Prerequisites

1.  **ADB Installed**: The host PC must have Android Debug Bridge (`adb`) installed. If it is not found in standard system `PATH` folders, find its absolute binary path (e.g., `/opt/homebrew/bin/adb` on macOS).
2.  **Device Connected wirelessly**: The device should appear when running the `adb devices` list (e.g., `10.0.0.39:5555`).

---

## Connection Steps

### 1. Verify Device Is Seated
Run the device check taking into account non-interactive workspace limits:
```bash
/opt/homebrew/bin/adb -s 10.0.0.39:5555 devices
```

### 2. Forward Abstract Domain Socket To Local TCP
Chrome on Android does not map its remote debugger to a numbered TCP port directly; it uses a Unix Domain Socket named `chrome_devtools_remote`. To read this from your workspace, forward local port `9223` (bridges clash avoidance) to the domain socket:
```bash
/opt/homebrew/bin/adb -s 10.0.0.39:5555 forward tcp:9223 localabstract:chrome_devtools_remote
```

### 3. Curl Local JSON Enclosure
Once forwarded, run a request against the local Mac endpoint to pull current active running tabs and workers:
```bash
curl http://localhost:9223/json
```

### 4. Determine WebSocket URL
Find the `webSocketDebuggerUrl` inside the JSON response. Connect output scrape handlers to that endpoint to pipe live execution traces.

---

## Persistence 

The TCP port remains forwarded until the device disconnects or ADB restarts. You can list forwards using:
```bash
/opt/homebrew/bin/adb -s 10.0.0.39:5555 forward --list
```
To remove a specific forward if needed:
```bash
/opt/homebrew/bin/adb -s 10.0.0.39:5555 forward --remove tcp:9223
```
