use crate::config::Config;
use serde::Deserialize;
use std::{
    fs::{self, File},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

struct Runtime {
    child: Option<Child>,
    config: Config,
}

pub struct Backend {
    runtime: Mutex<Runtime>,
    app_root: PathBuf,
    pub log_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub service: String,
    pub api_version: u32,
    pub projects: usize,
    pub chats: usize,
    pub messages: usize,
    pub running: usize,
    pub sync_errors: usize,
    pub frontend_origin: String,
    pub allow_any_origin: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    ok: bool,
    claude_available: bool,
    claude_version: Option<String>,
    cwd: String,
}

#[derive(Debug)]
pub struct Probe {
    pub summary: Option<Summary>,
    pub cli: String,
    pub hosted_allowed: bool,
}

impl Backend {
    pub fn new(app_root: PathBuf, log_path: PathBuf, config: Config) -> Self {
        Self {
            runtime: Mutex::new(Runtime {
                child: None,
                config,
            }),
            app_root,
            log_path,
        }
    }

    pub fn config(&self) -> Config {
        self.runtime.lock().expect("backend lock").config.clone()
    }

    pub fn owned_pid(&self) -> Option<u32> {
        let mut runtime = self.runtime.lock().expect("backend lock");
        match runtime.child.as_mut().map(Child::try_wait) {
            Some(Ok(None)) => runtime.child.as_ref().map(Child::id),
            Some(Ok(Some(_))) => {
                runtime.child = None;
                None
            }
            _ => None,
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|e| e.to_string())?;
        if let Some(child) = runtime.child.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(());
            }
            runtime.child = None;
        }
        let config = &runtime.config;
        // Never adopt or terminate a process just because it occupies our port.
        if port_open(config.port) {
            return Err("Port occupied by an external process; it was left unchanged".into());
        }
        let entry = self.app_root.join("server/index.mjs");
        if !entry.is_file() {
            return Err(format!("Backend missing: {}", entry.display()));
        }
        let node = find_node(config.node_binary.as_deref())?;
        if let Some(parent) = self.log_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&config.data_dir).map_err(|e| e.to_string())?;
        let stdout = File::options()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|e| e.to_string())?;
        let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
        let child = Command::new(node)
            .arg(entry)
            .current_dir(&self.app_root)
            .env("PORT", config.port.to_string())
            .env("CC_CHAT_DESKTOP", "1")
            .env("CC_CHAT_DATA_DIR", &config.data_dir)
            .env("CC_CHAT_CWD", &config.workspace)
            .env("CC_CHAT_FRONTEND_ORIGIN", &config.frontend_origin)
            .env("PATH", executable_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|e| format!("Could not launch Node: {e}"))?;
        runtime.child = Some(child);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|e| e.to_string())?;
        let Some(child) = runtime.child.as_mut() else {
            return Ok(());
        };
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            runtime.child = None;
            return Ok(());
        }
        // Let the shared Node runner interrupt Claude and persist state. Closing
        // stdin is also a shutdown signal; only kill this owned child on timeout.
        if let Some(mut input) = child.stdin.take() {
            let _ = input.write_all(b"shutdown\n");
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                runtime.child = None;
                return Ok(());
            }
            thread::sleep(Duration::from_millis(40));
        }
        child.kill().map_err(|e| e.to_string())?;
        child.wait().map_err(|e| e.to_string())?;
        runtime.child = None;
        Err(
            "Graceful shutdown timed out; owned backend was force-stopped. Check recent output."
                .into(),
        )
    }

    pub fn replace_config(&self, config: Config) -> Result<(), String> {
        if self.owned_pid().is_some() {
            return Err("Stop the owned backend before reloading settings".into());
        }
        self.runtime.lock().map_err(|e| e.to_string())?.config = config;
        Ok(())
    }
}

pub fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

// The local Node endpoints use Content-Length and JSON, with a bounded response.
// No message bodies, secrets, or native transcript files are read by the tray.
struct Response {
    headers: String,
    body: serde_json::Value,
}

#[derive(Debug)]
enum RequestError {
    HttpStatus(u16),
    Other(String),
}

impl std::fmt::Display for RequestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HttpStatus(status) => write!(formatter, "Backend returned HTTP {status}"),
            Self::Other(error) => formatter.write_str(error),
        }
    }
}

