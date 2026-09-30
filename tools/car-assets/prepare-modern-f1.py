"""Prepare Redgrund's CC-BY 2023 F1 cars, preserving their original UV liveries.
Run in isolated Blender: --background --factory-startup --python this.py -- MODEL SOURCE OUTPUT
The four tyres are detected as round connected components, never cut out of bodywork.
"""
import sys, json
from pathlib import Path
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix

model, source, dest = sys.argv[sys.argv.index('--') + 1:]
assert model in ('mclaren-mcl60', 'ferrari-sf23', 'redbull-rb19')
out = Path(dest); out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.view_layer.update()
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
source_tris = sum(len(o.data.polygons) for o in objects)
for o in objects:
    world = o.matrix_world.copy(); o.parent = None; o.matrix_world = Matrix.Identity(4)
    o.data = o.data.copy(); o.data.transform(world)
for o in list(bpy.context.scene.objects):
    if o not in objects: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in objects: o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]; bpy.ops.object.join()
# Sketchfab splits the original atlas mesh into chunks. Rejoin shared vertices before
# discovering actual connected parts. UV coordinates remain on the face corners.
o = bpy.context.object
bm = bmesh.new(); bm.from_mesh(o.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
bm.to_mesh(o.data); bm.free()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def points(o):
    a = np.empty(len(o.data.vertices)*3, dtype=np.float32)
    o.data.vertices.foreach_get('co', a); return a.reshape(-1, 3)
def bounds(o):
    a = points(o); return a.min(axis=0), a.max(axis=0)
def center(o):
    lo, hi = bounds(o); return (lo+hi)/2

# The complete tyre + rim shells have circular YZ bounds and sit on the ground.
tyres = []
for o in objects:
    lo, hi = bounds(o); d = hi-lo; c = (hi+lo)/2
    if len(o.data.polygons)>20000 and lo[2]<.03 and abs(c[0])>.35 and .4<d[1]<.7 and abs(d[1]-d[2])<.01 and d[0]<d[1]*.8:
        tyres.append(o)
assert len(tyres)==4, f'Expected four complete tyres, found {len(tyres)}'
tyres.sort(key=lambda o: (center(o)[1]>0, center(o)[0]<0))
centers = [center(o) for o in tyres]
wb = 3.6  # representative 2023 wheelbase; not a claim of exact factory measurements
front_y = np.mean([c[1] for c in centers[:2]])
rear_y = np.mean([c[1] for c in centers[2:]])
scale = wb/(rear_y-front_y); mid_y = (front_y+rear_y)/2
radii = [float((bounds(o)[1][2]-bounds(o)[0][2])*scale/2) for o in tyres]
widths = [float((bounds(o)[1][0]-bounds(o)[0][0])*scale) for o in tyres]
rF, rR = np.mean(radii[:2]), np.mean(radii[2:])
trackF = float((centers[0][0]-centers[1][0])*scale)
trackR = float((centers[2][0]-centers[3][0])*scale)
ground = np.mean([c[2]*scale-r for c,r in zip(centers,radii)])
transform = Matrix.Translation((0,-mid_y*scale,-ground)) @ Matrix.Scale(scale,4)
wheel_parts = [[t] for t in tyres]; stationary = [[] for _ in tyres]; body = []
for o in objects:
    if o in tyres: continue
    lo,hi = bounds(o); c=(lo+hi)/2
    i = min(range(4), key=lambda i: float(np.linalg.norm(c-centers[i])))
    tl,th = bounds(tyres[i])
    if np.all(lo>=tl-.015) and np.all(hi<=th+.015): wheel_parts[i].append(o)
    # Front tyre deflectors move with steering, but must never spin with the rubber.
    elif i<2 and abs(c[0])>.32 and abs(c[1]-centers[i][1])<.13 and hi[1]-lo[1]<.5 and hi[2]-lo[2]<.55 and lo[2]>.05:
        stationary[i].append(o)
    else: body.append(o)

# MCL60 and RB19 have authored steering assemblies. SF23 has no separate wheel:
# retain its cockpit shell and supply the small generic race wheel at runtime.
steer_parts = []
sy = {'mclaren-mcl60':-.6721, 'redbull-rb19':-.7217}.get(model)
if sy is not None:
    for o in list(body):
        lo,hi=bounds(o)
        if lo[0]>-.13 and hi[0]<.13 and lo[1]>sy-.035 and hi[1]<sy+.055 and lo[2]>.35 and hi[2]<.51:
            steer_parts.append(o); body.remove(o)
    assert steer_parts, 'Authored steering assembly missing'

root=bpy.data.objects.new('car',None);bpy.context.collection.objects.link(root)
def mount(name):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=root;return o
body_root=mount('body')
for o in body:
    o.data.transform(transform);o.parent=body_root;o['role']='livery'
mounts=[body_root]
for i,name in enumerate(['wheel_fl','wheel_fr','wheel_rl','wheel_rr']):
    parent=mount(name);mounts.append(parent)
    r=float(rF if i<2 else rR)
    parent.location=((1 if i%2==0 else -1)*(trackF if i<2 else trackR)/2,(-1 if i<2 else 1)*wb/2,r)
    local=Matrix.Diagonal((scale,scale*r/radii[i],scale*r/radii[i],1)) @ Matrix.Translation(-Vector(centers[i]))
    for o in wheel_parts[i]+stationary[i]:
        o.data.transform(local);o.parent=parent;o['role']='wheel' if o in wheel_parts[i] else 'carbon'
        o['stationary']=o in stationary[i]

steering=None
if steer_parts:
    for o in steer_parts:o.data.transform(transform)
    co=np.concatenate([points(o) for o in steer_parts]);c=(co.min(axis=0)+co.max(axis=0))/2
    # Blender +Y points towards the driver. Local -Y exports as game +Z.
    frame=Matrix.Diagonal((-1,-1,1,1));frame.translation=Vector(c)
    parent=mount('steering');parent.matrix_world=frame;mounts.append(parent)
    for o in steer_parts:o.data.transform(frame.inverted());o.parent=parent;o['role']='cockpit'
    steering=[float(c[0]),float(c[2]),float(-c[1])]

# Preserve silhouette and cockpit detail, spend fewer triangles on bolts and hidden pieces.
def simplify(o,ratio):
    if ratio>=.98:return
    lo,hi=bounds(o)
    mod=o.modifiers.new('Distance detail','DECIMATE');mod.ratio=ratio
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.vertices.foreach_set('co',np.clip(points(o),lo,hi).astype(np.float32).ravel());o.data.update()
for o in [o for o in bpy.context.scene.objects if o.type=='MESH']:
    n=len(o.data.polygons)
    ratio=.65 if n>60000 else .38 if n>20000 else .24
    if o.parent.name=='steering':ratio=1
    simplify(o,max(ratio,min(1,180/max(n,1))))
# One material bucket per mount: liveries stay textured, wheels get rubber response.
for parent in mounts:
    buckets={}
    for o in list(parent.children):buckets.setdefault((o['role'],bool(o.get('stationary'))),[]).append(o)
    for (role,still),parts in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0]
        if len(parts)>1:bpy.ops.object.join()
        o=bpy.context.object;o.name=f'{parent.name}_{role}';o['role']=role;o['stationary']=still;o['lod']=0
        # Set each role's own PBR material, preserving the shared atlas texture.
        mat=o.data.materials[0].copy();mat.name='F1_'+role
        p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        # Imported factors may be linked through math nodes; replace those inputs
        # explicitly so tyres do not inherit the body atlas's metallic gloss.
        for socket in ('Metallic', 'Roughness'):
            for link in list(p.inputs[socket].links):mat.node_tree.links.remove(link)
        p.inputs['Metallic'].default_value=0 if role=='wheel' else .15
        p.inputs['Roughness'].default_value=.82 if role=='wheel' else .43
        o.data.materials.clear();o.data.materials.append(mat)
        for poly in o.data.polygons:poly.material_index=0
        for level,ratio in [(1,.35),(2,.09)]:
            clone=o.copy();clone.data=o.data.copy();bpy.context.collection.objects.link(clone)
            clone.name=o.name+f'_lod{level}';clone['lod']=level
            simplify(clone,max(ratio,min(1,100/max(len(clone.data.polygons),1))))
