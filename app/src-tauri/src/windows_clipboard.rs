use std::ffi::c_void;

#[link(name = "user32")]
extern "system" {
    fn OpenClipboard(owner: *mut c_void) -> i32;
    fn CloseClipboard() -> i32;
    fn CountClipboardFormats() -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn SetLastError(code: u32);
    fn GetLastError() -> u32;
}

/// Missing text does not mean empty: images, files, and private formats must
/// not be silently discarded. Check formats while holding the OS clipboard.
pub fn is_empty() -> Result<bool, String> {
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
        CloseClipboard();
        if count == 0 && error != 0 {
            Err(format!(
                "Could not inspect clipboard (Windows error {error})."
            ))
        } else {
            Ok(count == 0)
        }
    }
}
