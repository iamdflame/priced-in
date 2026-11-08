# The film's hero object: the Pulse dial as a physical thing, from the kit's geometry and materials
# (.apex/design/brand/_pr/blender-pulse.py), with a real needle, hub and printed read-out.
#
#   blender -b -P blender/dial_film.py -- <shot> <wide|tall> <outdir> [--frames a-b|a,b,c] [--samples n]
#
# Every frame is written on its own and an existing frame is skipped, so a stopped render resumes where it
# left off. The needle only ever shows real prices of market 18: 50 opening, 23.18 before the free bet,
# 11.63 after it, 9.98 last, and the seven steps from the event log.
import bpy, math, os, sys

argv = sys.argv[sys.argv.index('--') + 1:]
SHOT, ASPECT, OUT = argv[0], argv[1], os.path.abspath(argv[2])
FRAMES, SAMPLES, THEME = None, 64, 'dark'
i = 3
while i < len(argv):
    if argv[i] == '--frames':
        FRAMES = argv[i + 1]
    if argv[i] == '--samples':
        SAMPLES = int(argv[i + 1])
    if argv[i] == '--theme':
        THEME = argv[i + 1]
    i += 2
HERE = os.path.dirname(os.path.abspath(__file__))
TALL = ASPECT == 'tall'
LIGHT = THEME == 'light'  # the bright film: a white studio, the kit's dial-light materials, a transparent ground


# ----- timing helpers ----------------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def bez(x1, y1, x2, y2):
    # cubic-bezier as in CSS, solved by bisection; y may overshoot
    def f(t):
        def b(a, c, u):
            return 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * c + u ** 3
        lo, hi = 0.0, 1.0
        for _ in range(30):
            m = (lo + hi) / 2
            if b(x1, x2, m) < t:
                lo = m
            else:
                hi = m
        return b(y1, y2, (lo + hi) / 2)
    return f


NEEDLE = bez(0.3, 1.6, 0.45, 1)  # the kit's signature settle
OUTC = bez(0.22, 1, 0.36, 1)
INOUT = bez(0.65, 0, 0.35, 1)
FPS = 30


def path(sec, keys, dur=1.25, ease=NEEDLE):
    # keys: [(time, price)], each move eases from the previous price with the needle's spring
    p = keys[0][1]
    for k, (t, v) in enumerate(keys[1:], 1):
        if sec >= t:
            prev = keys[k - 1][1]
            p = prev + (v - prev) * ease(clamp((sec - t) / dur))
    return p


def digits(sec, keys, dur=0.22):
    # the printed number snaps to each real price (a quick roll, no invented in-between values held on screen)
    return round(path(sec, keys, dur, OUTC))


# ----- the shots ---------------------------------------------------------------------------------------
STEPS = [(0.0, 50.0), (0.9, 25.0874), (1.5, 27.9936), (2.1, 17.7651), (2.7, 14.0457), (3.3, 23.1763), (3.9, 11.6287), (4.5, 9.9804)]
SHOTS = {
    # B1 the dial wakes: dark, a light rakes the face, the needle rises from rest to 23%
    'wake': dict(frames=120, keys=[(0.0, 0.0), (1.1, 23.1763)], wake=(0.15, 1.3), sweep=(0.1, 2.9)),
    # B2 the free $1: macro on the needle, 23% to 12%
    'swing': dict(frames=96, keys=[(0.0, 23.1763), (0.7, 11.6287)]),
    # B3 seven bets, the real path from 50 to 10
    'steps': dict(frames=186, keys=STEPS),
    # B4 the end-card hero: the last move of the market, then a slow dolly under a held 10%
    'end': dict(frames=240, keys=[(0.0, 50.0), (0.5, 9.9804)]),
}
# B5 the verdict: three stamps land on a plate at the moments the voice says "False"
HITS = [(0.6, 'DeepSeek V4.1', '8.0 s', 0), (1.6, 'Qwen 3.8', '9.8 s', 1), (3.7, 'GLM 5.3', '16.7 s', 2)]
SHOTS['stamps'] = dict(frames=168, keys=[(0.0, 10.0)])
# v6: the market, full frame: the dial wakes onto 23%, holds while the voice sets the idea, then the free $1 on No
# swings it to 11.63% (the tap is 6.11 s into the plate, from scripts/mix.py)
SHOTS['market'] = dict(frames=310, keys=[(0.0, 0.0), (0.5, 23.1763), (6.26, 11.6287)], wake=(0.15, 1.2), sweep=(0.1, 2.6))
S = SHOTS[SHOT]


