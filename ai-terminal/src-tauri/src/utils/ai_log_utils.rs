use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};

const AI_CHAT_LOG_FILE_NAME: &str = "ai-chat.jsonl";

#[command]
pub fn write_ai_log_event(app_handle: AppHandle, event: Value) -> Result<String, String> {
    let log_file_path = get_ai_log_file_path_for_app(&app_handle)?;
    let log_dir = log_file_path
        .parent()
        .ok_or_else(|| "Could not determine AI log directory".to_string())?;

    create_dir_all(log_dir).map_err(|error| {
        format!(
            "Could not create AI log directory '{}': {}",
            log_dir.to_string_lossy(),
            error
        )
    })?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)
        .map_err(|error| {
            format!(
                "Could not open AI log file '{}': {}",
                log_file_path.to_string_lossy(),
                error
            )
        })?;

    let logged_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error while writing AI log: {}", error))?
        .as_millis();

    let record = json!({
        "loggedAtUnixMs": logged_at_unix_ms,
        "event": event
    });

    serde_json::to_writer(&mut file, &record)
        .map_err(|error| format!("Could not serialize AI log event: {}", error))?;
    file.write_all(b"\n")
        .map_err(|error| format!("Could not write AI log newline: {}", error))?;
    file.flush()
        .map_err(|error| format!("Could not flush AI log file: {}", error))?;

    Ok(log_file_path.to_string_lossy().to_string())
}

#[command]
pub fn get_ai_log_file_path(app_handle: AppHandle) -> Result<String, String> {
    get_ai_log_file_path_for_app(&app_handle).map(|path| path.to_string_lossy().to_string())
}

fn get_ai_log_file_path_for_app(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_log_dir()
        .map(|log_dir| log_dir.join(AI_CHAT_LOG_FILE_NAME))
        .map_err(|error| format!("Could not resolve AI log directory: {}", error))
}