for image in bpy.data.images:
    if max(image.size)>2048:
        f=2048/max(image.size);image.scale(round(image.size[0]*f),round(image.size[1]*f));image.pack()
bpy.context.view_layer.update()
near=[o for o in bpy.context.scene.objects if o.type=='MESH' and o['lod']==0]
p=np.concatenate([np.array([o.matrix_world@Vector(v) for v in o.bound_box]) for o in near]);lo=p.min(axis=0);hi=p.max(axis=0)
meta=dict(model=model,wheelbase=wb,trackF=trackF,trackR=trackR,wheelR=float(rF),wheelRr=float(rR),wheelW=float(np.mean(widths[:2])),wheelWr=float(np.mean(widths[2:])),length=float(hi[1]-lo[1]),width=float(hi[0]-lo[0]),height=float(hi[2]),frontOverhang=float(-lo[1]-wb/2),rearOverhang=float(hi[1]-wb/2),steering=steering,sourceTriangles=source_tris,triangles={str(i):sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH' and o['lod']==i) for i in range(3)})
(out/'geometry.json').write_text(json.dumps(meta,indent=2)+'\n')
bpy.ops.export_scene.gltf(filepath=str(out/'car.glb'),export_format='GLB',export_extras=True,export_animations=False,export_skins=False,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_draco_position_quantization=14,export_draco_normal_quantization=10,export_draco_texcoord_quantization=12,export_image_format='WEBP',export_image_quality=90)
print('PREPARED',json.dumps(meta),'bytes',(out/'car.glb').stat().st_size)
