//! Native emptiness probes. Unavailable access must never mean empty.

#[cfg(target_os = "windows")]
pub fn is_empty() -> Result<bool, String> {
    super::windows_clipboard::inspect()
}

#[cfg(target_os = "linux")]
pub fn is_empty() -> Result<bool, String> {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        use wl_clipboard_rs::paste::{get_mime_types, ClipboardType, Error, Seat};
        return match get_mime_types(ClipboardType::Regular, Seat::Unspecified) {
            Ok(types) => {
                if types.is_empty() {
                    return Ok(true);
                }
                can_preserve_types(&types.into_iter().collect::<Vec<_>>())?;
                Ok(false)
            }
            Err(Error::ClipboardEmpty) => Ok(true),
            Err(error) => Err(format!("Could not inspect Wayland clipboard: {error}")),
        };
    }
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{AtomEnum, ConnectionExt, CreateWindowAux, WindowClass},
            Event,
        },
    };
    let (connection, _) = x11rb::connect(None).map_err(|error| error.to_string())?;
    let clipboard = connection
        .intern_atom(false, b"CLIPBOARD")
        .map_err(|error| error.to_string())?
        .reply()
        .map_err(|error| error.to_string())?
        .atom;
    let owner = connection
        .get_selection_owner(clipboard)
        .map_err(|error| error.to_string())?
        .reply()
        .map_err(|error| error.to_string())?
        .owner;
    if owner == x11rb::NONE {
        return Ok(true);
    }
    let window = connection
        .generate_id()
        .map_err(|error| error.to_string())?;
    let root = connection.setup().roots[0].root;
    connection
        .create_window(
            0,
            window,
            root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_ONLY,
            0,
            &CreateWindowAux::new(),
        )
        .map_err(|error| error.to_string())?
        .check()
        .map_err(|error| error.to_string())?;
    struct WindowGuard<'a>(&'a x11rb::rust_connection::RustConnection, u32);
    impl Drop for WindowGuard<'_> {
        fn drop(&mut self) {
            let _ = self.0.destroy_window(self.1);
            let _ = self.0.flush();
        }
    }
    let _guard = WindowGuard(&connection, window);
    let targets = connection
        .intern_atom(false, b"TARGETS")
        .map_err(|error| error.to_string())?
        .reply()
        .map_err(|error| error.to_string())?
        .atom;
    connection
        .convert_selection(window, clipboard, targets, targets, x11rb::CURRENT_TIME)
        .map_err(|error| error.to_string())?
        .check()
        .map_err(|error| error.to_string())?;
    connection.flush().map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        if let Some(Event::SelectionNotify(event)) = connection
            .poll_for_event()
            .map_err(|error| error.to_string())?
        {
            if event.requestor != window || event.selection != clipboard {
                continue;
            }
            if event.property == x11rb::NONE {
                return Err(
                    "Could not inspect clipboard formats; clipboard left untouched.".into(),
                );
            }
            let property = connection
                .get_property(false, window, targets, AtomEnum::ATOM, 0, 1024)
                .map_err(|error| error.to_string())?
                .reply()
                .map_err(|error| error.to_string())?;
            if property.bytes_after != 0 {
                return Err("Too many clipboard formats; clipboard left untouched.".into());
            }
            let atoms = property
                .value32()
                .ok_or("Invalid clipboard format response")?;
            let mut types = Vec::new();
            for atom in atoms {
                let name = connection
                    .get_atom_name(atom)
                    .map_err(|error| error.to_string())?
                    .reply()
                    .map_err(|error| error.to_string())?
                    .name;
                types.push(String::from_utf8(name).map_err(|error| error.to_string())?);
            }
            can_preserve_types(&types)?;
            return Ok(false);
        }
        if std::time::Instant::now() >= deadline {
            return Err("Clipboard format inspection timed out; clipboard left untouched.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[cfg(target_os = "macos")]
pub fn is_empty() -> Result<bool, String> {
    use objc2_app_kit::NSPasteboard;
    let types = NSPasteboard::generalPasteboard().types();
    let Some(types) = types.filter(|types| !types.is_empty()) else {
        return Ok(true);
    };
    can_preserve_types(
        &types
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>(),
    )?;
    Ok(false)
}

#[cfg(unix)]
fn can_preserve_types(types: &[String]) -> Result<(), String> {
    let payloads: Vec<&str> = types
        .iter()
        .map(String::as_str)
        .filter(|name| !matches!(*name, "TARGETS" | "TIMESTAMP" | "MULTIPLE" | "SAVE_TARGETS"))
        .collect();
    let text_only = !payloads.is_empty()
        && payloads.iter().all(|name| {
            matches!(
                *name,
                "UTF8_STRING"
                    | "STRING"
                    | "TEXT"
                    | "COMPOUND_TEXT"
                    | "public.utf8-plain-text"
                    | "public.utf16-plain-text"
                    | "public.text"
                    | "NSStringPboardType"
            ) || name.split(';').next() == Some("text/plain")
        });
    let image_only = !payloads.is_empty()
        && payloads.iter().all(|name| {
            matches!(
                *name,
                "image/png" | "public.png" | "public.tiff" | "NSTIFFPboardType"
            )
        });
    if text_only || image_only {
        Ok(())
    } else {
        Err("Auto paste cannot safely restore rich, mixed, or private clipboard formats. The clipboard was left untouched. Your transcript is ready; use Copy transcript when you want to replace it.".into())
    }
}

#[cfg(all(test, unix))]
mod format_tests {
    use super::*;
    #[test]
    fn format_probe_accepts_plain_payloads_but_never_rich_mixed_or_unknown() {
        for (names, allowed) in [
            (
                vec!["TARGETS", "UTF8_STRING", "text/plain;charset=utf-8"],
                true,
            ),
            (vec!["image/png"], true),
            (vec!["public.tiff", "public.png"], true),
            (vec!["UTF8_STRING", "text/html"], false),
            (vec!["UTF8_STRING", "image/png"], false),
            (vec!["public.utf8-plain-text", "public.rtf"], false),
            (vec!["TARGETS"], false),
        ] {
            assert_eq!(
                can_preserve_types(&names.into_iter().map(String::from).collect::<Vec<_>>())
                    .is_ok(),
                allowed
            );
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a dedicated empty Xvfb clipboard"]
    fn linux_empty_clipboard_native_probe() {
        assert!(std::env::var_os("WAYLAND_DISPLAY").is_none());
        assert!(is_empty().unwrap());
        // A failed connection must remain an error, never an empty clipboard.
        // X11 TCP ports are 6000 + display; keep the display within that range.
        std::env::set_var("DISPLAY", ":12345");
        assert!(is_empty().is_err());
    }
}
