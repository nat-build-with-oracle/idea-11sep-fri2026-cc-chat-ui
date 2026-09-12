use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const DEFAULT_PORT: u16 = 4318;
const DEFAULT_FRONTEND_ORIGIN: &str = "https://cc-chat-ui.laris.workers.dev";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub port: u16,
    pub workspace: PathBuf,
    pub data_dir: PathBuf,
    pub frontend_origin: String,
    pub node_binary: Option<PathBuf>,
}

impl Config {
    pub(crate) fn defaults(app_data_dir: &Path, home: &Path) -> Self {
        Self {
            port: DEFAULT_PORT,
            workspace: home.to_path_buf(),
            data_dir: app_data_dir.to_path_buf(),
            frontend_origin: DEFAULT_FRONTEND_ORIGIN.to_owned(),
            node_binary: None,
        }
    }

    pub fn local_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn hosted_url(&self) -> Option<String> {
        if self.frontend_origin.is_empty() {
            return None;
        }

        // Validation guarantees that this is a URL. Avoid hand-building its query
        // string so the local backend URL is always encoded as query data.
        let mut url = tauri::Url::parse(&self.frontend_origin).ok()?;
        url.query_pairs_mut().append_pair("host", &self.local_url());
        Some(url.into())
    }
}

pub fn default_config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("server-config.json")
}

/// Loads persisted settings, then applies the current process's `CC_CHAT_*`
/// overrides without writing those overrides back to disk.
pub fn load(config_path: &Path, app_data_dir: &Path, home: &Path) -> Result<Config, String> {
    let overrides = std::env::vars_os()
        .filter_map(|(key, value)| key.into_string().ok().map(|key| (key, value)))
        .collect();
    load_with_overrides(config_path, app_data_dir, home, &overrides)
}

/// Deterministic form of [`load`] for callers that already have an environment
/// snapshot and for tests that must not mutate the process environment.
pub fn load_with_overrides(
    config_path: &Path,
    app_data_dir: &Path,
    home: &Path,
    overrides: &HashMap<String, OsString>,
) -> Result<Config, String> {
    let persisted = if config_path.exists() {
        read_config(config_path)?
    } else {
        let defaults = Config::defaults(app_data_dir, home);
        create_default_config(config_path, &defaults)?;
        // Another process may have won the create race. Read the actual persisted
        // file in that case rather than silently using our in-memory defaults.
        read_config(config_path)?
    };

    let mut effective = persisted;
    apply_overrides(&mut effective, overrides)?;
    validate(&effective)?;
    Ok(effective)
}

fn read_config(path: &Path) -> Result<Config, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("could not read config {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("invalid config {}: {error}", path.display()))
}

fn create_default_config(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "could not create config directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => {
            return Err(format!(
                "could not create default config {}: {error}",
                path.display()
            ))
        }
    };
    let mut json = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("could not serialize default config: {error}"))?;
    json.push(b'\n');
    file.write_all(&json)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("could not write default config {}: {error}", path.display()))
}

fn apply_overrides(
    config: &mut Config,
    overrides: &HashMap<String, OsString>,
) -> Result<(), String> {
    if let Some(value) = overrides.get("CC_CHAT_PORT") {
        let value = value
            .to_str()
            .ok_or_else(|| "invalid field port (CC_CHAT_PORT): value is not UTF-8".to_owned())?;
        config.port = value.parse::<u16>().map_err(|_| {
            format!("invalid field port (CC_CHAT_PORT): expected an integer from 1 to 65535, got {value:?}")
        })?;
    }
    if let Some(value) = overrides.get("CC_CHAT_CWD") {
        config.workspace = PathBuf::from(value);
    }
    if let Some(value) = overrides.get("CC_CHAT_DATA_DIR") {
        config.data_dir = PathBuf::from(value);
    }
    if let Some(value) = overrides.get("CC_CHAT_FRONTEND_ORIGIN") {
        config.frontend_origin = value
            .to_str()
            .ok_or_else(|| {
                "invalid field frontend_origin (CC_CHAT_FRONTEND_ORIGIN): value is not UTF-8"
                    .to_owned()
            })?
            .to_owned();
    }
    if let Some(value) = overrides.get("CC_CHAT_NODE_BINARY") {
        config.node_binary = Some(PathBuf::from(value));
    }
    Ok(())
}

fn validate(config: &Config) -> Result<(), String> {
    if config.port == 0 {
        return Err("invalid field port: must be greater than zero".to_owned());
    }
    if !config.workspace.is_dir() {
        return Err(format!(
            "invalid field workspace: must be an existing directory: {}",
            config.workspace.display()
        ));
    }
    if !config.data_dir.is_absolute() {
        return Err(format!(
            "invalid field data_dir: must be absolute: {}",
            config.data_dir.display()
        ));
    }
    validate_frontend_origin(&config.frontend_origin)?;
    if let Some(node_binary) = &config.node_binary {
        if !node_binary.is_absolute() {
            return Err(format!(
                "invalid field node_binary: must be absolute: {}",
                node_binary.display()
            ));
        }
        if !node_binary.is_file() {
            return Err(format!(
                "invalid field node_binary: must be an existing file: {}",
                node_binary.display()
            ));
        }
    }
    Ok(())
}

