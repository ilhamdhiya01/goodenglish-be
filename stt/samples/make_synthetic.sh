#!/usr/bin/env bash
# Builds samples/synthetic/: machine voices (macOS `say`) + silence + noise,
# in the formats browsers record (webm/opus = Chrome, m4a/aac = Safari).
# NOT Indonesian accents: for real accuracy use samples/real/ (SCRIPT.md).
set -euo pipefail
cd "$(dirname "$0")/synthetic"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

clip() { # name voice format text
  local name=$1 voice=$2 fmt=$3 text=$4
  say -v "$voice" -r 165 -o "$tmp/$name.aiff" "$text"
  case $fmt in
    webm) ffmpeg -loglevel error -y -i "$tmp/$name.aiff" -c:a libopus -b:a 32k "$name.webm" ;;
    m4a)  ffmpeg -loglevel error -y -i "$tmp/$name.aiff" -c:a aac -b:a 64k "$name.m4a" ;;
    ogg)  ffmpeg -loglevel error -y -i "$tmp/$name.aiff" -c:a libopus -b:a 32k "$name.ogg" ;;
    wav)  ffmpeg -loglevel error -y -i "$tmp/$name.aiff" -ar 16000 -ac 1 "$name.wav" ;;
  esac
}

clip en_short_1        Samantha webm "Yes, please."
clip en_short_2        Daniel   m4a  "Two coffee."
clip en_grammar_1      Samantha webm "I go to event yesterday."
clip en_grammar_2      Daniel   m4a  "Yesterday I am meet my friend."
clip en_grammar_3      Samantha ogg  "She is work in Jakarta since two years."
clip en_grammar_4      Daniel   webm "He don't like coffee."
clip en_grammar_5      Samantha m4a  "I want buy two latte. How much it is?"
clip en_long_1         Samantha webm "Hi, my name is Rani. I am from Jakarta and I work as a developer in a small startup. I have been living here for three years and I really like the food."
clip en_long_grammar   Daniel   m4a  "Last week I go to Bali with my family. We stay in hotel near the beach, and the weather is very hot, but we very happy."
clip id_short          Damayanti webm "Iya, boleh."
clip id_long           Damayanti m4a  "Aku kerja di Jakarta sudah dua tahun, biasanya aku naik kereta ke kantor."
clip id_order          Damayanti wav  "Saya mau pesan dua kopi susu ya."

# Silence and noise must come back empty.
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=48000:cl=mono -t 5 -c:a libopus silence_5s.webm
ffmpeg -loglevel error -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.05:r=48000" -t 5 -c:a aac noise_5s.m4a
# Speech over background noise (cafe-like hum).
say -v Samantha -r 165 -o "$tmp/noisy.aiff" "I go to event yesterday with my friend."
ffmpeg -loglevel error -y -i "$tmp/noisy.aiff" \
  -f lavfi -i "anoisesrc=color=brown:amplitude=0.08:r=22050" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.6" \
  -c:a libopus -b:a 32k en_noisy.webm
echo "done: $(ls | wc -l | tr -d ' ') files"
