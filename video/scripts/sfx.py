"""The film's sound effects, synthesised here (sine, noise, envelopes, a generated reverb) so every sound is
ours: no third-party licence. Writes 48 kHz stereo 16-bit WAVs into public/audio/sfx/.
    python scripts/sfx.py
"""
import os
import wave

import numpy as np

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio', 'sfx')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(d * SR)) / SR


def save(name, x):
    x = np.atleast_2d(x)
    if x.shape[0] != 2:
        x = np.vstack([x, x]) if x.shape[0] == 1 else x.T
    peak = np.abs(x).max()
    if peak > 0.98:
        x = x * 0.98 / peak
    pcm = (x.T * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def lp(x, fc):
    # one-pole low-pass, run twice
    a = np.exp(-2 * np.pi * fc / SR)
    for _ in range(2):
        y = np.zeros_like(x)
        z = 0.0
        for i, v in enumerate(x):
            z = (1 - a) * v + a * z
            y[i] = z
        x = y
    return x


def hp(x, fc):
    return x - lp(x, fc)


def reverb(x, dur=1.2, mix=0.25, bright=4000):
    # stereo convolution with decaying filtered noise, done with an FFT
    n = int(dur * SR)
    e = np.exp(-6.0 * np.arange(n) / n)
    out = []
    for ch in range(2):
        ir = lp(rng.standard_normal(n), bright) * e
        ir /= np.sqrt((ir ** 2).sum())
        L = len(x) + n
        wet = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L)
        dry = np.concatenate([x, np.zeros(n)])
        out.append(dry * (1 - mix) + wet * mix)
    return np.array(out)


# 1. odds tick: dry, short; the pitch is passed in so the ear hears the odds fall
def tick(freq=2600, level=0.7):
    T = t(0.05)
    x = np.sin(2 * np.pi * freq * T) * np.exp(-T * 170)
    x += 0.5 * np.sin(2 * np.pi * freq * 2.01 * T) * np.exp(-T * 260)
    x += 0.25 * rng.standard_normal(len(T)) * np.exp(-T * 600)
    return reverb(x * level, 0.25, 0.12)


for i, semis in enumerate([0, -2, -3, -5, -7, -9, -10, -12]):
    save(f'tick{i}', tick(2900 * 2 ** (semis / 12)))
save('tick_soft', tick(2200, 0.4))


# 2. the tap: a felt press
T = t(0.09)
press = np.sin(2 * np.pi * 170 * T) * np.exp(-T * 60) + 0.5 * lp(rng.standard_normal(len(T)), 1800) * np.exp(-T * 120)
save('tap', reverb(press, 0.3, 0.15))


# 3. whoosh: band-limited noise, a sweep up and down, panned across
def whoosh(d=0.8, f0=250, f1=2400, level=0.7):
    T = t(d)
    n = rng.standard_normal(len(T))
    k = T / d
    env = np.sin(np.pi * k ** 0.7) ** 2
    fc = f0 + (f1 - f0) * np.sin(np.pi * k) ** 2
    y = np.zeros_like(n)
    z1 = z2 = 0.0
    for i, v in enumerate(n):
        a = 1 - np.exp(-2 * np.pi * fc[i] / SR)
        z1 += a * (v - z1)
        z2 += a * (z1 - z2)
        y[i] = z1 - z2 * 0.55
    y = y * env * level
    pan = 0.5 + 0.45 * np.cos(np.pi * k)
    return reverb(y, 0.5, 0.2) * np.array([[1.0], [1.0]]) * np.vstack([
        np.concatenate([np.sqrt(pan), np.full(int(0.5 * SR), np.sqrt(pan[-1]))]),
        np.concatenate([np.sqrt(1 - pan), np.full(int(0.5 * SR), np.sqrt(1 - pan[-1]))]),
    ])


save('whoosh', whoosh())
save('whoosh_short', whoosh(0.45, 400, 3200, 0.6))
save('whoosh_long', whoosh(1.4, 180, 1700, 0.75))


# 4. the needle's bloom under a swing
T = t(1.0)
bloom = np.sin(2 * np.pi * (84 * T - 12 * T ** 2)) * np.exp(-T * 3.2) * np.minimum(1, T / 0.02)
save('bloom', reverb(bloom * 0.9, 1.0, 0.18, 1500))


