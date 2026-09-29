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
wb_target = {'shelby-gt500': 2.72, 'porsche-911-gt3': 2.457, 'mustang-fastback': 2.743}[model]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.view_layer.update()
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.materials)]
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
    for o in objects:
        if material(o) != 'FordMustangWheels_MTL':
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
    for parts in wheel_parts:
        lo = np.min([bounds(o)[0] for o in parts], axis=0)
        hi = np.max([bounds(o)[1] for o in parts], axis=0)
        centers.append((lo+hi)/2)
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
    measures = [tires[i]] if model != 'mustang-fastback' else parts
    lo = np.min([bounds(o)[0] for o in measures], axis=0)
    hi = np.max([bounds(o)[1] for o in measures], axis=0)
    radii.append(float(max(hi[1]-lo[1], hi[2]-lo[2])/2*scale))
    widths.append(float((hi[0]-lo[0])*scale))
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
    else:
        if m == 'FordMustang_MTL': role = 'paint-atlas'
        elif m == 'FordMustangWindow_MTL': role = 'glass-atlas'
    o['role'] = role or m

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

bpy.context.view_layer.update()
# Merge by semantic role AND source material; keep texture sets and lamp controls.
for parent in [body_root]+[bpy.data.objects.get(n) for n in names]:
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

# Offline LODs keep download size and draw count bounded without runtime simplification.
meshes = [o for o in bpy.context.scene.objects if o.type=='MESH']
budget = {'shelby-gt500': 170000, 'porsche-911-gt3': 230000, 'mustang-fastback': 190000}[model]
source_tris = sum(len(o.data.polygons) for o in meshes)
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
for o in meshes:
    count = len(o.data.polygons)
    # Avoid erasing badges, lamp internals and thin trim.
    rr = 1 if count < 400 else max(ratio, min(1, 400/count))
    # The GT3 paint shell sits close to inner panels; aggressive collapse makes
    # those surfaces intersect. Preserve its authored silhouette at close range.
    if model == 'porsche-911-gt3' and o.get('role') == 'paint': rr = 1
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
bpy.ops.export_scene.gltf(filepath=str(output/'car.glb'), export_format='GLB', export_extras=True, export_animations=False, export_skins=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
print('PREPARED',json.dumps(meta), 'bytes', (output/'car.glb').stat().st_size)
