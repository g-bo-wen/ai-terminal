use serde_json::{json, Value};
use std::fs::{create_dir_all, read_dir, remove_dir_all, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};

const AI_CHAT_LOG_DIR_NAME: &str = "ai-chat-sessions";
const AI_CHAT_EVENTS_FILE_NAME: &str = "events.jsonl";
const AI_CHAT_CONVERSATION_FILE_NAME: &str = "conversation.json";
const UNASSIGNED_CONVERSATION_ID: &str = "unassigned";

#[command]
pub fn write_ai_log_event(app_handle: AppHandle, event: Value) -> Result<String, String> {
    let conversation_id = event
        .get("conversationId")
        .and_then(Value::as_str)
        .unwrap_or(UNASSIGNED_CONVERSATION_ID);
    let log_file_path = get_ai_conversation_dir_for_app(&app_handle, conversation_id)?
        .join(AI_CHAT_EVENTS_FILE_NAME);
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

#[command]
pub fn get_ai_log_directory_path(app_handle: AppHandle) -> Result<String, String> {
    get_ai_log_root_dir_for_app(&app_handle).map(|path| path.to_string_lossy().to_string())
}

#[command]
pub fn save_ai_conversation(app_handle: AppHandle, conversation: Value) -> Result<String, String> {
    let conversation_id = conversation
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Conversation is missing an id".to_string())?;
    let conversation_dir = get_ai_conversation_dir_for_app(&app_handle, conversation_id)?;
    create_dir_all(&conversation_dir).map_err(|error| {
        format!(
            "Could not create AI conversation directory '{}': {}",
            conversation_dir.to_string_lossy(),
            error
        )
    })?;

    let conversation_file_path = conversation_dir.join(AI_CHAT_CONVERSATION_FILE_NAME);
    let mut file = File::create(&conversation_file_path).map_err(|error| {
        format!(
            "Could not create AI conversation file '{}': {}",
            conversation_file_path.to_string_lossy(),
            error
        )
    })?;

    serde_json::to_writer_pretty(&mut file, &conversation)
        .map_err(|error| format!("Could not serialize AI conversation: {}", error))?;
    file.write_all(b"\n")
        .map_err(|error| format!("Could not write AI conversation newline: {}", error))?;
    file.flush()
        .map_err(|error| format!("Could not flush AI conversation file: {}", error))?;

    Ok(conversation_file_path.to_string_lossy().to_string())
}

#[command]
pub fn list_ai_conversations(app_handle: AppHandle, limit: Option<usize>) -> Result<Vec<Value>, String> {
    let root_dir = get_ai_log_root_dir_for_app(&app_handle)?;
    if !root_dir.exists() {
        return Ok(Vec::new());
    }

    let mut conversations = Vec::new();
    let entries = read_dir(&root_dir).map_err(|error| {
        format!(
            "Could not read AI conversation directory '{}': {}",
            root_dir.to_string_lossy(),
            error
        )
    })?;

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if !file_type.is_dir() {
            continue;
        }

        let conversation_file_path = entry.path().join(AI_CHAT_CONVERSATION_FILE_NAME);
        if !conversation_file_path.exists() {
            continue;
        }

        let mut file = match File::open(&conversation_file_path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            continue;
        }

        if let Ok(conversation) = serde_json::from_str::<Value>(&content) {
            conversations.push(conversation);
        }
    }

    conversations.sort_by(|left, right| {
        let left_updated_at = left
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_updated_at = right
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        right_updated_at.cmp(left_updated_at)
    });

    let max_count = limit.unwrap_or(10);
    conversations.truncate(max_count);
    Ok(conversations)
}

#[command]
pub fn delete_ai_conversation(app_handle: AppHandle, conversation_id: String) -> Result<(), String> {
    let conversation_dir = get_ai_conversation_dir_for_app(&app_handle, &conversation_id)?;
    if !conversation_dir.exists() {
        return Ok(());
    }

    remove_dir_all(&conversation_dir).map_err(|error| {
        format!(
            "Could not delete AI conversation directory '{}': {}",
            conversation_dir.to_string_lossy(),
            error
        )
    })
}

fn get_ai_log_file_path_for_app(app_handle: &AppHandle) -> Result<PathBuf, String> {
    get_ai_conversation_dir_for_app(app_handle, UNASSIGNED_CONVERSATION_ID)
        .map(|conversation_dir| conversation_dir.join(AI_CHAT_EVENTS_FILE_NAME))
}

fn get_ai_log_root_dir_for_app(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_log_dir()
        .map(|log_dir| log_dir.join(AI_CHAT_LOG_DIR_NAME))
        .map_err(|error| format!("Could not resolve AI log directory: {}", error))
}

fn get_ai_conversation_dir_for_app(
    app_handle: &AppHandle,
    conversation_id: &str,
) -> Result<PathBuf, String> {
    let root_dir = get_ai_log_root_dir_for_app(app_handle)?;
    let safe_conversation_id = sanitize_path_segment(conversation_id);
    Ok(root_dir.join(safe_conversation_id))
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect();

    let trimmed = sanitized.trim_matches('.').trim_matches('_');
    if trimmed.is_empty() {
        UNASSIGNED_CONVERSATION_ID.to_string()
    } else {
        trimmed.to_string()
    }
}
