# Attribution

Écorché is a derivative work of two anatomical datasets. This file gives their credits, their licence notices and the changes made to them, as their licences require.

## Sources

### BodyParts3D

- **Credit:** BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International.
- **Site:** https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- **Licence page:** https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- **Files used:** `isa_BP3D_4.0_obj_99.zip` (version 4.0, "is-a" tree, OBJ, full resolution), sha256 `40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e`.
- **Licence history:** the OBJ files in this archive still carry the notice "Creative Commons Attribution-Share Alike 2.1 Japan" in their headers. The Database Center for Life Science now publishes BodyParts3D under CC BY 4.0. Releasing this derivative under CC BY-SA 4.0 meets the conditions of both licences: CC BY-SA 2.1 Japan allows adaptations under a later version with the same licence elements.

### Z-Anatomy

- **Credit:** Z-Anatomy, the libre 3D atlas of anatomy, by Gauthier Kervyn, licensed under CC BY-SA 4.0. Z-Anatomy is itself built on BodyParts3D.
- **Site:** https://www.z-anatomy.com/
- **Source:** https://github.com/Z-Anatomy/The-blend
- **Structures used:** latissimus dorsi, rectus abdominis, internal oblique, transversus abdominis, quadratus lumborum, multifidus (cervicis, thoracis, lumborum), rotatores, posterior layer of the thoracolumbar fascia. From the head: temporalis, masseter (superficial and deep parts), medial and lateral pterygoids, frontalis, orbicularis oculi (orbital and palpebral parts), orbicularis oris, zygomaticus major and minor, levator labii superioris, depressor labii inferioris, depressor anguli oris, risorius, mentalis, procerus, nasalis, corrugator supercilii. Left and right of each.

### BodyExplorer

The Z-Anatomy meshes were taken from the glTF export published by the BodyExplorer project (Johan Bellander, https://github.com/JohanBellander/BodyExplorer, commit `7d04bf3c4de2bd9cb234dd51d7e6857c099afafd`): `public/anatomy.glb` and `public/mesh_mapping.json`. BodyExplorer's code is MIT-licensed. The mesh data in it keeps the Z-Anatomy and BodyParts3D licences above. No BodyExplorer code is included here.

## Changes made to the source data

The model in `model/` differs from the sources in these ways. [`tools/`](tools/README.md) reproduces them all from the original files.

1. **Selection.** About 575 BodyParts3D meshes are kept: bones, cartilages, teeth, sclera and cornea, and skeletal muscles. Vessels, nerves, organs, ligaments and skin are dropped. The Z-Anatomy structures listed above are added.
2. **Coordinates.** The data is converted from millimetres in the BodyParts3D frame to metres, Y up, the figure facing +Z, soles on y = 0.
3. **Simplification.** Triangle counts are reduced with meshoptimizer, under a geometric error budget per structure. Duplicate vertices are welded.
4. **Layering.** Where Z-Anatomy and BodyParts3D overlap, the Z-Anatomy surface is displaced so that it lies on the correct side of its neighbour: trapezius over latissimus dorsi, latissimus dorsi over erector spinae and serratus posterior inferior, the external oblique's sheath over rectus abdominis, and deep muscles under what covers them. Overlaps of up to 4 mm inside BodyParts3D are also resolved. Displacements are smoothed over each surface.
5. **Symmetry.** The muscles are clipped at the midline. The right side is replaced by the mirror image of the left.
6. **Remeshing.** The external oblique and serratus anterior, made of overlapping fibre bundles, are replaced by a single surface rebuilt from a distance field, within about 1 mm of the original.
7. **Orientation.** Z-Anatomy meshes, wound inside out in the source, are rewound to face outward.
8. **Attributes.** Vertex normals are recomputed. Vertex colours encode a tissue tint (bone, cartilage, muscle, tendon) and baked ambient occlusion. Positions are quantized to 0.1 mm and normals to 8 bits.
9. **Names and metadata.** Each structure keeps its English name and, for BodyParts3D, its FMA concept ID. Its layer, side and source dataset are added. When one structure has two meshes, the second gets a "(2)" suffix.

## Licence of this work

- Model files (`model/ecorche.glb`, `model/ecorche.meshopt.glb`, `model/ecorche.structures.json`, `docs/preview.jpg`): **CC BY-SA 4.0**, full text in [LICENSES/CC-BY-SA-4.0.txt](LICENSES/CC-BY-SA-4.0.txt).
- Code (`index.html`, `tools/`): **MIT**, full text in [LICENSES/MIT.txt](LICENSES/MIT.txt).

There is no warranty for either. This is not a medical device and must not be used for diagnosis or treatment.
