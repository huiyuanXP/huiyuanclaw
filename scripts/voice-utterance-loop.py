#!/usr/bin/env python3

import argparse
import os
import signal
import sys
import time
import uuid

from voice_audio_common import (
    DEFAULT_MODEL,
    capture_until_silence,
    default_input_backend,
    emit_json,
    play_ack_sound,
    transcribe_audio,
    trim,
)


def now_iso():
    import datetime as _datetime
    return _datetime.datetime.now(_datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args():
    parser = argparse.ArgumentParser(description="Always-on passive utterance loop using VAD + MLX Whisper")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--language", default="")
    parser.add_argument("--initial-prompt", default="")
    parser.add_argument("--timeout-ms", type=int, default=15000)
    parser.add_argument("--speech-start-timeout-ms", type=int, default=5000)
    parser.add_argument("--silence-ms", type=int, default=900)
    parser.add_argument("--frame-ms", type=int, default=100)
    parser.add_argument("--pre-roll-ms", type=int, default=250)
    parser.add_argument("--speech-threshold", type=float, default=0.0015)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--min-duration-ms", type=int, default=450)
    parser.add_argument("--cooldown-ms", type=int, default=1200)
    parser.add_argument("--input-backend", default="")
    parser.add_argument("--input-source", default="")
    parser.add_argument("--ack-sound-path", default="")
    parser.add_argument("--connector-id", default=os.environ.get("REMOTELAB_VOICE_CONNECTOR_ID", ""))
    parser.add_argument("--room-name", default=os.environ.get("REMOTELAB_VOICE_ROOM_NAME", ""))
    parser.add_argument("--test-file", default="")
    return parser.parse_args()


def build_event(args, transcript, *, source, raw_transcript, duration_ms, peak):
    return {
        "eventId": f"voice-{uuid.uuid4().hex}",
        "transcript": transcript,
        "detectedAt": now_iso(),
        "connectorId": trim(args.connector_id),
        "roomName": trim(args.room_name),
        "source": source,
        "metadata": {
            "rawTranscript": raw_transcript,
            "locale": trim(args.language),
            "durationMs": duration_ms,
            "peak": peak,
            "recognitionMode": "utterance_loop",
        },
    }


def main():
    args = parse_args()
    running = True
    last_emit_at = 0.0
    active_backend = trim(args.input_backend) or default_input_backend()

    print(
        f"[voice-utterance-loop] listening for any speech via {active_backend} + mlx_whisper"
        f" (silence={args.silence_ms}ms, min={args.min_duration_ms}ms)",
        file=sys.stderr,
    )

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    if trim(args.test_file):
        result = transcribe_audio(
            args.test_file,
            model=args.model,
            language=args.language,
            initial_prompt=args.initial_prompt,
        )
        transcript = trim(result["text"])
        if transcript:
            emit_json(build_event(args, transcript, source="utterance_test_file", raw_transcript=transcript, duration_ms=0, peak=0.0))
        return

    while running:
        audio_path = ""
        try:
            captured = capture_until_silence(
                timeout_ms=args.timeout_ms,
                speech_start_timeout_ms=args.speech_start_timeout_ms,
                silence_ms=args.silence_ms,
                frame_ms=args.frame_ms,
                pre_roll_ms=args.pre_roll_ms,
                speech_threshold=args.speech_threshold,
                sample_rate=args.sample_rate,
                backend=active_backend,
                source=args.input_source,
            )
            audio_path = trim(captured.get("audioPath"))
            if not captured.get("speechDetected") or not audio_path:
                continue
            duration_ms = int(captured.get("durationMs") or 0)
            if duration_ms < args.min_duration_ms:
                continue
            now = time.time()
            if now - last_emit_at < args.cooldown_ms / 1000.0:
                continue

            result = transcribe_audio(
                audio_path,
                model=args.model,
                language=args.language,
                initial_prompt=args.initial_prompt,
            )
            transcript = trim(result["text"])
            if not transcript:
                continue
            last_emit_at = now
            print(f"[voice-utterance-loop] detected utterance: {transcript}", file=sys.stderr)
            play_ack_sound(args.ack_sound_path)
            emit_json(
                build_event(
                    args,
                    transcript,
                    source="voice_activity",
                    raw_transcript=transcript,
                    duration_ms=duration_ms,
                    peak=float(captured.get("peak") or 0.0),
                )
            )
        except KeyboardInterrupt:
            running = False
        except Exception as error:
            print(f"[voice-utterance-loop] {error}", file=sys.stderr)
            time.sleep(0.3)
        finally:
            if audio_path:
                try:
                    os.remove(audio_path)
                except OSError:
                    pass


if __name__ == "__main__":
    main()
