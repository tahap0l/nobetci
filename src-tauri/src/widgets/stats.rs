//! The island's system card: processor, memory and graphics load.
//!
//! Read only while the card is on screen (the front end asks every two seconds
//! while it shows the card, never while the island is hidden). CPU and memory
//! come from `sysinfo`; the GPU from what each OS offers without a driver SDK:
//! the "GPU Engine" performance counters on Windows, the IOAccelerator
//! statistics on macOS, and the amdgpu sysfs file or `nvidia-smi` on Linux.

use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Whole-machine processor load, 0–100.
    cpu: f32,
    cores: usize,
    cpu_name: String,
    mem_used: u64,
    mem_total: u64,
    /// Graphics load, 0–100, when the OS says.
    gpu: Option<f32>,
}

fn system() -> &'static Mutex<Option<System>> {
    static SYS: OnceLock<Mutex<Option<System>>> = OnceLock::new();
    SYS.get_or_init(|| {
        let wanted = RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_usage())
            .with_memory(MemoryRefreshKind::nothing().with_ram());
        Mutex::new(System::new_with_specifics(wanted).ok())
    })
}

pub fn read() -> Stats {
    let (cpu, cores, cpu_name, mem_used, mem_total) = {
        let Ok(mut guard) = system().lock() else { return Stats::default() };
        let Some(sys) = guard.as_mut() else { return Stats::default() };
        // CPU load is the difference since the last refresh, so the first
        // reading after start is 0 and the next one is right.
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let name = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
        (sys.global_cpu_usage(), sys.cpus().len(), name, sys.used_memory(), sys.total_memory())
    };
    Stats { cpu: cpu.clamp(0.0, 100.0), cores, cpu_name, mem_used, mem_total, gpu: gpu().map(|g| g.clamp(0.0, 100.0)) }
}

#[tauri::command]
pub async fn island_stats() -> Stats {
    tauri::async_runtime::spawn_blocking(read).await.unwrap_or_default()
}

// ── GPU ──────────────────────────────────────────────────────────────────────

#[cfg(windows)]
fn gpu() -> Option<f32> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
        PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
    };

    /// The query lives as long as the app: a rate needs two samples.
    struct Pdh {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }
    // SAFETY: PDH handles may be used from any thread; the mutex serialises use.
    unsafe impl Send for Pdh {}

    static PDH: OnceLock<Option<Mutex<Pdh>>> = OnceLock::new();
    let pdh = PDH.get_or_init(|| unsafe {
        let mut query = PDH_HQUERY::default();
        if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
            return None;
        }
        let mut counter = PDH_HCOUNTER::default();
        if PdhAddEnglishCounterW(query, w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"), 0, &mut counter) != 0 {
            return None;
        }
        let _ = PdhCollectQueryData(query);
        Some(Mutex::new(Pdh { query, counter }))
    });
    let pdh = pdh.as_ref()?.lock().ok()?;
    unsafe {
        if PdhCollectQueryData(pdh.query) != 0 {
            return None;
        }
        let mut size = 0u32;
        let mut count = 0u32;
        if PdhGetFormattedCounterArrayW(pdh.counter, PDH_FMT_DOUBLE, &mut size, &mut count, None) != PDH_MORE_DATA
            || size == 0
        {
            return None;
        }
        // The buffer holds the items followed by their instance names; u64
        // keeps it aligned for the doubles inside.
        let mut buf = vec![0u64; (size as usize).div_ceil(8)];
        let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        if PdhGetFormattedCounterArrayW(pdh.counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) != 0 {
            return None;
        }
        // One instance per process and engine: their sum is the 3D engine's load.
        let total: f64 = (0..count as usize)
            .map(|i| (*items.add(i)).FmtValue.Anonymous.doubleValue)
            .filter(|v| v.is_finite() && *v > 0.0)
            .sum();
        Some(total.min(100.0) as f32)
    }
}

/// How long a helper program may take to report the graphics load. nvidia-smi
/// needs a second or two when the driver is not kept loaded; one that hangs
/// is stopped, so the card's two-second poll cannot pile them up.
#[cfg(unix)]
const GPU_PROGRAM_LIMIT: std::time::Duration = std::time::Duration::from_secs(3);

#[cfg(target_os = "macos")]
fn gpu() -> Option<f32> {
    // "Device Utilization %" from the graphics driver's statistics.
    let mut ioreg = crate::sys::command("/usr/sbin/ioreg");
    ioreg.args(["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]);
    let out = super::output_within(ioreg, GPU_PROGRAM_LIMIT)?;
    parse_ioreg(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(any(target_os = "macos", test))]
fn parse_ioreg(text: &str) -> Option<f32> {
    let key = "\"Device Utilization %\"=";
    text.match_indices(key)
        .filter_map(|(at, _)| {
            let rest = &text[at + key.len()..];
            let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            rest[..end].parse::<f32>().ok()
        })
        .reduce(f32::max)
}

#[cfg(target_os = "linux")]
fn gpu() -> Option<f32> {
    // amdgpu (and some Intel drivers) publish the load as a plain number.
    if let Ok(dir) = std::fs::read_dir("/sys/class/drm") {
        let mut best: Option<f32> = None;
        for entry in dir.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            if let Ok(v) = std::fs::read_to_string(entry.path().join("device/gpu_busy_percent")) {
                if let Ok(v) = v.trim().parse::<f32>() {
                    best = Some(best.map_or(v, |b| b.max(v)));
                }
            }
        }
        if best.is_some() {
            return best;
        }
    }
    nvidia_smi()
}

#[cfg(target_os = "linux")]
fn nvidia_smi() -> Option<f32> {
    // Looked for once: most machines have no NVIDIA card.
    static PRESENT: OnceLock<bool> = OnceLock::new();
    let present = *PRESENT.get_or_init(|| {
        std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).any(|d| d.join("nvidia-smi").is_file()))
            .unwrap_or(false)
    });
    if !present {
        return None;
    }
    let mut smi = crate::sys::command("nvidia-smi");
    smi.args(["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"]);
    let out = super::output_within(smi, GPU_PROGRAM_LIMIT)?;
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.trim().parse::<f32>().ok()).reduce(f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_machine() {
        let _ = read();
        std::thread::sleep(std::time::Duration::from_millis(250));
        let s = read();
        assert!(s.mem_total > 0 && s.mem_used <= s.mem_total);
        assert!(s.cores > 0);
        assert!((0.0..=100.0).contains(&s.cpu));
    }

    #[test]
    fn ioreg_utilization_is_found() {
        let text = r#"| "PerformanceStatistics" = {"In use system memory"=123,"Device Utilization %"=37,"Renderer Utilization %"=30}
| "PerformanceStatistics" = {"Device Utilization %"=4}"#;
        assert_eq!(parse_ioreg(text), Some(37.0));
        assert_eq!(parse_ioreg("nothing here"), None);
    }
}
