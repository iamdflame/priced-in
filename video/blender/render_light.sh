#!/bin/bash
# The bright film's plates, in the order the edit needs them. Safe to re-run: finished frames are skipped.
cd "$(dirname "$0")/.."
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
while read -r aspect shot frames; do
  [ -z "$aspect" ] && continue
  "$B" -b -P blender/dial_film.py -- $shot $aspect public/blender/light-$aspect/$shot --frames $frames --samples 48 --theme light 2>&1 | grep -E "Traceback|Error:|blender done" | sed "s/^/$aspect $shot: /"
done <<'LIST'
wide stamps 1-168
wide wake 1-92
wide swing 1-72
wide steps 15-156
wide end 1-240
tall stamps 1-168
tall swing 1-96
tall steps 5-150
tall end 1-110
LIST
echo LIGHT QUEUE DONE
