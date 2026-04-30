use crate::command::types::command_manager::CommandManager;
use tauri::State;

#[tauri::command]
pub fn terminate_command(
    session_id: String,
    command_manager: State<'_, CommandManager>,
) -> Result<(), String> {
    let mut states = command_manager.commands.lock().map_err(|e| e.to_string())?;
    let key = session_id;

    let pid = if let Some(state) = states.get(&key) {
        state.pid.unwrap_or(0)
    } else {
        return Err("No active process found".to_string());
    };

    if pid == 0 {
        return Err("No active process to terminate".to_string());
    }

    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        // Try to send SIGTERM first
        if let Err(err) = kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
            return Err(format!("Failed to send SIGTERM: {}", err));
        }

        // Give the process a moment to terminate gracefully
        std::thread::sleep(std::time::Duration::from_millis(100));

        // If it's still running, force kill with SIGKILL
        if let Err(err) = kill(Pid::from_raw(pid as i32), Signal::SIGKILL) {
            return Err(format!("Failed to send SIGKILL: {}", err));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|err| format!("Failed to start taskkill: {}", err))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!("Failed to terminate process {}", pid)
            } else {
                stderr
            });
        }
    }

    // Clear the PID after successful termination
    if let Some(state) = states.get_mut(&key) {
        state.pid = None;
    }

    Ok(())
}
