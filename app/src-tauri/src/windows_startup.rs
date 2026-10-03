use std::{io, path::Path};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const NAME: &str = "VibeVoice";

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    write_registration(RUN, APPROVED, NAME, &executable, enabled).map_err(|e| e.to_string())
}

pub struct Snapshot {
    run: Option<winreg::RegValue>,
    approved: Option<winreg::RegValue>,
}

fn read_value(path: &str) -> io::Result<Option<winreg::RegValue>> {
    match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(path)
        .and_then(|key| key.get_raw_value(NAME))
    {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn snapshot() -> Result<Snapshot, String> {
    Ok(Snapshot {
        run: read_value(RUN).map_err(|e| e.to_string())?,
        approved: read_value(APPROVED).map_err(|e| e.to_string())?,
    })
}

pub fn restore(snapshot: Snapshot) -> Result<(), String> {
    let mut errors = Vec::new();
    for (path, value) in [(RUN, snapshot.run), (APPROVED, snapshot.approved)] {
        let result = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(path)
            .and_then(|(key, _)| {
                if let Some(value) = value {
                    key.set_raw_value(NAME, &value)
                } else {
                    match key.delete_value(NAME) {
                        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                        result => result,
                    }
                }
            });
        if let Err(error) = result {
            errors.push(error.to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn startup_command(executable: &Path) -> String {
    // Run entries are command lines. Program Files and user paths need quotes.
    format!("\"{}\"", executable.display())
}

fn write_registration(
    run: &str,
    approved: &str,
    name: &str,
    executable: &Path,
    enabled: bool,
) -> io::Result<()> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = user.create_subkey(run)?;
    if enabled {
        run.set_value(name, &startup_command(executable))?;
        let (approved, _) = user.create_subkey(approved)?;
        approved.set_raw_value(
            name,
            &winreg::RegValue {
                vtype: winreg::enums::RegType::REG_BINARY,
                bytes: vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            },
        )?;
    } else {
        match run.delete_value(name) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_registry_round_trip_quotes_spaces_and_removes_disabled_entries() {
        let root = format!(
            "Software\\VibeVoice\\SettingsTests\\{}",
            uuid::Uuid::new_v4()
        );
        let run = format!("{root}\\Run");
        let approved = format!("{root}\\Approved");
        let exe = Path::new("C:\\Program Files\\VibeVoice\\vibevoice.exe");
        let user = RegKey::predef(HKEY_CURRENT_USER);
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root);
        write_registration(&run, &approved, NAME, exe, true).unwrap();
        assert_eq!(
            user.open_subkey(&run)
                .unwrap()
                .get_value::<String, _>(NAME)
                .unwrap(),
            "\"C:\\Program Files\\VibeVoice\\vibevoice.exe\""
        );
        assert_eq!(
            user.open_subkey(&approved)
                .unwrap()
                .get_raw_value(NAME)
                .unwrap()
                .bytes[0],
            2
        );
        // Even if Task Manager disables startup, turning the app toggle off must remove Run.
        user.create_subkey(&approved)
            .unwrap()
            .0
            .set_raw_value(
                NAME,
                &winreg::RegValue {
                    vtype: winreg::enums::RegType::REG_BINARY,
                    bytes: vec![3; 12],
                },
            )
            .unwrap();
        write_registration(&run, &approved, NAME, exe, false).unwrap();
        assert!(user
            .open_subkey(&run)
            .unwrap()
            .get_value::<String, _>(NAME)
            .is_err());
        write_registration(&run, &approved, NAME, exe, false).unwrap();
    }
}
