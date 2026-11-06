#!/bin/bash
# Renders the three cuts at high quality, then the poster and the 2 fps contact sheets.
#   FFMPEG=<full ffmpeg build> bash scripts/render_film.sh [main] [c15] [v30]
cd "$(dirname "$0")/.."
R=../.apex/design/video/renders
FF=${FFMPEG:?set FFMPEG to a full ffmpeg build}
mkdir -p $R out/master
# 1) a ProRes master from Remotion, picture only; 2) the delivery H.264: high bitrate, bt709 limited range, aq-mode 3
# so the dark gradients hold, with the mixed audio straight from the WAV.
deliver() { # comp cut outname
  npx remotion render src/index.ts $1 out/master/$2.mov --codec prores --prores-profile hq --muted --concurrency 5 --image-format jpeg --jpeg-quality 97 --color-space bt709 2>&1 | grep -E "\+ |rror"
  "$FF" -v error -y -i out/master/$2.mov -i public/audio/mix-$2.wav -map 0:v -map 1:a -c:v libx264 -preset slow -crf 13 -maxrate 30M -bufsize 60M -x264-params aq-mode=3:aq-strength=1.1 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart $R/$3.mp4
  ls -la $R/$3.mp4
}
for c in ${*:-main c15 v30}; do
  case $c in
    main) deliver FilmMain main pricedin-film-16x9 ;;
    c15) deliver Film15s c15 pricedin-15s-16x9 ;;
    v30) deliver FilmVertical v30 pricedin-30s-9x16 ;;
  esac
done
