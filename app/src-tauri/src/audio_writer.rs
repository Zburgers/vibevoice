//! Bounded callback-to-disk handoff. Callbacks never wait for storage.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender},
    Arc,
};

pub enum Message {
    Samples(Vec<i16>),
    Stop,
}

#[derive(Clone)]
pub struct AudioQueue {
    sender: SyncSender<Message>,
    failed: Arc<AtomicBool>,
}

impl AudioQueue {
    pub fn new(capacity: usize) -> (Self, Receiver<Message>) {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        (
            Self {
                sender,
                failed: Arc::new(AtomicBool::new(false)),
            },
            receiver,
        )
    }

    pub fn failed_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.failed)
    }

    pub fn has_failed(&self) -> bool {
        self.failed.load(Ordering::Acquire)
    }

    pub fn push(&self, samples: Vec<i16>) {
        if self.sender.try_send(Message::Samples(samples)).is_err() {
            // Do not silently transcribe a truncated recording. The writer
            // reports the fault after finalization, and the next recording
            // gets a fresh queue. Subsequent callbacks discard input cheaply.
            self.failed.store(true, Ordering::Release);
        }
    }

    // Called only after callback completion, outside the audio callback.
    pub fn stop(&self) {
        let _ = self.sender.send(Message::Stop);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stalled_writer_is_bounded_and_reports_missing_audio() {
        let (queue, receiver) = AudioQueue::new(1);
        queue.push(vec![1]);
        assert!(!queue.has_failed());
        queue.push(vec![2]);
        assert!(queue.has_failed());
        assert!(
            matches!(receiver.try_recv().unwrap(), Message::Samples(samples) if samples == [1])
        );
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn disconnected_writer_is_not_silent_success_and_next_queue_starts_clean() {
        let (queue, receiver) = AudioQueue::new(1);
        drop(receiver);
        queue.push(vec![1]);
        assert!(queue.has_failed());
        let (next, _) = AudioQueue::new(1);
        assert!(!next.has_failed());
    }
}