# 5. the stamp: a body thump, a dry slap, a room. The third is bigger.
def stamp(size=1.0):
    d = 0.7 + 0.5 * size
    T = t(d)
    f = 46 + (150 - 46) * np.exp(-T * 42)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-T * (9 / size))
    punch = np.sin(2 * np.pi * 95 * T) * np.exp(-T * 28)
    slap = lp(rng.standard_normal(len(T)), 5200) * np.exp(-T * 150) * 0.95
    wood = np.sin(2 * np.pi * 410 * T) * np.exp(-T * 95) * 0.28
    x = 1.0 * body + 0.5 * punch + slap + wood
    x = np.tanh(x * 1.3)
    return reverb(x, 1.3 * size, 0.2, 2600)


save('stamp1', stamp(1.0) * 0.82)
save('stamp2', stamp(1.05) * 0.86)
save('stamp3', stamp(1.6))


# 6. the signature check: a small glass ping
T = t(0.5)
ping = (np.sin(2 * np.pi * 2637 * T) + 0.5 * np.sin(2 * np.pi * 3951 * T) + 0.25 * np.sin(2 * np.pi * 6275 * T)) * np.exp(-T * 15) * 0.4
save('ping', reverb(ping, 0.6, 0.3, 7000))


# 7. the receipt: two tones, a fifth up
def tones(freqs, gap, d=0.42, level=0.45):
    T = t(d + gap * len(freqs))
    x = np.zeros_like(T)
    for i, f in enumerate(freqs):
        s = int(i * gap * SR)
        u = T[:len(T) - s]
        x[s:] += (np.sin(2 * np.pi * f * u) + 0.3 * np.sin(2 * np.pi * f * 2 * u)) * np.exp(-u * 8) * np.minimum(1, u / 0.004)
    return reverb(x * level, 0.9, 0.28, 5000)


save('receipt', tones([988, 1480], 0.08))
save('settle', tones([659, 988, 1319], 0.11, 0.8, 0.5))


# 8. the clock: fast, filtered ticks that slow and stop; 3.6 s
def clock(d=3.6):
    T = t(d)
    x = np.zeros_like(T)
    pos = 0.0
    i = 0
    while pos < d - 0.1:
        s = int(pos * SR)
        u = t(0.03)
        g = np.sin(2 * np.pi * (2100 - 900 * pos / d) * u) * np.exp(-u * 300) * (0.5 + 0.3 * (i % 2))
        e = min(len(x), s + len(u))
        x[s:e] += g[:e - s]
        pos += 0.07 + 0.09 * (pos / d) ** 2
        i += 1
    return reverb(x * 0.5, 0.3, 0.14)


save('clock', clock())


# 9. the strike through the old number: a marker swipe
T = t(0.32)
sw = hp(lp(rng.standard_normal(len(T)), 6000), 900) * np.sin(np.pi * T / 0.32) ** 0.5 * 0.45
save('strike', reverb(sw, 0.25, 0.12))


# 10. the morph: a rising run of ticks, one a character, 0.8 s
x = np.zeros(int(1.1 * SR))
for i in range(15):
    s = int(i * 0.05 * SR)
    b = tick(1500 * 2 ** (i / 10), 0.32)[0]
    x[s:s + len(b)] += b[:max(0, len(x) - s)][:len(b)]
save('morph', reverb(x, 0.8, 0.22, 6000))


# 11. the count-up to $4.93: quick ticks for 1.4 s, slowing
x = np.zeros(int(1.8 * SR))
pos = 0.0
n = 0
while pos < 1.4:
    b = tick(1800 + 900 * pos / 1.4, 0.3)[0]
    s = int(pos * SR)
    x[s:s + len(b)] += b[:len(b)]
    pos += 0.045 + 0.1 * (pos / 1.4) ** 3
    n += 1
save('count', reverb(x, 0.3, 0.1))


# 12. the logo sting: a sub bloom and a held open chord, with a slow shimmer; 4 s
T = t(4.0)
env = np.minimum(1, T / 0.05) * np.exp(-T * 1.1)
chord = sum(a * np.sin(2 * np.pi * f * T + p) for f, a, p in [
    (110.0, 0.7, 0), (164.81, 0.5, 1), (246.94, 0.35, 2), (329.63, 0.26, 3), (493.88, 0.14, 4), (659.26, 0.09, 5)])
sh = 1 + 0.12 * np.sin(2 * np.pi * 5.2 * T)
sub = np.sin(2 * np.pi * (55 * T)) * np.exp(-T * 2.4)
save('sting', reverb((chord * sh * env * 0.5 + sub * 0.6), 3.0, 0.4, 3000))

# 13. room tone: warm air, so a silence is never digital black; 90 s loop
n = int(30 * SR)
room = lp(rng.standard_normal(n), 420)
room = room / np.abs(room).max() * 0.5
save('room', np.vstack([room, np.roll(room, 9000)]))
print('sfx written to', os.path.abspath(OUT))
