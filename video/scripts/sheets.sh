#!/bin/bash
# Poster frame and 2 fps contact sheets for each rendered cut (needs a full ffmpeg: FFMPEG=...).
cd "$(dirname "$0")/.."
R=../.apex/design/video/renders
FF=${FFMPEG:?set FFMPEG to a full ffmpeg build}
sheet() { # in out cols width
  "$FF" -v error -y -i "$1" -vf "fps=2,scale=$4:-1,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.55,tile=$3x$5:padding=4:color=0x1a1a1a" -frames:v 1 "$2"
}
sheet $R/pricedin-film-16x9.mp4 $R/contact-film-16x9.png 12 300 8
sheet $R/pricedin-15s-16x9.mp4 $R/contact-15s-16x9.png 10 300 3
sheet $R/pricedin-30s-9x16.mp4 $R/contact-30s-9x16.png 16 180 4
"$FF" -v error -y -ss 3.6 -i $R/pricedin-film-16x9.mp4 -frames:v 1 $R/poster.png
ls -la $R/*.png
