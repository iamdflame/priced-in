"""The film's timeline and sound. One source of truth for all three cuts: cue times, shot times and sound events.
Writes src/film/cuts.json for Remotion (shots, voice words, events) and public/audio/mix-<cut>.wav.

    python scripts/mix.py [main|c15|v30 ...] [--timing-only]

Music: 'Aphelion' by Scott Buckley, CC BY 4.0, a steady 80 BPM (a beat is 0.75 s, a bar 3 s, on the track's own
grid), so every cut lands on its beat. Voice: Peter on eleven_v4, time-stretched line by line with rubberband.
Sound effects: scripts/sfx.py.
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FF = os.environ.get('FFMPEG') or r'C:/Users/Dflame/AppData/Local/Temp/claude/057e9ba3f46752a6/59eb9a27-2bf0-48a2-972f-672a32f97eef/scratchpad/ffenv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe'
SR = 48000
BEAT = 0.75
VOICE_DIR = os.path.join(ROOT, 'public', 'voice')
STRETCH_DIR = os.path.join(VOICE_DIR, 'stretched')
SFX = os.path.join(ROOT, 'public', 'audio', 'sfx')
os.makedirs(STRETCH_DIR, exist_ok=True)

# post-generation time-stretch per line (eleven_v4 ignores the API's speed)
SPEED = {'L01': 1.15, 'L02': 1.04, 'L03': 1.14, 'L04': 1.12, 'L05': 1.1, 'L06': 1.14, 'L07a': 1.1, 'L07b': 1.0, 'L07c': 1.0,
         'L07d': 1.0, 'L07e': 1.12, 'L08': 1.1, 'L09': 1.12, 'L10': 1.11, 'L11': 1.1, 'L12': 1.12, 'L14': 1.0, 'C2': 1.08,
         'C3': 1.15, 'C4': 1.14, 'C5': 1.1, 'C6': 1.12, 'V2c': 1.08, 'V2b': 1.1, 'V3b': 1.08, 'V4': 1.08, 'V5': 1.2,
         'N02': 1.08, 'N03': 1.08, 'N04': 1.08, 'N05': 1.08, 'N06': 1.06, 'N07': 1.0, 'N08': 1.13, 'N09': 1.06, 'N10': 1.08,
         'N11': 1.08, 'N12': 1.06, 'N13': 1.0, 'N08v': 1.08, 'N02s': 1.06, 'P02': 1.04, 'P03': 1.08, 'P04a': 1.04, 'P04b': 1.0, 'P06': 1.08, 'P07': 1.06,
         'R03': 1.06, 'R04': 1.06, 'R05': 1.04}


def run(*a):
    subprocess.run([FF, '-v', 'error', '-y', *a], check=True)


def stretched(i):
    out = os.path.join(STRETCH_DIR, f'{i}.wav')
    src = os.path.join(VOICE_DIR, f'{i}.mp3')
    sp = SPEED[i]
    stamp = os.path.join(STRETCH_DIR, f'{i}.speed')
    if not (os.path.exists(out) and os.path.exists(stamp) and open(stamp).read() == str(sp)):
        chain = f'rubberband=tempo={sp}:pitchq=quality:transients=smooth,' if sp != 1.0 else ''
        chain += 'highpass=f=85,deesser=i=0.35:f=0.45,acompressor=threshold=-20dB:ratio=2.5:attack=6:release=120:makeup=2'
        run('-i', src, '-af', chain, '-ar', str(SR), '-ac', '2', '-c:a', 'pcm_s16le', out)
        open(stamp, 'w').write(str(sp))
    return out


def read_wav(path):
    with wave.open(path) as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    x = x.reshape(-1, ch).T
    if ch == 1:
        x = np.vstack([x, x])
    assert sr == SR, path
    return x


def words(i):
    j = json.load(open(os.path.join(VOICE_DIR, f'{i}.json'), encoding='utf8'))
    sp = SPEED[i]
    return [{'w': w['w'], 's': round(w['s'] / sp, 3), 'e': round(w['e'] / sp, 3)} for w in j['words']]


def word_at(i, at, prefix):
    for w in words(i):
        if w['w'].lower().startswith(prefix.lower()):
            return round(at + w['s'], 3)
    raise KeyError((i, prefix))


# ----- the cuts ----------------------------------------------------------------------------------------
def main_cut():
    # Everything on the 0.75 s beat of the music, which starts at the track's bar 24 (72.0 s).
    # 84.0 s: the line that carries Illia's sentence (L09) takes its time from the proof stack, never the verdict.
    v = [('L01', 0.05), ('L02', 3.85), ('L03', 6.75), ('L04', 13.5), ('L05', 20.25), ('L06', 23.4), ('L07a', 29.25),
         ('L07b', 35.05), ('L07c', 36.05), ('L07d', 38.15), ('L07e', 39.6), ('L08', 44.25), ('L09', 48.0), ('L10', 59.25),
         ('L11', 65.25), ('L12', 68.25), ('L14', 77.25)]
    tap = word_at('L03', 6.75, 'No')
    near = word_at('L03', 6.75, 'NEAR')
    page = round(word_at('L09', 48.0, 'with') - 0.15, 3)
    # the panel holds through "Now every page here is written by AI,"; the whip to the page's header lands on "from what the market believes"
    written = round(word_at('L09', 48.0, 'from') - 0.35, 3)
    shots = [
        dict(id='hook', at=0.0, dur=3.75),
        dict(id='wake', at=3.75, dur=3.0),
        dict(id='phoneTap', at=6.75, dur=near - 6.75, tap=tap),
        dict(id='swing', at=near, dur=11.25 - near),
        dict(id='phoneReceipt', at=11.25, dur=2.25),
        dict(id='feed', at=13.5, dur=2.25),
        dict(id='steps', at=15.75, dur=4.5),
        dict(id='traders', at=20.25, dur=3.0),
        dict(id='who', at=23.25, dur=2.25),
        dict(id='challenge', at=25.5, dur=3.75),
        dict(id='judges', at=29.25, dur=5.25),
        dict(id='stamps', at=34.5, dur=5.25),
        dict(id='signed', at=39.75, dur=4.5),
        dict(id='window', at=44.25, dur=3.75),
        dict(id='fix', at=48.0, dur=page - 48.0),
        dict(id='pageFix', at=page, dur=59.25 - page, written=written),
        dict(id='payout', at=59.25, dur=6.0),
        dict(id='reopen', at=65.25, dur=3.0),
        dict(id='pullback', at=68.25, dur=6.0),
        dict(id='proof', at=74.25, dur=2.25),
        dict(id='end', at=76.5, dur=7.5),
    ]
    four = word_at('L10', 59.25, 'Four')
    sx = [('whoosh_long', 3.45, 0.5), ('bloom', 4.85, 0.7), ('tick_soft', 4.85, 0.5),
          ('whoosh', 6.5, 0.4), ('tap', tap, 0.9),
          ('whoosh_short', near - 0.15, 0.5), ('bloom', near + 0.7, 0.9), ('receipt', near + 0.75, 0.8),
          ('whoosh', 11.05, 0.35), ('whoosh', 13.3, 0.4), ('whoosh_short', 15.6, 0.4),
          ('whoosh', 20.05, 0.4), ('whoosh_short', 23.1, 0.35), ('whoosh', 25.3, 0.35), ('tap', 26.6, 0.5),
          ('stamp1', 35.1, 1.9), ('stamp2', 36.1, 1.9), ('stamp3', 38.2, 2.2),
          ('ping', word_at('L07e', 39.6, 'checked'), 0.8), ('ping', word_at('L07e', 39.6, 'checked') + 0.3, 0.8), ('ping', word_at('L07e', 39.6, 'checked') + 0.6, 0.8),
          ('clock', 44.5, 0.5), ('whoosh_short', 47.8, 0.35),
          ('strike', word_at('L09', 48.0, 'One') - 0.7, 0.8), ('morph', word_at('L09', 48.0, 'One') - 0.02, 0.75),
          ('whoosh_long', page - 0.25, 0.45), ('tap', page + 1.6, 0.45), ('ping', page + 2.3, 0.6), ('whoosh', written - 0.2, 0.35),
          ('whoosh', 59.0, 0.35), ('count', four, 0.6), ('settle', four + 1.45, 0.9),
          ('whoosh', 65.0, 0.35), ('whoosh_long', 67.9, 0.5), ('whoosh_short', 74.05, 0.35), ('whoosh_long', 76.1, 0.45),
          ('bloom', 77.0, 0.9), ('sting', 77.0, 0.8)]
    for i, t in enumerate([0.15, 0.75, 1.35, 1.95, 2.55, 3.15, 3.75]):
        sx.append((f'tick{i + 1}', 15.75 + t + 0.25, 0.75))
    for i in range(7):
        sx.append(('tick_soft', 74.35 + i * 0.22, 0.7))
    # music: gain in dB over film time. The track rises by itself; the opening is lifted to meet it, it drops out
    # before the verdict, returns under "NEAR checked every signature", and fades on the end card.
    music = dict(track=72.0, gain=[(0, -4), (1.0, 2.5), (20, 1), (27.0, 0), (29.25, -9), (31.0, -60), (41.6, -60), (43.0, -3), (59.25, -1),
                                   (64, -2), (76.5, -1), (81, -3), (84.0, -30)])
    return dict(id='main', dur=84.0, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def short_cut():
    v = [('L01', 0.05), ('C2', 3.8), ('C3', 5.9), ('C4', 8.35), ('C5', 10.2), ('C6', 11.7)]
    shots = [
        dict(id='hook', at=0.0, dur=3.75),
        dict(id='phoneTap', at=3.75, dur=2.1, tap=4.55, chip=5.0),
        dict(id='stamps', at=5.85, dur=4.45, rate=1.6),
        dict(id='payout', at=10.3, dur=1.5, fast=True),
        dict(id='end', at=11.8, dur=3.2, fast=True),
    ]
    sx = [('whoosh', 3.55, 0.35), ('tap', 4.55, 0.9), ('receipt', 5.0, 0.7), ('whoosh_short', 5.7, 0.4),
          ('stamp1', 6.22, 1.7), ('stamp2', 6.85, 1.8), ('stamp3', 8.16, 2.1), ('ping', 9.6, 0.7),
          ('whoosh_short', 10.15, 0.35), ('count', 10.45, 0.55), ('settle', 11.1, 0.8),
          ('bloom', 12.1, 0.9), ('sting', 12.1, 0.75)]
    music = dict(track=135.0, gain=[(0, -6), (1, -2), (5.3, -3), (6.1, -60), (9.5, -60), (10.3, -2), (13, -3), (15, -24)])
    return dict(id='c15', dur=15.0, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def vertical_cut():
    v = [('L01', 0.05), ('V2c', 3.8), ('V2b', 6.1), ('V3b', 9.75), ('V4', 13.6), ('L07b', 17.05), ('L07c', 18.05), ('L07d', 20.15),
         ('C4', 21.3), ('V5', 23.15), ('C6', 26.85)]
    shots = [
        dict(id='hook', at=0.0, dur=3.75),
        dict(id='phoneTap', at=3.75, dur=2.25, tap=5.2),
        dict(id='swing', at=6.0, dur=3.75),
        dict(id='steps', at=9.75, dur=3.75),
        dict(id='judges', at=13.5, dur=3.0),
        dict(id='stamps', at=16.5, dur=6.0),
        dict(id='fixShort', at=22.5, dur=2.25),
        dict(id='payout', at=24.75, dur=1.9, fast=True),
        dict(id='end', at=26.65, dur=3.6, fast=True),
    ]
    sx = [('whoosh', 3.55, 0.35), ('tap', 5.2, 0.9), ('whoosh_short', 5.85, 0.4), ('bloom', 6.7, 0.9), ('receipt', 6.75, 0.8),
          ('whoosh_short', 9.55, 0.4), ('whoosh', 13.3, 0.3),
          ('stamp1', 17.1, 1.9), ('stamp2', 18.1, 1.9), ('stamp3', 20.2, 2.2), ('ping', 21.9, 0.8),
          ('strike', 22.9, 0.8), ('morph', 23.3, 0.6), ('whoosh_short', 24.6, 0.3), ('count', 24.95, 0.55), ('settle', 25.7, 0.8),
          ('bloom', 26.95, 0.9), ('sting', 26.95, 0.75)]
    for i, t in enumerate([0.15, 0.6, 1.05, 1.5, 1.95, 2.4, 2.85]):
        sx.append((f'tick{i + 1}', 9.75 + t, 0.7))
    music = dict(track=117.0, gain=[(0, -6), (1, -1), (13, -2), (15.5, -60), (21.6, -60), (22.5, -2), (28, -3), (30, -24)])
    return dict(id='v30', dur=30.25, w=1080, h=1920, voice=v, shots=shots, sfx=sx, music=music)


# ----- v5: the re-cut after three cold viewers scored v4 5/10 (.apex/prompts/V5-film-recut.md) -------------------
def seq(lines, start=0.05, gap=0.35, at=None):
    """Lays voice lines end to end; `at` pins a line to a time."""
    out, t = [], start
    for i in lines:
        if at and i in at:
            t = at[i]
        out.append((i, round(t, 3)))
        t = t + words(i)[-1]['e'] + gap
    return out


def end_of(v, i):
    return round(dict(v)[i] + words(i)[-1]['e'], 3)


def main_v5():
    # the verdict keeps its rhythm: a breath after the judges, then False, False, (a beat) False
    v = seq(['L01', 'N02', 'N03', 'N04', 'N05', 'N06'], at={'N02': 3.85})
    fb = round(end_of(v, 'N06') + 0.55, 3)
    v += [('L07b', fb), ('L07c', fb + 1.0), ('L07d', fb + 3.1)]
    v += seq(['C4', 'N07', 'N08', 'N09', 'N10', 'N11', 'N12', 'N13'], start=fb + 3.1 + 1.25)
    d = dict(v)
    W = lambda i, pre: word_at(i, d[i], pre)
    tap = W('N03', 'wrong')
    near = W('N03', 'Near')
    stamps = round(fb - 0.55, 3)
    with_ = W('N08', 'with')
    shots = [
        dict(id='v5hook', at=0.0, dur=3.75, nocap=True),
        dict(id='v5idea', at=3.75, dur=d['N03'] - 0.15 - 3.75, nocap=True),
        dict(id='v5bet', at=d['N03'] - 0.15, dur=d['N04'] - d['N03'], tap=tap, chip=near),
        dict(id='v5odds', at=d['N04'] - 0.15, dur=d['N05'] - d['N04']),
        dict(id='v5challenge', at=d['N05'] - 0.15, dur=d['N06'] - d['N05'], src=W('N05', 'with')),
        dict(id='v5judges', at=d['N06'] - 0.15, dur=stamps - d['N06'] + 0.15),
        dict(id='v5stamps', at=stamps, dur=d['C4'] - 0.15 - stamps, nocap=True),
        dict(id='v5signed', at=d['C4'] - 0.15, dur=d['N07'] - d['C4']),
        dict(id='v5rule', at=d['N07'] - 0.15, dur=d['N08'] - d['N07'], nocap=True, ev=W('N07', 'Evidence')),
        dict(id='v5fix', at=d['N08'] - 0.15, dur=with_ - 0.2 - d['N08'] + 0.15, nocap=True),
        dict(id='v5panel', at=with_ - 0.2, dur=d['N09'] - 0.15 - with_ + 0.2),
        dict(id='v5page', at=d['N09'] - 0.15, dur=d['N10'] - d['N09'], sure=W('N09', 'plainly'), doubt=W('N09', 'isn')),
        dict(id='v5dispute', at=d['N10'] - 0.15, dur=d['N11'] - d['N10'], paid=W('N10', 'Here')),
        dict(id='v5news', at=d['N11'] - 0.15, dur=d['N12'] - d['N11'], pick=W('N11', 'Pick')),
        dict(id='v5proof', at=d['N12'] - 0.15, dur=d['N13'] - d['N12']),
        dict(id='v5end', at=d['N13'] - 0.15, dur=end_of(v, 'N13') + 2.6 - d['N13'] + 0.15, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('tick_soft', 0.0, 0.4), ('whoosh', 3.55, 0.4), ('bloom', 3.9, 0.6), ('whoosh_short', 5.0, 0.4),
          ('whoosh', shots[2]['at'] - 0.2, 0.4), ('tap', tap, 0.9), ('receipt', near + 0.55, 0.6), ('bloom', tap + 0.3, 0.7),
          ('whoosh', shots[3]['at'] - 0.2, 0.4), ('whoosh', shots[4]['at'] - 0.2, 0.35), ('whoosh_short', shots[4]['src'] - 0.1, 0.4),
          ('whoosh', shots[5]['at'] - 0.2, 0.3),
          ('stamp1', fb + 0.05, 1.9), ('stamp2', fb + 1.05, 1.9), ('stamp3', fb + 3.15, 2.2),
          ('ping', W('C4', 'checked'), 0.8), ('ping', W('C4', 'checked') + 0.3, 0.8), ('ping', W('C4', 'checked') + 0.6, 0.8),
          ('whoosh_short', shots[8]['at'] - 0.1, 0.35), ('stamp1', shots[8]['ev'], 0.8),
          ('strike', W('N08', 'One') - 0.7, 0.8), ('morph', W('N08', 'One') - 0.02, 0.75), ('whoosh', with_ - 0.3, 0.4),
          ('whoosh', shots[11]['at'] - 0.2, 0.35), ('tick_soft', shots[11]['sure'], 0.6), ('tick_soft', shots[11]['doubt'], 0.6),
          ('whoosh', shots[12]['at'] - 0.2, 0.35), ('settle', shots[12]['paid'] + 0.6, 0.6),
          ('whoosh', shots[13]['at'] - 0.2, 0.35), ('tap', shots[13]['pick'] + 0.2, 0.5),
          ('whoosh_short', shots[14]['at'] - 0.2, 0.35), ('whoosh_long', shots[15]['at'] - 0.4, 0.45),
          ('bloom', shots[15]['at'] + 0.5, 0.9), ('sting', shots[15]['at'] + 0.5, 0.8)]
    for i, t in enumerate([0.9, 1.5, 2.1, 2.7, 3.3, 3.9, 4.5]):
        sx.append((f'tick{i + 1}', shots[3]['at'] + t - 0.4, 0.75))
    for i in range(7):
        sx.append(('tick_soft', shots[14]['at'] + 0.3 + i * 0.2, 0.6))
    music = dict(track=72.0, gain=[(0, 0), (1.0, 2.5), (20, 1), (shots[5]['at'], -2), (shots[5]['at'] + 1.5, -9), (fb - 0.2, -60),
                                   (shots[7]['at'] + 0.3, -60), (shots[7]['at'] + 1.6, -3), (shots[12]['at'], -1),
                                   (shots[15]['at'], -1), (dur - 3, -3), (dur, -30)])
    return dict(id='main', dur=dur, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def short_v5():
    v = [('L01', 0.05), ('N02s', 3.85)]
    fb = round(3.85 + words('N02s')[-1]['e'] + 1.0, 3)
    v += [('L07b', fb), ('L07c', fb + 0.62), ('L07d', fb + 1.93), ('C6', fb + 2.95)]
    stamps = round(fb - 0.38, 3)
    end = round(fb + 2.9, 3)
    shots = [
        dict(id='v5hook', at=0.0, dur=3.75, nocap=True),
        dict(id='v5idea', at=3.75, dur=stamps - 3.75, nocap=True),
        dict(id='v5stamps', at=stamps, dur=end - stamps, rate=1.6, nocap=True),
        dict(id='v5end', at=end, dur=round(fb + 2.95 + words('C6')[-1]['e'] + 1.6 - end, 3), fast=True, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('whoosh', 3.55, 0.4), ('bloom', 3.9, 0.6), ('whoosh_short', stamps - 0.15, 0.4),
          ('stamp1', fb + 0.05, 1.7), ('stamp2', fb + 0.67, 1.8), ('stamp3', fb + 1.98, 2.1),
          ('bloom', end + 0.2, 0.9), ('sting', end + 0.2, 0.75)]
    music = dict(track=135.0, gain=[(0, -3), (1, -1), (stamps - 0.3, -3), (fb - 0.1, -60), (end - 0.1, -60), (end + 0.3, -2), (dur - 1, -3), (dur, -24)])
    return dict(id='c15', dur=dur, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def vertical_v5():
    v = seq(['L01', 'N02', 'N03'], at={'N02': 3.85})
    fb = round(end_of(v, 'N03') + 0.9, 3)
    v += [('L07b', fb), ('L07c', fb + 1.0), ('L07d', fb + 2.4)]
    v += seq(['N07', 'N08v', 'C6'], start=fb + 2.4 + 1.1, gap=0.3)
    d = dict(v)
    W = lambda i, pre: word_at(i, d[i], pre)
    stamps = round(fb - 0.55, 3)
    shots = [
        dict(id='v5hook', at=0.0, dur=3.75, nocap=True),
        dict(id='v5idea', at=3.75, dur=d['N03'] - 0.15 - 3.75, nocap=True),
        dict(id='v5bet', at=d['N03'] - 0.15, dur=stamps - d['N03'] + 0.15, tap=W('N03', 'wrong'), chip=W('N03', 'Near')),
        dict(id='v5stamps', at=stamps, dur=d['N07'] - 0.15 - stamps, rate=1.25, nocap=True),
        dict(id='v5rule', at=d['N07'] - 0.15, dur=d['N08v'] - d['N07'], nocap=True, ev=W('N07', 'Evidence')),
        dict(id='v5fix', at=d['N08v'] - 0.15, dur=d['C6'] - d['N08v'], nocap=False),
        dict(id='v5end', at=d['C6'] - 0.15, dur=round(end_of(v, 'C6') + 0.7 - d['C6'] + 0.15, 3), fast=True, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('whoosh', 3.55, 0.4), ('bloom', 3.9, 0.6), ('whoosh', shots[2]['at'] - 0.2, 0.4), ('tap', W('N03', 'wrong'), 0.9),
          ('receipt', W('N03', 'Near') + 0.55, 0.6), ('whoosh_short', stamps - 0.15, 0.4),
          ('stamp1', fb + 0.05, 1.9), ('stamp2', fb + 1.05, 1.9), ('stamp3', fb + 2.45, 2.2),
          ('stamp1', shots[4]['ev'], 0.8), ('whoosh', shots[5]['at'] - 0.2, 0.35), ('strike', shots[5]['at'] + 0.2, 0.8), ('morph', shots[5]['at'] + 0.9, 0.75), ('bloom', shots[6]['at'] + 0.2, 0.9), ('sting', shots[6]['at'] + 0.2, 0.75)]
    music = dict(track=117.0, gain=[(0, -2), (1, -1), (W('N03', 'Near') - 0.6, -1), (W('N03', 'Near') - 0.3, -6), (W('N03', 'Near') + 0.6, -6), (W('N03', 'Near') + 0.9, -2), (stamps - 0.3, -3), (fb - 0.1, -60), (shots[4]['at'] + 0.3, -60), (shots[4]['at'] + 1.5, -3), (dur - 1, -3), (dur, -24)])
    return dict(id='v30', dur=dur, w=1080, h=1920, voice=v, shots=shots, sfx=sx, music=music)


# ----- v6: one idea, full frame (.apex/prompts/V6-film-one-idea.md) -------------------------------------------------
def main_v6():
    v = seq(['L01', 'P02', 'P03', 'P04a'], at={'P02': 3.85}, gap=0.3)
    fb = round(end_of(v, 'P04a') + 0.55, 3)
    v += [('L07b', fb), ('L07c', fb + 1.0), ('L07d', fb + 3.1)]
    v += seq(['P04b', 'N07', 'P06', 'P07', 'N13'], start=fb + 3.1 + 1.25, gap=0.4)
    d = dict(v)
    W = lambda i, pre: word_at(i, d[i], pre)
    stamps = round(fb - 0.55, 3)
    shots = [
        dict(id='v6hook', at=0.0, dur=3.75, nocap=True),
        dict(id='v6market', at=3.75, dur=d['P04a'] - 0.15 - 3.75, tap=W('P03', 'wrong'), chip=W('P03', 'Near'), lock=W('P02', 'Priced')),
        dict(id='v6evidence', at=d['P04a'] - 0.15, dur=stamps - d['P04a'] + 0.15),
        dict(id='v6stamps', at=stamps, dur=d['P04b'] - 0.15 - stamps, nocap=True),
        dict(id='v6won', at=d['P04b'] - 0.15, dur=d['N07'] - d['P04b']),
        dict(id='v6rule', at=d['N07'] - 0.15, dur=d['P06'] - d['N07'], nocap=True, ev=W('N07', 'Evidence')),
        dict(id='v6payoff', at=d['P06'] - 0.15, dur=d['P07'] - d['P06'], ours=W('P06', 'Priced')),
        dict(id='v6pages', at=d['P07'] - 0.15, dur=d['N13'] - d['P07'], honest=W('P07', 'honest')),
        dict(id='v6end', at=d['N13'] - 0.15, dur=end_of(v, 'N13') + 3.0 - d['N13'] + 0.15, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    m = shots[1]
    sx = [('tick_soft', 0.0, 0.4), ('whoosh_long', 3.45, 0.45), ('bloom', 4.4, 0.7), ('tick_soft', 5.2, 0.5),
          ('tap', m['tap'], 0.9), ('bloom', m['tap'] + 0.15, 0.9), ('receipt', m['chip'] + 0.55, 0.6),
          ('whoosh', shots[2]['at'] - 0.2, 0.4),
          ('stamp1', fb + 0.05, 1.9), ('stamp2', fb + 1.05, 1.9), ('stamp3', fb + 3.15, 2.2),
          ('settle', shots[4]['at'] + 0.35, 0.7),
          ('whoosh_short', shots[5]['at'] - 0.1, 0.35), ('stamp1', shots[5]['ev'], 0.8),
          ('whoosh', shots[6]['at'] - 0.2, 0.4), ('strike', shots[6]['at'] + 0.6, 0.6), ('morph', shots[6]['ours'] + 0.9, 0.6),
          ('whoosh', shots[7]['at'] - 0.2, 0.35), ('tick_soft', shots[7]['honest'], 0.6),
          ('whoosh_long', shots[8]['at'] - 0.4, 0.45), ('bloom', shots[8]['at'] + 0.5, 0.9), ('sting', shots[8]['at'] + 0.5, 0.8)]
    music = dict(track=72.0, gain=[(0, 0), (1.0, 2.5), (shots[2]['at'], 0), (shots[2]['at'] + 2.0, -9), (fb - 0.2, -60),
                                   (shots[4]['at'] + 0.1, -60), (shots[4]['at'] + 1.2, -2), (d['P06'] - 0.4, -3), (d['P06'], -7), (d['P07'] - 0.3, -7), (d['P07'], -19),
                                   (end_of(v, 'P07'), -19), (shots[8]['at'], -1), (dur - 2.5, -3), (dur, -30)])
    return dict(id='main', dur=dur, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def short_v6():
    v = [('L01', 0.05), ('P02', 3.85)]
    fb = round(3.85 + words('P02')[-1]['e'] / SPEED['P02'] + 0.75, 3)
    v += [('L07b', fb), ('L07c', fb + 0.62), ('L07d', fb + 1.93), ('C6', fb + 2.95)]
    stamps = round(fb - 0.38, 3)
    end = round(fb + 2.9, 3)
    shots = [
        dict(id='v6hook', at=0.0, dur=3.75, nocap=True),
        dict(id='v6market', at=3.75, dur=stamps - 3.75, tap=99, chip=99, lock=word_at('P02', 3.85, 'Priced')),
        dict(id='v6stamps', at=stamps, dur=end - stamps, rate=1.6, nocap=True),
        dict(id='v6end', at=end, dur=round(fb + 2.95 + words('C6')[-1]['e'] / SPEED['C6'] + 0.5 - end, 3), fast=True, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('whoosh_long', 3.45, 0.45), ('bloom', 4.4, 0.7), ('whoosh_short', stamps - 0.15, 0.4),
          ('stamp1', fb + 0.05, 1.7), ('stamp2', fb + 0.67, 1.8), ('stamp3', fb + 1.98, 2.1),
          ('bloom', end + 0.2, 0.9), ('sting', end + 0.2, 0.75)]
    music = dict(track=135.0, gain=[(0, -3), (1, -1), (stamps - 0.3, -3), (fb - 0.1, -60), (end - 0.1, -60), (end + 0.3, -2), (dur - 1, -3), (dur, -24)])
    return dict(id='c15', dur=dur, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def vertical_v6():
    v = seq(['L01', 'P02', 'P03'], at={'P02': 3.85}, gap=0.3)
    fb = round(end_of(v, 'P03') + 1.0, 3)
    v += [('L07b', fb), ('L07c', fb + 0.85), ('L07d', fb + 2.1)]
    v += seq(['P06', 'C6'], start=fb + 2.1 + 1.15, gap=0.35)
    d = dict(v)
    W = lambda i, pre: word_at(i, d[i], pre)
    stamps = round(fb - 0.5, 3)
    shots = [
        dict(id='v6hook', at=0.0, dur=3.75, nocap=True),
        dict(id='v6market', at=3.75, dur=stamps - 3.75, tap=W('P03', 'wrong'), chip=W('P03', 'Near'), lock=W('P02', 'Priced')),
        dict(id='v6stamps', at=stamps, dur=d['P06'] - 0.15 - stamps, rate=1.15, nocap=True, judges=True),
        dict(id='v6payoff', at=d['P06'] - 0.15, dur=d['C6'] - d['P06'], ours=W('P06', 'Priced')),
        dict(id='v6end', at=d['C6'] - 0.15, dur=round(end_of(v, 'C6') + 1.3 - d['C6'] + 0.15, 3), fast=True, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    m = shots[1]
    sx = [('whoosh_long', 3.45, 0.45), ('bloom', 4.4, 0.7), ('tap', m['tap'], 0.9), ('bloom', m['tap'] + 0.15, 0.9), ('receipt', m['chip'] + 0.55, 0.6),
          ('whoosh_short', shots[2]['at'] - 0.15, 0.4),
          ('stamp1', fb + 0.05, 1.9), ('stamp2', fb + 0.9, 1.9), ('stamp3', fb + 2.15, 2.2),
          ('whoosh', shots[3]['at'] - 0.2, 0.4), ('morph', shots[3]['ours'] + 0.9, 0.6), ('bloom', shots[4]['at'] + 0.2, 0.9), ('sting', shots[4]['at'] + 0.2, 0.75)]
    music = dict(track=117.0, gain=[(0, -2), (1, -1), (m['chip'] - 0.4, -1), (m['chip'] - 0.1, -6), (m['chip'] + 0.8, -6), (m['chip'] + 1.1, -2),
                                   (stamps - 0.3, -3), (fb - 0.1, -60), (shots[3]['at'] + 0.1, -60), (shots[3]['at'] + 1.2, -3), (dur - 1, -3), (dur, -24)])
    return dict(id='v30', dur=dur, w=1080, h=1920, voice=v, shots=shots, sfx=sx, music=music)


# ----- v7: the real product in use, every number holds up (.apex/prompts/V7-film-real.md) -------------------------------
def main_v7():
    v = seq(['L01', 'P02', 'R03'], at={'P02': 3.85}, gap=0.3)
    v += [('R04', round(end_of(v, 'R03') + 1.7, 3))]
    fb = round(end_of(v, 'R04') + 0.5, 3)
    v += [('L07b', fb), ('L07c', fb + 1.0), ('L07d', fb + 3.1)]
    v += seq(['R05', 'N07', 'P06', 'N13'], start=fb + 3.1 + 1.2, gap=0.4)
    d = dict(v)
    W = lambda i, pre: word_at(i, d[i], pre)
    tap = W('R03', 'wrong')
    pub = W('R03', 'in')
    on = W('P02', 'On')
    verdict = round(d['R04'] - 0.2, 3)
    shots = [
        dict(id='v7hook', at=0.0, dur=round(on - 0.2, 3), k=dict(catch=W('P02', 'catch'))),
        dict(id='v7market', at=round(on - 0.2, 3), dur=round(pub - 0.1 - (on - 0.2), 3), k=dict(tap=tap, near=W('R03', 'Near'))),
        dict(id='v7explorer', at=round(pub - 0.1, 3), dur=round(verdict - (pub - 0.1), 3)),
        dict(id='v7verdict', at=verdict, dur=round(d['R05'] - 0.15 - verdict, 3), k=dict(f1=fb, f2=fb + 1.0, f3=fb + 3.1, cloud=W('R04', 'Near'), marksFalse=1)),
        dict(id='v7decided', at=round(d['R05'] - 0.15, 3), dur=round(d['P06'] - d['R05'], 3), k=dict(ev=W('N07', 'Evidence'), money=d['N07'])),
        dict(id='v7payoff', at=round(d['P06'] - 0.15, 3), dur=round(d['N13'] - d['P06'], 3), k=dict(ours=W('P06', 'Priced'), src=W('P06', 'with'))),
        dict(id='v7end', at=round(d['N13'] - 0.15, 3), dur=round(end_of(v, 'N13') + 3.0 - d['N13'] + 0.15, 3), nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('tick_soft', 0.0, 0.4), ('whoosh', 0.55, 0.35), ('tick_soft', 1.7, 0.5), ('whoosh_short', 2.7, 0.4), ('tick_soft', 3.0, 0.5),
          ('whoosh_long', shots[1]['at'] - 0.3, 0.45), ('tap', tap, 0.9), ('tap', tap + 0.72, 0.8), ('receipt', tap + 1.55, 0.6),
          ('whoosh', shots[2]['at'] - 0.15, 0.4), ('tick_soft', shots[2]['at'] + 0.5, 0.5),
          ('whoosh', shots[3]['at'] - 0.15, 0.4),
          ('stamp1', fb + 0.05, 1.6), ('stamp2', fb + 1.05, 1.6), ('stamp3', fb + 3.15, 1.9),
          ('whoosh_short', shots[4]['at'] - 0.1, 0.35), ('settle', shots[4]['at'] + 0.4, 0.6),
          ('whoosh', shots[5]['at'] - 0.2, 0.4), ('morph', shots[5]['k']['ours'] + 0.2, 0.5),
          ('whoosh_long', shots[6]['at'] - 0.4, 0.45), ('bloom', shots[6]['at'] + 0.4, 0.8), ('sting', shots[6]['at'] + 0.4, 0.7)]
    music = dict(track=72.0, gain=[(0, 0), (1.0, 2.5), (shots[3]['at'], 0), (shots[3]['at'] + 2.0, -9), (fb - 0.2, -60),
                                   (shots[4]['at'] + 0.1, -60), (shots[4]['at'] + 1.2, -3), (d['P06'] - 0.4, -3), (d['P06'], -7),
                                   (end_of(v, 'P06'), -7), (shots[6]['at'], -1), (dur - 2.5, -3), (dur, -30)])
    return dict(id='main', dur=dur, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def short_v7():
    v = [('L01', 0.05), ('P02', 3.85)]
    on = word_at('P02', 3.85, 'On')
    fb = round(3.85 + words('P02')[-1]['e'] / SPEED['P02'] + 0.35, 3)
    v += [('L07b', fb), ('L07c', fb + 0.62), ('L07d', fb + 1.93), ('C6', fb + 2.75)]
    verdict = round(fb - 0.3, 3)
    end = round(fb + 2.7, 3)
    tap = word_at('P02', 3.85, 'you')
    shots = [
        dict(id='v7hook', at=0.0, dur=round(on - 0.2, 3), fast=True, k=dict(catch=word_at('P02', 3.85, 'catch'))),
        dict(id='v7market', at=round(on - 0.2, 3), dur=round(verdict - (on - 0.2), 3), k=dict(tap=tap, near=99)),
        dict(id='v7verdict', at=verdict, dur=round(end - verdict, 3), rate=1.6, nocap=True, k=dict(f1=fb, f2=fb + 0.62, f3=fb + 1.93, cloud=99)),
        dict(id='v7end', at=end, dur=round(fb + 2.75 + words('C6')[-1]['e'] / SPEED['C6'] + 0.5 - end, 3), fast=True, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('whoosh', 0.55, 0.35), ('whoosh_short', 2.4, 0.4), ('whoosh_long', on - 0.5, 0.45), ('tap', tap, 0.9),
          ('whoosh_short', verdict - 0.15, 0.4), ('stamp1', fb + 0.05, 1.5), ('stamp2', fb + 0.67, 1.6), ('stamp3', fb + 1.98, 1.9),
          ('bloom', end + 0.2, 0.9), ('sting', end + 0.2, 0.75)]
    music = dict(track=135.0, gain=[(0, -3), (1, -1), (verdict - 0.3, -3), (fb - 0.1, -60), (end - 0.1, -60), (end + 0.3, -2), (dur - 1, -3), (dur, -24)])
    return dict(id='c15', dur=dur, w=1920, h=1080, voice=v, shots=shots, sfx=sx, music=music)


def vertical_v7():
    v = seq(['L01', 'P02', 'R03'], at={'P02': 3.85}, gap=0.3)
    fb = round(end_of(v, 'R03') + 1.6, 3)
    v += [('L07b', fb), ('L07c', fb + 0.85), ('L07d', fb + 2.1)]
    v += seq(['P06', 'C6'], start=fb + 2.1 + 1.15, gap=0.35)
    d = dict(v)
    W = lambda i, pre: word_at(i, d[i], pre)
    tap = W('R03', 'wrong')
    pub = W('R03', 'in')
    on = W('P02', 'On')
    verdict = round(fb - 0.6, 3)
    shots = [
        dict(id='v7hook', at=0.0, dur=round(on - 0.2, 3), k=dict(catch=W('P02', 'catch'), capBottom=560)),
        dict(id='v7market', at=round(on - 0.2, 3), dur=round(pub - 0.1 - (on - 0.2), 3), k=dict(tap=tap, near=W('R03', 'Near'), capBottom=600)),
        dict(id='v7explorer', at=round(pub - 0.1, 3), dur=round(verdict - (pub - 0.1), 3)),
        dict(id='v7verdict', at=verdict, dur=round(d['P06'] - 0.15 - verdict, 3), rate=1.15, nocap=True, k=dict(f1=fb, f2=fb + 0.85, f3=fb + 2.1, cloud=verdict + 0.2)),
        dict(id='v7payoff', at=round(d['P06'] - 0.15, 3), dur=round(d['C6'] - d['P06'], 3), k=dict(ours=W('P06', 'Priced'), src=W('P06', 'with'))),
        dict(id='v7end', at=round(d['C6'] - 0.15, 3), dur=round(end_of(v, 'C6') + 1.3 - d['C6'] + 0.15, 3), fast=True, nocap=True),
    ]
    dur = round(shots[-1]['at'] + shots[-1]['dur'], 2)
    sx = [('whoosh', 0.55, 0.35), ('whoosh_short', 2.7, 0.4), ('whoosh_long', shots[1]['at'] - 0.3, 0.45), ('tap', tap, 0.9),
          ('tap', tap + 0.72, 0.8), ('receipt', tap + 1.55, 0.6), ('whoosh', shots[2]['at'] - 0.15, 0.4), ('whoosh', verdict - 0.15, 0.4),
          ('stamp1', fb + 0.05, 1.6), ('stamp2', fb + 0.9, 1.6), ('stamp3', fb + 2.15, 1.9),
          ('whoosh', shots[4]['at'] - 0.2, 0.4), ('morph', shots[4]['k']['ours'] + 0.2, 0.5), ('bloom', shots[5]['at'] + 0.2, 0.9), ('sting', shots[5]['at'] + 0.2, 0.75)]
    music = dict(track=117.0, gain=[(0, -2), (1, -1), (verdict - 0.3, -3), (fb - 0.1, -60), (shots[4]['at'] + 0.1, -60), (shots[4]['at'] + 1.2, -6),
                                   (end_of(v, 'P06'), -6), (shots[5]['at'], -2), (dur - 1, -3), (dur, -24)])
    return dict(id='v30', dur=dur, w=1080, h=1920, voice=v, shots=shots, sfx=sx, music=music)


CUTS = {'main': main_v7, 'c15': short_v7, 'v30': vertical_v7}





def load_music():
    p = os.path.join(ROOT, 'public', 'audio', 'music', 'Aphelion.wav')
    if not os.path.exists(p):
        run('-i', os.path.join(ROOT, 'public', 'audio', 'music', 'Aphelion.mp3'), '-ar', str(SR), '-ac', '2', '-c:a', 'pcm_s16le', p)
    return read_wav(p)


def smooth(env, attack, release):
    a = np.exp(-1 / (attack * SR))
    r = np.exp(-1 / (release * SR))
    y = np.zeros_like(env)
    z = 0.0
    for i, v in enumerate(env):
        c = a if v > z else r
        z = c * z + (1 - c) * v
        y[i] = z
    return y


def mix(c, music):
    n = int(c['dur'] * SR)
    voice = np.zeros((2, n), np.float32)
    for i, at in c['voice']:
        x = read_wav(stretched(i))
        s = int(at * SR)
        e = min(n, s + x.shape[1])
        voice[:, s:e] += x[:, : e - s]
    # voice level: -18 LUFS-ish short term when speaking
    active = np.abs(voice).mean(axis=0)
    rms = np.sqrt((voice ** 2)[:, active > 0.003].mean())
    voice *= 10 ** (-18.5 / 20) / max(rms, 1e-6)
    # ducking: -8 dB under the voice, 30 ms in, 300 ms out, a hold via a coarse envelope
    hop = 480
    pres = (np.abs(voice).mean(axis=0)[: n // hop * hop].reshape(-1, hop).mean(axis=1) > 0.004).astype(np.float32)
    pres = np.repeat(pres, hop)
    pres = np.pad(pres, (0, n - len(pres)))
    duck = 1 - (1 - 10 ** (-8 / 20)) * smooth(pres, 0.05, 0.35)

    m = c['music']
    s0 = int(m['track'] * SR)
    mus = music[:, s0: s0 + n].copy()
    if mus.shape[1] < n:
        mus = np.pad(mus, ((0, 0), (0, n - mus.shape[1])))
    g = np.interp(np.arange(n) / SR, [t for t, _ in m['gain']], [d for _, d in m['gain']])
    mus = mus * 10 ** (g / 20) * duck * 10 ** (-3.0 / 20)

    fx = np.zeros((2, n), np.float32)
    for name, at, gain in c['sfx']:
        x = read_wav(os.path.join(SFX, name + '.wav'))
        s = int(at * SR)
        if s >= n:
            continue
        e = min(n, s + x.shape[1])
        fx[:, s:e] += x[:, : e - s] * gain
    fx *= 10 ** (-6.0 / 20)
    room = read_wav(os.path.join(SFX, 'room.wav'))
    r = np.tile(room, (1, n // room.shape[1] + 1))[:, :n] * 10 ** (-52 / 20)
    out = voice + mus + fx + r
    pcm = np.clip(out, -1, 1)
    tmp = os.path.join(ROOT, 'public', 'audio', f'raw-{c["id"]}.wav')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((pcm.T * 32767).astype(np.int16).tobytes())
    # master: two-pass loudness to -14 LUFS, -1 dBTP
    log = subprocess.run([FF, '-hide_banner', '-i', tmp, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    j = json.loads(log[log.rindex('{'): log.rindex('}') + 1])
    final = os.path.join(ROOT, 'public', 'audio', f'mix-{c["id"]}.wav')
    af = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
          f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,alimiter=limit=0.86:level=false")
    run('-i', tmp, '-af', af, '-ar', str(SR), '-c:a', 'pcm_s16le', final)
    log = subprocess.run([FF, '-hide_banner', '-nostats', '-i', final, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    tail = log[log.rindex('Summary'):]
    lines = [ln.strip() for ln in tail.splitlines() if any(k in ln for k in ('I:', 'LRA:', 'Peak:'))]
    print(c['id'], 'mix', ' | '.join(lines))


def export(cuts):
    out = {}
    for k, c in cuts.items():
        cues = []
        for i, at in c['voice']:
            j = json.load(open(os.path.join(VOICE_DIR, f'{i}.json'), encoding='utf8'))
            cues.append(dict(id=i, at=at, text=j['text'], words=[{'w': w['w'], 's': round(at + w['s'], 3), 'e': round(at + w['e'], 3)} for w in words(i)]))
        out[k] = dict(id=c['id'], dur=c['dur'], w=c['w'], h=c['h'], shots=c['shots'], cues=cues)
    p = os.path.join(ROOT, 'src', 'film', 'cuts.json')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(out, open(p, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print('wrote', p)


if __name__ == '__main__':
    args = sys.argv[1:]
    only = [a for a in args if not a.startswith('--')] or list(CUTS)
    cuts = {k: CUTS[k]() for k in CUTS}
    for k in cuts:
        for i, _ in cuts[k]['voice']:
            stretched(i)
    # report voice ends
    for k, c in cuts.items():
        ends = [(i, round(at + words(i)[-1]['e'], 2)) for i, at in c['voice']]
        print(k, ends)
    export(cuts)
    if '--timing-only' not in args:
        music = load_music()
        for k in only:
            mix(cuts[k], music)
