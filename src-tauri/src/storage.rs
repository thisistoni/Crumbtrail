use crate::models::{ProjectManifest, ProjectSummary, PROJECT_SCHEMA_VERSION};
use std::{
    fs::{self, File},
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
};
use thiserror::Error;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MANIFEST_FILE: &str = "manifest.json";
const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10_000;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Project archive error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Invalid project data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Unsupported project schema {found}; this build supports {supported}")]
    UnsupportedSchema { found: u32, supported: u32 },
    #[error("Unsafe or malformed project archive")]
    UnsafeArchive,
    #[error("Invalid project identifier")]
    InvalidProjectId,
    #[error("Project asset path escapes its session")]
    UnsafeAssetPath,
    #[error("Project references a missing asset: {0}")]
    MissingAsset(String),
}

pub type StorageResult<T> = Result<T, StorageError>;

#[derive(Debug, Clone)]
pub struct StorageService {
    sessions_root: PathBuf,
}

impl StorageService {
    pub fn new(app_local_data: PathBuf) -> StorageResult<Self> {
        let sessions_root = app_local_data.join("sessions");
        fs::create_dir_all(&sessions_root)?;
        Ok(Self { sessions_root })
    }

    pub fn create_project(&self, title: &str) -> StorageResult<ProjectManifest> {
        let project = ProjectManifest::new(title.trim());
        self.autosave(&project)?;
        Ok(project)
    }

    pub fn autosave(&self, project: &ProjectManifest) -> StorageResult<()> {
        self.validate_manifest(project)?;
        let session = self.session_dir(&project.id)?;
        fs::create_dir_all(session.join("media"))?;
        fs::create_dir_all(session.join("thumbnails"))?;
        self.validate_asset_references(project, &session)?;
        let json = serde_json::to_vec_pretty(project)?;
        atomic_write(&session.join(MANIFEST_FILE), &json)
    }

    pub fn load_session(&self, id: &str) -> StorageResult<ProjectManifest> {
        let path = self.session_dir(id)?.join(MANIFEST_FILE);
        let project = self.decode_manifest(&fs::read(path)?)?;
        self.validate_manifest(&project)?;
        self.validate_asset_references(&project, &self.session_dir(id)?)?;
        Ok(project)
    }

    pub fn list_sessions(&self) -> StorageResult<Vec<ProjectSummary>> {
        let mut projects = Vec::new();
        for entry in fs::read_dir(&self.sessions_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let manifest_path = entry.path().join(MANIFEST_FILE);
            let Ok(bytes) = fs::read(manifest_path) else {
                continue;
            };
            let Ok(project) = self.decode_manifest(&bytes) else {
                continue;
            };
            if self.validate_manifest(&project).is_err() {
                continue;
            }
            projects.push(ProjectSummary {
                id: project.id,
                title: project.title,
                updated_at: project.updated_at,
                step_count: project.steps.len(),
                recoverable: true,
            });
        }
        projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(projects)
    }

    pub fn write_asset(
        &self,
        project_id: &str,
        file_name: &str,
        bytes: &[u8],
    ) -> StorageResult<String> {
        let safe_name = safe_file_name(file_name);
        let relative = PathBuf::from("media").join(&safe_name);
        let path = self.asset_path(project_id, &relative)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(&path, bytes)?;
        if let Ok(image) = image::load_from_memory(bytes) {
            let thumbnail = image.thumbnail(360, 240);
            let mut encoded = Cursor::new(Vec::new());
            if thumbnail
                .write_to(&mut encoded, image::ImageFormat::Png)
                .is_ok()
            {
                let thumbnail_name = PathBuf::from("thumbnails").join(format!(
                    "{}.png",
                    Path::new(&safe_name)
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("image")
                ));
                let thumbnail_path = self.asset_path(project_id, &thumbnail_name)?;
                if let Some(parent) = thumbnail_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                atomic_write(&thumbnail_path, encoded.get_ref())?;
            }
        }
        Ok(path_to_archive_name(&relative))
    }

    pub fn read_asset(&self, project_id: &str, relative: &str) -> StorageResult<Vec<u8>> {
        fs::read(self.asset_path(project_id, Path::new(relative))?).map_err(Into::into)
    }

    pub fn replace_asset(&self, project_id: &str, source: &Path) -> StorageResult<String> {
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("png");
        let name = format!(
            "replacement-{}.{}",
            Uuid::new_v4(),
            safe_file_name(extension)
        );
        self.write_asset(project_id, &name, &fs::read(source)?)
    }

