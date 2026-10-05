use std::ffi::c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct KeyboardInput {
    virtual_key: u16,
    scan: u16,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseInput {
    dx: i32,
    dy: i32,
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[repr(C)]
union InputData {
    keyboard: KeyboardInput,
    mouse: MouseInput,
}

#[repr(C)]
struct Input {
    kind: u32,
    data: InputData,
}

#[link(name = "user32")]
extern "system" {
    fn OpenClipboard(owner: *mut c_void) -> i32;
    fn CloseClipboard() -> i32;
    fn CountClipboardFormats() -> i32;
    fn EnumClipboardFormats(format: u32) -> u32;
    fn SendInput(count: u32, inputs: *const Input, input_size: i32) -> u32;
}

/// Types UTF-16 text directly into the current foreground window without
/// changing the clipboard. Used when Windows reports clipboard formats that
/// cannot be safely snapshotted and restored.
pub fn type_text(text: &str) -> Result<String, String> {
    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_UNICODE: u32 = 0x0004;

    let mut inputs = Vec::with_capacity(text.encode_utf16().count().saturating_mul(2));
    for unit in text.encode_utf16() {
        for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
            inputs.push(Input {
                kind: INPUT_KEYBOARD,
                data: InputData {
                    keyboard: KeyboardInput {
                        virtual_key: 0,
                        scan: unit,
                        flags,
                        time: 0,
                        extra_info: 0,
                    },
                },
            });
        }
    }
    if inputs.is_empty() {
        return Err("Cannot insert an empty transcript.".into());
    }
    let count = u32::try_from(inputs.len())
        .map_err(|_| "Transcript is too long to insert in one Windows input batch.")?;
    let input_size = i32::try_from(std::mem::size_of::<Input>())
        .map_err(|_| "Windows input record size is invalid.")?;
    // SAFETY: `inputs` is a contiguous array of correctly laid out Win32
    // INPUT records and remains alive for the duration of SendInput.
    let sent = unsafe { SendInput(count, inputs.as_ptr(), input_size) };
    if sent == count {
        Ok("windows:unicode-input".into())
    } else {
        Err(format!(
            "Windows inserted {sent} of {count} transcript keystrokes."
        ))
    }
}

#[link(name = "kernel32")]
extern "system" {
    fn SetLastError(code: u32);
    fn GetLastError() -> u32;
}

/// Missing text does not mean empty: images, files, and private formats must
/// not be silently discarded. Check formats while holding the OS clipboard.
pub fn inspect() -> Result<bool, String> {
    // SAFETY: Win32 accepts a null owner for read-only access. No clipboard
    // data pointers escape; every successful open is closed on this path.
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err(format!(
                "Could not open clipboard (Windows error {}).",
                GetLastError()
            ));
        }
        SetLastError(0);
        let count = CountClipboardFormats();
        let error = GetLastError();
        let mut formats = Vec::new();
        let mut previous = 0;
        loop {
            SetLastError(0);
            let format = EnumClipboardFormats(previous);
            if format == 0 {
                let enumeration_error = GetLastError();
                if enumeration_error != 0 {
                    CloseClipboard();
                    return Err(format!(
                        "Could not enumerate clipboard (Windows error {enumeration_error})."
                    ));
                }
                break;
            }
            formats.push(format);
            previous = format;
        }
        CloseClipboard();
        if count == 0 && error != 0 {
            Err(format!(
                "Could not inspect clipboard (Windows error {error})."
            ))
        } else {
            can_preserve_formats(&formats)?;
            Ok(count == 0)
        }
    }
}

