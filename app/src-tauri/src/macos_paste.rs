//! Command-V through Quartz, with an explicit Accessibility permission gate.
use std::ffi::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> *const c_void;
    fn CGEventSetFlags(event: *const c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *const c_void);
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: *const c_void);
}

pub fn paste() -> Result<String, String> {
    // SAFETY: these functions use no borrowed Rust data. Create-rule events
    // are checked for null, posted while alive, and released exactly once.
    unsafe {
        if !AXIsProcessTrusted() {
            return Err("Allow VibeVoice in System Settings → Privacy & Security → Accessibility, then retry insertion. Your transcript is saved.".into());
        }
        let down = CGEventCreateKeyboardEvent(std::ptr::null(), 9, true);
        let up = CGEventCreateKeyboardEvent(std::ptr::null(), 9, false);
        if down.is_null() || up.is_null() {
            if !down.is_null() {
                CFRelease(down);
            }
            if !up.is_null() {
                CFRelease(up);
            }
            return Err("Could not create the macOS paste key events.".into());
        }
        // kCGEventFlagMaskCommand and kCGHIDEventTap. Key 9 is ANSI V.
        CGEventSetFlags(down, 1 << 20);
        CGEventSetFlags(up, 1 << 20);
        CGEventPost(0, down);
        CGEventPost(0, up);
        CFRelease(down);
        CFRelease(up);
    }
    // Allow the focused application to consume the staged clipboard before
    // restoration, as with the other asynchronous key-event adapters.
    std::thread::sleep(std::time::Duration::from_millis(200));
    Ok("macos:Command-V".into())
}
