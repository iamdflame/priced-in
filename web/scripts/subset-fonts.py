# Subsets Amstelvar for the web: keeps wght, wdth (78-113), opsz and GRAD on the roman, wght and
# opsz on the italic; pins every other axis to its default; Latin, Latin-1 and punctuation only.
#   python web/scripts/subset-fonts.py <dir with Amstelvar-Roman.ttf and Amstelvar-Italic.ttf> web/public/fonts
# Needs fontTools and brotli (pip install fonttools brotli).
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, out = sys.argv[1].rstrip("/\\") + "/", sys.argv[2]
UNI = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x2010, 0x2028)) + list(range(0x2030, 0x203B))
       + [0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2009, 0x200A, 0x2044, 0x0152, 0x0153, 0x0131])

def make(name, keep, extra, outname):
    f = TTFont(src + name)
    limits = {a.axisTag: None for a in f["fvar"].axes if a.axisTag not in keep}
    limits.update(extra)
    f = instancer.instantiateVariableFont(f, limits)
    o = subset.Options()
    o.flavor = "woff2"
    o.layout_features = ["kern", "liga", "lnum", "tnum", "pnum", "onum", "case", "mark", "mkmk"]
    o.name_IDs = ["*"]
    o.notdef_outline = True
    s = subset.Subsetter(o)
    s.populate(unicodes=UNI)
    s.subset(f)
    f.flavor = "woff2"
    f.save(f"{out}/{outname}")

make("Amstelvar-Roman.ttf", {"wght", "wdth", "opsz", "GRAD"}, {"wdth": (78, 100, 113)}, "amstelvar-roman.woff2")
make("Amstelvar-Italic.ttf", {"wght", "opsz"}, {}, "amstelvar-italic.woff2")
