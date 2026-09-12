mod backend;
mod config;

use backend::{port_open, probe, Backend};
use config::Config;
use std::{
    path::PathBuf,
    process::Command,
    sync::{mpsc, Arc},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent,
};

fn resolve_app_root(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("app");
    if bundled.join("server/index.mjs").is_file() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    {
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Missing source directory")?
            .to_path_buf();
        if source.join("server/index.mjs").is_file() {
            return Ok(source);
        }
    }
    Err("Bundled ARRA Claude Code backend resources were not found".into())
}

fn open_target(target: &str, edit: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "macos")]
    if edit {
        command.arg("-t");
    }
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    command
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn item(
    app: &AppHandle,
    id: &str,
    text: &str,
    enabled: bool,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, text, enabled, None::<&str>)
}

#[derive(Clone, Copy)]
enum Action {
    Start,
    Stop,
    Restart,
    Refresh,
    Reload,
    Local,
    Hosted,
    Chats,
    Logs,
    Data,
    Config,
    Quit,
}

fn install_tray(
    app: &AppHandle,
    backend: Arc<Backend>,
    config_path: PathBuf,
    app_data: PathBuf,
    home: PathBuf,
    initial_error: Option<String>,
) -> tauri::Result<()> {
    let target = item(app, "target", "Target: local", false)?;
    let stats = item(app, "stats", "Saved workspace: checking…", false)?;
    let sync = item(app, "sync", "History sync: checking…", false)?;
    let cli = item(app, "cli", "Claude CLI: checking…", false)?;
    let status = item(app, "status", "Local server: checking…", false)?;
    let hosted_status = item(app, "hosted_status", "Hosted access: checking…", false)?;
    let action_status = item(
        app,
        "action_status",
        "Controls affect only this app's backend",
        false,
    )?;
    let start = item(app, "start", "Start local server", true)?;
    let stop = item(
        app,
        "stop",
        "Stop local server (interrupts active chats)",
        false,
    )?;
    let restart = item(
        app,
        "restart",
        "Restart local server (interrupts active chats)",
        false,
    )?;
    let local = MenuItem::with_id(
        app,
        "local",
        "Open local dashboard",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let hosted = item(app, "hosted", "Open hosted workspace", true)?;
    let chats = item(app, "chats", "Open saved chats", true)?;
    let logs = item(app, "logs", "Open recent output…", true)?;
    let data = item(app, "data", "Open launch data folder…", true)?;
    let edit = MenuItem::with_id(
        app,
        "config",
        "Edit server settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let reload = item(
        app,
        "reload",
        "Reload settings (stop owned server first)",
        true,
    )?;
    let port_info = item(app, "port_info", "Port: …", false)?;
    let workspace_info = item(app, "workspace_info", "Launch workspace: …", false)?;
    let origin_info = item(app, "origin_info", "Allowed frontend: …", false)?;
    let settings = Submenu::with_items(
        app,
        "Settings",
        true,
        &[
            &port_info,
            &workspace_info,
            &origin_info,
            &edit,
            &reload,
            &data,
        ],
    )?;
    let version = item(
        app,
        "version",
        &format!("ARRA Server v{} · Tauri / Node", env!("CARGO_PKG_VERSION")),
        false,
    )?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh status", true, Some("CmdOrCtrl+R"))?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        "Quit ARRA Claude Code Server",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let separators: Vec<_> = (0..4)
        .map(|_| PredefinedMenuItem::separator(app))
        .collect::<tauri::Result<_>>()?;
    let menu = Menu::with_items(
        app,
        &[
            &target,
            &stats,
            &sync,
            &cli,
            &separators[0],
            &status,
            &hosted_status,
            &start,
            &stop,
            &restart,
            &separators[1],
            &local,
            &hosted,
            &chats,
            &logs,
            &separators[2],
            &settings,
            &refresh,
            &action_status,
            &version,
            &separators[3],
            &quit,
        ],
    )?;
    let (send, receive) = mpsc::channel();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("application icon").clone())
        .tooltip("ARRA Claude Code Server")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |_, event| {
            let action = match event.id.as_ref() {
                "start" => Action::Start,
                "stop" => Action::Stop,
                "restart" => Action::Restart,
                "local" => Action::Local,
                "hosted" => Action::Hosted,
                "chats" => Action::Chats,
                "logs" => Action::Logs,
                "data" => Action::Data,
                "config" => Action::Config,
                "reload" => Action::Reload,
                "refresh" => Action::Refresh,
                "quit" => Action::Quit,
                _ => return,
            };
            let _ = send.send(action);
        })
        .build(app)?;

    let app = app.clone();
    std::thread::spawn(move || {
        let mut config_error = initial_error;
        let mut notice = match config_error.as_ref() {
            Some(error) => error.clone(),
            None if port_open(backend.config().port) => {
                "External process left unchanged".to_string()
            }
            None => backend
                .start()
                .map(|_| "Backend launched".to_string())
                .unwrap_or_else(|e| e),
        };
        loop {
            let config = backend.config();
            let pid = backend.owned_pid();
            // An invalid config must never cause a connection attempt against
            // fallback settings. Those defaults exist only to construct Backend
            // and render non-actionable settings information.
            let valid = config_error.is_none();
            let occupied = valid && port_open(config.port);
            let target_text = if valid {
                format!("Target: local — {}", config.local_url())
            } else {
                "Target: unavailable — invalid settings".to_string()
            };
            let port_text = format!("Port: {}", config.port);
            let workspace_text = format!("Launch workspace: {}", config.workspace.display());
            let origin_text = format!(
                "Allowed frontend: {}",
                if config.frontend_origin.is_empty() {
                    "local only"
                } else {
                    &config.frontend_origin
                }
            );
            let hosted_enabled = valid && config.hosted_url().is_some();
            let (status_text, stats_text, sync_text, cli_text, hosted_status_text) =
                if let Some(error) = config_error.as_ref() {
                    (
                        "Local server: disabled — invalid settings".to_string(),
                        "Saved workspace: unavailable".to_string(),
                        "History sync: unavailable".to_string(),
                        "Claude CLI: not checked".to_string(),
                        format!("Configuration error: {error}"),
                    )
                } else {
                    match probe(&config, pid.is_some()) {
                        Ok(info) => {
                            let owner = pid
                                .map(|p| format!("owned PID {p}"))
                                .unwrap_or("external — not managed".into());
                            let status_text = format!("Local server: running ({owner})");
                            let cli_text = format!("Claude CLI: {}", info.cli);
                            let access = if config.frontend_origin.is_empty() {
                                "disabled (local only)"
                            } else if info.summary.as_ref().is_some_and(|s| s.allow_any_origin) {
                                "UNSAFE — allow-all mode"
                            } else if info.hosted_allowed {
                                "allowed for selected frontend"
                            } else {
                                "blocked — backend origin not configured"
                            };
                            let hosted_status_text = format!("Hosted access: {access}");
                            let (stats_text, sync_text) = if let Some(s) = info.summary {
                                (
                                    format!(
                                        "{} projects · {} saved chats · {} messages",
                                        s.projects, s.chats, s.messages
                                    ),
                                    format!(
                                        "{} active chats · {} sync errors",
                                        s.running, s.sync_errors
                                    ),
                                )
                            } else {
                                (
                                    "Workspace counts unavailable (older backend)".to_string(),
                                    "History sync details: open dashboard".to_string(),
                                )
                            };
                            (
                                status_text,
                                stats_text,
                                sync_text,
                                cli_text,
                                hosted_status_text,
                            )
                        }
                        Err(error) => {
                            let label = if pid.is_some() {
                                "starting or unhealthy (owned)"
                            } else if occupied {
                                "port occupied — unrecognized service"
                            } else {
                                "stopped"
                            };
                            (
                                format!("Local server: {label}"),
                                "Saved workspace: unavailable".to_string(),
                                "History sync: unavailable".to_string(),
                                "Claude CLI: not checked".to_string(),
                                if occupied {
                                    format!("Health check: {error}")
                                } else {
                                    "Hosted access: backend offline".into()
                                },
                            )
                        }
                    }
                };

            // Native menu objects are updated only on the Tauri main thread.
            let target_ui = target.clone();
            let stats_ui = stats.clone();
            let sync_ui = sync.clone();
            let cli_ui = cli.clone();
            let status_ui = status.clone();
            let hosted_status_ui = hosted_status.clone();
            let action_status_ui = action_status.clone();
            let start_ui = start.clone();
            let stop_ui = stop.clone();
            let restart_ui = restart.clone();
            let reload_ui = reload.clone();
            let local_ui = local.clone();
            let hosted_ui = hosted.clone();
            let chats_ui = chats.clone();
            let logs_ui = logs.clone();
            let data_ui = data.clone();
            let refresh_ui = refresh.clone();
            let port_info_ui = port_info.clone();
            let workspace_info_ui = workspace_info.clone();
            let origin_info_ui = origin_info.clone();
            let notice_text = format!("Last action: {notice}");
            if let Err(error) = app.run_on_main_thread(move || {
                let _ = target_ui.set_text(target_text);
                let _ = stats_ui.set_text(stats_text);
                let _ = sync_ui.set_text(sync_text);
                let _ = cli_ui.set_text(cli_text);
                let _ = status_ui.set_text(status_text);
                let _ = hosted_status_ui.set_text(hosted_status_text);
                let _ = action_status_ui.set_text(notice_text);
                let _ = port_info_ui.set_text(port_text);
                let _ = workspace_info_ui.set_text(workspace_text);
                let _ = origin_info_ui.set_text(origin_text);
                let _ = start_ui.set_enabled(valid && pid.is_none() && !occupied);
                let _ = stop_ui.set_enabled(valid && pid.is_some());
                let _ = restart_ui.set_enabled(valid && pid.is_some());
                let _ = reload_ui.set_enabled(pid.is_none());
                let _ = local_ui.set_enabled(valid);
                let _ = hosted_ui.set_enabled(hosted_enabled);
                let _ = chats_ui.set_enabled(valid);
                let _ = logs_ui.set_enabled(valid);
                let _ = data_ui.set_enabled(valid);
                let _ = refresh_ui.set_enabled(valid);
            }) {
                eprintln!("Could not update tray menu: {error}");
            }
            let action = match receive.recv_timeout(Duration::from_secs(5)) {
                Ok(action) => action,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => {
                    let _ = backend.stop();
                    break;
                }
            };
            if matches!(action, Action::Quit) {
                let status_ui = status.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = status_ui.set_text("Local server: shutting down owned process…");
                });
                if let Err(e) = backend.stop() {
                    eprintln!("{e}");
                }
                app.exit(0);
                break;
            }
            let result: Result<&str, String> =
                if config_error.is_some() && !matches!(action, Action::Reload | Action::Config) {
                    Err("Fix the configuration, then choose Reload settings".into())
                } else {
                    match action {
                        Action::Start => backend.start().map(|_| "Backend launched"),
                        Action::Stop => backend.stop().map(|_| "Owned backend stopped"),
                        Action::Restart => backend
                            .stop()
                            .and_then(|_| backend.start())
                            .map(|_| "Owned backend restarted"),
                        Action::Reload => match config::load(&config_path, &app_data, &home) {
                            Ok(reloaded) => match backend.replace_config(reloaded) {
                                Ok(()) => {
                                    config_error = None;
                                    Ok("Settings reloaded; choose Start")
                                }
                                Err(error) => Err(error),
                            },
                            Err(error) => {
                                let error = format!(
                                    "Configuration error at {}: {error}",
                                    config_path.display()
                                );
                                config_error = Some(error.clone());
                                Err(error)
                            }
                        },
                        Action::Local => open_target(&config.local_url(), false)
                            .map(|_| "Local dashboard opened"),
                        Action::Hosted => config
                            .hosted_url()
                            .ok_or("Hosted access is disabled".into())
                            .and_then(|url| open_target(&url, false))
                            .map(|_| "Hosted workspace opened"),
                        Action::Chats => open_target(
                            &format!("{}/#/sessions?tab=saved", config.local_url()),
                            false,
                        )
                        .map(|_| "Saved chats opened"),
                        Action::Logs => open_target(&backend.log_path.to_string_lossy(), true)
                            .map(|_| "Recent output opened"),
                        Action::Data => open_target(&config.data_dir.to_string_lossy(), false)
                            .map(|_| "Launch data folder opened"),
                        Action::Config => open_target(&config_path.to_string_lossy(), true)
                            .map(|_| "Settings opened; stop then reload to apply"),
                        Action::Refresh => Ok("Status refreshed"),
                        Action::Quit => unreachable!(),
                    }
                };
            notice = result.map(String::from).unwrap_or_else(|e| {
                eprintln!("{e}");
                e
            });
        }
    });
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let app_data = app.path().app_data_dir()?;
            let home = app.path().home_dir()?;
            let config_path = config::default_config_path(&app_data);
            let (config, config_error) = match config::load(&config_path, &app_data, &home) {
                Ok(config) => (config, None),
                Err(error) => (
                    Config::defaults(&app_data, &home),
                    Some(format!(
                        "Configuration error at {}: {error}",
                        config_path.display()
                    )),
                ),
            };
            let backend = Arc::new(Backend::new(
                resolve_app_root(app.handle()).map_err(std::io::Error::other)?,
                app.path().app_log_dir()?.join("backend.log"),
                config,
            ));
            app.manage(backend.clone());
            install_tray(
                app.handle(),
                backend,
                config_path,
                app_data,
                home,
                config_error,
            )?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not start ARRA Claude Code Server");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Err(error) = app.state::<Arc<Backend>>().stop() {
                eprintln!("{error}");
            }
        }
    });
}
