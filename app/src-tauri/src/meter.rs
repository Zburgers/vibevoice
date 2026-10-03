//! Display-only spectrum analysis. Runs outside the microphone callback and
//! never alters the samples written for transcription.
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

pub const BAND_COUNT: usize = 12;
const WINDOW: usize = 2048;
const HOP: usize = WINDOW / 2;
const EDGES: [f32; BAND_COUNT + 1] = [
    80.0, 120.0, 180.0, 270.0, 400.0, 600.0, 900.0, 1350.0, 2000.0, 3000.0, 4500.0, 6750.0, 10000.0,
];

pub type SharedSpectrum = Arc<[AtomicU32; BAND_COUNT]>;

pub fn empty_spectrum() -> SharedSpectrum {
    Arc::new(std::array::from_fn(|_| AtomicU32::new(0)))
}

pub fn read_spectrum(spectrum: &SharedSpectrum) -> [f32; BAND_COUNT] {
    std::array::from_fn(|index| spectrum[index].load(Ordering::Relaxed) as f32 / 1000.0)
}

pub struct SpectrumAnalyzer {
    sample_rate: f32,
    samples: [f32; WINDOW],
    cursor: usize,
    filled: usize,
    since_frame: usize,
    smoothed: [f32; BAND_COUNT],
    spectrum: SharedSpectrum,
}

impl SpectrumAnalyzer {
    pub fn new(sample_rate: u32, spectrum: SharedSpectrum) -> Self {
        Self {
            sample_rate: sample_rate.max(1) as f32,
            samples: [0.0; WINDOW],
            cursor: 0,
            filled: 0,
            since_frame: 0,
            smoothed: [0.0; BAND_COUNT],
            spectrum,
        }
    }

    pub fn push(&mut self, samples: &[i16]) {
        for &sample in samples {
            self.samples[self.cursor] = sample as f32 / 32768.0;
            self.cursor = (self.cursor + 1) % WINDOW;
            self.filled = (self.filled + 1).min(WINDOW);
            self.since_frame += 1;
            if self.filled == WINDOW && self.since_frame >= HOP {
                self.since_frame = 0;
                self.analyze();
            }
        }
    }

    fn analyze(&mut self) {
        let mut real = [0.0; WINDOW];
        let mut imag = [0.0; WINDOW];
        let mean = self.samples.iter().sum::<f32>() / WINDOW as f32;
        for (index, value) in real.iter_mut().enumerate() {
            let window = 0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / WINDOW as f32).cos();
            *value = (self.samples[(self.cursor + index) % WINDOW] - mean) * window;
        }
        fft(&mut real, &mut imag);
        let step = self.sample_rate / WINDOW as f32;
        let attack = 1.0 - (-(HOP as f32 / self.sample_rate) / 0.045).exp();
        let release = 1.0 - (-(HOP as f32 / self.sample_rate) / 0.18).exp();
        for index in 0..BAND_COUNT {
            let first = (EDGES[index] / step).ceil() as usize;
            let end = ((EDGES[index + 1] / step).ceil() as usize).min(WINDOW / 2 + 1);
            let power: f32 = (first..end)
                .map(|bin| real[bin].powi(2) + imag[bin].powi(2))
                .sum();
            // Fixed dB scale rather than per-frame normalization: silence
            // stays quiet, and a louder tone raises only its own band(s).
            let amplitude = power.sqrt() * 4.0 / WINDOW as f32;
            let db = 20.0 * amplitude.max(1e-9).log10();
            let target = ((db + 65.0) / 55.0).clamp(0.0, 1.0);
            let smoothing = if target > self.smoothed[index] {
                attack
            } else {
                release
            };
            self.smoothed[index] += (target - self.smoothed[index]) * smoothing;
            self.spectrum[index].store((self.smoothed[index] * 1000.0) as u32, Ordering::Relaxed);
        }
    }
}

