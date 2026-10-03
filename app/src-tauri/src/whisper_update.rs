use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const ENGINE_VERSION: &str = "1.9.4";
pub const MODEL_NAME: &str = "base.en";
pub const MODEL_SHA: &str = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
pub const MODEL_SIZE: u64 = 147_964_211;
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub engine_version: String,
    pub engine_supported: bool,
    pub model_name: String,
    pub model_bytes: u64,
    pub busy: bool,
}
pub fn catalog(busy: bool) -> Catalog {
    Catalog {
        engine_version: ENGINE_VERSION.into(),
        engine_supported: engine_artifact().is_some(),
        model_name: MODEL_NAME.into(),
        model_bytes: MODEL_SIZE,
        busy,
    }
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub component: String,
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

pub struct UpdateLease(Arc<AtomicBool>);
impl UpdateLease {
    pub fn acquire(busy: Arc<AtomicBool>) -> Result<Self, String> {
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "A Whisper update is already running.".to_string())?;
        Ok(Self(busy))
    }
}
impl Drop for UpdateLease {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct Artifact<'a> {
    url: &'a str,
    sha: &'a str,
    size: u64,
}
fn engine_artifact() -> Option<Artifact<'static>> {
    // b5130 is the distribution build at the exact stable v1.9.4 commit
    // 927cfce34f31707e17f2bff35c349632fb9e2c3a. Digests are pinned from
    // GitHub's release asset metadata, not accepted from caller input.
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some(Artifact {
            url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip",
            sha: "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
            size: 8_573_270,
        })
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        Some(Artifact {
            url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-win-cpu-arm64.zip",
            sha: "799543b926ab5b6c2d60cab269a2092e0ae8d27820e9e15429e59de3699546fc",
            size: 4_361_895,
        })
    } else {
        None
    }
}

pub fn check_cancel(cancel: &AtomicBool, shutdown: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) || shutdown.load(Ordering::Acquire) {
        Err("Whisper update cancelled. Your previous files are preserved.".to_string())
    } else {
        Ok(())
    }
}

pub fn file_matches(path: &Path, expected_sha: &str, expected_size: u64) -> Result<bool, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("Could not read model: {e}")),
    };
    if file.metadata().map_err(|e| e.to_string())?.len() != expected_size {
        return Ok(false);
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()) == expected_sha)
}

fn copy_verified(
    source: &mut impl Read,
    target: &mut impl Write,
    artifact: &Artifact<'_>,
    mut progress: impl FnMut(u64),
    cancel: &AtomicBool,
    shutdown: &AtomicBool,
) -> Result<(), String> {
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 65_536];
    let started = Instant::now();
    loop {
        check_cancel(cancel, shutdown)?;
        if started.elapsed() > Duration::from_secs(600) {
            return Err("Whisper download timed out. Your previous files are preserved.".into());
        }
        let count = source
            .read(&mut buffer)
            .map_err(|e| format!("Download interrupted: {e}"))?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > artifact.size {
            return Err("Download exceeded the verified file size.".to_string());
        }
        hash.update(&buffer[..count]);
        target
            .write_all(&buffer[..count])
            .map_err(|e| format!("Could not save download: {e}"))?;
        progress(total);
    }
    if total != artifact.size || format!("{:x}", hash.finalize()) != artifact.sha {
        return Err("Download verification failed. Your previous files are preserved.".to_string());
    }
    check_cancel(cancel, shutdown)
}