fn request(port: u16, path: &str, origin: Option<&str>) -> Result<Response, RequestError> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .map_err(|e| RequestError::Other(e.to_string()))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|e| RequestError::Other(e.to_string()))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|e| RequestError::Other(e.to_string()))?;
    let origin = origin
        .map(|s| format!("Origin: {s}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{origin}Connection: close\r\n\r\n"
    )
    .map_err(|e| RequestError::Other(e.to_string()))?;
    let mut bytes = Vec::new();
    stream
        .take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|e| RequestError::Other(e.to_string()))?;
    if bytes.len() > 65_536 {
        return Err(RequestError::Other(
            "Status response exceeded 64 KiB".into(),
        ));
    }
    let text = String::from_utf8(bytes).map_err(|e| RequestError::Other(e.to_string()))?;
    let (headers, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| RequestError::Other("Invalid HTTP response".into()))?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or_else(|| RequestError::Other("Invalid HTTP status line".into()))?;
    if status != 200 {
        return Err(RequestError::HttpStatus(status));
    }
    Ok(Response {
        headers: headers.to_string(),
        body: serde_json::from_str(body).map_err(|e| RequestError::Other(e.to_string()))?,
    })
}

pub fn probe(config: &Config, require_summary: bool) -> Result<Probe, String> {
    let health = request(config.port, "/api/health", None).map_err(|e| e.to_string())?;
    let health: Health = serde_json::from_value(health.body)
        .map_err(|_| "Port is not a compatible Claude backend")?;
    if !health.ok || health.cwd.is_empty() {
        return Err("Backend health is not ready".into());
    }
    let summary = match request(config.port, "/api/status", None) {
        Ok(response) => {
            let summary: Summary = serde_json::from_value(response.body)
                .map_err(|error| format!("Invalid backend status response: {error}"))?;
            if summary.service != "arra-claude-code" || summary.api_version != 1 {
                return Err("Backend status has an incompatible service or API version".into());
            }
            Some(summary)
        }
        Err(RequestError::HttpStatus(404)) if !require_summary => None,
        Err(RequestError::HttpStatus(404)) => {
            return Err("Owned backend is missing the required /api/status endpoint".into())
        }
        Err(error) => return Err(format!("Could not read backend status: {error}")),
    };
    let hosted_allowed = if config.frontend_origin.is_empty() {
        false
    } else if let Some(ref s) = summary {
        s.allow_any_origin || s.frontend_origin == config.frontend_origin
    } else {
        request(config.port, "/api/health", Some(&config.frontend_origin)).is_ok_and(|response| {
            response
                .headers
                .lines()
                .filter_map(|line| line.split_once(':'))
                .any(|(name, value)| {
                    name.eq_ignore_ascii_case("access-control-allow-origin")
                        && value.trim() == config.frontend_origin
                })
        })
    };
    Ok(Probe {
        summary,
        hosted_allowed,
        cli: if health.claude_available {
            health.claude_version.unwrap_or("Available".into())
        } else {
            "Not found — check Node/Claude PATH".into()
        },
    })
}

fn executable_path() -> std::ffi::OsString {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".local/bin"));
    }
    paths.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    std::env::join_paths(paths).unwrap_or_default()
}

