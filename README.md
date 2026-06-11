# Local Whisper.cpp Voice Transcription Setup — Fedora

## Goal

Set up a minimal local voice transcription workflow using `whisper.cpp`.

The final workflow achieved:

```text
Microphone input → local recording → whisper.cpp transcription → text output / clipboard / AI agent prompt
```
* Whisper implementation: `whisper.cpp`
* Model used: `ggml-base.en.bin`

## Dependencies

```bash
sudo dnf install -y git cmake gcc gcc-c++ make ffmpeg alsa-utils xclip
```

Clipboard support:

```bash
sudo dnf install -y wl-clipboard xclip
```

## Whisper.cpp Setup Commands

Created tools directory:

```bash
mkdir -p ~/tools
cd ~/tools
```

Cloned `whisper.cpp`:

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
```

Downloaded the base English model:

```bash
sh ./models/download-ggml-model.sh base.en
```

Built `whisper.cpp`:

```bash
cmake -B build
cmake --build build -j --config Release
```

## Verified Model and Binary

Checked that the model exists:

```bash
ls -lh ./models/ggml-base.en.bin
```

Output showed:

```text
 ./models/ggml-base.en.bin
```

Checked that the whisper.cpp CLI binary exists:

```bash
ls -lh ./build/bin/whisper-cli
```

Output showed:

```text
 ./build/bin/whisper-cli
```

## Tested Whisper.cpp

Ran the sample transcription:

```bash
./build/bin/whisper-cli -m ./models/ggml-base.en.bin -f ./samples/jfk.wav
```

Successful output:

```text
And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.
```

Timing result:

```text
total time = 2366.13 ms
```

The sample audio was 11 seconds long and transcribed locally in about 2.3 seconds.

Local whisper.cpp binary is:

```bash
~/tools/whisper.cpp/build/bin/whisper-cli
```

## Optional Whisper.cpp Shortcut

Created a shortcut named `whispercpp`:

```bash
ln -sf "$HOME/tools/whisper.cpp/build/bin/whisper-cli" "$HOME/.local/bin/whispercpp"
```

Usage:

```bash
whispercpp -m ~/tools/whisper.cpp/models/ggml-base.en.bin -f ~/tools/whisper.cpp/samples/jfk.wav
```

## Voice Prompt Script

Created a Proof of concept script named `vp`.

Script purpose:

```text
Record microphone audio
Save it as a WAV file
Run whisper.cpp locally
Generate transcript text
Print the transcript
Copy transcript to clipboard if clipboard tooling is available
```

## Made the Script Executable

From the script folder:

```bash
chmod +x vp
```

Run locally from that folder:

```bash
./vp
```

## Made `vp` Global

Copied the script into `~/.local/bin`:

```bash
mkdir -p ~/.local/bin
cp vp ~/.local/bin/vp
chmod +x ~/.local/bin/vp
```

Now it can be run from anywhere:

```bash
vp
```

## Final Working Command

```bash
vp
```

Final behavior:

```text
Press Enter to start recording
Speak the prompt
Press Enter to stop recording
Audio is transcribed locally using whisper.cpp
Transcript is printed
Transcript is copied to clipboard
```

## What Was Achieved

* `whisper.cpp` installed locally
* `ggml-base.en.bin` model downloaded
* `whisper-cli` built successfully
* `vp` voice prompt script created
* Local voice-to-text prompt workflow working successfully