fn download_verified(
    target: &Path,
    artifact: &Artifact<'_>,
    progress: impl FnMut(u64),
    cancel: &AtomicBool,
    shutdown: &AtomicBool,
) -> Result<(), String> {
    check_cancel(cancel, shutdown)?;
    // A provider may already be installed by the application updater. Losing
    // this one-time initialization race means the existing provider is used.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("VibeVoice/0.2.8")
        .build()
        .map_err(|e| format!("Download client unavailable: {e}"))?;
    let mut response = client
        .get(artifact.url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|e| format!("Could not download Whisper component: {e}"))?;
    if response
        .content_length()
        .is_some_and(|length| length != artifact.size)
    {
        return Err("Server returned an unexpected file size.".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    AtomicFile::new(target, AllowOverwrite)
        .write(|file| copy_verified(&mut response, file, artifact, progress, cancel, shutdown))
        .map_err(|error| format!("Could not install verified download: {error}"))
}

pub fn ensure_model(
    root: &Path,
    current_model: Option<&Path>,
    mut notify: impl FnMut(Progress),
    cancel: &AtomicBool,
    shutdown: &AtomicBool,
) -> Result<PathBuf, String> {
    check_cancel(cancel, shutdown)?;
    notify(Progress {
        component: "model".into(),
        stage: "checking".into(),
        downloaded_bytes: 0,
        total_bytes: MODEL_SIZE,
        message: "Verifying the current base.en model…".into(),
    });
    if let Some(model) = current_model {
        if file_matches(model, MODEL_SHA, MODEL_SIZE)? {
            return Ok(model.to_path_buf());
        }
    }
    // Repair only the managed model; never overwrite an explicitly selected
    // custom model or modify its containing engine checkout.
    let target = root
        .join("models")
        .join(format!("ggml-base.en-{MODEL_SHA}.bin"));
    if file_matches(&target, MODEL_SHA, MODEL_SIZE)? {
        return Ok(target);
    }
    let artifact = Artifact {
        url: MODEL_URL,
        sha: MODEL_SHA,
        size: MODEL_SIZE,
    };
    let mut last_percent = u64::MAX;
    download_verified(
        &target,
        &artifact,
        |bytes| {
            let percent = bytes * 100 / MODEL_SIZE;
            if percent != last_percent {
                last_percent = percent;
                notify(Progress {
                    component: "model".into(),
                    stage: "downloading".into(),
                    downloaded_bytes: bytes,
                    total_bytes: MODEL_SIZE,
                    message: format!("Downloading base.en model: {percent}%"),
                });
            }
        },
        cancel,
        shutdown,
    )?;
    Ok(target)
}

fn extract_engine(archive: &Path, target: &Path) -> Result<PathBuf, String> {
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid engine package: {e}"))?;
    if zip.len() > 256 {
        return Err("Engine package has too many entries.".into());
    }
    let mut names = HashSet::new();
    let mut expanded = 0u64;
    let mut binary = None;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or("Unsafe path in engine package.")?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Engine package contains a symbolic link.".into());
        }
        let key = relative.to_string_lossy().to_ascii_lowercase();
        if !names.insert(key) {
            return Err("Engine package contains duplicate paths.".into());
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or("Engine package size overflow.")?;
        if expanded > 128 * 1024 * 1024 {
            return Err("Engine package is too large.".into());
        }
        let path = target.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut file = File::options()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut file).map_err(|e| format!("Engine extraction failed: {e}"))?;
        file.sync_all().map_err(|e| e.to_string())?;
        if relative
            .file_name()
            .is_some_and(|name| name == "whisper-cli.exe")
            && binary.replace(path).is_some()
        {
            return Err("Engine package contains multiple CLIs.".into());
        }
    }
    binary.ok_or_else(|| "Engine package does not contain whisper-cli.exe.".into())
}

