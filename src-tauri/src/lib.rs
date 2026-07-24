use std::process::Command;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DeviceProps {
    pub serial: String,
    pub model: String,
    pub battery: String,
    pub temperature: String,
    pub release: String,
    pub sdk: String,
    pub security_patch: String,
    pub sales_code: String,
    pub pda: String,
    pub sw_ver: String,
    pub official_cscver: String,
    pub fingerprint: String,
    pub build_type: String,
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
        .env("ADB_MDNS_OPENSCREEN", "0")
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
    let mut build_type = String::new();
    let mut battery = String::new();
    let mut temperature = String::new();

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
                        "ro.build.type" | "ro.system.build.type" => {
                            if build_type.is_empty() || key == "ro.build.type" {
                                build_type = val.to_string();
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if build_type.is_empty() {
        if fingerprint.contains("userdebug") {
            build_type = "userdebug".to_string();
        } else if fingerprint.contains(":user/") || fingerprint.contains("/user/") {
            build_type = "user".to_string();
        } else if fingerprint.contains("eng") {
            build_type = "eng".to_string();
        }
    }

    if let Ok(out) = run_adb(&["-s", serial, "shell", "dumpsys", "battery"]) {
        for line in out.lines() {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            match key.trim() {
                "level" => battery = format!("{}%", value.trim()),
                "temperature" => {
                    if let Ok(value) = value.trim().parse::<f32>() {
                        temperature = format!("{:.1}°C", value / 10.0);
                    }
                }
                _ => {}
            }
        }
    }

    DeviceProps {
        serial: serial.to_string(),
        model,
        battery,
        temperature,
        release,
        sdk,
        security_patch,
        sales_code,
        pda,
        sw_ver,
        official_cscver,
        fingerprint,
        build_type,
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
    
    // Ensure adb daemon is alive before switching mode
    let _ = run_adb(&["start-server"]);
    
    // 1. Restart adb in tcpip mode on port 5555
    let tcpip_res = run_adb(&["-s", &serial, "tcpip", "5555"]);
    if let Err(e) = tcpip_res {
        // If error mentions daemon died, restart daemon and retry once
        let _ = run_adb(&["start-server"]);
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let _ = run_adb(&["-s", &serial, "tcpip", "5555"]);
    }
    
    // 2. Wait 2 seconds for adbd service restart on target phone
    std::thread::sleep(std::time::Duration::from_millis(2000));
    
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
async fn send_key_event(serials: Vec<String>, keycode: String) -> Result<(), String> {
    let mut handles = Vec::new();
    for s in serials {
        let kc = keycode.clone();
        handles.push(std::thread::spawn(move || {
            let _ = run_adb(&["-s", &s, "shell", "input", "keyevent", &kc]);
        }));
    }
    for h in handles {
        let _ = h.join();
    }
    Ok(())
}

#[tauri::command]
async fn send_swipe_event(serials: Vec<String>, x1: i32, y1: i32, x2: i32, y2: i32, duration_ms: i32) -> Result<(), String> {
    let x1_str = x1.to_string();
    let y1_str = y1.to_string();
    let x2_str = x2.to_string();
    let y2_str = y2.to_string();
    let dur_str = duration_ms.to_string();
    let mut handles = Vec::new();
    for s in serials {
        let x1_c = x1_str.clone();
        let y1_c = y1_str.clone();
        let x2_c = x2_str.clone();
        let y2_c = y2_str.clone();
        let dur_c = dur_str.clone();
        handles.push(std::thread::spawn(move || {
            let _ = run_adb(&["-s", &s, "shell", "input", "swipe", &x1_c, &y1_c, &x2_c, &y2_c, &dur_c]);
        }));
    }
    for h in handles {
        let _ = h.join();
    }
    Ok(())
}

#[tauri::command]
async fn send_tap_event(serials: Vec<String>, x: i32, y: i32) -> Result<(), String> {
    let x_str = x.to_string();
    let y_str = y.to_string();
    let mut handles = Vec::new();
    for s in serials {
        let xc = x_str.clone();
        let yc = y_str.clone();
        handles.push(std::thread::spawn(move || {
            let _ = run_adb(&["-s", &s, "shell", "input", "tap", &xc, &yc]);
        }));
    }
    for h in handles {
        let _ = h.join();
    }
    Ok(())
}

#[tauri::command]
async fn open_url(serials: Vec<String>, url: String) -> Result<(), String> {
    let clean_url = url.trim().to_string();
    if clean_url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    let mut handles = Vec::new();
    for s in serials {
        let u = clean_url.clone();
        handles.push(std::thread::spawn(move || {
            let _ = run_adb(&[
                "-s",
                &s,
                "shell",
                "am",
                "start",
                "-a",
                "android.intent.action.VIEW",
                "-d",
                &u,
            ]);
        }));
    }
    for h in handles {
        let _ = h.join();
    }
    Ok(())
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

#[tauri::command]
async fn start_scrcpy_all(serials: Vec<String>) -> Result<usize, String> {
    let mut launched = 0;
    let cols = 4;
    let win_w = 340;
    let win_h = 640;

    for (idx, serial) in serials.iter().enumerate() {
        let col = idx % cols;
        let row = idx / cols;
        let x = (col * (win_w + 10)) as i32;
        let y = (row * (win_h + 35)) as i32;

        let child = Command::new("scrcpy")
            .arg("-s")
            .arg(serial)
            .arg("--window-title")
            .arg(format!("Mirror - {}", serial))
            .arg("--window-x")
            .arg(x.to_string())
            .arg("--window-y")
            .arg(y.to_string())
            .arg("--window-width")
            .arg(win_w.to_string())
            .spawn();

        if child.is_ok() {
            launched += 1;
        }
    }

    if launched == 0 && !serials.is_empty() {
        return Err("Failed to launch scrcpy for any devices. Make sure scrcpy is installed.".to_string());
    }

    Ok(launched)
}

#[tauri::command]
async fn get_device_screenshot(serial: String) -> Result<String, String> {
    use base64::Engine;
    let output = Command::new("adb")
        .arg("-s")
        .arg(&serial)
        .arg("exec-out")
        .arg("screencap")
        .arg("-p")
        .output()
        .map_err(|e| format!("ADB exec error: {}", e))?;

    if output.status.success() && !output.stdout.is_empty() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
        Ok(format!("data:image/png;base64,{}", b64))
    } else {
        Err("Failed to capture screenshot".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ponytail: tray menu minimal — Show + Quit
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|win, event| {
            // ponytail: hide instead of close
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            connect_wireless,
            disconnect_wireless,
            set_brightness,
            set_timeout,
            start_scrcpy,
            start_scrcpy_all,
            get_device_screenshot,
            send_key_event,
            send_swipe_event,
            send_tap_event,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
