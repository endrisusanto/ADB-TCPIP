import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface DeviceProps {
  serial: string;
  model: string;
  battery: string;
  temperature: string;
  release: string;
  sdk: string;
  security_patch: string;
  sales_code: string;
  pda: string;
  sw_ver: string;
  official_cscver: string;
  fingerprint: string;
  build_type: string;
}

interface DeviceInfo {
  serial: string;
  connection_type: "usb" | "wireless";
  ip: string;
  properties: DeviceProps;
}

interface LogEntry {
  id: number;
  time: string;
  text: string;
  type: "info" | "success" | "error";
}

const MODEL_PALETTE = [
  { bg: "#1e293b", border: "#3b82f6", text: "#93c5fd" }, // Blue
  { bg: "#14532d", border: "#22c55e", text: "#86efac" }, // Green
  { bg: "#581c87", border: "#a855f7", text: "#e9d5ff" }, // Purple
  { bg: "#701a75", border: "#e879f9", text: "#f5d0fe" }, // Fuchsia
  { bg: "#7c2d12", border: "#f97316", text: "#fed7aa" }, // Orange
  { bg: "#134e4a", border: "#14b8a6", text: "#99f6e4" }, // Teal
  { bg: "#831843", border: "#ec4899", text: "#fbcfe8" }, // Pink
  { bg: "#713f12", border: "#eab308", text: "#fef08a" }, // Yellow
  { bg: "#1e1b4b", border: "#6366f1", text: "#c7d2fe" }, // Indigo
  { bg: "#365314", border: "#84cc16", text: "#d9f99d" }, // Lime
];

function getModelStyle(model: string) {
  if (!model || model === "N/A") {
    return { backgroundColor: "#1f1f1f", borderColor: "#444444", color: "#aaaaaa" };
  }
  let hash = 0;
  for (let i = 0; i < model.length; i++) {
    hash = model.charCodeAt(i) + ((hash << 5) - hash);
  }
  const item = MODEL_PALETTE[Math.abs(hash) % MODEL_PALETTE.length];
  return {
    backgroundColor: item.bg,
    borderColor: item.border,
    color: item.text,
  };
}

function getBuildTypeBadge(buildType: string) {
  const type = (buildType || "").toLowerCase();
  if (type.includes("userdebug")) {
    return <span className="badge badge-userdebug">userdebug</span>;
  }
  if (type.includes("user")) {
    return <span className="badge badge-user">user</span>;
  }
  if (type.includes("eng")) {
    return <span className="badge badge-eng">eng</span>;
  }
  return type ? <span className="badge badge-default">{type}</span> : null;
}

function getBatteryBadge(battStr: string) {
  if (!battStr || battStr === "N/A") return <span style={{ color: "#777" }}>N/A</span>;
  const num = parseInt(battStr.replace(/[^0-9]/g, ""), 10);
  if (isNaN(num)) return <span>{battStr}</span>;
  
  let color = "#22c55e"; // Green for >= 50%
  let bg = "rgba(34, 197, 94, 0.15)";
  if (num < 20) {
    color = "#ef4444"; // Red for < 20%
    bg = "rgba(239, 68, 68, 0.2)";
  } else if (num < 50) {
    color = "#eab308"; // Yellow for 20-49%
    bg = "rgba(234, 179, 8, 0.18)";
  }

  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: "3px",
        fontSize: "0.65rem",
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        color,
        backgroundColor: bg,
        border: `1px solid ${color}44`
      }}
    >
      {battStr}
    </span>
  );
}

function getTempBadge(tempStr: string) {
  if (!tempStr || tempStr === "N/A") return <span style={{ color: "#777" }}>N/A</span>;
  const num = parseFloat(tempStr.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return <span>{tempStr}</span>;

  let color = "#3b82f6"; // Cool Blue for < 35 C
  let bg = "rgba(59, 130, 246, 0.15)";
  if (num >= 42) {
    color = "#ef4444"; // Hot Red for >= 42 C
    bg = "rgba(239, 68, 68, 0.25)";
  } else if (num >= 35) {
    color = "#f97316"; // Warm Orange for 35-41.9 C
    bg = "rgba(249, 115, 22, 0.2)";
  }

  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: "3px",
        fontSize: "0.65rem",
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        color,
        backgroundColor: bg,
        border: `1px solid ${color}44`
      }}
    >
      {tempStr}
    </span>
  );
}

