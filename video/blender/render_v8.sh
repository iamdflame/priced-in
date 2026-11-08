#!/bin/bash
# v8's one new plate: the decided dial (12% held, then 0%), wide. Safe to re-run: finished frames are skipped.
cd "$(dirname "$0")/.."
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$B" -b -P blender/dial_film.py -- decided wide public/blender/v6-wide/decided --frames 1-130 --samples 40 --theme light 2>&1 | grep -E "Traceback|Error:|blender done"
echo V8 PLATES DONE
