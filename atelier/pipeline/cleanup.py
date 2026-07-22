# cleanup.py — OPTIONELE escape-hatch, bewust NIET in het default-pad.
#
# Zware mesh-repair via Blender headless voor probleem-assets waar de
# gltf-transform-keten (optimize.mjs) niet doorheen komt: non-manifold
# geometrie, gaten, losse rommel. Vereist een lokale Blender (≥ 3.6);
# Blender is nergens anders in de pipeline nodig.
#
# gebruik:
#   blender -b -P cleanup.py -- --in <probleem.glb> --uit <gerepareerd.glb> \
#           [--merge 0.0001] [--voxel 0]
#
#   --merge  afstand voor merge-by-distance (weld), default 0.0001
#   --voxel  > 0 activeert voxel-remesh met die voxelgrootte (bijv. 0.02).
#            LET OP: destructief — UV's en materiaaltoewijzing gaan verloren;
#            alleen voor hopeloze meshes, daarna opnieuw texturen.
#
# Daarna gewoon weer door het default-pad: node optimize.mjs <gerepareerd.glb>
import sys

try:
    import bpy
    import bmesh
except ImportError:
    sys.exit("dit script draait binnen Blender: blender -b -P cleanup.py -- --in ... --uit ...")


def argumenten():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opties = {"merge": 0.0001, "voxel": 0.0}
    i = 0
    while i < len(argv):
        vlag = argv[i].lstrip("-")
        if vlag in ("in", "uit"):
            opties[vlag] = argv[i + 1]; i += 2
        elif vlag in ("merge", "voxel"):
            opties[vlag] = float(argv[i + 1]); i += 2
        else:
            sys.exit("onbekende vlag: " + argv[i])
    if "in" not in opties or "uit" not in opties:
        sys.exit("gebruik: blender -b -P cleanup.py -- --in a.glb --uit b.glb [--merge 0.0001] [--voxel 0]")
    return opties


def main():
    o = argumenten()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=o["in"])

    meshes = [ob for ob in bpy.context.scene.objects if ob.type == "MESH"]
    if not meshes:
        sys.exit("geen mesh-objecten gevonden in " + o["in"])

    # alles samenvoegen zodat de repair over het geheel gaat
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    v0, f0 = len(bm.verts), len(bm.faces)

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=o["merge"])
    los = [v for v in bm.verts if not v.link_faces]
    if los:
        bmesh.ops.delete(bm, geom=los, context="VERTS")
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    if o["voxel"] > 0:
        print("voxel-remesh %.4f — let op: UV's/materialen gaan verloren" % o["voxel"])
        obj.data.remesh_voxel_size = o["voxel"]
        bpy.ops.object.voxel_remesh()

    bpy.ops.export_scene.gltf(filepath=o["uit"], export_format="GLB")
    print("repair klaar: %d→%d verts, %d→%d faces → %s" %
          (v0, len(obj.data.vertices), f0, len(obj.data.polygons), o["uit"]))
    print("nu door het default-pad: node optimize.mjs " + o["uit"])


main()