fn find_node(explicit: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(path) = explicit {
        return if path.is_absolute() && path.is_file() {
            Ok(path.to_path_buf())
        } else {
            Err("Configured Node binary does not exist".into())
        };
    }
    std::env::split_paths(&executable_path())
        .map(|p| p.join("node"))
        .find(|p| p.is_file())
        .ok_or("Node.js was not found. Set node_binary in server-config.json.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn response(status: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    fn serve(responses: Vec<Vec<u8>>) -> (u16, thread::JoinHandle<()>) {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = server.accept().unwrap();
                let mut headers = Vec::new();
                let mut byte = [0; 1];
                while !headers.ends_with(b"\r\n\r\n") {
                    stream.read_exact(&mut byte).unwrap();
                    headers.push(byte[0]);
                }
                stream.write_all(&response).unwrap();
            }
        });
        (port, handle)
    }

    fn health_response() -> Vec<u8> {
        response(
            "200 OK",
            r#"{"ok":true,"claudeAvailable":true,"claudeVersion":"fixture","cwd":"/tmp"}"#,
        )
    }

    fn probe_config(port: u16) -> Config {
        Config {
            port,
            workspace: PathBuf::from("/tmp"),
            data_dir: PathBuf::from("/tmp"),
            frontend_origin: String::new(),
            node_binary: None,
        }
    }

    #[test]
    fn explicit_invalid_node_does_not_silently_fall_back() {
        assert!(find_node(Some(Path::new("/definitely/missing/node"))).is_err());
    }

    #[test]
    fn arbitrary_http_server_is_not_reported_as_claude() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut headers = Vec::new();
            let mut byte = [0; 1];
            while !headers.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                headers.push(byte[0]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").unwrap();
        });
        assert!(request(port, "/api/health", None).is_ok());
        handle.join().unwrap();
        assert!(serde_json::from_value::<Health>(serde_json::json!({"ok":true})).is_err());
    }

    #[test]
    fn external_backend_may_use_legacy_fallback_only_for_status_404() {
        let (port, handle) = serve(vec![
            health_response(),
            response("404 Not Found", "not json"),
        ]);
        let result = probe(&probe_config(port), false).unwrap();
        assert!(result.summary.is_none());
        handle.join().unwrap();
    }

    #[test]
    fn owned_backend_requires_status_even_when_endpoint_returns_404() {
        let (port, handle) = serve(vec![
            health_response(),
            response("404 Not Found", "not json"),
        ]);
        let error = probe(&probe_config(port), true).unwrap_err();
        assert!(error.contains("Owned backend"), "{error}");
        handle.join().unwrap();
    }

    #[test]
    fn malformed_or_incompatible_status_is_not_treated_as_legacy() {
        for body in [
            r#"{"service":"arra-claude-code"}"#,
            r#"{"service":"other","apiVersion":1,"projects":0,"chats":0,"messages":0,"running":0,"syncErrors":0,"frontendOrigin":"","allowAnyOrigin":false}"#,
        ] {
            let (port, handle) = serve(vec![health_response(), response("200 OK", body)]);
            assert!(probe(&probe_config(port), false).is_err());
            handle.join().unwrap();
        }
    }

    #[test]
    fn status_protocol_failure_is_not_treated_as_legacy() {
        let (port, handle) = serve(vec![health_response(), b"not http".to_vec()]);
        let error = probe(&probe_config(port), false).unwrap_err();
        assert!(error.contains("Could not read backend status"), "{error}");
        handle.join().unwrap();
    }

    struct Fixture {
        root: PathBuf,
        backend: Backend,
    }
    impl Fixture {
        fn new(port: u16) -> Self {
            let root = std::env::temp_dir().join(format!(
                "arra-supervisor-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(root.join("server")).unwrap();
            fs::write(root.join("server/index.mjs"), r#"
                import http from 'node:http';
                const server = http.createServer((req,res) => {
                    const body = JSON.stringify({ok:true, claudeAvailable:true, claudeVersion:'fixture', cwd:process.env.CC_CHAT_CWD,
                        dataDir:process.env.CC_CHAT_DATA_DIR, frontendOrigin:process.env.CC_CHAT_FRONTEND_ORIGIN});
                    res.writeHead(200, {'content-type':'application/json', 'content-length':Buffer.byteLength(body)}); res.end(body);
                }).listen(Number(process.env.PORT),'127.0.0.1');
                process.stdin.on('data', () => server.close(() => process.exit(0)));
                process.stdin.on('end', () => server.close(() => process.exit(0)));
            "#).unwrap();
            let config = Config {
                port,
                workspace: root.clone(),
                data_dir: root.join("data"),
                frontend_origin: "https://cc-chat-ui.laris.workers.dev".into(),
                node_binary: None,
            };
            let backend = Backend::new(root.clone(), root.join("backend.log"), config);
            Self { root, backend }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.backend.stop();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn start_stop_and_reload_never_adopt_or_terminate_external_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let f = Fixture::new(port);
        assert!(f.backend.start().is_err());
        assert_eq!(f.backend.owned_pid(), None);
        f.backend.stop().unwrap();
        assert!(port_open(port));
        let mut updated = f.backend.config();
        updated.port = 4327;
        f.backend.replace_config(updated).unwrap();
        assert!(port_open(port));
    }

    #[test]
    fn owned_backend_inherits_selected_origin_paths_and_gracefully_exits() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let f = Fixture::new(port);
        f.backend.start().unwrap();
        let pid = f.backend.owned_pid().unwrap();
        f.backend.start().unwrap();
        assert_eq!(f.backend.owned_pid(), Some(pid));
        let deadline = Instant::now() + Duration::from_secs(4);
        while !port_open(port) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let health = request(port, "/api/health", None).unwrap().body;
        assert_eq!(health["cwd"], f.root.to_string_lossy().as_ref());
        assert_eq!(
            health["dataDir"],
            f.root.join("data").to_string_lossy().as_ref()
        );
        assert_eq!(
            health["frontendOrigin"],
            "https://cc-chat-ui.laris.workers.dev"
        );
        assert!(f.backend.replace_config(f.backend.config()).is_err());
        f.backend.stop().unwrap();
        assert_eq!(f.backend.owned_pid(), None);
        assert!(!port_open(port));
        f.backend.start().unwrap();
        assert_ne!(f.backend.owned_pid(), Some(pid));
    }
}