# ----- scene -------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
s.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA', 'NONE'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type != 'CPU']
        if devs or kind == 'NONE':
            for d in prefs.devices:
                d.use = d.type == 'OPTIX'
            s.cycles.device = 'GPU' if devs else 'CPU'
            print('render device', kind, [d.name for d in prefs.devices if d.use])
            break
    except Exception as e:
        print('device', kind, e)
s.cycles.samples = SAMPLES
s.cycles.use_adaptive_sampling = False
s.cycles.use_denoising = True
s.cycles.denoiser = 'OPTIX'
s.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
s.cycles.seed = 7  # a fixed seed: the denoiser then does not boil from frame to frame
s.cycles.use_animated_seed = False
s.cycles.max_bounces = 6
s.cycles.caustics_reflective = False
s.cycles.caustics_refractive = False
s.render.use_persistent_data = True
s.render.resolution_x, s.render.resolution_y = (1080, 1920) if TALL else (1920, 1080)
s.render.fps = FPS
s.view_settings.view_transform = 'Standard'
s.view_settings.look = 'None'
s.render.image_settings.file_format = 'PNG'
s.render.image_settings.color_mode = 'RGBA' if LIGHT else 'RGB'
s.render.film_transparent = LIGHT
s.render.image_settings.compression = 40


def mat(name, base, metallic=0.0, rough=0.4, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    def put(k, v):
        if k in b.inputs:
            b.inputs[k].default_value = v
    put('Base Color', (*base, 1))
    put('Metallic', metallic)
    put('Roughness', rough)
    put('Coat Weight', coat)
    if emit:
        put('Emission Color', (*emit, 1))
        put('Emission Strength', strength)
    return m


def radial_brushed(name, base, rough, aniso):
    # The machined face: anisotropic metal whose grain runs round the axis, which gives the conic
    # highlights of the kit's dial.webp, plus a fine ring grain in the roughness.
    m = mat(name, base, 1.0, rough)
    t = m.node_tree
    b = t.nodes.get('Principled BSDF')
    b.inputs['Anisotropic'].default_value = aniso
    tan = t.nodes.new('ShaderNodeTangent')
    tan.direction_type = 'RADIAL'
    tan.axis = 'Z'
    t.links.new(tan.outputs['Tangent'], b.inputs['Tangent'])
    tc = t.nodes.new('ShaderNodeTexCoord')
    grad = t.nodes.new('ShaderNodeTexWave')
    grad.wave_type = 'RINGS'
    grad.rings_direction = 'Z'
    grad.inputs['Scale'].default_value = 90
    grad.inputs['Distortion'].default_value = 2.5
    grad.inputs['Detail'].default_value = 6
    t.links.new(tc.outputs['Object'], grad.inputs['Vector'])
    r = t.nodes.new('ShaderNodeMapRange')
    r.inputs['To Min'].default_value = rough - 0.05
    r.inputs['To Max'].default_value = rough + 0.05
    t.links.new(grad.outputs['Fac'], r.inputs['Value'])
    t.links.new(r.outputs['Result'], b.inputs['Roughness'])
    return m


def cyl(name, r, depth, z, material, verts=256, bevel=0.0, segs=4):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(0, 0, z))
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    if bevel:
        m = o.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'ANGLE'
    o.data.materials.append(material)
    return o


def area(loc, target, size, energy, color=(1, 1, 1), name='a'):
    d = bpy.data.lights.new(name, 'AREA')
    d.size = size
    d.energy = energy
    d.color = color
    o = bpy.data.objects.new(name, d)
    s.collection.objects.link(o)
    o.location = loc
    aim(o, target)
    return o


def aim(o, target):
    from mathutils import Vector
    d = Vector(target) - Vector(o.location)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


