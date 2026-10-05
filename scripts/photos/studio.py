"""Shared studio setup for photoreal product renders (Blender / bpy, Cycles on CPU)."""
import bpy, math, os
from mathutils import Vector

W, H = 1200, 900


def reset(bg=(0.93, 0.92, 0.90), samples=110):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 10
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.transmission_bounces = 12
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy'
    sc.view_settings.exposure = 0.0
    world = bpy.data.worlds.new('w'); sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (*[c * 0.6 for c in bg], 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.12
    backdrop(bg)
    lights()
    return sc


def mat(name, color=(0.8, 0.8, 0.8), rough=0.4, metal=0.0, trans=0.0, ior=1.45, coat=0.0, alpha=1.0, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Transmission Weight'].default_value = trans
    b.inputs['IOR'].default_value = ior
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Alpha'].default_value = alpha
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    return m


def image_mat(name, path, rough=0.35, coat=0.0, metal=0.0, emit=0.0):
    """Material printed with an image (labels, screens, covers). UVs decide placement."""
    m = mat(name, rough=rough, coat=coat, metal=metal)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(path)
    tex.extension = 'CLIP'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if emit:
        nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emit
    return m


def backdrop(color):
    """Seamless sweep: floor that curves up into a back wall."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    o = bpy.context.object; o.name = 'sweep'
    me = o.data
    import bmesh
    bm = bmesh.new()
    rows = []
    for i in range(41):
        t = i / 40
        a = t * math.pi / 2
        r = 3.0
        if t < 0.5:
            y, z = -12 + (12 * t / 0.5), 0
        else:
            k = (t - 0.5) / 0.5
            y, z = math.sin(k * math.pi / 2) * r, (1 - math.cos(k * math.pi / 2)) * r
        rows.append([bm.verts.new((x, y, z)) for x in (-14, 14)])
    top = [bm.verts.new((x, 3.0, 14)) for x in (-14, 14)]
    rows.append(top)
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o.data.materials.append(mat('backdrop', color, rough=0.9))
    o.location.y = 2.2


def area(loc, size, power, color=(1, 1, 1), target=(0, 0, 0.6)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l = bpy.context.object; l.data.size = size; l.data.energy = power; l.data.color = color
    d = Vector(target) - Vector(loc)
    l.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return l


def lights():
    area((-3.2, -3.0, 3.6), 3.0, 650)          # key softbox
    area((3.6, -2.4, 2.4), 2.5, 160, (0.98, 0.99, 1.0))  # fill
    area((0.5, 2.8, 4.2), 2.0, 450)            # rim from behind
    area((0, -1.5, 6), 4.0, 60)               # top


def camera(loc=(0, -6.2, 1.9), target=(0, 0, 0.75), lens=70):
    bpy.ops.object.camera_add(location=loc)
    c = bpy.context.object; c.data.lens = lens
    d = Vector(target) - Vector(loc)
    c.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = c
    return c


def bevel(o, w=0.02, seg=4):
    m = o.modifiers.new('bevel', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'
    return m


def smooth(o):
    for p in o.data.polygons: p.use_smooth = True


def render(out):
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)


def lathe(name, profile, seg=96, material=None):
    """Revolve a list of (radius, z) points around the Z axis."""
    import bmesh
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-5:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    smooth(o)
    if material: o.data.materials.append(material)
    return o


def label_band(name, radius, z0, z1, path, arc=1.0, start=-90, seg=128, rough=0.35, coat=0.0):
    """A printed wrap-around label: open cylinder band with the image mapped across `arc` of the circumference, facing the camera."""
    import bmesh
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    n = max(8, int(seg * arc))
    span = 2 * math.pi * arc
    a0 = math.radians(start) - span / 2
    cols = []
    for i in range(n + 1):
        a = a0 + span * i / n
        cols.append((bm.verts.new((radius * math.cos(a), radius * math.sin(a), z0)), bm.verts.new((radius * math.cos(a), radius * math.sin(a), z1)), i / n))
    for (a0v, a1v, u0), (b0v, b1v, u1) in zip(cols, cols[1:]):
        f = bm.faces.new((a0v, b0v, b1v, a1v))
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            loop[uv].uv = (u, v)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    smooth(o)
    o.data.materials.append(image_mat(name, path, rough=rough, coat=coat))
    return o


def rrect_pts(w, h, r, n=12):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def slab(name, w, h, t, r, edge=0.02, material=None):
    """Rounded-rectangle slab lying in XZ (faces toward -Y), thickness t along Y, centred at origin."""
    import bmesh
    bm = bmesh.new()
    pts = rrect_pts(w, h, r)
    front = [bm.verts.new((x, -t / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, t / 2, z)) for x, z in pts]
    bm.faces.new(front[::-1]); bm.faces.new(back)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    if edge:
        m = o.modifiers.new('bevel', 'BEVEL'); m.width = edge; m.segments = 6; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(50)
        o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    smooth(o)
    if material: o.data.materials.append(material)
    return o


def panel(name, w, h, r, y, path, emit=0.0, rough=0.08, coat=1.0, flip=False):
    """Flat rounded-rect face (screen, cover, label) in XZ at depth y, with the image fitted to it."""
    import bmesh
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    pts = rrect_pts(w, h, r)
    vs = [bm.verts.new((x, y, z)) for x, z in pts]
    f = bm.faces.new(vs if flip else vs[::-1])
    for loop in f.loops:
        x, _, z = loop.vert.co
        loop[uv].uv = ((x + w / 2) / w if not flip else 1 - (x + w / 2) / w, (z + h / 2) / h)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    o.data.materials.append(image_mat(name, path, rough=rough, coat=coat, emit=emit))
    return o


def group(objs, loc=(0, 0, 0), rot=(0, 0, 0)):
    e = bpy.data.objects.new('grp', None); bpy.context.collection.objects.link(e)
    for o in objs: o.parent = e
    e.location = loc; e.rotation_euler = [math.radians(a) for a in rot]
    return e


def pouch(name, w, d, h, path, seg=64, rows=48, seal=0.12, material_back=None):
    """Stand-up pouch / sack: lofted soft box, flat sealed top, artwork wrapped over the front half."""
    import bmesh
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    rings = []
    for j in range(rows + 1):
        v = j / rows
        z = v * h
        top = max(0.0, (v - (1 - seal)) / seal)
        depth = d * (1 - top ** 0.7 * 0.97) * (0.9 + 0.1 * math.sin(v * math.pi))
        width = w * (1 + 0.04 * math.sin(v * math.pi)) * (1 - 0.02 * top)
        ring = []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            c, s = math.cos(t), math.sin(t)
            x = width / 2 * math.copysign(abs(c) ** 0.35, c)
            y = depth / 2 * math.copysign(abs(s) ** 0.6, s)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for j in range(rows):
        for i in range(seg):
            k = (i + 1) % seg
            f = bm.faces.new((rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]))
            for loop in f.loops:
                x, y, z = loop.vert.co
                loop[uv].uv = (0.5 - x / w if y > 0 else 0.5 + x / w, z / h) if False else ((x / w + 0.5), z / h)
            f.material_index = 0 if all(l.vert.co.y < 1e-6 for l in f.loops) else 1
    bot = bm.faces.new(rings[0][::-1]); bot.material_index = 1
    tp = bm.faces.new(rings[-1]); tp.material_index = 1
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    smooth(o)
    o.data.materials.append(image_mat(name + '_front', path, rough=0.42, coat=0.35))
    o.data.materials.append(material_back or mat(name + '_back', (0.85, 0.82, 0.74), rough=0.5, coat=0.3))
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = 1; m.render_levels = 2
    return o


def grains(name, surface, count, size, material, seed=1):
    """Scatter little grains (rice, lentils, sugar...) over a surface object via an object-instancing particle system."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1)
    g = bpy.context.object; g.name = name + '_grain'
    g.scale = (size * 0.26, size * 0.26, size); g.data.materials.append(material); smooth(g)
    g.location = (0, 0, -50)
    ps = surface.modifiers.new(name, 'PARTICLE_SYSTEM').particle_system
    st = ps.settings
    st.type = 'HAIR'; st.count = count; st.hair_length = 1
    st.render_type = 'OBJECT'; st.instance_object = g
    st.use_rotations = True; st.rotation_mode = 'NOR'; st.rotation_factor_random = 1.0; st.phase_factor_random = 2.0
    st.particle_size = 1.0; st.size_random = 0.25
    st.use_advanced_hair = True
    ps.seed = seed
    surface.show_instancer_for_render = False
    return g
