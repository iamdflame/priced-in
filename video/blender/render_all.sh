#!/bin/bash
# Renders the hero shots frame by frame into public/blender/<aspect>/<shot>/. Safe to re-run: done frames are skipped.
cd "$(dirname "$0")/.."
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ASPECT=${1:-wide}; shift
SHOTS=${*:-wake swing steps end stamps}
for shot in $SHOTS; do
  "$B" -b -P blender/dial_film.py -- $shot $ASPECT public/blender/$ASPECT/$shot --samples 96 2>&1 | grep -E "FRAME .* (1|30|60|90|120|150|180|210|240) |Traceback|Error:|blender done"
done
echo "ALL DONE $ASPECT"
