#!/bin/bash
# v6's plates: the market (the dial wakes to 23%, the free $1 swings it to 12%) and the end card, wide and tall,
# with the scale's 0 and 100 moved clear of the bezel. Safe to re-run: finished frames are skipped.
cd "$(dirname "$0")/.."
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
while read -r aspect shot frames; do
  [ -z "$aspect" ] && continue
  "$B" -b -P blender/dial_film.py -- $shot $aspect public/blender/v6-$aspect/$shot --frames $frames --samples 40 --theme light 2>&1 | grep -E "Traceback|Error:|blender done" | sed "s/^/$aspect $shot: /"
done <<'LIST'
wide market 1-310
wide end 1-240
tall market 1-310
tall end 1-110
LIST
echo V6 PLATES DONE