fn validate_frontend_origin(origin: &str) -> Result<(), String> {
    if origin.is_empty() {
        return Ok(());
    }
    let url = tauri::Url::parse(origin)
        .map_err(|error| format!("invalid field frontend_origin: {error}"))?;
    if url.scheme() != "https" {
        return Err("invalid field frontend_origin: scheme must be https".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("invalid field frontend_origin: credentials are not allowed".to_owned());
    }
    let exact_origin = url.origin().ascii_serialization();
    if exact_origin == "null" || origin != exact_origin {
        return Err(format!(
            "invalid field frontend_origin: must be an exact HTTPS origin such as {DEFAULT_FRONTEND_ORIGIN}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let nonce = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "cc-chat-config-{}-{nanos}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn load_clean(root: &TempDir) -> Result<Config, String> {
        let home = root.0.join("home");
        let app_data = root.0.join("app-data");
        fs::create_dir(&home).unwrap();
        load_with_overrides(
            &default_config_path(&app_data),
            &app_data,
            &home,
            &HashMap::new(),
        )
    }

    #[test]
    fn creates_and_loads_contextual_defaults() {
        let root = TempDir::new();
        let config = load_clean(&root).unwrap();
        assert_eq!(config.port, 4318);
        assert_eq!(config.workspace, root.0.join("home"));
        assert_eq!(config.data_dir, root.0.join("app-data"));
        assert_eq!(config.frontend_origin, DEFAULT_FRONTEND_ORIGIN);
        assert_eq!(config.node_binary, None);
        assert!(root.0.join("app-data/server-config.json").is_file());
        assert!(!root.0.join("app-data/data").exists());
    }

    #[cfg(unix)]
    #[test]
    fn creates_default_config_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = TempDir::new();
        load_clean(&root).unwrap();
        let mode = fs::metadata(root.0.join("app-data/server-config.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn rejects_unknown_config_fields() {
        let root = TempDir::new();
        let home = root.0.join("home");
        let app_data = root.0.join("app-data");
        fs::create_dir(&home).unwrap();
        fs::create_dir(&app_data).unwrap();
        let path = default_config_path(&app_data);
        fs::write(
            &path,
            format!(
                r#"{{"port":4318,"workspace":{:?},"data_dir":{:?},"frontend_origin":"","node_binary":null,"prot":9}}"#,
                home.to_string_lossy(),
                app_data.join("data").to_string_lossy()
            ),
        )
        .unwrap();
        let error = load_with_overrides(&path, &app_data, &home, &HashMap::new()).unwrap_err();
        assert!(error.contains("unknown field `prot`"), "{error}");
    }

    #[test]
    fn environment_overrides_are_effective_but_not_persisted() {
        let root = TempDir::new();
        let home = root.0.join("home");
        let other_workspace = root.0.join("other");
        let app_data = root.0.join("app-data");
        fs::create_dir(&home).unwrap();
        fs::create_dir(&other_workspace).unwrap();
        let path = default_config_path(&app_data);
        let overrides = HashMap::from([
            ("CC_CHAT_PORT".to_owned(), OsString::from("9876")),
            (
                "CC_CHAT_CWD".to_owned(),
                other_workspace.clone().into_os_string(),
            ),
            ("CC_CHAT_FRONTEND_ORIGIN".to_owned(), OsString::from("")),
        ]);
        let effective = load_with_overrides(&path, &app_data, &home, &overrides).unwrap();
        assert_eq!(effective.port, 9876);
        assert_eq!(effective.workspace, other_workspace);
        assert_eq!(effective.hosted_url(), None);

        let persisted = read_config(&path).unwrap();
        assert_eq!(persisted.port, DEFAULT_PORT);
        assert_eq!(persisted.workspace, home);
        assert_eq!(persisted.frontend_origin, DEFAULT_FRONTEND_ORIGIN);
    }

    #[test]
    fn validates_workspace_and_data_directory_fields() {
        let root = TempDir::new();
        let mut config = Config::defaults(&root.0, &root.0);
        config.workspace = root.0.join("missing");
        assert!(validate(&config).unwrap_err().contains("field workspace"));
        config.workspace = root.0.clone();
        config.data_dir = PathBuf::from("relative-data");
        assert!(validate(&config).unwrap_err().contains("field data_dir"));
    }

    #[test]
    fn validates_port_override_and_names_the_field() {
        let root = TempDir::new();
        let home = root.0.join("home");
        let app_data = root.0.join("app-data");
        fs::create_dir(&home).unwrap();
        let overrides = HashMap::from([("CC_CHAT_PORT".to_owned(), OsString::from("0"))]);
        let error = load_with_overrides(
            &default_config_path(&app_data),
            &app_data,
            &home,
            &overrides,
        )
        .unwrap_err();
        assert!(error.contains("field port"), "{error}");
    }

    #[test]
    fn accepts_only_empty_or_exact_credential_free_https_origins() {
        assert!(validate_frontend_origin("").is_ok());
        assert!(validate_frontend_origin("https://example.com").is_ok());
        for invalid in [
            "http://example.com",
            "https://user@example.com",
            "https://example.com/path",
            "https://example.com/",
            "https://example.com?query=1",
        ] {
            let error = validate_frontend_origin(invalid).unwrap_err();
            assert!(
                error.contains("field frontend_origin"),
                "{invalid}: {error}"
            );
        }
    }

    #[test]
    fn validates_node_binary_as_an_absolute_existing_file() {
        let root = TempDir::new();
        let mut config = Config::defaults(&root.0, &root.0);
        config.node_binary = Some(PathBuf::from("node"));
        assert!(validate(&config).unwrap_err().contains("field node_binary"));
        let node = root.0.join("node");
        fs::write(&node, b"").unwrap();
        config.node_binary = Some(node);
        assert!(validate(&config).is_ok());
    }

    #[test]
    fn hosted_url_percent_encodes_the_local_backend_url() {
        let root = TempDir::new();
        let config = Config::defaults(&root.0, &root.0);
        assert_eq!(config.local_url(), "http://127.0.0.1:4318");
        assert_eq!(
            config.hosted_url().as_deref(),
            Some("https://cc-chat-ui.laris.workers.dev/?host=http%3A%2F%2F127.0.0.1%3A4318")
        );
    }
}
