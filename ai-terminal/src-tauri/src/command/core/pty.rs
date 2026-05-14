use crate::command::types::pty_manager::{PtyManager, PtySession};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
#[cfg(not(target_os = "windows"))]
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{command, AppHandle, Emitter, Manager, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub session_id: String,
    pub success: bool,
}

#[command]
pub fn pty_create_session(
    session_id: String,
    cols: u16,
    rows: u16,
    launch_kind: Option<String>,
    wsl_distro_name: Option<String>,
    app_handle: AppHandle,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut command = new_platform_pty_command(launch_kind.as_deref(), wsl_distro_name.as_deref());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    command.cwd(cwd);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Failed to spawn shell in PTY: {e}"))?;
    let killer = child.clone_killer();
    let child = Arc::new(Mutex::new(child));
    let killer = Arc::new(Mutex::new(killer));

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;
    let writer = Arc::new(Mutex::new(writer));

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    {
        let mut sessions = pty_manager.sessions.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&session_id) {
            return Err(format!("PTY session '{}' already exists", session_id));
        }

        sessions.insert(
            session_id.clone(),
            PtySession {
                master: pair.master,
                writer: writer.clone(),
                child: child.clone(),
                killer: killer.clone(),
            },
        );
    }

    let emit_handle = app_handle.clone();
    let session_id_for_reader = session_id.clone();
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut pending_utf8_bytes: Vec<u8> = Vec::new();

        let emit_output = |data: String| {
            if data.is_empty() {
                return;
            }
            let _ = emit_handle.emit(
                "pty_output",
                PtyOutputEvent {
                    session_id: session_id_for_reader.clone(),
                    data,
                },
            );
        };

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    if !pending_utf8_bytes.is_empty() {
                        emit_output(String::from_utf8_lossy(&pending_utf8_bytes).to_string());
                        pending_utf8_bytes.clear();
                    }
                    break;
                }
                Ok(n) => {
                    pending_utf8_bytes.extend_from_slice(&buffer[..n]);

                    loop {
                        match std::str::from_utf8(&pending_utf8_bytes) {
                            Ok(valid_str) => {
                                emit_output(valid_str.to_string());
                                pending_utf8_bytes.clear();
                                break;
                            }
                            Err(err) => {
                                let valid_up_to = err.valid_up_to();
                                if valid_up_to > 0 {
                                    emit_output(
                                        String::from_utf8_lossy(&pending_utf8_bytes[..valid_up_to])
                                            .to_string(),
                                    );
                                    pending_utf8_bytes.drain(..valid_up_to);
                                }

                                // error_len == None means an incomplete UTF-8 sequence: keep bytes and wait.
                                if let Some(error_len) = err.error_len() {
                                    let invalid_len = error_len.min(pending_utf8_bytes.len());
                                    if invalid_len > 0 {
                                        emit_output(
                                            String::from_utf8_lossy(
                                                &pending_utf8_bytes[..invalid_len],
                                            )
                                            .to_string(),
                                        );
                                        pending_utf8_bytes.drain(..invalid_len);
                                        continue;
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
                Err(_) => {
                    if !pending_utf8_bytes.is_empty() {
                        emit_output(String::from_utf8_lossy(&pending_utf8_bytes).to_string());
                        pending_utf8_bytes.clear();
                    }
                    break;
                }
            }
        }
    });

    let wait_handle = app_handle.clone();
    let wait_session_id = session_id.clone();
    thread::spawn(move || {
        let success = child
            .lock()
            .ok()
            .and_then(|mut c| c.wait().ok())
            .map(|status| status.success())
            .unwrap_or(false);

        let manager = wait_handle.state::<PtyManager>();
        if let Ok(mut sessions) = manager.sessions.lock() {
            sessions.remove(&wait_session_id);
        }

        let _ = wait_handle.emit(
            "pty_exit",
            PtyExitEvent {
                session_id: wait_session_id.clone(),
                success,
            },
        );
    });

    Ok(())
}

#[cfg(target_os = "windows")]
fn new_platform_pty_command(launch_kind: Option<&str>, wsl_distro_name: Option<&str>) -> CommandBuilder {
    if launch_kind == Some("local-wsl") {
        let mut command = CommandBuilder::new("wsl.exe");
        if let Some(distro_name) = wsl_distro_name.filter(|value| !value.trim().is_empty()) {
            command.arg("-d");
            command.arg(distro_name.trim());
        }
        return command;
    }

    let mut command = CommandBuilder::new("powershell.exe");
    command.arg("-NoLogo");
    command.arg("-NoProfile");
    command.arg("-NoExit");
    command
}

#[cfg(not(target_os = "windows"))]
fn new_platform_pty_command(launch_kind: Option<&str>, _wsl_distro_name: Option<&str>) -> CommandBuilder {
    #[cfg(target_os = "macos")]
    let default_shell = "/bin/zsh";
    #[cfg(not(target_os = "macos"))]
    let default_shell = "/bin/bash";

    let preferred_shell = if launch_kind == Some("local-zsh") {
        "/bin/zsh"
    } else {
        default_shell
    };
    let shell = if Path::new(preferred_shell).exists() {
        preferred_shell.to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    };
    let mut command = CommandBuilder::new(shell.clone());
    if shell.ends_with("bash") {
        command.arg("--noprofile");
        command.arg("--norc");
        command.env("BASH_SILENCE_DEPRECATION_WARNING", "1");
        command.env("PROMPT_COMMAND", "");
        command.env("PS1", "\\[\\033[1;34m\\]\\w\\[\\033[0m\\] $ ");
    } else if shell.ends_with("zsh") {
        command.arg("-f");
        command.env("PROMPT", "%n@%m %1~ %# ");
        command.env("RPROMPT", "");
        command.env("PROMPT_EOL_MARK", "");
        command.env("PS1", "%n@%m %1~ %# ");
    }
    command.arg("-i");
    command
}

#[command]
pub fn pty_write(
    session_id: String,
    data: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let sessions = pty_manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;

    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write PTY input: {e}"))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY input: {e}"))?;
    Ok(())
}

#[command]
pub fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let mut sessions = pty_manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {e}"))?;
    Ok(())
}

#[command]
pub fn pty_close_session(
    session_id: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let session_opt = {
        let mut sessions = pty_manager.sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(&session_id)
    };

    if let Some(session) = session_opt {
        match session.killer.lock() {
            Ok(mut killer) => {
                let _ = killer.kill();
            }
            Err(_poisoned) => {
                // If the killer mutex is poisoned, the wait thread will still
                // reap the process and emit the exit event shortly after.
            }
        }
        Ok(())
    } else {
        Ok(())
    }
}
