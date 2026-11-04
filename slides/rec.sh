#!/bin/zsh
# Record from the default mic until Ctrl-C, then transcribe with whisper.
# Usage: ./rec.sh [name]   → takes/<name>.wav + takes/<name>.txt
name=${1:-take-$(date +%H%M%S)}
mkdir -p takes
trap true INT   # Ctrl-C stops ffmpeg, not this script
echo "Recording… Ctrl-C to stop."
ffmpeg -loglevel error -f avfoundation -i ":default" -ar 16000 -ac 1 "takes/$name.wav"
trap "" INT   # a second Ctrl-C must not kill whisper
whisper-cli -m ~/models/whisper/ggml-large-v3-turbo-q5_0.bin -mc 0 -l en -nt \
  --prompt "Coroutine, co_await, resumeOn, resume(), executor, queue, processBlock, audio thread, Main, when_all, setValue, callback, stdexec." \
  -otxt -of "takes/$name" "takes/$name.wav" 2>"takes/$name.log"
cat "takes/$name.txt"
