use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn save_server_context_file(profile_id: String, context: String) -> Result<String, String> {
    let directory = server_context_directory()?;
    fs::create_dir_all(&directory)
        .map_err(|e| format!("Failed to create server context directory: {e}"))?;

    let file_path = directory.join(format!("{}.txt", sanitize_file_name(&profile_id)));
    fs::write(&file_path, context)
        .map_err(|e| format!("Failed to write server context file: {e}"))?;

    Ok(file_path.to_string_lossy().to_string())
}

fn server_context_directory() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not resolve an application data directory.".to_string())?;

    Ok(base_dir.join("ai-terminal").join("server-contexts"))
}

fn sanitize_file_name(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();

    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "profile".to_string()
    } else {
        trimmed.to_string()
    }
}