fn can_preserve_formats(formats: &[u32]) -> Result<(), String> {
    // Windows synthesizes ANSI/OEM text + locale from Unicode, and bitmap
    // representations from DIB. These describe one restorable payload.
    // Registered formats (HTML, RTF, app data), files, and mixed text/image
    // payloads cannot be recreated by arboard: refuse before any write.
    let text_only = formats
        .iter()
        .all(|format| matches!(format, 1 | 7 | 13 | 16));
    let image_only = formats.iter().all(|format| matches!(format, 2 | 8 | 17));
    if text_only || image_only {
        Ok(())
    } else {
        Err("Auto paste cannot safely restore rich, mixed, or private clipboard formats. The clipboard was left untouched. Your transcript is ready; use Copy transcript when you want to replace it.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_empty_and_single_payload_with_synthesized_formats() {
        for formats in [&[][..], &[13, 1, 7, 16], &[2, 8, 17]] {
            assert!(can_preserve_formats(formats).is_ok());
        }
    }

    #[test]
    fn refuses_mixed_rich_files_and_private_formats_before_reading() {
        for formats in [&[13, 8][..], &[13, 0xc000], &[15], &[13, 3]] {
            assert!(can_preserve_formats(formats).is_err());
        }
    }

    #[link(name = "user32")]
    extern "system" {
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, memory: *mut c_void) -> *mut c_void;
        fn RegisterClipboardFormatW(name: *const u16) -> u32;
        fn GetDesktopWindow() -> *mut c_void;
        fn GetClipboardSequenceNumber() -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, size: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }

    // Only used on an isolated CI desktop, never on the owner's clipboard.
    #[test]
    #[ignore = "mutates clipboard; requires a disposable CI desktop"]
    fn windows_mixed_clipboard_native_probe() {
        assert!(
            std::env::var_os("CI").is_some(),
            "requires disposable CI desktop"
        );
        struct ClearOnDrop;
        impl Drop for ClearOnDrop {
            fn drop(&mut self) {
                // SAFETY: restore the disposable test desktop to empty.
                unsafe {
                    if OpenClipboard(GetDesktopWindow()) != 0 {
                        EmptyClipboard();
                        CloseClipboard();
                    }
                }
            }
        }
        let _cleanup = ClearOnDrop;
        // SAFETY: fixture allocations are locked during writes, transferred
        // to Windows on successful SetClipboardData, freed on failure, and
        // cleared by the guard after inspection. No data pointers escape.
        unsafe {
            let name: Vec<u16> = "HTML Format\0".encode_utf16().collect();
            let html = RegisterClipboardFormatW(name.as_ptr());
            assert_ne!(html, 0);
            let mut dib = vec![0u8; 44];
            dib[..4].copy_from_slice(&40u32.to_le_bytes());
            dib[4..8].copy_from_slice(&1i32.to_le_bytes());
            dib[8..12].copy_from_slice(&1i32.to_le_bytes());
            dib[12..14].copy_from_slice(&1u16.to_le_bytes());
            dib[14..16].copy_from_slice(&32u16.to_le_bytes());
            for (format, bytes) in [(html, b"<b>rich</b>\0".to_vec()), (8, dib)] {
                assert_ne!(OpenClipboard(GetDesktopWindow()), 0);
                assert_ne!(EmptyClipboard(), 0);
                for (kind, payload) in [(13, vec![65, 0, 0, 0]), (format, bytes)] {
                    let memory = GlobalAlloc(2, payload.len());
                    assert!(!memory.is_null());
                    let data = GlobalLock(memory);
                    assert!(!data.is_null());
                    std::ptr::copy_nonoverlapping(payload.as_ptr(), data.cast(), payload.len());
                    GlobalUnlock(memory);
                    if SetClipboardData(kind, memory).is_null() {
                        GlobalFree(memory);
                        CloseClipboard();
                        panic!("fixture clipboard write failed");
                    }
                }
                CloseClipboard();
                let sequence = GetClipboardSequenceNumber();
                assert!(inspect().unwrap_err().contains("left untouched"));
                assert_eq!(GetClipboardSequenceNumber(), sequence);
                assert_ne!(OpenClipboard(GetDesktopWindow()), 0);
                assert!(CountClipboardFormats() >= 2);
                CloseClipboard();
            }
        }
    }
}