# world and table: near-black, the kit's --bg, so the plates melt into the graphite stage
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.0035, 0.0048, 0.0065, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
s.world = w
if LIGHT:
    # the kit's soft white cyclorama (studio_world in _pr/blender-pulse.py): bright above, falling off below
    n_ = w.node_tree
    tc_ = n_.nodes.new('ShaderNodeTexCoord')
    sep_ = n_.nodes.new('ShaderNodeSeparateXYZ')
    ramp_ = n_.nodes.new('ShaderNodeValToRGB')
    map_ = n_.nodes.new('ShaderNodeMapRange')
    map_.inputs['From Min'].default_value = -1
    map_.inputs['From Max'].default_value = 1
    n_.links.new(tc_.outputs['Generated'], sep_.inputs[0])
    n_.links.new(sep_.outputs['Y'], map_.inputs['Value'])
    n_.links.new(map_.outputs['Result'], ramp_.inputs['Fac'])
    c_ = ramp_.color_ramp
    c_.elements[0].position = 0.0
    c_.elements[0].color = (0.5, 0.5, 0.52, 1)
    c_.elements[1].position = 1.0
    c_.elements[1].color = (1.0, 1.0, 1.0, 1)
    m_ = c_.elements.new(0.5)
    m_.color = (0.68, 0.68, 0.69, 1)
    n_.links.new(ramp_.outputs['Color'], n_.nodes['Background'].inputs[0])
    n_.nodes['Background'].inputs[1].default_value = 0.66
table = mat('table', (0.0022, 0.0028, 0.004), 0.0, 0.5)
table.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.0 if TALL else 0.12
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.3))
bpy.context.object.data.materials.append(table)
if LIGHT:
    bpy.context.object.is_shadow_catcher = True  # the ground is the page's own white; only the soft shadow is kept
    table.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.92, 0.925, 0.935, 1)  # what the bezel reflects

face = radial_brushed('face', (0.13, 0.142, 0.165), 0.3, 0.82)
bezel = mat('bezel', (0.2, 0.21, 0.235), 1.0, 0.14)
well = mat('well', (0.012, 0.013, 0.016), 0.9, 0.5)
tick = mat('tick', (0.75, 0.8, 0.85), 0.0, 0.3, emit=(0.8, 0.86, 0.92), strength=0.5)
tick2 = mat('tick2', (0.3, 0.33, 0.37), 0.0, 0.4, emit=(0.5, 0.55, 0.6), strength=0.16)
glass_ring = mat('ring', (0.03, 0.035, 0.04), 1.0, 0.08)
cyan = (0.0, 0.84, 1.0)  # #00ECFF in linear
needle_m = mat('needle', (0.0, 0.4, 0.5), 0.0, 0.3, emit=cyan, strength=2.2)
core_m = mat('core', (0.0, 0.4, 0.5), 0.0, 0.3, emit=cyan, strength=3.0)
hub_m = mat('hub', (0.13, 0.135, 0.15), 1.0, 0.22)
ink = mat('ink', (0.9, 0.92, 0.95), 0.0, 0.5, emit=(0.96, 0.97, 0.98), strength=1.05)
ink2 = mat('ink2', (0.6, 0.63, 0.66), 0.0, 0.5, emit=(0.72, 0.75, 0.79), strength=0.72)

if LIGHT:
    # dial_light() in _pr/blender-pulse.py: ceramic face, brushed aluminium bezel, graphite ticks
    face = mat('face', (0.95, 0.953, 0.96), 0.0, 0.34, coat=0.4)
    bezel = mat('bezel', (0.74, 0.755, 0.78), 1.0, 0.22)
    bezel.node_tree.nodes['Principled BSDF'].inputs['Anisotropic'].default_value = 0.8
    glass_ring = mat('lip', (0.86, 0.87, 0.89), 1.0, 0.08)
    well = mat('well', (0.1, 0.11, 0.125), 0.8, 0.36)
    tick = mat('tick', (0.009, 0.011, 0.015), 0.0, 0.4, coat=0.2)
    tick2 = mat('tick2', (0.07, 0.078, 0.09), 0.0, 0.45)
    # the needle keeps the mark's light-ground cyan (#00B7C7 in logo/mark.svg), lit from inside just enough to sing
    needle_m = mat('needle', (0.0, 0.36, 0.45), 0.0, 0.34, emit=(0.0, 0.72, 0.86), strength=0.62)
    core_m = mat('core', (0.0, 0.36, 0.45), 0.0, 0.34, emit=(0.0, 0.72, 0.86), strength=0.72)
    for m in (needle_m, core_m):
        m.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.25
    hub_m = mat('hub', (0.78, 0.79, 0.81), 1.0, 0.16)
    ink = mat('ink', (0.0056, 0.0080, 0.013), 0.0, 0.75)
    ink2 = mat('ink2', (0.06, 0.07, 0.085), 0.0, 0.75)
    for m in (ink, ink2, tick, tick2):
        m.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.08