    pub fn save_archive(&self, project: &ProjectManifest, destination: &Path) -> StorageResult<()> {
        self.autosave(project)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp = destination.with_extension("crumbtrail.tmp");
        let session = self.session_dir(&project.id)?;
        let file = File::create(&temp)?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        for entry in WalkDir::new(&session).follow_links(false) {
            let entry = entry.map_err(|error| std::io::Error::other(error.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&session)
                .map_err(|_| StorageError::UnsafeAssetPath)?;
            zip.start_file(path_to_archive_name(relative), options)?;
            let mut source = File::open(entry.path())?;
            std::io::copy(&mut source, &mut zip)?;
        }
        zip.finish()?.sync_all()?;
        replace_file(&temp, destination)
    }

    pub fn open_archive(&self, source: &Path) -> StorageResult<ProjectManifest> {
        let mut archive = ZipArchive::new(File::open(source)?)?;
        if archive.len() > MAX_ARCHIVE_ENTRIES {
            return Err(StorageError::UnsafeArchive);
        }

        let staging_id = Uuid::new_v4().to_string();
        let staging = self.session_dir(&staging_id)?;
        fs::create_dir_all(&staging)?;
        let mut total = 0_u64;

        let extract_result = (|| -> StorageResult<()> {
            for index in 0..archive.len() {
                let mut file = archive.by_index(index)?;
                total = total.saturating_add(file.size());
                if total > MAX_ARCHIVE_BYTES || is_symlink(&file) {
                    return Err(StorageError::UnsafeArchive);
                }
                let relative = file.enclosed_name().ok_or(StorageError::UnsafeArchive)?;
                if relative
                    .components()
                    .any(|part| !matches!(part, Component::Normal(_)))
                {
                    return Err(StorageError::UnsafeArchive);
                }
                let destination = staging.join(relative);
                if file.is_dir() {
                    fs::create_dir_all(&destination)?;
                } else {
                    if let Some(parent) = destination.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    let mut output = File::create(destination)?;
                    std::io::copy(&mut file, &mut output)?;
                }
            }
            Ok(())
        })();

        if let Err(error) = extract_result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }

        let manifest_path = staging.join(MANIFEST_FILE);
        let project_result = (|| -> StorageResult<ProjectManifest> {
            let mut project = self.decode_manifest(&fs::read(&manifest_path)?)?;
            self.validate_manifest(&project)?;
            self.validate_asset_references(&project, &staging)?;
            project.id = staging_id;
            project.updated_at = chrono::Utc::now().to_rfc3339();
            atomic_write(&manifest_path, &serde_json::to_vec_pretty(&project)?)?;
            Ok(project)
        })();
        if project_result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        project_result
    }

    pub fn delete_session(&self, id: &str) -> StorageResult<()> {
        let path = self.session_dir(id)?;
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
        Ok(())
    }

    fn validate_manifest(&self, project: &ProjectManifest) -> StorageResult<()> {
        if project.schema_version != PROJECT_SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema {
                found: project.schema_version,
                supported: PROJECT_SCHEMA_VERSION,
            });
        }
        Uuid::parse_str(&project.id).map_err(|_| StorageError::InvalidProjectId)?;
        Ok(())
    }

    fn decode_manifest(&self, bytes: &[u8]) -> StorageResult<ProjectManifest> {
        let value: serde_json::Value = serde_json::from_slice(bytes)?;
        let found = value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0);
        if found == 0 || found > PROJECT_SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema {
                found,
                supported: PROJECT_SCHEMA_VERSION,
            });
        }
        let mut project: ProjectManifest = serde_json::from_value(value)?;
        if project.schema_version < PROJECT_SCHEMA_VERSION {
            project.schema_version = PROJECT_SCHEMA_VERSION;
        }
        Ok(project)
    }

    fn validate_asset_references(
        &self,
        project: &ProjectManifest,
        session: &Path,
    ) -> StorageResult<()> {
        let mut assets = Vec::new();
        if let Some(logo) = project.theme.logo_asset.as_deref() {
            assets.push(logo);
        }
        for step in &project.steps {
            if let Some(asset) = step.media.before_asset.as_deref() {
                assets.push(asset);
            }
            if let Some(asset) = step.media.after_asset.as_deref() {
                assets.push(asset);
            }
        }
        for asset in assets {
            let relative = Path::new(asset);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|part| !matches!(part, Component::Normal(_)))
            {
                return Err(StorageError::UnsafeAssetPath);
            }
            if !session.join(relative).is_file() {
                return Err(StorageError::MissingAsset(asset.to_string()));
            }
        }
        Ok(())
    }

    fn session_dir(&self, id: &str) -> StorageResult<PathBuf> {
        Uuid::parse_str(id).map_err(|_| StorageError::InvalidProjectId)?;
        Ok(self.sessions_root.join(id))
    }

    fn asset_path(&self, project_id: &str, relative: &Path) -> StorageResult<PathBuf> {
        if relative.is_absolute()
            || relative
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(StorageError::UnsafeAssetPath);
        }
        Ok(self.session_dir(project_id)?.join(relative))
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> StorageResult<()> {
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut file = File::create(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    replace_file(&temp, path)
}

fn replace_file(source: &Path, destination: &Path) -> StorageResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            },
        };
        let source_wide = source
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let destination_wide = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        unsafe {
            MoveFileExW(
                PCWSTR(source_wide.as_ptr()),
                PCWSTR(destination_wide.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|error| StorageError::Io(std::io::Error::other(error.to_string())))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if destination.exists() {
            fs::remove_file(destination)?;
        }
        fs::rename(source, destination)?;
        Ok(())
    }
}

