fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|target| target == "windows")
        && !resource_compiler_available()
    {
        println!(
            "cargo:warning=Skipping Windows resource embedding because no resource compiler was found on PATH."
        );
        return;
    }
    tauri_build::build();
}

fn resource_compiler_available() -> bool {
    ["llvm-rc", "rc.exe", "windres"]
        .iter()
        .any(|command| command_exists(command))
}

fn command_exists(name: &str) -> bool {
    if cfg!(target_os = "windows") {
        std::process::Command::new("where")
            .arg(name)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    } else {
        let probe = format!("command -v '{}' >/dev/null 2>&1", name.replace('\'', ""));
        std::process::Command::new("sh")
            .arg("-c")
            .arg(probe)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}