cyl('body', 1.0, 0.3, -0.15, bezel, bevel=0.035, segs=6)
cyl('lip', 0.965, 0.03, 0.012, glass_ring, bevel=0.01)
cyl('well', 0.935, 0.05, 0.003, well, bevel=0.008)
cyl('face', 0.905, 0.06, 0.012, face, bevel=0.006)
for i in range(51):
    p = i / 50
    th = math.radians(-120 + 240 * p)
    major = i % 5 == 0
    ln = 0.095 if major else 0.05
    wd = 0.0135 if major else 0.0065
    r = 0.87 - ln / 2
    bpy.ops.mesh.primitive_cube_add(size=1, location=(r * math.sin(th), r * math.cos(th), 0.046))
    o = bpy.context.object
    o.scale = (wd, ln, 0.006)
    o.rotation_euler = (0, 0, -th)
    o.data.materials.append(tick if major else tick2)

# the needle: the kit's tapered path, extruded, on its pivot at the origin
def needle_mesh():
    me = bpy.data.meshes.new('needle')
    L, B, T, H = 0.81, 0.05, 0.016, 0.012
    verts, faces = [], []
    prof = [(-B, 0), (B, 0), (T, L), (0.0, L + 0.012), (-T, L)]
    for z in (-H, H):
        verts += [(x, y, z) for x, y in prof]
    n = len(prof)
    faces.append(list(range(n - 1, -1, -1)))
    faces.append(list(range(n, 2 * n)))
    for a in range(n):
        b = (a + 1) % n
        faces.append([a, b, b + n, a + n])
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new('needle', me)
    s.collection.objects.link(o)
    me.materials.append(needle_m)
    m = o.modifiers.new('b', 'BEVEL')
    m.width = 0.004
    m.segments = 2
    return o


needle = needle_mesh()
needle.location = (0, 0, 0.085)
hub = cyl('hub', 0.115, 0.1, 0.1, hub_m, bevel=0.03, segs=6)
core = cyl('core', 0.042, 0.03, 0.15, core_m, verts=64, bevel=0.012)


def text(body, font, size, x, y, material, align='CENTER'):
    c = bpy.data.curves.new('t', 'FONT')
    c.body = body
    c.font = bpy.data.fonts.load(font, check_existing=True)
    c.size = size
    c.align_x = align
    c.align_y = 'CENTER'
    c.extrude = 0.0015
    o = bpy.data.objects.new('t', c)
    s.collection.objects.link(o)
    o.location = (x, y, 0.046)
    c.materials.append(material)
    return o


GS = os.path.join(HERE, 'fonts', 'GeneralSans-700.ttf')
GE = os.path.join(HERE, 'fonts', 'Geist-500.ttf')
num = text('23', GS, 0.5, -0.06, -0.42, ink, 'RIGHT')
num.data.space_character = 0.94
pct = text('%', GS, 0.26, -0.05, -0.47, ink, 'LEFT')
lab = text('chance it’s true', GE, 0.082, 0, -0.71, ink2)
# the scale's 0 and 100 sit just past the sweep's ends, well inside the bezel (v4's sat under its lip)
s0 = text('0', GE, 0.085, -0.64, -0.47, ink2)
s100 = text('100', GE, 0.085, 0.64, -0.47, ink2)

