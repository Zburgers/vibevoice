use serde::{Deserialize, Serialize};
use std::process::Child;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TranscriptionMetrics {
    pub audio_ms: u64,
    pub transcription_ms: u64,
    pub session_ms: u64,
    pub threads: usize,
    pub cpu_time_ms: Option<u64>,
    pub average_cpu_percent: Option<f64>,
    pub peak_memory_mb: Option<f64>,
}

#[derive(Debug, Default)]
pub struct ProcessUsage {
    pub cpu_time_ms: Option<u64>,
    pub peak_memory_mb: Option<f64>,
}

pub fn thread_count(requested: usize, available: usize) -> usize {
    let available = available.max(1);
    if requested == 0 {
        available.min(4)
    } else {
        requested.clamp(1, available.min(16))
    }
}

pub fn cpu_percent(cpu_ms: Option<u64>, wall_ms: u64, logical_cpus: usize) -> Option<f64> {
    cpu_ms
        .filter(|_| wall_ms > 0 && logical_cpus > 0)
        .map(|cpu| (100.0 * cpu as f64 / wall_ms as f64 / logical_cpus as f64).clamp(0.0, 100.0))
}

#[cfg(windows)]
pub fn process_usage(child: &Child) -> ProcessUsage {
    use std::{ffi::c_void, os::windows::io::AsRawHandle};
    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    impl FileTime {
        fn ticks(&self) -> u64 {
            (self.high as u64) << 32 | self.low as u64
        }
    }
    #[repr(C)]
    #[derive(Default)]
    struct MemoryCounters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetProcessTimes(
            handle: *mut c_void,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn K32GetProcessMemoryInfo(
            handle: *mut c_void,
            counters: *mut MemoryCounters,
            size: u32,
        ) -> i32;
    }
    let (mut creation, mut exit, mut kernel, mut user) = (
        FileTime::default(),
        FileTime::default(),
        FileTime::default(),
        FileTime::default(),
    );
    let handle = child.as_raw_handle();
    let cpu_time_ms = if unsafe {
        GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user)
    } != 0
    {
        Some((kernel.ticks() + user.ticks()) / 10_000)
    } else {
        None
    };
    let size = std::mem::size_of::<MemoryCounters>() as u32;
    let mut memory = MemoryCounters {
        cb: size,
        ..MemoryCounters::default()
    };
    let peak_memory_mb = if unsafe { K32GetProcessMemoryInfo(handle, &mut memory, size) } != 0 {
        Some(memory.peak_working_set_size as f64 / 1_048_576.0)
    } else {
        None
    };
    ProcessUsage {
        cpu_time_ms,
        peak_memory_mb,
    }
}

#[cfg(not(windows))]
pub fn process_usage(_child: &Child) -> ProcessUsage {
    ProcessUsage::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thread_budget_handles_small_machines_and_explicit_limits() {
        assert_eq!(thread_count(0, 2), 2);
        assert_eq!(thread_count(0, 8), 4);
        assert_eq!(thread_count(2, 8), 2);
        assert_eq!(thread_count(99, 8), 8);
        assert_eq!(thread_count(99, 64), 16);
        assert_eq!(thread_count(0, 0), 1);
    }
    #[test]
    fn cpu_usage_matches_task_manager_denominator_and_preserves_unknowns() {
        assert_eq!(cpu_percent(Some(16_000), 4_000, 8), Some(50.0));
        assert_eq!(cpu_percent(None, 4_000, 8), None);
        assert_eq!(cpu_percent(Some(1), 0, 8), None);
    }
}
