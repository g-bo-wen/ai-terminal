use crate::command::types::command_manager::CommandManager;
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};
use tauri::State;

// Add a helper function to get the OS information
pub fn get_operating_system() -> String {
    #[cfg(target_os = "windows")]
    return "Windows".to_string();

    #[cfg(target_os = "macos")]
    return "macOS".to_string();

    #[cfg(target_os = "linux")]
    return "Linux".to_string();
}

#[tauri::command]
pub fn get_system_environment_variables() -> Result<Vec<(String, String)>, String> {
    let env_vars: Vec<(String, String)> = std::env::vars().collect();
    Ok(env_vars)
}

#[tauri::command]
pub fn is_process_elevated() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }

    #[cfg(target_os = "windows")]
    {
        use std::mem::size_of;
        use std::ptr::null_mut;
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token: HANDLE = null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(format!(
                    "Failed to open process token: {}",
                    std::io::Error::last_os_error()
                ));
            }

            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut returned_size = 0_u32;
            let success = GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut TOKEN_ELEVATION as *mut _,
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut returned_size,
            );
            let close_result = CloseHandle(token);

            if success == 0 {
                return Err(format!(
                    "Failed to read process elevation token: {}",
                    std::io::Error::last_os_error()
                ));
            }

            if close_result == 0 {
                return Err(format!(
                    "Failed to close process token: {}",
                    std::io::Error::last_os_error()
                ));
            }

            Ok(elevation.TokenIsElevated != 0)
        }
    }
}

#[tauri::command]
pub fn get_current_pid(
    session_id: String,
    command_manager: State<'_, CommandManager>,
) -> Result<u32, String> {
    let states = command_manager.commands.lock().map_err(|e| e.to_string())?;
    let key = session_id;

    if let Some(state) = states.get(&key) {
        Ok(state.pid.unwrap_or(0))
    } else {
        Ok(0)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistribution {
    pub name: String,
    pub state: String,
    pub version: Option<u8>,
    pub is_default: bool,
}

#[tauri::command]
pub fn list_wsl_distributions() -> Result<Vec<WslDistribution>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(Vec::new());
    }

    #[cfg(target_os = "windows")]
    {
        let output = run_wsl_list_with_timeout(Duration::from_secs(4))?;

        if !output.status.success() {
            let stderr = decode_process_output(&output.stderr);
            return Err(format!(
                "wsl.exe --list --verbose failed: {}",
                stderr.trim()
            ));
        }

        Ok(parse_wsl_distributions(&decode_process_output(&output.stdout)))
    }
}

#[cfg(target_os = "windows")]
fn run_wsl_list_with_timeout(timeout: Duration) -> Result<std::process::Output, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut child = Command::new("wsl.exe")
        .args(["--list", "--verbose"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to run wsl.exe --list --verbose: {e}"))?;

    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("Failed to read wsl.exe --list --verbose output: {e}"));
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("wsl.exe --list --verbose timed out.".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Failed while waiting for wsl.exe --list --verbose: {e}"));
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn decode_process_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let utf16: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }

    if bytes.len() > 2 && bytes[1] == 0 {
        let utf16: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }

    String::from_utf8_lossy(bytes).to_string()
}

#[cfg(target_os = "windows")]
fn parse_wsl_distributions(output: &str) -> Vec<WslDistribution> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }

            let is_default = trimmed.starts_with('*');
            let without_marker = trimmed.trim_start_matches('*').trim();
            let columns: Vec<&str> = without_marker.split_whitespace().collect();
            if columns.is_empty() {
                return None;
            }

            let version = columns.last().and_then(|value| value.parse::<u8>().ok());
            let state = columns
                .get(columns.len().saturating_sub(2))
                .map(|value| (*value).to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            let name_end = columns.len().saturating_sub(if version.is_some() { 2 } else { 1 });
            let name = columns[..name_end.max(1)].join(" ");

            Some(WslDistribution {
                name,
                state,
                version,
                is_default,
            })
        })
        .collect()
}
