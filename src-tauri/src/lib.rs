use std::process::Command;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DeviceProps {
    pub serial: String,
    pub model: String,
    pub release: String,
    pub sdk: String,
    pub security_patch: String,
    pub sales_code: String,
    pub pda: String,
    pub sw_ver: String,
    pub official_cscver: String,
    pub fingerprint: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DeviceInfo {
    pub serial: String,
    pub connection_type: String, // "usb" or "wireless"
    pub ip: String,
    pub properties: DeviceProps,
}

fn run_adb(args: &[&str]) -> Result<String, String> {
    let output = Command::new("adb")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute adb: {}", e))?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

// ponytail: keep IP detection simple by trying common methods sequentially
fn get_device_ip(serial: &str) -> Option<String> {
    // Method 1: Check via wlan0 ip addr show
    if let Ok(out) = run_adb(&["-s", serial, "shell", "ip", "addr", "show", "wlan0"]) {
        for line in out.lines() {
            if line.contains("inet ") {
                let parts: Vec<&str> = line.trim().split_whitespace().collect();
                if parts.len() > 1 {
                    if let Some(ip_with_subnet) = parts.get(1) {
                        let ip = ip_with_subnet.split('/').next().unwrap_or("");
                        if !ip.is_empty() && ip.contains('.') {
                            return Some(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    // Method 2: Try getprop dhcp.wlan0.ipaddress
    if let Ok(ip) = run_adb(&["-s", serial, "shell", "getprop", "dhcp.wlan0.ipaddress"]) {
        let ip = ip.trim();
        if !ip.is_empty() && ip.contains('.') {
            return Some(ip.to_string());
        }
    }

    // Method 3: Try parsing ip route
    if let Ok(out) = run_adb(&["-s", serial, "shell", "ip", "route"]) {
        for line in out.lines() {
            if line.contains("dev wlan0") || line.contains("wlan") {
                if let Some(pos) = line.find("src ") {
                    let parts: Vec<&str> = line[pos + 4..].split_whitespace().collect();
                    if let Some(ip) = parts.first() {
                        if ip.contains('.') {
                            return Some(ip.to_string());
                        }
                    }
                }
            }
        }
    }
    
    None
}

// ponytail: single getprop shell call to avoid multiple serial connection overhead
fn get_properties(serial: &str) -> DeviceProps {
    let mut model = String::new();
    let mut release = String::new();
    let mut sdk = String::new();
    let mut security_patch = String::new();
    let mut sales_code = String::new();
    let mut pda = String::new();
    let mut sw_ver = String::new();
    let mut official_cscver = String::new();
    let mut fingerprint = String::new();

    if let Ok(out) = run_adb(&["-s", serial, "shell", "getprop"]) {
        for line in out.lines() {
            if let (Some(start_key), Some(end_key)) = (line.find('['), line.find(']')) {
                let key = &line[start_key + 1..end_key];
                let rest = &line[end_key + 1..];
                if let (Some(start_val), Some(end_val)) = (rest.find('['), rest.rfind(']')) {
                    let val = &rest[start_val + 1..end_val];
                    
                    match key {
                        "ro.product.model" => model = val.to_string(),
                        "ro.build.version.release" => release = val.to_string(),
                        "ro.system.build.version.sdk_full" | "ro.build.version.sdk" => {
                            if sdk.is_empty() || key == "ro.system.build.version.sdk_full" {
                                sdk = val.to_string();
                            }
                        }
                        "ro.build.version.security_patch" => security_patch = val.to_string(),
                        "ro.csc.sales_code" => sales_code = val.to_string(),
                        "ro.build.PDA" => pda = val.to_string(),
                        "ril.sw_ver" => sw_ver = val.to_string(),
                        "ril.official_cscver" => official_cscver = val.to_string(),
                        "ro.build.fingerprint" => fingerprint = val.to_string(),
                        _ => {}
                    }
                }
            }
        }
    }

    DeviceProps {
        serial: serial.to_string(),
        model,
        release,
        sdk,
        security_patch,
        sales_code,
        pda,
        sw_ver,
        official_cscver,
        fingerprint,
    }
}

#[tauri::command]
async fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    let output = run_adb(&["devices"])?;
    let mut devices = Vec::new();
    
    for line in output.lines() {
        if line.starts_with("List of devices") || line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 && parts[1] == "device" {
            let serial = parts[0].to_string();
            let is_wireless = serial.contains(':');
            let connection_type = if is_wireless { "wireless".to_string() } else { "usb".to_string() };
            
            let ip = if is_wireless {
                serial.split(':').next().unwrap_or("").to_string()
            } else {
                get_device_ip(&serial).unwrap_or_default()
            };
            
            let properties = get_properties(&serial);
            
            devices.push(DeviceInfo {
                serial,
                connection_type,
                ip,
                properties,
            });
        }
    }
    
    Ok(devices)
}

#[tauri::command]
async fn connect_wireless(serial: String, ip: String) -> Result<String, String> {
    if ip.trim().is_empty() {
        return Err("Device IP address is unknown. Connect device to Wi-Fi.".to_string());
    }
    
    // 1. Restart adb in tcpip mode on port 5555
    run_adb(&["-s", &serial, "tcpip", "5555"])?;
    
    // 2. Wait 1.5 seconds for adbd to restart
    std::thread::sleep(std::time::Duration::from_millis(1500));
    
    // 3. Connect via adb connect
    let connect_target = format!("{}:5555", ip);
    let connect_res = run_adb(&["connect", &connect_target])?;
    
    Ok(connect_res)
}

#[tauri::command]
async fn disconnect_wireless(ip: String) -> Result<String, String> {
    let target = format!("{}:5555", ip);
    let res = run_adb(&["disconnect", &target])?;
    Ok(res)
}

#[tauri::command]
async fn set_brightness(serial: String, brightness: i32) -> Result<(), String> {
    // Disable adaptive brightness (0) first, then apply manual brightness
    let _ = run_adb(&["-s", &serial, "shell", "settings", "put", "system", "screen_brightness_mode", "0"]);
    run_adb(&["-s", &serial, "shell", "settings", "put", "system", "screen_brightness", &brightness.to_string()])?;
    Ok(())
}

#[tauri::command]
async fn set_timeout(serial: String, timeout_ms: i32) -> Result<(), String> {
    run_adb(&["-s", &serial, "shell", "settings", "put", "system", "screen_off_timeout", &timeout_ms.to_string()])?;
    Ok(())
}

#[tauri::command]
async fn start_scrcpy(serial: String) -> Result<(), String> {
    // ponytail: spawn independent process to keep app active and robust
    let child = Command::new("scrcpy")
        .arg("-s")
        .arg(&serial)
        .spawn();
        
    match child {
        Ok(_) => Ok(()),
        Err(e) => Err(format!(
            "Failed to start scrcpy: {}. Make sure scrcpy is installed and in your PATH.",
            e
        )),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_devices,
            connect_wireless,
            disconnect_wireless,
            set_brightness,
            set_timeout,
            start_scrcpy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

