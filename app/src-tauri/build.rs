fn main() {
    if target_is_windows() && !has_windows_resource_compiler() {
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(tauri_build::build);
        std::panic::set_hook(previous_hook);
        if result.is_err() {
            println!(
                "cargo:warning=skipping Windows resource embedding because llvm-rc, rc.exe, and windres are unavailable"
            );
        }
    } else {
        tauri_build::build();
    }
}

fn target_is_windows() -> bool {
    std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|value| value == "windows")
}

fn has_windows_resource_compiler() -> bool {
    ["llvm-rc", "rc.exe", "windres"]
        .into_iter()
        .any(command_available)
}

fn command_available(command: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|path| {
                let candidate = path.join(command);
                candidate.is_file()
            })
        })
        .unwrap_or(false)
}
