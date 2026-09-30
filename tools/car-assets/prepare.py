"""Prepare licensed Sketchfab cars in an isolated Blender --background process.
Usage: blender --background --factory-startup --python prepare.py -- MODEL SOURCE OUTPUT
Sources and adaptations are documented in public/models/<model>/ATTRIBUTION.md.
"""
import sys, json, math, re
from pathlib import Path
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix

model, source, output = sys.argv[sys.argv.index('--') + 1:]
output = Path(output); output.mkdir(parents=True, exist_ok=True)
wb_target = {'shelby-gt500': 2.72, 'porsche-911-gt3': 2.457, 'mustang-fastback': 2.743, 'mclaren-mp45': 2.896}[model]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.view_layer.update()
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.materials)]
# The authored group each mesh hangs under (e.g. 'front_wheels'), kept before flattening.
for o in objects:
    o['group'] = re.sub(r'_\d+$', '', o.parent.name) if o.parent else ''
# Freeze imported transforms without retaining authoring rigs, animation or helper objects.
for o in objects:
    world = o.matrix_world.copy()
    o.data = o.data.copy()
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    o.data.transform(world)
    o.modifiers.clear()
for o in list(bpy.context.scene.objects):
    if o not in objects: bpy.data.objects.remove(o, do_unlink=True)

def points(o):
    co = np.empty(len(o.data.vertices)*3, dtype=np.float32)
    o.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)

def bounds(o):
    p = points(o)
    return p.min(axis=0), p.max(axis=0)

def center(o):
    a, b = bounds(o)
    return (a+b)/2

def material(o):
    return re.sub(r'\.\d{3}$', '', o.data.materials[0].name)

# Assign whole authored parts to wheel assemblies. The classic has four wheels
# packed into each mesh, so split its polygons spatially while retaining UVs.
wheel_parts = [[] for _ in range(4)]
calipers = [[] for _ in range(4)]
body = []
if model == 'shelby-gt500':
    keys = ['Ft.L', 'Ft.R', 'Bk.L', 'Bk.R']
    tires = [next(o for o in objects if 'Wheel.'+key+'_tire' in o.name) for key in keys]
    centers = [center(o) for o in tires]
    for o in objects:
        if 'WheelBrake.' in o.name:
            calipers[next(i for i,k in enumerate(keys) if 'WheelBrake.'+k in o.name)].append(o)
        elif 'GT500.Wheel.' in o.name:
            wheel_parts[next(i for i,k in enumerate(keys) if 'Wheel.'+k in o.name)].append(o)
        else: body.append(o)
elif model == 'porsche-911-gt3':
    tires = [o for o in objects if material(o).startswith('tire_mat')]
    tires.sort(key=lambda o: (center(o)[1] > 0, center(o)[0] < 0))
    assert len(tires) == 4
    centers = [center(o) for o in tires]
    for o in objects:
        lo, hi = bounds(o); c = (lo+hi)/2
        index = min(range(4), key=lambda i: np.linalg.norm(c[1:] - centers[i][1:]) + abs(c[0]-centers[i][0]))
        wc = centers[index]
        wheel = abs(c[0]) > .70 and abs(c[1]-wc[1]) < .26 and abs(c[2]-wc[2]) < .34 and hi[1]-lo[1] < 1.1 and hi[2] < .91
        if wheel:
            (calipers if abs(c[1]-wc[1]) > .09 else wheel_parts)[index].append(o)
        else: body.append(o)
else:
    # Mustang: four wheels packed in each wheel mesh. McLaren: one mesh per axle.
    is_wheel = (lambda o: o['group'] in ('front_wheels', 'back_wheels')) if model == 'mclaren-mp45' else (lambda o: material(o) == 'FordMustangWheels_MTL')
    for o in objects:
        if not is_wheel(o):
            body.append(o); continue
        for i in range(4):
            mesh = o.data.copy()
            bm = bmesh.new(); bm.from_mesh(mesh)
            discard = []
            for f in bm.faces:
                c = f.calc_center_median()
                index = (0 if c.y < 0 else 2) + (0 if c.x > 0 else 1)
                if index != i: discard.append(f)
            bmesh.ops.delete(bm, geom=discard, context='FACES')
            bm.to_mesh(mesh); bm.free()
            if not mesh.polygons: bpy.data.meshes.remove(mesh); continue
            part = bpy.data.objects.new(f'wheel_{i}_{o.name}', mesh)
            bpy.context.collection.objects.link(part); wheel_parts[i].append(part)
        bpy.data.objects.remove(o, do_unlink=True)
    centers = []
    tires = []
    tread = []
    for parts in wheel_parts:
        lo = np.min([bounds(o)[0] for o in parts], axis=0)
        hi = np.max([bounds(o)[1] for o in parts], axis=0)
        c = (lo+hi)/2
        if model == 'mclaren-mp45':
            # the rear wheel meshes carry the driveshafts in to the gearbox: find the tyre
            # (everything far from the axle) and take the wheel's centre and width from it
            co = np.concatenate([points(o) for o in parts])
            rad = np.hypot(co[:, 1]-c[1], co[:, 2]-c[2])
            tyre = co[rad > .8*rad.max()]
            c[0] = (tyre[:, 0].min()+tyre[:, 0].max())/2
            tread.append(float(tyre[:, 0].max()-tyre[:, 0].min()))
        centers.append(c)
        tires.append(parts[0])

