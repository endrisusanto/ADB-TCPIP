# ADB Wireless Device Farm Manager

A compact, monochrome, modern utility dashboard built with Rust and Tauri v2. It is designed to manage connection states, pairing, and controls of multiple Android devices in a device farm, with a strong focus on switching from unstable USB cables to reliable ADB Wireless (TCP/IP) connections.

## Features

- **Monochrome & Compact UI**: Refactored to fit into a single screen layout without page scroll. Clean grid cards with a side-by-side log panel.
- **Connection Type Highlights**:
  - Cards are marked with colored borders representing their connection state:
    - **Blue (`#4285f4`)** border for USB connections.
    - **Green (`#3ddc84`)** border for Wireless connections.
- **Toggle Filters**: Dynamically filter devices in the list by checking or unchecking the **USB** and **Wireless** toggles.
- **Comprehensive Build Properties**: Retrieves 9 detailed build fields using a single efficient `getprop` command:
  - Model (`ro.product.model`)
  - Android Release (`ro.build.version.release`)
  - SDK Version (`ro.system.build.version.sdk_full` / `ro.build.version.sdk`)
  - Security Patch (`ro.build.version.security_patch`)
  - Sales Code / CSC (`ro.csc.sales_code`)
  - PDA (`ro.build.PDA`)
  - SW Version (`ril.sw_ver`)
  - CSC Version (`ril.official_cscver`)
  - Fingerprint (`ro.build.fingerprint`)
- **Utility Actions (Per Device)**:
  - **Pair Wireless**: Switches device adbd to TCP mode (`adb tcpip 5555`) and establishes connection. Supports manual IP override if wlan0 auto-detection is not available.
  - **Screen Brightness**: Slider control (0-255) with quick Min (5) and Max (255) presets.
  - **Screen Timeout**: Dropdown select with quick Min (15s) and Max (Keep Awake) presets.
  - **Mirror View**: Spawns an independent `scrcpy` instance to control the screen with a single click.
- **Execution Log Terminal**: Embedded log terminal on the right rendering command status (info/success/error) in real time.

---

## Prerequisites

Ensure the following tools are installed on your system and available in your shell's `PATH`:
1. **ADB (Android Debug Bridge)**: To query and control the devices.
2. **scrcpy**: For screen mirroring features.
3. **Rust Toolchain**: To compile the Tauri Rust backend.
4. **Node.js (LTS)**: To run the Vite/React frontend.

---

## Local Development

To run the application locally:

```bash
npm install
npm run tauri dev
```

### Linux / Wayland Note
The application programmatically forces the X11 backend (`GDK_BACKEND=x11`) and disables DMABUF rendering (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) on Linux at launch. This prevents common WebKitGTK and GDK protocol errors on Wayland display servers. You can run the command normally without prepending environment overrides.

---

## Automated Release Process

The project is configured with a release manager script (`script.sh`) and a parallel GitHub Actions builder.

### How to Release
To deploy a new release tag:
```bash
./script.sh patch
```
*(You can also use `./script.sh minor` or `./script.sh major`)*. 

The script will automatically:
1. Initialize the git repository (if not already done).
2. Auto-commit any outstanding changes.
3. Bump the version in `package.json`, `Cargo.toml`, and `tauri.conf.json`.
4. Create and push a git tag (e.g. `v0.1.2`) to GitHub.

### Parallel CI/CD Build (`.github/workflows/release.yml`)
Once the tag is pushed to GitHub, the Actions runner triggers two parallel build jobs:
- **Build DEB**: Compiles the Debian/Ubuntu package (`.deb`).
- **Build RPM**: Installs package builders and compiles the RedHat/Fedora package (`.rpm`).

Both jobs build concurrently on separate runners. Upon successful build, the release job downloads both packages and publishes them under a unified GitHub Release.