# ----- the verdict plate -------------------------------------------------------------------------------
stamp_sets = []
if SHOT == 'stamps':
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'FONT') and o.name != 'Plane':
            o.hide_render = True
    red = (1.0, 0.162, 0.168)  # the kit's --no
    if LIGHT:
        # on white the plate is the page: the shadow catcher rises to the stamps' level
        for o in bpy.data.objects:
            if o.name == 'Plane':
                o.location.z = 0.0
    else:
        plate = radial_brushed('plate', (0.05, 0.055, 0.066), 0.36, 0.0)
        bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
        bpy.context.object.data.materials.append(plate)
    def stamp_mat(n):
        if LIGHT:
            m = mat(n, (0.58, 0.016, 0.024), 0.0, 0.42)  # --no on white, #C9222B
            m.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.2
            return m
        return mat(n, (0.55, 0.06, 0.07), 0.0, 0.32, emit=red, strength=0.5, coat=0.5)
    def rounded(w, h, r, n=10):
        pts = []
        for (cx, cy, a0) in ((w - r, h - r, 0), (-w + r, h - r, 90), (-w + r, -h + r, 180), (w - r, -h + r, 270)):
            for i in range(n + 1):
                a = math.radians(a0 + 90 * i / n)
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        return pts
    def frame_obj(w, h, t, material):
        c = bpy.data.curves.new('fr', 'CURVE')
        c.dimensions = '2D'
        c.fill_mode = 'BOTH'
        c.extrude = 0.03
        c.bevel_depth = 0.006
        c.bevel_resolution = 3
        for loop in (rounded(w, h, 0.09), rounded(w - t, h - t, 0.06)):
            sp = c.splines.new('POLY')
            sp.points.add(len(loop) - 1)
            for i, (x, y) in enumerate(loop):
                sp.points[i].co = (x, y, 0, 1)
            sp.use_cyclic_u = True
        o = bpy.data.objects.new('fr', c)
        s.collection.objects.link(o)
        c.materials.append(material)
        return o
    if TALL:
        rows, sx, nx, sz, ns, ts = (1.75, 0.0, -1.75), 0.72, -1.72, 0.54, 0.3, 0.21
    else:
        rows, sx, nx, sz, ns, ts = (1.25, 0.0, -1.25), 1.75, -3.45, 0.7, 0.46, 0.27
    for t, name, secs, i in HITS:
        y = rows[i]
        m = stamp_mat(f'st{i}')
        word = text('FALSE', GS, sz, 0, -0.012, m)
        word.data.extrude = 0.03
        word.data.bevel_depth = 0.004
        word.data.space_character = 1.04
        word.location = (0, -0.03, 0)
        bw, bh = sz * 1.62, sz * 0.62
        fr = frame_obj(bw, bh, 0.05, m)
        pivot = bpy.data.objects.new('pv', None)
        s.collection.objects.link(pivot)
        word.parent = pivot
        fr.parent = pivot
        pivot.location = (sx, y, 0.02)
        pivot.rotation_euler = (0, 0, math.radians(3.5))
        nm = text(name, GS, ns, nx, y + (0.13 if not TALL else 0.11), ink, 'LEFT')
        tm = text(secs, GE, ts, nx, y - (0.26 if not TALL else 0.2), ink2, 'LEFT')
        tm.data.extrude = 0.0015
        for o in (word, fr, nm, tm):
            o.hide_render = False
        if LIGHT:
            # the names are set by the film as crisp type (src/film/shots.tsx); only the stamps have weight
            nm.hide_render = True
            tm.hide_render = True
        lamp = bpy.data.lights.new('hit', 'POINT')
        lamp.color = red
        lamp.energy = 0
        lamp.shadow_soft_size = 0.8
        lo = bpy.data.objects.new('hit', lamp)
        s.collection.objects.link(lo)
        lo.location = (sx, y, 0.7)
        stamp_sets.append(dict(t=t, pivot=pivot, y=y, sx=sx, nm=nm, tm=tm, word=word, fr=fr, m=m, lamp=lamp, i=i))

# ----- camera and light, per shot ----------------------------------------------------------------------
cd = bpy.data.cameras.new('c')
cam = bpy.data.objects.new('c', cd)
s.collection.objects.link(cam)
s.camera = cam
cd.dof.use_dof = True
cd.sensor_fit = 'HORIZONTAL'

KEYS = dict(key=300, top=90, fill=60, rim=130, sweep=900, endsweep=320)
if LIGHT:
    KEYS = dict(key=105, top=26, fill=14, rim=14, sweep=190, endsweep=80)
key = area((-2.6, 2.8, 3.2), (0, 0, 0), 3.4 if not LIGHT else 5.0, 300, (0.92, 0.96, 1) if not LIGHT else (1, 0.985, 0.965), 'key')
rim = area((3.0, -2.6, 1.6), (0, 0, 0), 1.8, 130, (0.45, 0.9, 1), 'rim')
top = area((0, 3.4, 0.8), (0, 0, 0), 4, 90, (1, 1, 1), 'top')
fill = area((-3.2, -2.4, 1.2), (0, 0, 0), 2.4, 60, (0.85, 0.9, 1), 'fill')
sweep = area((-7, -2.5, 2.2), (0, 0, 0), 1.0, 0, (0.9, 0.96, 1), 'sweep')
sweep.data.shape = 'RECTANGLE'
sweep.data.size_y = 9


