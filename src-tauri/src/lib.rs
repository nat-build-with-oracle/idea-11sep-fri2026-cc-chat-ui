use std::{
    fs::{self, File},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent,
};

const DEFAULT_PORT: u16 = 4318;

struct Backend {
    child: Mutex<Option<Child>>,
    app_root: PathBuf,
    log_path: PathBuf,
    port: u16,
    data_dir: PathBuf,
    workspace: PathBuf,
}

impl Backend {
    fn new(
        app_root: PathBuf,
        log_path: PathBuf,
        port: u16,
        data_dir: PathBuf,
        workspace: PathBuf,
    ) -> Self {
        Self {
            child: Mutex::new(None),
            app_root,
            log_path,
            port,
            data_dir,
            workspace,
        }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn start(&self) -> Result<u32, String> {
        if port_ready(self.port) {
            return Ok(0);
        }
        let mut guard = self.child.lock().map_err(|_| "backend lock is poisoned")?;
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Ok(child.id());
            }
        }

        let entry = self.app_root.join("server/index.mjs");
        if !entry.is_file() {
            return Err(format!("backend entry is missing: {}", entry.display()));
        }
        if let Some(parent) = self.log_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let stdout = File::options()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|error| error.to_string())?;
        let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
        let node = find_node().ok_or_else(|| {
            "Node.js 18+ was not found. Install Node or set CC_CHAT_NODE_BINARY.".to_string()
        })?;
        let child = Command::new(node)
            .arg(entry)
            .current_dir(&self.app_root)
            .env("PORT", self.port.to_string())
            .env("CC_CHAT_DESKTOP", "1")
            .env("CC_CHAT_DATA_DIR", &self.data_dir)
            .env("CC_CHAT_CWD", &self.workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("could not launch backend: {error}"))?;
        let pid = child.id();
        *guard = Some(child);
        Ok(pid)
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn restart(&self) -> Result<u32, String> {
        if self.external_running() {
            return Err(format!(
                "{} is owned by another process; stop it before restarting from the tray",
                self.url()
            ));
        }
        self.stop();
        self.start()
    }

    fn external_running(&self) -> bool {
        port_ready(self.port) && !self.process_running()
    }

    fn process_running(&self) -> bool {
        let Ok(mut guard) = self.child.lock() else {
            return false;
        };
        guard
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().flatten().is_none())
    }
}

fn find_node() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CC_CHAT_NODE_BINARY").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
    .or_else(|| {
        std::env::var_os("PATH").and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|path| path.join("node"))
                .find(|path| path.is_file())
        })
    })
}

fn port_ready(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(150),
    )
    .is_ok()
}

fn resolve_app_root(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("app");
    if bundled.join("server/index.mjs").is_file() {
        return Ok(bundled);
    }
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("invalid source directory")?
        .to_path_buf();
    if source.join("server/index.mjs").is_file() {
        return Ok(source);
    }
    Err("ARRA Claude Code backend resources were not found".into())
}

fn reveal(path: &Path) {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg("-R").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let _ = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn();
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .spawn();
}

fn open_dashboard(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = Command::new("cmd").args(["/C", "start", url]).spawn();
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

fn install_tray(app: &AppHandle, backend: Arc<Backend>) -> tauri::Result<()> {
    let dashboard_url = backend.url();
    let target = MenuItem::with_id(
        app,
        "target",
        format!("Target: local — {dashboard_url}"),
        false,
        None::<&str>,
    )?;
    let status = MenuItem::with_id(
        app,
        "status",
        "Local server: starting…",
        false,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, "open", "Open dashboard", true, Some("CmdOrCtrl+O"))?;
    let restart = MenuItem::with_id(
        app,
        "restart",
        "Restart local server",
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let logs = MenuItem::with_id(app, "logs", "Show recent output…", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        "Quit ARRA Claude Code Server",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &target,
            &separator,
            &status,
            &restart,
            &separator_two,
            &open,
            &logs,
            &quit,
        ],
    )?;

    let event_backend = backend.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("application icon").clone())
        .tooltip("ARRA Claude Code Server")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => open_dashboard(&event_backend.url()),
            "restart" => {
                let _ = event_backend.restart();
            }
            "logs" => reveal(&event_backend.log_path),
            "quit" => {
                event_backend.stop();
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    thread::spawn(move || loop {
        let text = if port_ready(backend.port) && backend.process_running() {
            "Local server: running (launched)"
        } else if backend.external_running() {
            "Local server: running (external)"
        } else if backend.process_running() {
            "Local server: starting…"
        } else {
            "Local server: stopped — choose Restart"
        };
        let _ = status.set_text(text);
        thread::sleep(Duration::from_secs(2));
    });
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let app_root = resolve_app_root(app.handle()).map_err(std::io::Error::other)?;
            let log_path = app.path().app_log_dir()?.join("backend.log");
            let data_dir = std::env::var_os("CC_CHAT_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let workspace = std::env::var_os("CC_CHAT_CWD")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
                .unwrap_or_else(|| PathBuf::from("/"));
            let port = std::env::var("CC_CHAT_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|port| *port > 0)
                .unwrap_or(DEFAULT_PORT);
            let backend = Arc::new(Backend::new(app_root, log_path, port, data_dir, workspace));
            backend.start().map_err(std::io::Error::other)?;
            install_tray(app.handle(), backend.clone())?;
            app.manage(backend);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ARRA Claude Code Server");

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            app.state::<Arc<Backend>>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_is_the_existing_loopback_backend() {
        let backend = Backend::new(
            PathBuf::new(),
            PathBuf::new(),
            DEFAULT_PORT,
            PathBuf::new(),
            PathBuf::new(),
        );
        assert_eq!(backend.url(), "http://127.0.0.1:4318");
    }

    #[test]
    fn explicit_node_path_must_exist() {
        std::env::set_var("CC_CHAT_NODE_BINARY", "/definitely/missing/node");
        assert_ne!(find_node(), Some(PathBuf::from("/definitely/missing/node")));
        std::env::remove_var("CC_CHAT_NODE_BINARY");
    }
}
