import unittest

from asr_benchmark import parse_cli_timings, percentile, summarize, word_errors
from summarize_hybrid import combine
from whisper_server_benchmark import transcript_from_response


class BenchmarkMetricsTests(unittest.TestCase):
    def test_resident_server_response_extracts_transcript_text(self):
        self.assertEqual(transcript_from_response('{"text":"hello world"}'), "hello world")
        for invalid in ('not json', '{}', '{"text": 2}'):
            with self.subTest(invalid=invalid), self.assertRaises(RuntimeError):
                transcript_from_response(invalid)

    def test_wer_normalizes_case_punctuation_and_apostrophes(self):
        self.assertEqual(word_errors("UseEffect, don't stop.", "useeffect dont stop"), (1, 3))

    def test_wer_counts_insertions_deletions_and_substitutions(self):
        self.assertEqual(word_errors("a b c", "a d"), (2, 3))

    def test_percentile_uses_nearest_rank(self):
        self.assertEqual(percentile([5, 1, 4, 2, 3], 0.5), 3)
        self.assertEqual(percentile([5, 1, 4, 2, 3], 0.95), 5)
        self.assertIsNone(percentile([], 0.95))

    def test_cli_stage_timing_parser_extracts_supported_whisper_timings(self):
        log = """whisper_print_timings:     load time =   240.82 ms
whisper_print_timings:      mel time =   183.70 ms
whisper_print_timings:   encode time =  8582.63 ms / 1430.44 ms per layer
whisper_print_timings:    decode time =   436.16 ms /   72.69 ms per layer
"""
        self.assertEqual(parse_cli_timings(log), {
            "load_time": 240.82, "mel_time": 183.70,
            "encode_time": 8582.63, "decode_time": 436.16,
        })

    def test_summary_preserves_unknown_resources_and_aggregates_wer(self):
        result = summarize([
            {"wall_ms": 100.0, "rtf": 0.1, "cpu_ms": None, "average_cpu_percent": None, "peak_memory_mb": None,
             "word_errors": 1, "reference_words": 4, "silence_false_positive_words": 0},
            {"wall_ms": 200.0, "rtf": 0.2, "cpu_ms": 150.0, "average_cpu_percent": 20.0, "peak_memory_mb": 300.0,
             "word_errors": 0, "reference_words": 6, "silence_false_positive_words": 0},
        ])
        self.assertEqual(result["sample_count"], 2)
        self.assertEqual(result["wall_ms_p50"], 150.0)
        self.assertEqual(result["wall_ms_p95"], 200.0)
        self.assertEqual(result["wer"], 0.1)
        self.assertEqual(result["cpu_ms_p50"], 150.0)
        self.assertEqual(result["peak_memory_mb_p50"], 300.0)

    def test_silence_false_positives_are_not_included_in_undefined_wer(self):
        result = summarize([
            {"wall_ms": 100.0, "rtf": 0.1, "cpu_ms": None, "average_cpu_percent": None, "peak_memory_mb": None,
             "word_errors": 0, "reference_words": 10, "silence_false_positive_words": 0},
            {"wall_ms": 200.0, "rtf": 0.2, "cpu_ms": None, "average_cpu_percent": None, "peak_memory_mb": None,
             "word_errors": 3, "reference_words": 0, "silence_false_positive_words": 3},
        ])
        self.assertEqual(result["wer"], 0)
        self.assertEqual(result["silence_false_positive_words"], 3)

    def test_hybrid_combines_aligned_runs_using_duration_cutoff(self):
        def result(model: str, wall: float) -> dict:
            return {"manifest_sha256": "same", "hardware": {}, "engine": {"sha256": "engine"},
                    "model": {"sha256": model}, "runs": [
                        {"sample_id": "short", "repeat": 1, "audio_ms": 2000, "duration_bucket_s": 2,
                         "category": "speech",
                         "wall_ms": wall, "rtf": wall / 2000, "cpu_ms": wall, "average_cpu_percent": 10,
                         "peak_memory_mb": 100, "word_errors": 0, "reference_words": 10,
                         "silence_false_positive_words": 0},
                        {"sample_id": "long", "repeat": 1, "audio_ms": 10000, "duration_bucket_s": 10,
                         "category": "speech",
                         "wall_ms": wall, "rtf": wall / 10000, "cpu_ms": wall, "average_cpu_percent": 10,
                         "peak_memory_mb": 100, "word_errors": 1, "reference_words": 10,
                         "silence_false_positive_words": 0},
                    ]}

        combined = combine(result("base", 1000), result("fast", 500))
        self.assertEqual([run["model_variant"] for run in combined["runs"]], ["tiny.en", "base.en"])
        self.assertEqual(combined["summary"]["all"]["wall_ms_p50"], 750)

    def test_hybrid_rejects_different_manifests(self):
        with self.assertRaises(ValueError):
            combine({"manifest_sha256": "a"}, {"manifest_sha256": "b"})


if __name__ == "__main__":
    unittest.main()
