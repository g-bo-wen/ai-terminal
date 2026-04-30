use crate::command::types::command_manager::CommandManager;
use std::env;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "windows"))]
use std::process::Command;
use tauri::{command, State};

#[cfg(target_os = "windows")]
pub fn get_shell_path() -> Option<String> {
    env::var("PATH").ok()
}

#[cfg(not(target_os = "windows"))]
pub fn get_shell_path() -> Option<String> {
    // First try to get the user's default shell
    let shell = {
        let shells = ["/bin/zsh", "/bin/bash", "/bin/sh"];
        for shell in shells.iter() {
            if std::path::Path::new(shell).exists() {
                return Some(shell.to_string());
            }
        }
        "sh" // Fallback
    };

    // Try to get PATH using the shell's login mode and sourcing initialization files
    let command = if shell.contains("zsh") {
        "source ~/.zshrc 2>/dev/null || true; source ~/.zshenv 2>/dev/null || true; echo $PATH"
    } else if shell.contains("bash") {
        "source ~/.bashrc 2>/dev/null || true; source ~/.bash_profile 2>/dev/null || true; echo $PATH"
    } else {
        "echo $PATH"
    };

    let output = Command::new(shell)
        .arg("-l") // Login shell to get proper environment
        .arg("-c")
        .arg(command)
        .output()
        .ok()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }

    // If the shell method fails, try to get PATH from the environment
    env::var("PATH").ok()
}

#[command]
pub fn get_working_directory(
    session_id: String,
    command_manager: State<'_, CommandManager>,
) -> Result<String, String> {
    let states = command_manager.commands.lock().map_err(|e| e.to_string())?;
    let key = session_id;

    if let Some(state) = states.get(&key) {
        if state.is_ssh_session_active {
            // Return the stored remote CWD, or a default if not yet known
            Ok(state
                .remote_current_dir
                .clone()
                .unwrap_or_else(|| "remote:~".to_string()))
        } else {
            Ok(state.current_dir.clone())
        }
    } else {
        // Fallback if the session doesn't exist - create a new default state
        Ok(env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string())
    }
}

#[command]
pub fn get_home_directory() -> Result<String, String> {
    dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

// Helper function to split a path into directory and file prefix parts
pub fn split_path_prefix(path: &str) -> (&str, &str) {
    match path.rfind(['/', '\\']) {
        Some(index) => {
            let (dir, file) = path.split_at(index + 1);
            (dir, file)
        }
        None => ("", path),
    }
}

pub fn is_absolute_path_input(path: &str) -> bool {
    Path::new(path).is_absolute() || has_windows_drive_prefix(path)
}

pub fn expand_home_path(path: &str) -> Result<PathBuf, String> {
    let home_dir =
        dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let without_tilde = path.trim_start_matches('~');
    let rel_path = without_tilde.trim_start_matches(['/', '\\']);

    if rel_path.is_empty() {
        Ok(home_dir)
    } else {
        Ok(home_dir.join(rel_path))
    }
}

pub fn resolve_path_input(current_dir: &str, path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path == "~" || path == "~/" || path == "~\\" {
        return expand_home_path("~");
    }

    if path.starts_with('~') {
        return expand_home_path(path);
    }

    if is_absolute_path_input(path) {
        return Ok(PathBuf::from(path));
    }

    Ok(Path::new(current_dir).join(path))
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}