function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [manualIps, setManualIps] = useState<Record<string, string>>({});
  const [brightnessValues, setBrightnessValues] = useState<Record<string, number>>({});
  // ponytail: accordion open state per group
  const [openUsb, setOpenUsb] = useState<boolean>(true);
  const [openWireless, setOpenWireless] = useState<boolean>(true);
  // ponytail: view mode toggle (cards vs table vs grid_wall)
  const [viewMode, setViewMode] = useState<"cards" | "table" | "grid_wall">("grid_wall");
  const [selectedDeviceSerial, setSelectedDeviceSerial] = useState<string | null>(null);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [screenPreviews, setScreenPreviews] = useState<Record<string, string>>({});
  const [isCapturingScreens, setIsCapturingScreens] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");
  
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef<number>(0);

  const handleOpenYoutube = async (urlToPlay?: string) => {
    const targetUrl = urlToPlay || youtubeUrl;
    if (!targetUrl || !targetUrl.trim()) {
      addLog("Please enter a valid YouTube URL", "error");
      return;
    }
    const targetSerials = devices.map((d) => d.serial);
    if (targetSerials.length === 0) {
      addLog("No connected devices to play YouTube URL", "error");
      return;
    }
    addLog(`Broadcasting YouTube URL to ${targetSerials.length} device(s)...`, "info");
    try {
      await invoke("open_url", { serials: targetSerials, url: targetUrl.trim() });
      addLog(`YouTube URL opened on ${targetSerials.length} device(s)`, "success");
    } catch (err: any) {
      addLog(`Failed to open YouTube URL: ${err.toString()}`, "error");
    }
  };

  const toggleSelectAll = () => {
    if (selectedSerials.length === devices.length) {
      setSelectedSerials([]);
    } else {
      setSelectedSerials(devices.map((d) => d.serial));
    }
  };

  const toggleSelectDevice = (serial: string) => {
    setSelectedSerials((prev) =>
      prev.includes(serial) ? prev.filter((s) => s !== serial) : [...prev, serial]
    );
  };

  const handleBatchBrightness = async (val: number) => {
    if (selectedSerials.length === 0) return;
    addLog(`Setting brightness to ${val} for ${selectedSerials.length} selected device(s) concurrently...`, "info");
    await Promise.all(selectedSerials.map((serial) => handleSetBrightness(serial, val)));
  };

  const handleBatchTimeout = async (timeoutMs: number) => {
    if (selectedSerials.length === 0) return;
    addLog(`Setting screen timeout for ${selectedSerials.length} selected device(s) concurrently...`, "info");
    await Promise.all(selectedSerials.map((serial) => handleSetTimeout(serial, timeoutMs)));
  };

  const handleBatchScrcpy = async () => {
    if (selectedSerials.length === 0) return;
    addLog(`Launching scrcpy for ${selectedSerials.length} selected device(s) concurrently...`, "info");
    await Promise.all(selectedSerials.map((serial) => handleStartScrcpy(serial)));
  };

  const addLog = (text: string, type: "info" | "success" | "error" = "info") => {
    const time = new Date().toLocaleTimeString();
    const id = logIdCounter.current++;
    setLogs((prev) => [...prev, { id, time, text, type }]);
  };

  const captureAllScreens = async () => {
    if (devices.length === 0) return;
    setIsCapturingScreens(true);
    for (const device of devices) {
      try {
        const dataUrl = await invoke<string>("get_device_screenshot", { serial: device.serial });
        setScreenPreviews((prev) => ({ ...prev, [device.serial]: dataUrl }));
      } catch (e) {
        // ignore capture errors for disconnected devices
      }
    }
    setIsCapturingScreens(false);
  };

  useEffect(() => {
    if (viewMode === "grid_wall" && devices.length > 0) {
      captureAllScreens();
      const timer = setInterval(() => {
        captureAllScreens();
      }, 3500);
      return () => clearInterval(timer);
    }
  }, [viewMode, devices]);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const scanDevices = async () => {
    setLoading(true);
    addLog("Scanning for connected devices...", "info");
    try {
      const list = await invoke<DeviceInfo[]>("list_devices");
      setDevices(list);
      
      const newIps: Record<string, string> = {};
      const newBrightness: Record<string, number> = {};
      list.forEach((d) => {
        newIps[d.serial] = d.ip;
        newBrightness[d.serial] = 128;
      });
      setManualIps((prev) => ({ ...newIps, ...prev }));
      setBrightnessValues((prev) => ({ ...newBrightness, ...prev }));
      
      addLog(`Scan complete. Found ${list.length} device(s).`, "success");
    } catch (err: any) {
      addLog(`Scan failed: ${err.toString()}`, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scanDevices();
  }, []);

  const handleConnectWireless = async (serial: string, customIp?: string) => {
    const ipToUse = customIp || manualIps[serial];
    if (!ipToUse || !ipToUse.trim()) {
      addLog(`[${serial}] Error: IP address is required for wireless connection.`, "error");
      return;
    }
    
    addLog(`[${serial}] Swapping to TCP/IP mode and connecting to IP ${ipToUse}...`, "info");
    try {
      const res = await invoke<string>("connect_wireless", { serial, ip: ipToUse });
      addLog(`[${serial}] Wireless connect result: ${res}`, "success");
      setTimeout(scanDevices, 2000);
    } catch (err: any) {
      addLog(`[${serial}] Wireless connect failed: ${err.toString()}`, "error");
    }
  };

  const handleDisconnectWireless = async (ip: string) => {
    if (!ip) return;
    addLog(`Disconnecting wireless device at ${ip}...`, "info");
    try {
      const res = await invoke<string>("disconnect_wireless", { ip });
      addLog(`Wireless disconnect result: ${res}`, "success");
      setTimeout(scanDevices, 1500);
    } catch (err: any) {
      addLog(`Disconnect failed: ${err.toString()}`, "error");
    }
  };

  const handleConnectAllWireless = async () => {
    const usbDevices = devices.filter((d) => d.connection_type === "usb");
    if (usbDevices.length === 0) {
      addLog("No USB devices available to connect.", "error");
      return;
    }

    addLog(`Attempting to connect ${usbDevices.length} USB device(s) to wireless sequentially...`, "info");
    for (const d of usbDevices) {
      const ip = manualIps[d.serial];
      if (ip && ip.trim()) {
        await handleConnectWireless(d.serial, ip);
        // Safety delay between devices to allow adbd daemon to restart cleanly
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        addLog(`[${d.serial}] Skipped: No IP address detected. Please set it manually.`, "error");
      }
    }
  };

  const handleSetBrightness = async (serial: string, val: number) => {
    try {
      await invoke("set_brightness", { serial, brightness: val });
      setBrightnessValues((prev) => ({ ...prev, [serial]: val }));
      addLog(`[${serial}] Screen brightness set to ${val}/255.`, "success");
    } catch (err: any) {
      addLog(`[${serial}] Failed to set brightness: ${err.toString()}`, "error");
    }
  };

  const handleSetTimeout = async (serial: string, timeoutMs: number) => {
    const minutes = timeoutMs / 60000;
    const desc = timeoutMs === 2147483647 ? "Infinite (Max)" : `${minutes} min`;
    addLog(`[${serial}] Setting screen timeout to ${desc}...`, "info");
    try {
      await invoke("set_timeout", { serial, timeoutMs });
      addLog(`[${serial}] Screen timeout set to ${desc}.`, "success");
    } catch (err: any) {
      addLog(`[${serial}] Failed to set timeout: ${err.toString()}`, "error");
    }
  };

  const handleStartScrcpy = async (serial: string) => {
    addLog(`[${serial}] Spawning scrcpy mirror view...`, "info");
    try {
      await invoke("start_scrcpy", { serial });
      addLog(`[${serial}] scrcpy instance launched.`, "success");
    } catch (err: any) {
      addLog(`[${serial}] Failed to start scrcpy: ${err.toString()}`, "error");
    }
  };



  const clearLogs = () => {
    setLogs([]);
  };

  // Stats calculation
  const totalCount = devices.length;
  const usbCount = devices.filter(d => d.connection_type === "usb").length;
  const wirelessCount = devices.filter(d => d.connection_type === "wireless").length;

  // Selected device for side drawer
  const selectedDevice = devices.find((d) => d.serial === selectedDeviceSerial);

  return (
    <div className="app-container">
      <header>
        <div className="brand">
          <img src="/adb.png" alt="ADB" className="app-logo" />
          <h1 id="app-title">Ternak Buzzer</h1>
          <p>Utility Dashboard</p>
        </div>
        <div className="global-actions">
          <button id="scan-btn" onClick={scanDevices} disabled={loading}>
            {loading ? <div className="spinner" /> : "Scan Devices"}
          </button>
          <button id="connect-all-btn" className="primary" onClick={handleConnectAllWireless} disabled={loading || usbCount === 0}>
            Connect All Wireless
          </button>
          <button
            id="toggle-sidebar-btn"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? "Minimize right panel" : "Expand right panel"}
          >
            {isSidebarOpen ? "▶ Hide Panel" : "◀ Show Panel"}
          </button>
        </div>
      </header>

      <div className="app-layout">
        {/* Left Column: Device Cards / Matrix / Table Pane */}
        <section className="devices-pane">
          <div className="pane-header">
            <h3>Connected Devices</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>{devices.length} device(s)</span>
              {viewMode === "grid_wall" && (
                <button
                  className="btn-text"
                  style={{ fontSize: "0.6875rem" }}
                  onClick={() => captureAllScreens()}
                  disabled={isCapturingScreens}
                  title="Capture live screen preview for all devices"
                >
                  {isCapturingScreens ? "⚡ Syncing..." : "⚡ Sync Screens"}
                </button>
              )}
              <div className="view-toggle-group">
                <button
                  className={`toggle-btn ${viewMode === "grid_wall" ? "active" : ""}`}
                  onClick={() => setViewMode("grid_wall")}
                >
                  📱 Matrix Grid
                </button>
                <button
                  className={`toggle-btn ${viewMode === "cards" ? "active" : ""}`}
                  onClick={() => setViewMode("cards")}
                >
                  🎴 Cards
                </button>
                <button
                  className={`toggle-btn ${viewMode === "table" ? "active" : ""}`}
                  onClick={() => setViewMode("table")}
                >
                  📊 Table
                </button>
              </div>
            </div>
          </div>

          <div className="device-list">
            {devices.length === 0 ? (
              <div className="empty-state">
                {loading ? (
                  <>
                    <div className="spinner" />
                    <div>Scanning system devices...</div>
                  </>
                ) : (
                  <>
                    <div>No Android devices detected</div>
                    <button onClick={scanDevices}>Scan Now</button>
                  </>
                )}
              </div>
            ) : viewMode === "grid_wall" ? (
              <div className="phone-wall-container">
                <div
                  className="phone-wall-grid"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(Math.max(devices.length, 1), 10)}, minmax(0, 1fr))`
                  }}
                >
                  {devices.map((device, idx) => {
                    const isWireless = device.connection_type === "wireless";
                    const isFocused = selectedDeviceSerial === device.serial;
                    const indexStr = String(idx + 1).padStart(2, "0");

                    return (
                      <div
                        key={device.serial}
                        className={`phone-frame ${isFocused ? "focused" : ""}`}
                        onClick={() => setSelectedDeviceSerial(device.serial)}
                      >
                        <div className="phone-top-stats-left">
                          {getBuildTypeBadge(device.properties.build_type)}
                          <span className={`phone-conn-tag ${isWireless ? "wireless" : "usb"}`}>
                            {device.connection_type.toUpperCase()}
                          </span>
                        </div>

                        <div className="phone-top-stats-right">
                          {getTempBadge(device.properties.temperature)}
                          {getBatteryBadge(device.properties.battery)}
                        </div>

                        <div className="phone-screen-header">
                          <div className="phone-index-num">{indexStr}</div>
                          <div className="phone-model-name" title={device.properties.model}>
                            {device.properties.model || "Device"}
                          </div>
                          <div className="phone-serial-sub">{device.serial}</div>
                        </div>

                        <div className="phone-screen-body">
                          {screenPreviews[device.serial] ? (
                            <div style={{ width: "100%", height: "100%", position: "relative" }}>
                              <img
                                src={screenPreviews[device.serial]}
                                alt={device.serial}
                                className="phone-screen-img"
                              />
                              {isFocused && (
                                <div className="screen-active-overlay">
                                  <div className="pointer-icon">👆</div>
                                  <div className="active-label">Controlling...</div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="phone-idle-screen">
                              <div className="spinner" />
                              <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", marginTop: "4px" }}>
                                Syncing Screen...
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="phone-frame-footer">
                          <button
                            className="btn-phone-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartScrcpy(device.serial);
                            }}
                          >
                            Mirror
                          </button>
                          <button
                            className="btn-phone-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDeviceSerial(device.serial);
                            }}
                          >
                            Control
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedDevice && (
                  <div className="phone-control-drawer">
                    <div className="drawer-header">
                      <div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 800 }}>{selectedDevice.properties.model || "Device"}</div>
                        <div style={{ fontSize: "0.625rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{selectedDevice.serial}</div>
                      </div>
                      <button className="btn-text" onClick={() => setSelectedDeviceSerial(null)}>✕</button>
                    </div>

                    <div className="drawer-section-title">🎮 Global Broadcast Gesture Pad</div>
                    <div style={{ fontSize: "0.55rem", color: "#22c55e", marginBottom: "4px" }}>
                      *Gestures on this pad will broadcast to ALL connected devices ({devices.length})
                    </div>

                    {/* Interactive Touchpad inside Control Drawer */}
                    <div
                      className="touchpad-area"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const startX = Math.round(((e.clientX - rect.left) / rect.width) * 1080);
                        const startY = Math.round(((e.clientY - rect.top) / rect.height) * 2400);
                        const startTime = Date.now();

                        const handleMouseUp = (upEvent: MouseEvent) => {
                          window.removeEventListener("mouseup", handleMouseUp);
                          const endX = Math.round(((upEvent.clientX - rect.left) / rect.width) * 1080);
                          const endY = Math.round(((upEvent.clientY - rect.top) / rect.height) * 2400);
                          const durationMs = Math.max(Date.now() - startTime, 100);
                          const dist = Math.hypot(endX - startX, endY - startY);
                          const targetSerials = devices.map(d => d.serial);

                          if (dist < 20) {
                            // Tap action
                            invoke("send_tap_event", { serials: targetSerials, x: startX, y: startY });
                            addLog(`[Global Touch] Tap at (${startX}, ${startY}) broadcasted to ${targetSerials.length} device(s)`, "info");
                          } else {
                            // Drag / Swipe action
                            invoke("send_swipe_event", { serials: targetSerials, x1: startX, y1: startY, x2: endX, y2: endY, durationMs });
                            addLog(`[Global Touch] Drag (${startX},${startY}) ➔ (${endX},${endY}) broadcasted to ${targetSerials.length} device(s)`, "info");
                          }
                        };
                        window.addEventListener("mouseup", handleMouseUp);
                      }}
                    >
                      {screenPreviews[selectedDevice.serial] ? (
                        <img
                          src={screenPreviews[selectedDevice.serial]}
                          alt="Control Preview"
                          className="touchpad-preview-img"
                        />
                      ) : (
                        <div className="touchpad-placeholder">
                          <span>Interactive Touchscreen</span>
                          <span style={{ fontSize: "0.55rem", opacity: 0.6 }}>Click / Drag anywhere to control all devices</span>
                        </div>
                      )}
                    </div>

                    {/* Quick Swipe Controls */}
                    <div className="drawer-section-title" style={{ marginTop: "4px" }}>Global Swipes</div>
                    <div className="gesture-btn-grid">
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_swipe_event", { serials: targetSerials, x1: 540, y1: 1800, x2: 540, y2: 600, durationMs: 300 });
                        addLog(`[Global Gesture] Swipe Up sent to ${targetSerials.length} device(s)`, "info");
                      }}>⬆️ Up</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_swipe_event", { serials: targetSerials, x1: 540, y1: 600, x2: 540, y2: 1800, durationMs: 300 });
                        addLog(`[Global Gesture] Swipe Down sent to ${targetSerials.length} device(s)`, "info");
                      }}>⬇️ Down</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_swipe_event", { serials: targetSerials, x1: 900, y1: 1200, x2: 180, y2: 1200, durationMs: 300 });
                        addLog(`[Global Gesture] Swipe Left sent to ${targetSerials.length} device(s)`, "info");
                      }}>⬅️ Left</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_swipe_event", { serials: targetSerials, x1: 180, y1: 1200, x2: 900, y2: 1200, durationMs: 300 });
                        addLog(`[Global Gesture] Swipe Right sent to ${targetSerials.length} device(s)`, "info");
                      }}>➡️ Right</button>
                    </div>

                    {/* Global Hardware Keys */}
                    <div className="drawer-section-title" style={{ marginTop: "4px" }}>Global Hardware Keys & Volume</div>
                    <div className="gesture-btn-grid">
                      <button className="primary" onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "3" });
                        addLog(`[Global Gesture] HOME sent to ${targetSerials.length} device(s)`, "info");
                      }}>🏠 Home</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "4" });
                        addLog(`[Global Gesture] BACK sent to ${targetSerials.length} device(s)`, "info");
                      }}>◀️ Back</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "187" });
                        addLog(`[Global Gesture] RECENT APPS sent to ${targetSerials.length} device(s)`, "info");
                      }}>▢ Recents</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "26" });
                        addLog(`[Global Gesture] POWER sent to ${targetSerials.length} device(s)`, "info");
                      }}>⚡ Power</button>
                    </div>

                    {/* Global Volume & Display Controls Row */}
                    <div className="gesture-btn-grid-5" style={{ marginTop: "4px" }}>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "24" }); // KEYCODE_VOLUME_UP
                        addLog(`[Global Volume] Volume UP sent to ${targetSerials.length} device(s)`, "info");
                      }}>🔊 Vol +</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "25" }); // KEYCODE_VOLUME_DOWN
                        addLog(`[Global Volume] Volume DOWN sent to ${targetSerials.length} device(s)`, "info");
                      }}>🔉 Vol -</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "164" }); // KEYCODE_VOLUME_MUTE
                        addLog(`[Global Volume] Volume MUTE sent to ${targetSerials.length} device(s)`, "info");
                      }}>🔇 Mute</button>
                      <button onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("send_key_event", { serials: targetSerials, keycode: "85" }); // KEYCODE_MEDIA_PLAY_PAUSE
                        addLog(`[Global Media] Play/Pause sent to ${targetSerials.length} device(s)`, "info");
                      }}>⏯️ Play/Pause</button>
                      <button title="Toggle Lock Screen Orientation (Auto-Rotate)" onClick={() => {
                        const targetSerials = devices.map(d => d.serial);
                        invoke("toggle_screen_orientation", { serials: targetSerials });
                        addLog(`[Global Display] Toggle Orientation Lock sent to ${targetSerials.length} device(s)`, "info");
                      }}>🔒 Orient</button>
                    </div>

                    {/* Global YouTube Broadcast Section */}
                    <div className="drawer-section-title" style={{ marginTop: "8px" }}>▶ Broadcast YouTube / Web URL</div>
                    <div className="url-broadcast-box">
                      <input
                        type="text"
                        placeholder="https://youtu.be/..."
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleOpenYoutube();
                        }}
                      />
                      <button className="primary" onClick={() => handleOpenYoutube()}>
                        Play All
                      </button>
                    </div>

                    <div className="drawer-section-title" style={{ marginTop: "8px" }}>Quick Actions</div>
                    <div className="drawer-action-list">
                      <button className="primary" onClick={() => handleStartScrcpy(selectedDevice.serial)}>📺 Launch scrcpy Mirror</button>
                      <button onClick={() => handleSetBrightness(selectedDevice.serial, 5)}>🌙 Dim Screen (Min)</button>
                      <button onClick={() => handleSetBrightness(selectedDevice.serial, 255)}>☀️ Max Brightness</button>
                      <button onClick={() => handleSetTimeout(selectedDevice.serial, 2147483647)}>⏰ Keep Screen Awake</button>
                      <button onClick={() => handleSetTimeout(selectedDevice.serial, 15000)}>⏱️ 15s Timeout</button>
                    </div>

                    <div className="drawer-section-title" style={{ marginTop: "8px" }}>Device Specs</div>
                    <div className="drawer-specs">
                      <div><span className="label">Android:</span> {selectedDevice.properties.release || "N/A"}</div>
                      <div><span className="label">SDK:</span> {selectedDevice.properties.sdk || "N/A"}</div>
                      <div><span className="label">Build Type:</span> {selectedDevice.properties.build_type || "N/A"}</div>
                      <div><span className="label">Battery:</span> {selectedDevice.properties.battery || "N/A"}</div>
                      <div><span className="label">Temp:</span> {selectedDevice.properties.temperature || "N/A"}</div>
                      <div><span className="label">Sales Code:</span> {selectedDevice.properties.sales_code || "N/A"}</div>
                      <div><span className="label">CSC Ver:</span> {selectedDevice.properties.official_cscver || "N/A"}</div>
                    </div>
                  </div>
                )}
              </div>
            ) : viewMode === "table" ? (
              <div className="table-container" style={{ display: "flex", flexDirection: "column" }}>
                {selectedSerials.length > 0 && (
                  <div className="batch-control-bar">
                    <span className="batch-selected-count">
                      {selectedSerials.length} device(s) selected
                    </span>
                    <div className="batch-actions">
                      <button className="primary" onClick={handleBatchScrcpy}>
                        📺 Mirror Selected ({selectedSerials.length})
                      </button>
                      <button onClick={() => handleBatchBrightness(5)}>🌙 Dim (Min)</button>
                      <button onClick={() => handleBatchBrightness(255)}>☀️ Max Brightness</button>
                      <button onClick={() => handleBatchTimeout(2147483647)}>⏰ Keep Awake</button>
                      <button onClick={() => handleBatchTimeout(15000)}>⏱️ 15s Timeout</button>
                      <button className="btn-text" onClick={() => setSelectedSerials([])}>
                        ✕ Deselect All
                      </button>
                    </div>
                  </div>
                )}
                <table className="device-grid-table">
                  <thead>
                    <tr>
                      <th style={{ width: "32px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={devices.length > 0 && selectedSerials.length === devices.length}
                          onChange={toggleSelectAll}
                          title="Select / Deselect All"
                        />
                      </th>
                      <th style={{ width: "36px", textAlign: "center" }}>#</th>
                      <th>Model</th>
                      <th>Serial</th>
                      <th>Connection</th>
                      <th>Build Type</th>
                      <th>IP Address</th>
                      <th>Battery</th>
                      <th>Temp</th>
                      <th>Brightness</th>
                      <th>Timeout</th>
                      <th>Fingerprint</th>
                      <th>Sales Code</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device, idx) => {
                      const isWireless = device.connection_type === "wireless";
                      const currentIp = manualIps[device.serial] || "";
                      const isSelected = selectedSerials.includes(device.serial);
                      const indexStr = String(idx + 1).padStart(2, "0");

                      return (
                        <tr key={device.serial} className={isSelected ? "row-selected" : ""}>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectDevice(device.serial)}
                            />
                          </td>
                          <td style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-muted)", fontSize: "0.6875rem" }}>
                            {indexStr}
                          </td>
                          <td>
                            <span
                              className="device-model-badge"
                              style={getModelStyle(device.properties.model)}
                            >
                              {device.properties.model || "N/A"}
                            </span>
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                            {device.serial}
                          </td>
                          <td>
                            <span className={`badge ${isWireless ? "active-badge" : ""}`}>
                              {device.connection_type}
                            </span>
                          </td>
                          <td>{getBuildTypeBadge(device.properties.build_type)}</td>
                          <td style={{ fontFamily: "var(--font-mono)" }}>
                            {!isWireless ? (
                              <input
                                type="text"
                                value={currentIp}
                                onChange={(e) => setManualIps({ ...manualIps, [device.serial]: e.target.value })}
                                placeholder="IP Address"
                                style={{ width: "95px", padding: "1px 4px", fontSize: "0.625rem" }}
                              />
                            ) : (
                              device.ip || "N/A"
                            )}
                          </td>
                          <td>{getBatteryBadge(device.properties.battery)}</td>
                          <td>{getTempBadge(device.properties.temperature)}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <input
                                type="range"
                                min="0"
                                max="255"
                                value={brightnessValues[device.serial] ?? 128}
                                onChange={(e) => setBrightnessValues({ ...brightnessValues, [device.serial]: parseInt(e.target.value) })}
                                onMouseUp={() => handleSetBrightness(device.serial, brightnessValues[device.serial])}
                                style={{ width: "55px" }}
                              />
                              <span className="slider-val">{brightnessValues[device.serial] ?? 128}</span>
                            </div>
                          </td>
                          <td>
                            <select
                              onChange={(e) => handleSetTimeout(device.serial, parseInt(e.target.value))}
                              defaultValue="60000"
                              style={{ padding: "0 14px 0 2px", fontSize: "0.625rem" }}
                            >
                              <option value="15000">15s</option>
                              <option value="60000">1m</option>
                              <option value="300000">5m</option>
                              <option value="2147483647">Max</option>
                            </select>
                          </td>
                          <td style={{ maxWidth: "160px", whiteSpace: "normal", wordBreak: "break-all", fontSize: "0.55rem" }}>
                            {device.properties.fingerprint || "N/A"}
                          </td>
                          <td>{device.properties.sales_code || "N/A"}</td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "4px" }}>
                              {isWireless ? (
                                <button onClick={() => handleDisconnectWireless(device.ip)}>
                                  Disconnect
                                </button>
                              ) : (
                                <button
                                  className="primary"
                                  onClick={() => handleConnectWireless(device.serial)}
                                  disabled={!currentIp.trim()}
                                >
                                  Pair
                                </button>
                              )}
                              <button
                                onClick={() => handleStartScrcpy(device.serial)}
                                style={{ background: "#ffffff", color: "#000000" }}
                              >
                                Mirror
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              ["usb", "wireless"].map((groupType) => {
                const groupDevices = devices.filter(d => d.connection_type === groupType);
                const isOpen = groupType === "usb" ? openUsb : openWireless;
                const setOpen = groupType === "usb" ? setOpenUsb : setOpenWireless;
                const label = groupType === "usb" ? "USB" : "Wireless";
                const isWirelessGroup = groupType === "wireless";
                const isCollapsed = !isOpen;

                return (
                  <div key={groupType} className={`accordion-group ${isWirelessGroup ? "wireless-group" : "usb-group"} ${isCollapsed ? "collapsed" : ""}`}>
                    {/* Accordion Header */}
                    <button
                      id={`accordion-${groupType}`}
                      className={`accordion-header ${groupType === "usb" ? "usb-header" : "wireless-header"}`}
                      onClick={() => setOpen(!isOpen)}
                    >
                      <span className="accordion-label">
                        <span className="accordion-icon">{groupType === "usb" ? "🔌" : "📡"}</span>
                        {label} Devices
                      </span>
                      <span className="accordion-meta">
                        <span className="accordion-count">{groupDevices.length}</span>
                        <span className={`accordion-chevron ${isOpen ? "open" : ""}`}>▾</span>
                      </span>
                    </button>

                    {/* Accordion Content */}
                    {isOpen && (
                      <div className="accordion-body">
                        {groupDevices.length === 0 ? (
                          <div className="accordion-empty">No {label.toLowerCase()} devices connected.</div>
                        ) : (
                          groupDevices.map((device) => {
                            const isWireless = device.connection_type === "wireless";
                            const currentIp = manualIps[device.serial] || "";
                            return (
                              <div key={device.serial} className={`device-card ${isWireless ? "wireless-card" : "usb-card"}`}>
                                <div className="device-card-top">
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                    <span
                                      className="device-model-badge"
                                      style={getModelStyle(device.properties.model)}
                                      title={device.properties.model || "N/A"}
                                    >
                                      {device.properties.model || "N/A"}
                                    </span>
                                    <span className={`badge ${isWireless ? "active-badge" : ""}`}>
                                      {device.connection_type}
                                    </span>
                                    {getBuildTypeBadge(device.properties.build_type)}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    {!isWireless && (
                                      <input
                                        id={`ip-input-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                                        type="text"
                                        value={currentIp}
                                        onChange={(e) => setManualIps({ ...manualIps, [device.serial]: e.target.value })}
                                        placeholder="IP Address"
                                        style={{ width: "95px", padding: "2px 4px", fontSize: "0.625rem" }}
                                      />
                                    )}
                                    {isWireless ? (
                                      <button
                                        id={`disconnect-btn-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                                        onClick={() => handleDisconnectWireless(device.ip)}
                                      >
                                        Disconnect
                                      </button>
                                    ) : (
                                      <button
                                        id={`connect-btn-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                                        className="primary"
                                        onClick={() => handleConnectWireless(device.serial)}
                                        disabled={!currentIp.trim()}
                                      >
                                        Pair Wireless
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Proplist Grid */}
                                <div className="device-details-grid">
                                  <div className="detail-item">
                                    <span className="detail-label">Serial</span>
                                    <span className="detail-value" title={device.serial}>{device.serial}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Battery</span>
                                    <span className="detail-value">{device.properties.battery || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Temperature</span>
                                    <span className="detail-value">{device.properties.temperature || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Android</span>
                                    <span className="detail-value" title={device.properties.release}>{device.properties.release || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">SDK</span>
                                    <span className="detail-value" title={device.properties.sdk}>{device.properties.sdk || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Security</span>
                                    <span className="detail-value" title={device.properties.security_patch}>{device.properties.security_patch || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">PDA</span>
                                    <span className="detail-value" title={device.properties.pda}>{device.properties.pda || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">SW Ver</span>
                                    <span className="detail-value" title={device.properties.sw_ver}>{device.properties.sw_ver || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">CSC Ver</span>
                                    <span className="detail-value" title={device.properties.official_cscver}>{device.properties.official_cscver || "N/A"}</span>
                                  </div>
                                  <div className="detail-item fingerprint-item" style={{ gridColumn: "span 3" }}>
                                    <span className="detail-label">Fingerprint</span>
                                    <span className="detail-value" title={device.properties.fingerprint}>{device.properties.fingerprint || "N/A"}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">Sales Code</span>
                                    <span className="detail-value" title={device.properties.sales_code}>{device.properties.sales_code || "N/A"}</span>
                                  </div>
                                </div>

                                {/* Control Row */}
                                <div className="device-card-controls">
                                  <div>
                                    <div className="control-label" style={{ marginBottom: "2px" }}>Screen Brightness</div>
                                    <div className="control-row">
                                      <input
                                        id={`brightness-range-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                                        type="range" min="0" max="255"
                                        value={brightnessValues[device.serial] ?? 128}
                                        onChange={(e) => setBrightnessValues({ ...brightnessValues, [device.serial]: parseInt(e.target.value) })}
                                        onMouseUp={() => handleSetBrightness(device.serial, brightnessValues[device.serial])}
                                        onTouchEnd={() => handleSetBrightness(device.serial, brightnessValues[device.serial])}
                                      />
                                      <span className="slider-val">{brightnessValues[device.serial] ?? 128}</span>
                                      <button id={`bright-min-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`} onClick={() => handleSetBrightness(device.serial, 5)} style={{ padding: "2px 4px", fontSize: "0.625rem" }}>Min</button>
                                      <button id={`bright-max-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`} onClick={() => handleSetBrightness(device.serial, 255)} style={{ padding: "2px 4px", fontSize: "0.625rem" }}>Max</button>
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "8px", marginTop: "4px" }}>
                                    <div style={{ flex: 1 }}>
                                      <div className="control-label" style={{ marginBottom: "2px" }}>Screen Timeout</div>
                                      <div className="control-row" style={{ gap: "4px" }}>
                                        <select
                                          id={`timeout-select-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                                          onChange={(e) => handleSetTimeout(device.serial, parseInt(e.target.value))}
                                          defaultValue="60000"
                                          style={{ height: "20px", padding: "0 14px 0 4px", fontSize: "0.625rem" }}
                                        >
                                          <option value="15000">15 sec</option>
                                          <option value="60000">1 min</option>
                                          <option value="300000">5 min</option>
                                          <option value="600000">10 min</option>
                                          <option value="1800000">30 min</option>
                                          <option value="2147483647">Keep Awake</option>
                                        </select>
                                        <button id={`timeout-min-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`} onClick={() => handleSetTimeout(device.serial, 15000)} style={{ padding: "2px 4px", fontSize: "0.625rem" }}>Min</button>
                                        <button id={`timeout-max-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`} onClick={() => handleSetTimeout(device.serial, 2147483647)} style={{ padding: "2px 4px", fontSize: "0.625rem" }}>Max</button>
                                      </div>
                                    </div>
                                    <button
                                      id={`scrcpy-btn-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                                      onClick={() => handleStartScrcpy(device.serial)}
                                      style={{ height: "20px", padding: "0 8px", background: "#ffffff", color: "#000000", border: "1px solid #ffffff" }}
                                    >
                                      Mirror View
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Stats & Logs & Global Gesture Pad */}
        <aside className={`sidebar-logs ${!isSidebarOpen ? "collapsed" : ""}`}>
          {/* Summary Panel */}
          <div className="summary-panel">
            <h3 className="panel-title">Statistics</h3>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="label">Total Devices:</span>
                <span className="val">{totalCount}</span>
              </div>
              <div className="summary-item">
                <span className="label">USB Devices:</span>
                <span className="val">{usbCount}</span>
              </div>
              <div className="summary-item">
                <span className="label">Wireless Devices:</span>
                <span className="val">{wirelessCount}</span>
              </div>
            </div>
          </div>

          {/* Global Gesture Touchpad Panel */}
          <div className="gesture-panel">
            <div className="console-header" style={{ borderTop: "none" }}>
              <span>🎮 Global Gesture Pad ({devices.length})</span>
            </div>
            
            {/* Interactive Screen Touchpad Canvas */}
            <div
              className="touchpad-area"
              onMouseDown={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const startX = Math.round(((e.clientX - rect.left) / rect.width) * 1080);
                const startY = Math.round(((e.clientY - rect.top) / rect.height) * 2400);
                const startTime = Date.now();

                const handleMouseUp = (upEvent: MouseEvent) => {
                  window.removeEventListener("mouseup", handleMouseUp);
                  const endX = Math.round(((upEvent.clientX - rect.left) / rect.width) * 1080);
                  const endY = Math.round(((upEvent.clientY - rect.top) / rect.height) * 2400);
                  const durationMs = Math.max(Date.now() - startTime, 100);
                  const dist = Math.hypot(endX - startX, endY - startY);
                  const targetSerials = devices.map(d => d.serial);

                  if (dist < 20) {
                    // Tap action
                    invoke("send_tap_event", { serials: targetSerials, x: startX, y: startY });
                    addLog(`[Global Touch] Tap at (${startX}, ${startY}) broadcasted to ${targetSerials.length} device(s)`, "info");
                  } else {
                    // Drag / Swipe action
                    invoke("send_swipe_event", { serials: targetSerials, x1: startX, y1: startY, x2: endX, y2: endY, durationMs });
                    addLog(`[Global Touch] Drag (${startX},${startY}) ➔ (${endX},${endY}) broadcasted to ${targetSerials.length} device(s)`, "info");
                  }
                };
                window.addEventListener("mouseup", handleMouseUp);
              }}
            >
              {/* Reference Preview Image if available */}
              {devices.length > 0 && screenPreviews[devices[0].serial] ? (
                <img
                  src={screenPreviews[devices[0].serial]}
                  alt="Gesture Canvas"
                  className="touchpad-preview-img"
                />
              ) : (
                <div className="touchpad-placeholder">
                  <span>Interactive Touchscreen</span>
                  <span style={{ fontSize: "0.55rem", opacity: 0.6 }}>Click / Drag anywhere to control all devices</span>
                </div>
              )}
            </div>

            {/* Quick Swipe & Nav Bar */}
            <div className="gesture-btn-grid">
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_swipe_event", { serials: targetSerials, x1: 540, y1: 1800, x2: 540, y2: 600, durationMs: 300 });
                addLog(`[Global Gesture] Swipe Up sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ⬆️ Swipe Up
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_swipe_event", { serials: targetSerials, x1: 540, y1: 600, x2: 540, y2: 1800, durationMs: 300 });
                addLog(`[Global Gesture] Swipe Down sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ⬇️ Swipe Down
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_swipe_event", { serials: targetSerials, x1: 900, y1: 1200, x2: 180, y2: 1200, durationMs: 300 });
                addLog(`[Global Gesture] Swipe Left sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ⬅️ Swipe Left
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_swipe_event", { serials: targetSerials, x1: 180, y1: 1200, x2: 900, y2: 1200, durationMs: 300 });
                addLog(`[Global Gesture] Swipe Right sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ➡️ Swipe Right
              </button>
            </div>

            {/* Navigation Keys */}
            <div className="gesture-btn-grid" style={{ marginTop: "4px" }}>
              <button className="primary" onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "3" }); // KEYCODE_HOME
                addLog(`[Global Gesture] HOME key sent to ${targetSerials.length} device(s)`, "info");
              }}>
                🏠 Home
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "4" }); // KEYCODE_BACK
                addLog(`[Global Gesture] BACK key sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ◀️ Back
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "187" }); // KEYCODE_APP_SWITCH
                addLog(`[Global Gesture] RECENT APPS sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ▢ Recents
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "26" }); // KEYCODE_POWER
                addLog(`[Global Gesture] POWER key sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ⚡ Power
              </button>
            </div>

            {/* Global Volume & Media Controls */}
            <div className="gesture-btn-grid-5" style={{ marginTop: "4px" }}>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "24" }); // KEYCODE_VOLUME_UP
                addLog(`[Global Volume] Volume UP sent to ${targetSerials.length} device(s)`, "info");
              }}>
                🔊 Vol +
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "25" }); // KEYCODE_VOLUME_DOWN
                addLog(`[Global Volume] Volume DOWN sent to ${targetSerials.length} device(s)`, "info");
              }}>
                🔉 Vol -
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "164" }); // KEYCODE_VOLUME_MUTE
                addLog(`[Global Volume] Volume MUTE sent to ${targetSerials.length} device(s)`, "info");
              }}>
                🔇 Mute
              </button>
              <button onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("send_key_event", { serials: targetSerials, keycode: "85" }); // KEYCODE_MEDIA_PLAY_PAUSE
                addLog(`[Global Media] Play/Pause sent to ${targetSerials.length} device(s)`, "info");
              }}>
                ⏯️ Play/Pause
              </button>
              <button title="Toggle Lock Screen Orientation (Auto-Rotate)" onClick={() => {
                const targetSerials = devices.map(d => d.serial);
                invoke("toggle_screen_orientation", { serials: targetSerials });
                addLog(`[Global Display] Toggle Orientation Lock sent to ${targetSerials.length} device(s)`, "info");
              }}>
                🔒 Orient
              </button>
            </div>

            {/* Global YouTube Broadcast Box */}
            <div style={{ marginTop: "8px" }}>
              <div className="drawer-section-title" style={{ marginBottom: "4px" }}>▶ Broadcast YouTube / Web URL</div>
              <div className="url-broadcast-box">
                <input
                  type="text"
                  placeholder="https://youtu.be/..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOpenYoutube();
                  }}
                />
                <button className="primary" onClick={() => handleOpenYoutube()}>
                  Play All
                </button>
              </div>
            </div>
          </div>

          {/* Running Logs */}
          <div className="console-header">
            <span>Running Log</span>
            <button id="clear-log-btn" className="btn-text" onClick={clearLogs}>
              [ Clear Log ]
            </button>
          </div>
          <div className="log-panel" style={{ flex: "0 0 160px" }}>
            {logs.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No log output.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="log-line">
                  <span className="log-time">[{log.time}]</span>
                  <span className={`log-text ${log.type}`}>{log.text}</span>
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
