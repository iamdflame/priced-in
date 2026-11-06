# Builds app/fonts/amstelvar-text.woff2: Amstelvar (the kit's face for what Wikipedia says) as one static
# text instance, opsz 18 and weight 400, Latin only. The variable source is
# .apex/design/brand/pulse/assets/fonts/amstelvar-roman.woff2 (211 KB); the result is 17 KB, so the quote
# never weighs on the first paint. Needs fontTools and brotli: pip install fonttools brotli
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / ".apex/design/brand/pulse/assets/fonts/amstelvar-roman.woff2"
OUT = ROOT / "site/app/fonts/amstelvar-text.woff2"

font = instancer.instantiateVariableFont(TTFont(SRC), {"wght": 400, "wdth": 100, "opsz": 18, "GRAD": 0})
opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["kern", "liga", "onum", "tnum", "lnum"]
opts.name_IDs = ["*"]
sub = subset.Subsetter(opts)
sub.populate(unicodes=[*range(0x20, 0x7F), *range(0xA0, 0x180), 0x2018, 0x2019, 0x201C, 0x201D, 0x2013, 0x2014, 0x2026, 0x20AC, 0x2032, 0x2033, 0x2212])
sub.subset(font)
font.flavor = "woff2"
font.save(OUT)
print(f"{OUT.name}: {OUT.stat().st_size} bytes")
