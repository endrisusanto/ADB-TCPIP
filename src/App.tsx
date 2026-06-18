import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface DeviceProps {
  serial: string;
  model: string;
  release: string;
  sdk: string;
  security_patch: string;
  sales_code: string;
  pda: string;
  sw_ver: string;
  official_cscver: string;
  fingerprint: string;
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

function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [manualIps, setManualIps] = useState<Record<string, string>>({});
  const [brightnessValues, setBrightnessValues] = useState<Record<string, number>>({});
  const [filterUsb, setFilterUsb] = useState<boolean>(true);
  const [filterWireless, setFilterWireless] = useState<boolean>(true);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef<number>(0);

  const addLog = (text: string, type: "info" | "success" | "error" = "info") => {
    const time = new Date().toLocaleTimeString();
    const id = logIdCounter.current++;
    setLogs((prev) => [...prev, { id, time, text, type }]);
  };

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

    addLog(`Attempting to connect ${usbDevices.length} USB device(s) to wireless...`, "info");
    for (const d of usbDevices) {
      const ip = manualIps[d.serial];
      if (ip && ip.trim()) {
        await handleConnectWireless(d.serial, ip);
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

  return (
    <div className="app-container">
      <header>
        <div className="brand">
          <img src="/adb.png" alt="ADB" className="app-logo" />
          <h1 id="app-title">ADB Wireless Device Farm</h1>
          <p>Utility Dashboard</p>
        </div>
        <div className="global-actions">
          <button id="scan-btn" onClick={scanDevices} disabled={loading}>
            {loading ? <div className="spinner" /> : "Scan Devices"}
          </button>
          <button id="connect-all-btn" className="primary" onClick={handleConnectAllWireless} disabled={loading || usbCount === 0}>
            Connect All Wireless
          </button>
        </div>
      </header>

      <div className="app-layout">
        {/* Left Column: Device Cards List */}
        <section className="devices-pane">
          <div className="pane-header">
            <h3>Connected Devices</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.6875rem", cursor: "pointer", color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={filterUsb} onChange={(e) => setFilterUsb(e.target.checked)} style={{ width: "12px", height: "12px" }} />
                USB
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.6875rem", cursor: "pointer", color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={filterWireless} onChange={(e) => setFilterWireless(e.target.checked)} style={{ width: "12px", height: "12px" }} />
                Wireless
              </label>
              <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginLeft: "4px" }}>
                ({devices.filter(d => {
                  if (d.connection_type === "usb" && !filterUsb) return false;
                  if (d.connection_type === "wireless" && !filterWireless) return false;
                  return true;
                }).length} shown)
              </span>
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
            ) : (
              devices
                .filter((device) => {
                  if (device.connection_type === "usb" && !filterUsb) return false;
                  if (device.connection_type === "wireless" && !filterWireless) return false;
                  return true;
                })
                .map((device) => {
                  const isWireless = device.connection_type === "wireless";
                  const currentIp = manualIps[device.serial] || "";

                  return (
                    <div key={device.serial} className={`device-card ${isWireless ? "wireless-card" : "usb-card"}`}>
                    <div className="device-card-top">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className="device-id">{device.serial}</span>
                        <span className={`badge ${isWireless ? "active-badge" : ""}`}>
                          {device.connection_type}
                        </span>
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
                        <span className="detail-label">Model</span>
                        <span className="detail-value" title={device.properties.model}>{device.properties.model || "N/A"}</span>
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
                        <span className="detail-label">Sales Code</span>
                        <span className="detail-value" title={device.properties.sales_code}>{device.properties.sales_code || "N/A"}</span>
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
                      <div className="detail-item" style={{ gridColumn: "span 3" }}>
                        <span className="detail-label">Fingerprint</span>
                        <span className="detail-value" title={device.properties.fingerprint}>{device.properties.fingerprint || "N/A"}</span>
                      </div>
                    </div>

                    {/* Control Row */}
                    <div className="device-card-controls">
                      {/* Brightness Section */}
                      <div>
                        <div className="control-label" style={{ marginBottom: "2px" }}>Screen Brightness</div>
                        <div className="control-row">
                          <input 
                            id={`brightness-range-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                            type="range" 
                            min="0" 
                            max="255" 
                            value={brightnessValues[device.serial] ?? 128}
                            onChange={(e) => setBrightnessValues({ ...brightnessValues, [device.serial]: parseInt(e.target.value) })}
                            onMouseUp={() => handleSetBrightness(device.serial, brightnessValues[device.serial])}
                            onTouchEnd={() => handleSetBrightness(device.serial, brightnessValues[device.serial])}
                          />
                          <span className="slider-val">{brightnessValues[device.serial] ?? 128}</span>
                          <button 
                            id={`bright-min-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                            onClick={() => handleSetBrightness(device.serial, 5)}
                            style={{ padding: "2px 4px", fontSize: "0.625rem" }}
                          >
                            Min
                          </button>
                          <button 
                            id={`bright-max-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                            onClick={() => handleSetBrightness(device.serial, 255)}
                            style={{ padding: "2px 4px", fontSize: "0.625rem" }}
                          >
                            Max
                          </button>
                        </div>
                      </div>

                      {/* Timeout and Scrcpy Section */}
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
                            <button 
                              id={`timeout-min-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                              onClick={() => handleSetTimeout(device.serial, 15000)}
                              style={{ padding: "2px 4px", fontSize: "0.625rem" }}
                            >
                              Min
                            </button>
                            <button 
                              id={`timeout-max-${device.serial.replace(/[^a-zA-Z0-9]/g, "-")}`}
                              onClick={() => handleSetTimeout(device.serial, 2147483647)}
                              style={{ padding: "2px 4px", fontSize: "0.625rem" }}
                            >
                              Max
                            </button>
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
        </section>

        {/* Right Column: Stats & Logs */}
        <aside className="sidebar-logs">
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

          {/* Running Logs */}
          <div className="console-header">
            <span>Running Log</span>
            <button id="clear-log-btn" className="btn-text" onClick={clearLogs}>
              [ Clear Log ]
            </button>
          </div>
          <div className="log-panel">
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
