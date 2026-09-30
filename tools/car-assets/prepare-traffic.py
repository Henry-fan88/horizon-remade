"""Prepare Comrade1280's CC BY 4.0 passenger pack for instanced ambient traffic.
Blender --background --factory-startup --python prepare-traffic.py -- SOURCE.glb OUTPUT_DIR
Keeps eight civilian body styles, original UV maps, and three measured LODs.
"""
import sys, json, math
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector

source, destination = sys.argv[sys.argv.index('--') + 1:]
out = Path(destination); out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.view_layer.update()
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def bounds(o, matrix=None):
    m = matrix if matrix is not None else o.matrix_world
    pts = [m @ v.co for v in o.data.vertices]
    return Vector(tuple(min(p[i] for p in pts) for i in range(3))), Vector(tuple(max(p[i] for p in pts) for i in range(3)))
def center(o):
    lo, hi = bounds(o); return (lo+hi)/2

bodies = [o for o in objects if 'body_body' in o.name.lower()]
body_by_name = {o.parent.name: o for o in bodies}
centers = {o: center(o) for o in bodies}
parts = {o: [x for x in objects if x.parent == o.parent] for o in bodies}
for o in objects:
    if not o.name.startswith('Wheel_'): continue
    closest = min(bodies, key=lambda b: (center(o)-centers[b]).length)
    parts[closest].append(o)

# Representative civilian proportions; dimensions and wheel positions are measured after fitting.
choices = [('compact','Compact Body',3.65), ('hatchback','Hatchback Body',4.2),
           ('sedan','Sedan Body',4.55), ('estate','Wagon Body',4.7),
           ('minivan','minivan body',4.95), ('pickup','Pickup Body',5.35),
           ('suv','SUV Body',5.15), ('offroad','Offroad Body',4.35)]
# Capture the original colored paint's highlight value to normalize per-car repainting.
for mat in bpy.data.materials:
    if not mat.name.lower().startswith('body') or not mat.use_nodes: continue
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    image = bsdf.inputs['Base Color'].links[0].from_node.image
    pixels = np.array(image.pixels[:],dtype=np.float32).reshape(-1,4)[:,:3]
    vmax = pixels.max(axis=1); saturation = (vmax-pixels.min(axis=1))/np.maximum(vmax,.0001)
    colored = np.any(saturation>.3)
    mat['darkPaint'] = not colored
    values = vmax[saturation>.3] if colored else vmax[(vmax>.04)&(vmax<.3)]
    mat['paintPeak'] = float(np.percentile(values,95)) if len(values) else 1.0
keep = set(); metadata = {}
for ident, name, target_length in choices:
    body = body_by_name[name]
    group = parts[body]
    # Undo the presentation turntable's position/rotation. Blender imports glTF in Y-up
    # local coordinates: restore Z-up before exporting +Z-forward glTF.
    local = Matrix.Rotation(-math.pi/2,4,'X') @ body.parent.matrix_world.inverted()
    for o in group:
        transform = local @ o.matrix_world
        o.data = o.data.copy(); o.data.transform(transform)
        o.parent = None; o.matrix_world = Matrix.Identity(4)
    wheels = [o for o in group if o.name.startswith('Wheel_') and 'Body' not in o.name]
    assert len(wheels)==4, (ident,len(wheels))
    lo,hi = bounds(body); scale = target_length/(hi.y-lo.y)
    cs = [center(o) for o in wheels]
    mid_y = sum(c.y for c in cs)/4
    mid_x = sum(c.x for c in cs)/4
    ground = min(bounds(o)[0].z for o in wheels)
    transform = Matrix.Scale(scale,4) @ Matrix.Translation((-mid_x,-mid_y,-ground))
    for o in group: o.data.transform(transform)
    front = sorted(wheels,key=lambda o:center(o).y)[:2]
    rear = sorted(wheels,key=lambda o:center(o).y)[2:]
    fy = sum(center(o).y for o in front)/2; ry = sum(center(o).y for o in rear)/2
    lo=Vector(tuple(min(bounds(o)[0][i] for o in group) for i in range(3)))
    hi=Vector(tuple(max(bounds(o)[1][i] for o in group) for i in range(3)))
    def radius(ws): return sum((bounds(o)[1].z-bounds(o)[0].z)/2 for o in ws)/2
    def width(ws): return sum(bounds(o)[1].x-bounds(o)[0].x for o in ws)/2
    geometry = dict(L=hi.y-lo.y,W=hi.x-lo.x,H=hi.z,WB=ry-fy,fo=fy-lo.y,ro=hi.y-ry,
                    wheelR=radius(front),wheelRr=radius(rear),wheelW=width(front),wheelWr=width(rear),
                    trackF=abs(center(front[0]).x-center(front[1]).x),trackR=abs(center(rear[0]).x-center(rear[1]).x),
                    sill=max(.12,bounds(body)[0].z))
    root=bpy.data.objects.new(ident,None); bpy.context.collection.objects.link(root);keep.add(root)
    totals=[]
    for level,ratio in enumerate([1,.28,.07]):
        total=0
        for original in group:
            o=original.copy();o.data=original.data.copy();bpy.context.collection.objects.link(o)
            o.name=f'{ident}_lod{level}_{original.name}';o.parent=root;o['lod']=level
            matname=original.data.materials[0].name.lower()
            o['role']='paint' if matname.startswith('body') else 'glass' if matname.startswith('glass') else 'lamps' if matname.startswith('optics') else 'wheels'
            if ratio<1:
                bpy.context.view_layer.objects.active=o
                mod=o.modifiers.new('Traffic distance reduction','DECIMATE');mod.ratio=ratio
                mod.use_collapse_triangulate=True
                bpy.ops.object.modifier_apply(modifier=mod.name)
                # Edge collapse must not expand wheels beneath the road or beyond the
                # measured collision envelope, especially at the coarsest distance tier.
                lower, upper = bounds(original)
                for vertex in o.data.vertices:
                    for axis in range(3): vertex.co[axis] = min(upper[axis],max(lower[axis],vertex.co[axis]))
            o.data.calc_loop_triangles();total+=len(o.data.loop_triangles);keep.add(o)
        totals.append(total)
    metadata[ident]={'geometry':{k:round(v,6) for k,v in geometry.items()},'triangles':totals}
for o in list(bpy.context.scene.objects):
    if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
# Use original textures at 1k; GLB embeds shared images only once.
bpy.ops.export_scene.gltf(filepath=str(out/'traffic.glb'),export_format='GLB',export_extras=True,
                         export_yup=True,export_animations=False,export_cameras=False,export_lights=False,
                         export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)
(out/'geometry.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