def lerp(a, b, k):
    return a + (b - a) * k


def vlerp(a, b, k):
    return tuple(lerp(x, y, k) for x, y in zip(a, b))


def camera_at(sec):
    n = S['frames'] / FPS
    k = sec / n
    sm = INOUT(k)
    if SHOT == 'wake':
        cd.lens = 70
        cam.location = vlerp((-2.9, -3.1, 1.55), (-2.15, -2.45, 1.75), sm)
        tgt = vlerp((0.1, 0.1, 0.04), (0.02, 0.06, 0.05), sm)
        focus, stop = (0.0, 0.0, 0.09), 0.55
        shift = (0, 0)
    elif SHOT == 'swing':
        cd.lens = 85
        cam.location = vlerp((-1.0, -2.05, 1.45), (-1.42, -1.75, 1.32), sm)
        tgt = vlerp((-0.34, -0.1, 0.05), (-0.38, -0.12, 0.05), sm)
        focus, stop = (-0.3, 0.0, 0.09), 0.5
        shift = (0, 0)
    elif SHOT == 'steps':
        cd.lens = 52
        cam.location = vlerp((1.9, -3.6, 3.4), (0.95, -2.95, 3.95), sm)
        if TALL:
            cam.location = tuple(c * 0.74 for c in cam.location)
        tgt = (0, -0.06, 0)
        focus, stop = (0, -0.05, 0.05), 0.9
        shift = (0.15, 0) if not TALL else (0, -0.3)
    elif SHOT == 'market':
        cd.lens = 60
        d = lerp(1.32, 1.24, OUTC(k)) * (0.56 if TALL else 1.0)
        cam.location = (lerp(-0.35, -0.15, sm) * d, lerp(-1.9, -1.6, sm) * d, 5.1 * d)
        tgt = (0, -0.02, 0)
        focus, stop = (0, 0, 0.05), 1.4
        shift = (-0.215, 0) if not TALL else (0, 0.02)
    elif SHOT == 'stamps':
        cd.lens = 50
        shake = 0.0
        sx_, sy_ = 0.0, 0.0
        for st in stamp_sets:
            dt = sec - st['t']
            if dt >= 0:
                amp = (0.05 if st['i'] < 2 else 0.11) * math.exp(-dt * 11)
                sx_ += amp * math.sin(dt * 71 + st['i'])
                sy_ += amp * math.cos(dt * 83 + st['i'] * 2)
        dist = lerp(1.045, 1.0, OUTC(k))
        base = (0.0, -1.45, 10.8) if not TALL else (0.0, -1.1, 7.2)
        cam.location = (base[0] + sx_, base[1] * dist + sy_, base[2] * dist)
        tgt = (sx_ * 0.5, 0.0, 0.0)
        focus, stop = (0.0, 0.0, 0.05), 2.2
        shift = (0, 0)
    else:  # end
        cd.lens = 60
        d = lerp(1.38, 1.22, OUTC(k)) * (0.74 if TALL else 1.0)
        cam.location = (lerp(0.45, 0.0, sm) * d, lerp(-2.0, -1.5, sm) * d, 5.1 * d)
        tgt = (0, -0.02, 0)
        focus, stop = (0, 0, 0.05), 1.4
        shift = (0.21, 0) if not TALL else (0, -0.42)
    cam.location = tuple(cam.location)
    aim(cam, tgt)
    cd.shift_x, cd.shift_y = shift
    from mathutils import Vector
    cd.dof.focus_distance = (Vector(focus) - Vector(cam.location)).length
    cd.dof.aperture_fstop = stop