/// A new engine remains disposable until the caller activates its settings.
pub struct StagedEngine {
    pub binary: PathBuf,
    directory: PathBuf,
    root: PathBuf,
    active: bool,
}
impl StagedEngine {
    pub fn activate(&mut self) {
        self.active = true;
    }
}
impl Drop for StagedEngine {
    fn drop(&mut self) {
        if !self.active
            && self.directory.canonicalize().is_ok_and(|path| {
                path == self.directory && path.parent() == Some(self.root.as_path())
            })
        {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }
}

pub fn stage_engine(
    root: &Path,
    mut notify: impl FnMut(Progress),
    cancel: &AtomicBool,
    shutdown: &AtomicBool,
) -> Result<StagedEngine, String> {
    let artifact = engine_artifact().ok_or("Automatic engine updates currently support Windows x64 and ARM64. Model updates are available on all platforms.")?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let directory = root.join(format!("whisper-{ENGINE_VERSION}-{}", Uuid::new_v4()));
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    let mut staged = StagedEngine {
        binary: PathBuf::new(),
        directory,
        root,
        active: false,
    };
    let archive = staged.directory.join("engine.zip");
    let mut last_percent = u64::MAX;
    download_verified(
        &archive,
        &artifact,
        |bytes| {
            let percent = bytes * 100 / artifact.size;
            if percent != last_percent {
                last_percent = percent;
                notify(Progress {
                    component: "engine".into(),
                    stage: "downloading".into(),
                    downloaded_bytes: bytes,
                    total_bytes: artifact.size,
                    message: format!("Downloading Whisper {ENGINE_VERSION}: {percent}%"),
                });
            }
        },
        cancel,
        shutdown,
    )?;
    check_cancel(cancel, shutdown)?;
    notify(Progress {
        component: "engine".into(),
        stage: "verifying".into(),
        downloaded_bytes: artifact.size,
        total_bytes: artifact.size,
        message: "Package verified. Checking the new engine…".into(),
    });
    staged.binary = extract_engine(&archive, &staged.directory)?;
    fs::remove_file(archive).map_err(|e| e.to_string())?;
    Ok(staged)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("vibevoice-updater-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn corrupted_or_truncated_download_never_replaces_working_file() {
        let root = fixture();
        let path = root.join("model.bin");
        fs::write(&path, b"working").unwrap();
        let artifact = Artifact {
            url: "",
            sha: "not-the-hash",
            size: 4,
        };
        for input in [&b"bad"[..], &b"bad!"[..]] {
            let result = AtomicFile::new(&path, AllowOverwrite).write(|file| {
                copy_verified(
                    &mut &input[..],
                    file,
                    &artifact,
                    |_| {},
                    &AtomicBool::new(false),
                    &AtomicBool::new(false),
                )
            });
            assert!(result.is_err());
            assert_eq!(fs::read(&path).unwrap(), b"working");
        }
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn verified_download_replaces_atomically_and_reports_progress() {
        let root = fixture();
        let path = root.join("model.bin");
        fs::write(&path, b"old").unwrap();
        let sha = format!("{:x}", Sha256::digest(b"new"));
        let artifact = Artifact {
            url: "",
            sha: &sha,
            size: 3,
        };
        let mut bytes = 0;
        AtomicFile::new(&path, AllowOverwrite)
            .write(|file| {
                copy_verified(
                    &mut &b"new"[..],
                    file,
                    &artifact,
                    |n| bytes = n,
                    &AtomicBool::new(false),
                    &AtomicBool::new(false),
                )
            })
            .unwrap();
        assert_eq!(bytes, 3);
        assert_eq!(fs::read(&path).unwrap(), b"new");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancellation_preserves_the_old_file() {
        let root = fixture();
        let path = root.join("model.bin");
        fs::write(&path, b"old").unwrap();
        let artifact = Artifact {
            url: "",
            sha: "",
            size: 3,
        };
        let result = AtomicFile::new(&path, AllowOverwrite).write(|file| {
            copy_verified(
                &mut &b"new"[..],
                file,
                &artifact,
                |_| {},
                &AtomicBool::new(true),
                &AtomicBool::new(false),
            )
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn update_lease_prevents_duplicates_and_releases_on_failure() {
        let busy = Arc::new(AtomicBool::new(false));
        let lease = UpdateLease::acquire(Arc::clone(&busy)).unwrap();
        assert!(UpdateLease::acquire(Arc::clone(&busy)).is_err());
        drop(lease);
        assert!(UpdateLease::acquire(busy).is_ok());
    }
    #[test]
    fn archive_traversal_is_rejected_before_writing_outside_staging() {
        let root = fixture();
        let archive = root.join("bad.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        zip.start_file("../escaped.exe", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"bad").unwrap();
        zip.finish().unwrap();
        assert!(extract_engine(&archive, &root.join("staging")).is_err());
        assert!(!root.join("escaped.exe").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