assert all(wheel_parts), 'All four authored wheel assemblies must be present'
front_y = sum(c[1] for c in centers[:2])/2
rear_y = sum(c[1] for c in centers[2:])/2
scale = wb_target/(rear_y-front_y)
mid_y = (front_y+rear_y)/2
radii = []
widths = []
for i, parts in enumerate(wheel_parts):
    # Tyres are separate on modern cars; use the full wheel bounds on the classic.
    measures = [tires[i]] if model not in ('mustang-fastback', 'mclaren-mp45') else parts
    lo = np.min([bounds(o)[0] for o in measures], axis=0)
    hi = np.max([bounds(o)[1] for o in measures], axis=0)
    radii.append(float(max(hi[1]-lo[1], hi[2]-lo[2])/2*scale))
    widths.append(float((tread[i] if model == 'mclaren-mp45' else hi[0]-lo[0])*scale))
rF, rR = sum(radii[:2])/2, sum(radii[2:])/2
trackF = float(abs(centers[0][0]-centers[1][0])*scale)
trackR = float(abs(centers[2][0]-centers[3][0])*scale)
ground = sum(c[2]*scale-r for c,r in zip(centers,radii))/4
transform = Matrix.Translation((0, -mid_y*scale, -ground)) @ Matrix.Scale(scale, 4)
for o in body: o.data.transform(transform)

# Semantic material names let runtime paint and lamp controls remain independent.
for o in body:
    m = material(o)
    role = None
    if model == 'shelby-gt500':
        if m == 'carpaint': role = 'paint' if any(x in o.name for x in ['Body_', 'Door.', 'Trunk_', 'Bumper.', 'Hood_', 'Fender.']) else 'metal'
        elif m == 'rearlight': role = 'tail'
        elif m == 'light': role = 'head'
        elif m == 'tinted_glass': role = 'lens' if 'HeadlightGlass' in o.name else 'glass'
    elif model == 'porsche-911-gt3':
        if m == 'body': role = 'paint'
        elif m in ['r_lights', 'r_glass']: role = 'tail'
        elif m in ['lights', 'lights_glass']: role = 'head'
        elif m in ['glass', 'd_glass']: role = 'glass'
    elif model == 'mclaren-mp45':
        # the livery is one painted texture and stays as authored (not repaintable)
        if m == 'body_mat': role = 'livery'
        elif m == 'interior_mat': role = 'interior'
        elif m == 'glass_details_mat': role = 'glass' if o['group'] == 'interior_details' else 'tail'
    else:
        if m == 'FordMustang_MTL': role = 'paint-atlas'
        elif m == 'FordMustangWindow_MTL': role = 'glass-atlas'
    o['role'] = role or m

# In-car view. The driver's steering wheel becomes its own mount so the game can turn it,
# and the cabin keeps more detail than the rest of the car. Values are in game space
# (+X left, +Y up, +Z forward; Blender is (x, -z, y)): rim centre, column axis pointing at
# the driver, and the cylinder (radius, depth towards the dash / the driver) that holds it.
STEER = {
    'shelby-gt500': dict(c=(0.363, 0.845, 0.153), n=(0, 0.323, -0.946), r=0.215, dash=0.075, driver=0.07),
    'porsche-911-gt3': dict(c=(0.34, 0.786, 0.242), n=(-0.007, 0.298, -0.955), r=0.205, dash=0.075, driver=0.07),
}.get(model)
CABIN = {'porsche-911-gt3': ((-0.9, 0.3, -1.5), (0.9, 1.4, 1.0), 0.3)}.get(model)
g2b = lambda v: Vector((v[0], -v[2], v[1]))
steer_parts = []
if model == 'mclaren-mp45':
    # The steering wheel is authored as its own object: its mount frame comes from the rim
    # itself (centre, and the plane's normal, pointing back at the driver).
    steer_parts = [o for o in body if o['group'] == 'steering wheel']
    for o in steer_parts: body.remove(o)
    co = np.concatenate([points(o) for o in steer_parts])
    mid = (co.min(axis=0) + co.max(axis=0)) / 2
    axis = np.linalg.eigh(np.cov((co - co.mean(axis=0)).T))[1][:, 0]
    if axis[1] < 0: axis = -axis  # Blender +Y = rearwards, towards the driver
    STEER = dict(c=(mid[0], mid[2], -mid[1]), n=(axis[0], axis[2], -axis[1]))
    print('steering wheel centre', [round(float(v), 3) for v in STEER['c']], 'axis', [round(float(v), 3) for v in STEER['n']])