fn fft(real: &mut [f32; WINDOW], imag: &mut [f32; WINDOW]) {
    let mut reversed = 0;
    for index in 1..WINDOW {
        let mut bit = WINDOW >> 1;
        while reversed & bit != 0 {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if index < reversed {
            real.swap(index, reversed);
            imag.swap(index, reversed);
        }
    }
    let mut length = 2;
    while length <= WINDOW {
        let angle = -std::f32::consts::TAU / length as f32;
        let (step_imag, step_real) = angle.sin_cos();
        for offset in (0..WINDOW).step_by(length) {
            let (mut twiddle_real, mut twiddle_imag) = (1.0, 0.0);
            for index in 0..length / 2 {
                let even = offset + index;
                let odd = even + length / 2;
                let r = twiddle_real * real[odd] - twiddle_imag * imag[odd];
                let i = twiddle_real * imag[odd] + twiddle_imag * real[odd];
                real[odd] = real[even] - r;
                imag[odd] = imag[even] - i;
                real[even] += r;
                imag[even] += i;
                let next = twiddle_real * step_real - twiddle_imag * step_imag;
                twiddle_imag = twiddle_real * step_imag + twiddle_imag * step_real;
                twiddle_real = next;
            }
        }
        length *= 2;
    }
}

/// Linux uses an external recorder. Read its growing WAV for visualization
/// only; do not open another microphone or change recorder arguments.
#[cfg(any(target_os = "linux", test))]
pub struct LiveWavSpectrum {
    path: std::path::PathBuf,
    file: Option<std::fs::File>,
    analyzer: Option<SpectrumAnalyzer>,
    spectrum: SharedSpectrum,
    pending_byte: Option<u8>,
}

#[cfg(any(target_os = "linux", test))]
impl LiveWavSpectrum {
    pub fn new(path: std::path::PathBuf, spectrum: SharedSpectrum) -> Self {
        Self {
            path,
            file: None,
            analyzer: None,
            spectrum,
            pending_byte: None,
        }
    }

    pub fn poll(&mut self) -> Option<f32> {
        use std::io::Read;
        if self.file.is_none() {
            let (file, rate) = open_live_wav(&self.path)?;
            self.file = Some(file);
            self.analyzer = Some(SpectrumAnalyzer::new(rate, Arc::clone(&self.spectrum)));
        }
        let mut peak = 0;
        let mut count = 0;
        let mut buffer = [0u8; 4096];
        // Bound each tick's file I/O, even if a recorder writes a large burst.
        for _ in 0..4 {
            let length = self.file.as_mut()?.read(&mut buffer).ok()?;
            if length == 0 {
                break;
            }
            let mut samples = Vec::with_capacity(length / 2 + 1);
            for &byte in &buffer[..length] {
                if let Some(first) = self.pending_byte.take() {
                    let sample = i16::from_le_bytes([first, byte]);
                    peak = peak.max(sample.unsigned_abs());
                    samples.push(sample);
                } else {
                    self.pending_byte = Some(byte);
                }
            }
            count += samples.len();
            self.analyzer.as_mut()?.push(&samples);
        }
        (count > 0).then_some(peak as f32 / 32768.0)
    }
}

#[cfg(any(target_os = "linux", test))]
fn open_live_wav(path: &std::path::Path) -> Option<(std::fs::File, u32)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header).ok()?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return None;
    }
    let mut rate = None;
    for _ in 0..64 {
        if file.stream_position().ok()? > 65536 {
            return None;
        }
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk).ok()?;
        let size = u32::from_le_bytes(chunk[4..].try_into().ok()?) as u64;
        if &chunk[..4] == b"data" {
            // The data length is commonly zero or a sentinel until recording
            // finishes. Read available bytes, not the unfinished length.
            return Some((file, rate?));
        }
        if size > 65536 {
            return None;
        }
        if &chunk[..4] == b"fmt " {
            if size < 16 {
                return None;
            }
            let mut fmt = vec![0u8; size as usize];
            file.read_exact(&mut fmt).ok()?;
            let format = u16::from_le_bytes([fmt[0], fmt[1]]);
            let pcm_guid = [1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
            let pcm =
                format == 1 || (format == 65534 && fmt.len() >= 40 && fmt[24..40] == pcm_guid);
            let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().ok()?);
            if !pcm || channels != 1 || bits != 16 || !(8000..=192000).contains(&sample_rate) {
                return None;
            }
            rate = Some(sample_rate);
            file.seek(SeekFrom::Current((size % 2) as i64)).ok()?;
        } else {
            file.seek(SeekFrom::Current((size + size % 2) as i64))
                .ok()?;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, frequency: f32, gain: f32) -> Vec<i16> {
        (0..rate)
            .map(|i| {
                ((std::f32::consts::TAU * frequency * i as f32 / rate as f32).sin()
                    * gain
                    * 32767.0) as i16
            })
            .collect()
    }

    fn analyze(rate: u32, samples: &[i16]) -> [f32; BAND_COUNT] {
        let shared = empty_spectrum();
        SpectrumAnalyzer::new(rate, Arc::clone(&shared)).push(samples);
        read_spectrum(&shared)
    }

    #[test]
    fn silence_and_dc_do_not_animate_the_equalizer() {
        assert_eq!(analyze(48000, &[0; 48000]), [0.0; BAND_COUNT]);
        assert_eq!(analyze(48000, &[10000; 48000]), [0.0; BAND_COUNT]);
    }

    #[test]
    fn equal_volume_low_and_high_tones_light_different_bands() {
        for rate in [16000, 44100, 48000] {
            for (frequency, expected) in [(220.0, 2), (1100.0, 6), (5200.0, 10)] {
                let bands = analyze(rate, &tone(rate, frequency, 0.2));
                let peak = bands
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                    .unwrap()
                    .0;
                assert_eq!(
                    peak, expected,
                    "rate={rate}, frequency={frequency}, bands={bands:?}"
                );
                assert!(bands[expected] > 0.7);
                assert!(bands[if expected < 6 { 10 } else { 0 }] < 0.1);
            }
        }
    }

    #[test]
    fn mixed_tones_remain_independent_and_quiet_audio_stays_quieter() {
        let low = tone(48000, 220.0, 0.1);
        let high = tone(48000, 5200.0, 0.1);
        let mixed: Vec<_> = low.iter().zip(&high).map(|(a, b)| a + b).collect();
        let bands = analyze(48000, &mixed);
        assert!(bands[2] > 0.7 && bands[10] > 0.7);
        assert!(bands[5] < 0.15);
        assert!(analyze(48000, &tone(48000, 220.0, 0.005))[2] < bands[2]);
    }

    #[test]
    fn silence_releases_the_bars_and_low_sample_rates_never_alias_high_bands() {
        let shared = empty_spectrum();
        let mut analyzer = SpectrumAnalyzer::new(8000, Arc::clone(&shared));
        analyzer.push(&tone(8000, 1100.0, 0.2));
        assert!(read_spectrum(&shared)[6] > 0.7);
        assert_eq!(read_spectrum(&shared)[10], 0.0);
        analyzer.push(&[0; 8000]);
        assert!(read_spectrum(&shared).iter().all(|value| *value < 0.02));
    }

    #[test]
    fn growing_wav_handles_unfinished_headers_and_split_samples_without_modifying_audio() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("vibevoice-spectrum-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("live.wav");
        let shared = empty_spectrum();
        let mut live = LiveWavSpectrum::new(path.clone(), Arc::clone(&shared));
        assert!(live.poll().is_none());
        let mut header = b"RIFF\0\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0".to_vec();
        header.extend(16000u32.to_le_bytes());
        header.extend(32000u32.to_le_bytes());
        header.extend([2, 0, 16, 0]);
        // Extra chunks occur in WAVs made by ffmpeg/libsndfile.
        header.extend(b"JUNK\x01\0\0\0x\0data\0\0\0\0");
        std::fs::write(&path, &header[..20]).unwrap();
        assert!(live.poll().is_none());
        std::fs::write(&path, &header).unwrap();
        assert!(live.poll().is_none());
        let bytes: Vec<_> = tone(16000, 1100.0, 0.2)
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        let mut writer = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writer.write_all(&bytes[..1]).unwrap();
        assert!(live.poll().is_none());
        writer.write_all(&bytes[1..]).unwrap();
        for _ in 0..4 {
            live.poll();
        }
        assert!(read_spectrum(&shared)[6] > 0.7);
        let mut expected = header;
        expected.extend(&bytes);
        assert_eq!(std::fs::read(&path).unwrap(), expected);
        drop(live);
        drop(writer);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