fn safe_file_name(value: &str) -> String {
    let value: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect();
    value
        .trim_matches(['-', '.'])
        .chars()
        .take(96)
        .collect::<String>()
        .to_lowercase()
}

fn path_to_archive_name(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn is_symlink(file: &zip::read::ZipFile<'_, File>) -> bool {
    file.unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> (tempfile::TempDir, StorageService) {
        let temp = tempfile::tempdir().unwrap();
        let service = StorageService::new(temp.path().to_path_buf()).unwrap();
        (temp, service)
    }

    #[test]
    fn project_round_trips_through_archive() {
        let (temp, storage) = service();
        let mut project = storage.create_project("Install the printer").unwrap();
        let asset = storage
            .write_asset(&project.id, "first.png", b"image")
            .unwrap();
        project.steps.push(crate::models::Step::manual(asset));
        let archive = temp.path().join("guide.crumbtrail");
        storage.save_archive(&project, &archive).unwrap();
        let reopened = storage.open_archive(&archive).unwrap();
        assert_eq!(reopened.title, project.title);
        assert_eq!(reopened.steps.len(), 1);
        assert_ne!(reopened.id, project.id);
    }

    #[test]
    fn rejects_newer_schema_without_changing_it() {
        let (_temp, storage) = service();
        let mut project = ProjectManifest::new("Future");
        project.schema_version = PROJECT_SCHEMA_VERSION + 1;
        let error = storage.autosave(&project).unwrap_err();
        assert!(matches!(error, StorageError::UnsupportedSchema { .. }));
        assert_eq!(project.schema_version, PROJECT_SCHEMA_VERSION + 1);
    }

    #[test]
    fn sanitizes_export_names() {
        assert_eq!(
            safe_file_name("01: Click / Save.PNG"),
            "01--click---save.png"
        );
    }

    #[test]
    fn refuses_to_persist_a_manifest_with_missing_assets() {
        let (_temp, storage) = service();
        let mut project = storage.create_project("Broken reference").unwrap();
        project
            .steps
            .push(crate::models::Step::manual("media/not-there.png".into()));
        assert!(matches!(
            storage.autosave(&project),
            Err(StorageError::MissingAsset(_))
        ));
    }

    #[test]
    fn rejects_zip_slip_entries_and_cleans_staging() {
        let (temp, storage) = service();
        let source = temp.path().join("unsafe.crumbtrail");
        let mut archive = ZipWriter::new(File::create(&source).unwrap());
        archive
            .start_file("../outside.txt", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"nope").unwrap();
        archive.finish().unwrap();
        assert!(matches!(
            storage.open_archive(&source),
            Err(StorageError::UnsafeArchive)
        ));
        assert_eq!(fs::read_dir(&storage.sessions_root).unwrap().count(), 0);
        assert!(!temp.path().join("outside.txt").exists());
    }

    #[test]
    fn ignores_interrupted_temporary_manifest_files() {
        let (_temp, storage) = service();
        let project = storage.create_project("Recover me").unwrap();
        let session = storage.session_dir(&project.id).unwrap();
        fs::write(session.join("manifest.interrupted.tmp"), b"not json").unwrap();
        assert_eq!(
            storage.load_session(&project.id).unwrap().title,
            "Recover me"
        );
    }

    #[test]
    fn migrates_schema_one_in_memory_without_rewriting_the_session() {
        let (_temp, storage) = service();
        let project = storage.create_project("Legacy").unwrap();
        let manifest = storage
            .session_dir(&project.id)
            .unwrap()
            .join(MANIFEST_FILE);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        value["schemaVersion"] = serde_json::json!(1);
        value["theme"]
            .as_object_mut()
            .unwrap()
            .remove("reportLocale");
        fs::write(&manifest, serde_json::to_vec_pretty(&value).unwrap()).unwrap();

        let migrated = storage.load_session(&project.id).unwrap();
        assert_eq!(migrated.schema_version, PROJECT_SCHEMA_VERSION);
        assert_eq!(migrated.theme.report_locale, "en");

        let unchanged: serde_json::Value =
            serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
        assert_eq!(unchanged["schemaVersion"], 1);
    }
}