elif STEER:
    c, n = g2b(STEER['c']), g2b(STEER['n']).normalized()
    def inside(co):
        d = co - c; a = d.dot(n)
        return -STEER['dash'] <= a <= STEER['driver'] and (d - n*a).length <= STEER['r']
    for o in list(body):
        bm = bmesh.new(); bm.from_mesh(o.data)
        inner = [f for f in bm.faces if all(inside(v.co) for v in f.verts)]
        if not inner: bm.free(); continue
        mesh = o.data.copy()
        if len(inner) < len(bm.faces):
            bmesh.ops.delete(bm, geom=inner, context='FACES'); bm.to_mesh(o.data)
            bm2 = bmesh.new(); bm2.from_mesh(mesh)
            bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if not all(inside(v.co) for v in f.verts)], context='FACES')
            bm2.to_mesh(mesh); bm2.free()
        else:
            body.remove(o)
        bm.free()
        part = bpy.data.objects.new(o.name+'_steer', mesh); bpy.context.collection.objects.link(part)
        part['role'] = o.get('role'); steer_parts.append(part)
        if o not in body: bpy.data.objects.remove(o, do_unlink=True)
    print('steering wheel faces', sum(len(o.data.polygons) for o in steer_parts))

# Make normalized parent groups: Blender Z-up becomes game Y-up in the GLB.
root = bpy.data.objects.new('car', None); bpy.context.collection.objects.link(root)
body_root = bpy.data.objects.new('body', None); bpy.context.collection.objects.link(body_root); body_root.parent = root
for o in body: o.parent = body_root
names = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']
for i, parts in enumerate(wheel_parts):
    parent = bpy.data.objects.new(names[i], None); bpy.context.collection.objects.link(parent); parent.parent = root
    r = rF if i < 2 else rR
    parent.location = ((1 if i%2==0 else -1)*(trackF if i<2 else trackR)/2, (-1 if i<2 else 1)*wb_target/2, r)
    # Each wheel is centered before animation; spin is always about its local X axis.
    translate = Matrix.Translation(-Vector(centers[i]))
    resize = Matrix.Diagonal((scale, scale*r/radii[i], scale*r/radii[i], 1))
    for o in parts:
        o.data.transform(resize @ translate); o.parent = parent
        o['role'] = 'wheel'
    for o in calipers[i]:
        # The source rig has inconsistent brake pivots; center each brake explicitly.
        c = center(o)
        o.data.transform(Matrix.Scale(scale,4) @ Matrix.Translation(-Vector(c)))
        o.location = (0, r*.52, 0)
        o.parent = parent; o['role'] = 'caliper'
        o['stationary'] = True

# Steering mount: local -Y (Blender) = column axis towards the driver, so in the GLB the
# mount's +Z is the axis the game turns the wheel about.
mounts = [body_root]+[bpy.data.objects.get(n) for n in names]
if steer_parts:
    yb = -g2b(STEER['n']).normalized(); up = Vector((0, 0, 1))
    zb = (up - yb*up.dot(yb)).normalized(); xb = yb.cross(zb)
    frame = Matrix(((xb.x, yb.x, zb.x, 0), (xb.y, yb.y, zb.y, 0), (xb.z, yb.z, zb.z, 0), (0, 0, 0, 1)))
    frame.translation = g2b(STEER['c'])
    steer_root = bpy.data.objects.new('steering', None); bpy.context.collection.objects.link(steer_root); steer_root.parent = root
    steer_root.matrix_world = frame
    to_local = frame.inverted()
    for o in steer_parts:
        o.data.transform(to_local); o.parent = steer_root; o['steer'] = True
    mounts.append(steer_root)

bpy.context.view_layer.update()
budget = {'shelby-gt500': 170000, 'porsche-911-gt3': 230000, 'mustang-fastback': 190000, 'mclaren-mp45': 200000}[model]
source_tris = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')
ratio = min(1, budget/source_tris)
def simplify(obj, amount):
    lo, hi = bounds(obj)
    dec = obj.modifiers.new('Browser detail', 'DECIMATE'); dec.ratio = amount
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=dec.name)
    # Thin / non-manifold source parts can produce distant QEM outliers. Keep
    # every LOD inside its authored envelope, including tyre width and roll bars.
    co = np.clip(points(obj), lo, hi).astype(np.float32).ravel()
    obj.data.vertices.foreach_set('co', co); obj.data.update()