def apply(frame):
    sec = (frame - 1) / FPS
    camera_at(sec)
    p = path(sec, S['keys']) / 100
    needle.rotation_euler = (0, 0, -math.radians(-120 + 240 * p))
    v = digits(sec, S['keys'])
    if SHOT == 'wake':
        v = round(S['keys'][-1][1])
    if SHOT == 'market' and sec < 6.26:
        v = 23  # the face lights up on the live price only
    num.data.body = str(int(v))
    # the wake: everything printed and lit fades up with the light
    w = 1.0
    if 'wake' in S:
        a, b = S['wake']
        w = OUTC(clamp((sec - a) / (b - a)))
    def st(m, val):
        m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = val
    if not LIGHT:
        st(tick, 0.5 * w)
        st(tick2, 0.16 * w)
        st(needle_m, 2.2 * (0.06 + 0.94 * w))
        st(core_m, 3.0 * (0.06 + 0.94 * w))
    lit = clamp((w - 0.6) / 0.4)
    if SHOT in ('wake', 'market'):
        lit = OUTC(clamp((sec - 1.55) / 0.5))  # the number appears once the needle has settled on 23%
    if LIGHT:
        # printed ink cannot glow on: it fades in from the ceramic
        for m, c in ((ink, (0.0056, 0.0080, 0.013)), (ink2, (0.06, 0.07, 0.085))):
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*vlerp((0.95, 0.953, 0.96), c, lit), 1)
    else:
        st(ink, 1.05 * lit)
        st(ink2, 0.72 * lit)
    for l, nm in ((key, 'key'), (top, 'top'), (fill, 'fill'), (rim, 'rim')):
        base = KEYS[nm]
        l.data.energy = base * (0.05 + 0.95 * w) if ('wake' in S and not LIGHT) else base
    if SHOT == 'stamps':
        for st in stamp_sets:
            dt = sec - st['t']
            drop = 0.13  # seconds in the air
            big = 1.5 if st['i'] == 2 else 1.0
            visible = dt > -drop
            for o in (st['word'], st['fr']):
                o.hide_render = not visible
            st['tm'].hide_render = LIGHT or dt < 0.02
            if dt < 0:
                z = 3.6 * (dt / -drop) ** 2 + 0.02
            else:
                z = 0.02
            st['pivot'].location = (st['sx'], st['y'], z)
            sq = 1.0 + (0.05 * math.exp(-dt * 16) if dt >= 0 else 0.1)
            st['pivot'].scale = (sq, sq, 1.0)
            flash = math.exp(-max(dt, 0) * 5.5) if dt >= 0 else 0
            if not LIGHT:
                st['m'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 0.42 + 2.4 * big * flash
                st['lamp'].energy = 260 * big * flash
            lit = clamp((dt + 0.02) / 0.1)
        st_w = 1.0
        for l, base in ((key, 60), (top, 22), (fill, 22), (rim, 40)):
            l.data.energy = base if not LIGHT else base * 2.1
        if LIGHT:
            # a big overhead source: the stamps sit tight on the page with one soft contact shadow, no doubled edge
            key.location = (-1.2, 1.4, 8.0)
            aim(key, (0, 0, 0))
            key.data.size = 11
            rim.data.energy = 0
        st_val = 1.05
    if 'sweep' in S:
        a, b = S['sweep']
        k = clamp((sec - a) / (b - a))
        sweep.location = (lerp(-6.5, 6.5, INOUT(k)), -2.2, 2.2)
        aim(sweep, (0, 0, 0))
        sweep.data.energy = KEYS['sweep'] * math.sin(math.pi * k) ** 0.7
    elif SHOT == 'end':
        # one slow pass of light over the machined face while the dial holds still
        k = clamp((sec - 2.0) / 5.5)
        sweep.location = (lerp(-6.5, 6.5, INOUT(k)), -2.2, 2.2)
        aim(sweep, (0, 0, 0))
        sweep.data.energy = KEYS['endsweep'] * math.sin(math.pi * k)


# ----- render, one file per frame, skipping what is already on disk ------------------------------------
os.makedirs(OUT, exist_ok=True)
if FRAMES:
    if '-' in FRAMES:
        a, b = FRAMES.split('-')
        todo = range(int(a), int(b) + 1)
    else:
        todo = [int(x) for x in FRAMES.split(',')]
else:
    todo = range(1, S['frames'] + 1)
import time
for f in todo:
    path_png = os.path.join(OUT, f'{f:04d}.png')
    if os.path.exists(path_png) and os.path.getsize(path_png) > 1000:
        continue
    t0 = time.time()
    s.frame_set(f)
    apply(f)
    s.render.filepath = path_png + '.tmp.png'
    bpy.ops.render.render(write_still=True)
    os.replace(path_png + '.tmp.png', path_png)  # a stopped render never leaves a half-written frame
    print(f'FRAME {SHOT} {ASPECT} {f} {time.time() - t0:.1f}s', flush=True)
print('blender done', flush=True)
