"""L12 with the live count: "Seven have already been ruled on NEAR."

The ElevenLabs account refused new speech on 2026-11-07 (a billing issue on the subscription), so the new word
comes from Peter's own take: "Seven", sentence-initial in V3b ("Seven bets took it ..."), replaces "Six",
sentence-initial in the original L12. Cut points sit at energy minima near the aligner's word edges, joined with
short equal-power crossfades and level-matched. Re-generate L12 properly once the account works again.

    python scripts/splice_seven.py
"""
import json
import os
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
V = os.path.join(HERE, '..', 'public', 'voice')
FF = os.environ.get('FFMPEG') or r'C:/Users/Dflame/AppData/Local/Temp/claude/057e9ba3f46752a6/59eb9a27-2bf0-48a2-972f-672a32f97eef/scratchpad/ffenv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe'
SR = 44100


def load(p):
    raw = subprocess.run([FF, '-v', 'error', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def env(x, win=0.005):
    n = int(win * SR)
    e = np.sqrt(np.convolve(x ** 2, np.ones(n) / n, mode='same'))
    return e


def quietest(x, a, b):
    e = env(x)
    i, j = int(a * SR), int(b * SR)
    return i + int(np.argmin(e[i:j]))


def onset(x, a, b, frac=0.06):
    e = env(x)
    i, j = int(a * SR), int(b * SR)
    peak = e[i:j].max()
    k = np.argmax(e[i:j] > peak * frac)
    return max(i, i + int(k) - int(0.012 * SR))


old = load(os.path.join(V, '_old', 'L12-six.mp3'))
src = load(os.path.join(V, 'V3b.mp3'))
wo = json.load(open(os.path.join(V, '_old', 'L12-six.json'), encoding='utf8'))['words']
ws = json.load(open(os.path.join(V, 'V3b.json'), encoding='utf8'))['words']
six = next(w for w in wo if w['w'] == 'Six')
have = next(w for w in wo if w['w'] == 'have')
fact = next(w for w in wo if w['w'] == 'fact.')
sev, bets = ws[0], ws[1]

a = quietest(old, fact['e'], six['s'] + 0.02)           # in the pause after "fact."
b = quietest(old, six['e'] - 0.06, have['s'] + 0.02)    # between "Six" and "have"
s0 = onset(src, 0.0, sev['e'])                          # where "Seven" starts
s1 = quietest(src, sev['e'] - 0.06, bets['s'] + 0.04)   # between "Seven" and "bets"
seven = src[s0:s1].copy()
six_seg = old[a:b]


def rms(x):
    return float(np.sqrt((x[np.abs(x) > 0.01] ** 2).mean()))


seven *= rms(six_seg) / max(rms(seven), 1e-6)
fade = int(0.012 * SR)
ramp = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
seven[:fade] *= ramp
seven[-fade:] *= ramp[::-1]
head = old[:a].copy()
tail = old[b:].copy()
tail[:fade] *= ramp
out = np.concatenate([head, np.zeros(int(0.02 * SR)), seven, tail])
delta = (len(out) - len(old)) / SR

pcm = (np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes()
subprocess.run([FF, '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '192k',
                os.path.join(V, 'L12.mp3')], input=pcm, check=True)
words = []
for w in wo:
    if w['w'] == 'Six':
        st = (a + int(0.02 * SR)) / SR
        words.append({'w': 'Seven', 's': round(st, 3), 'e': round(st + len(seven) / SR, 3)})
    elif w['s'] >= have['s'] - 0.001:
        words.append({'w': w['w'], 's': round(w['s'] + delta, 3), 'e': round(w['e'] + delta, 3)})
    else:
        words.append(w)
json.dump({'id': 'L12', 'text': 'A prediction market for every checkable fact. Seven have already been ruled on NEAR.',
           'speed': 1.12, 'words': words, 'note': 'spliced: "Seven" from V3b, see scripts/splice_seven.py'},
          open(os.path.join(V, 'L12.json'), 'w', encoding='utf8'))
print(f'cut {a / SR:.3f}-{b / SR:.3f} s (Six), inserted {len(seven) / SR:.3f} s of "Seven" from V3b {s0 / SR:.3f}-{s1 / SR:.3f}; length {len(old) / SR:.2f} -> {len(out) / SR:.2f} s')