if CABIN:
    # Decimate each authored part before merging, so cabin parts (seen from the driver's
    # seat) keep far more detail than the underbody and engine bay.
    (x0, y0, z0), (x1, y1, z1), cabin_ratio = CABIN
    for o in body:
        count = len(o.data.polygons)
        mid = center(o)
        in_cabin = x0 <= mid[0] <= x1 and -z1 <= mid[1] <= -z0 and y0 <= mid[2] <= y1
        rr = 1 if count < 400 or o.get('role') == 'paint' else max(cabin_ratio if in_cabin else ratio, min(1, 400/count))
        if rr < .98: simplify(o, rr)
        o['pre'] = True

# Merge by semantic role AND source material; keep texture sets and lamp controls.
for parent in mounts:
    buckets = {}
    for o in list(parent.children):
        key = (o.get('role'), material(o), bool(o.get('stationary')))
        buckets.setdefault(key, []).append(o)
    for (role, mat, stationary), parts in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts: o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1: bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = f'{parent.name}_{role}_{mat}'
        merged['role'] = role; merged['stationary'] = stationary
        if parent.name == 'steering': merged['steer'] = True

# Offline LODs keep download size and draw count bounded without runtime simplification.
meshes = [o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
    count = len(o.data.polygons)
    # Avoid erasing badges, lamp internals and thin trim.
    rr = 1 if count < 400 else max(ratio, min(1, 400/count))
    # The GT3 paint shell sits close to inner panels; aggressive collapse makes
    # those surfaces intersect. Preserve its authored silhouette at close range.
    if model == 'porsche-911-gt3' and o.get('role') == 'paint': rr = 1
    # the open cockpit and the livery shell are what you look at on the single-seater
    if model == 'mclaren-mp45' and o.get('role') in ('livery', 'interior', 'glass'): rr = 1
    # parts already decimated per cabin region, and the steering wheel, keep their detail
    if o.get('pre') or o.get('steer'): rr = 1
    if rr < .98:
        simplify(o, rr)
    o['lod'] = 0
    for level, lod_ratio in [(1, .32), (2, .09)]:
        clone = o.copy(); clone.data = o.data.copy(); bpy.context.collection.objects.link(clone)
        clone.name = o.name+f'_lod{level}'; clone['lod'] = level
        if len(clone.data.polygons) > 60:
            simplify(clone, max(lod_ratio,min(1,60/len(clone.data.polygons))))
        clone.hide_render = False

# Resize only working copies of textures; downloaded sources stay unchanged.
for image in bpy.data.images:
    if image.size[0] > 2048 or image.size[1] > 2048:
        factor = 2048/max(image.size)
        image.scale(round(image.size[0]*factor),round(image.size[1]*factor)); image.pack()

all_meshes = [o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.context.view_layer.update()
world_points = [np.array([o.matrix_world @ Vector(v) for v in o.bound_box]) for o in meshes]
lo = np.min([p.min(axis=0) for p in world_points],axis=0)
hi = np.max([p.max(axis=0) for p in world_points],axis=0)
meta = dict(model=model, wheelbase=wb_target, trackF=trackF, trackR=trackR, wheelR=rF, wheelRr=rR, wheelW=sum(widths[:2])/2, wheelWr=sum(widths[2:])/2, length=float(hi[1]-lo[1]), width=float(hi[0]-lo[0]), height=float(hi[2]), frontOverhang=float(-lo[1]-wb_target/2), rearOverhang=float(hi[1]-wb_target/2), triangles={str(i):sum(len(o.data.polygons) for o in all_meshes if o['lod']==i) for i in range(3)}, sourceTriangles=source_tris)
(output/'geometry.json').write_text(json.dumps(meta,indent=2)+'\n')
# Keep preparation reproducible and export portable GLB with local Draco support.
props = bpy.ops.export_scene.gltf.get_rna_type().properties
formats = [e.identifier for e in props['export_format'].enum_items]
if formats: assert 'GLB' in formats  # Some Blender builds expose this as a dynamic enum.
# The single-seater's sixteen PNG texture maps would be ~36 MB, so it ships them as WebP.
images = dict(export_image_format='WEBP', export_image_quality=88) if model == 'mclaren-mp45' else {}
bpy.ops.export_scene.gltf(filepath=str(output/'car.glb'), export_format='GLB', export_extras=True, export_animations=False, export_skins=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, **images)
print('PREPARED',json.dumps(meta), 'bytes', (output/'car.glb').stat().st_size)
