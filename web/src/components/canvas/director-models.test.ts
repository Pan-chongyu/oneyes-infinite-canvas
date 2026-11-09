import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { directorJoints, directorNames, directorObject, directorPoses } from "@/lib/canvas/director-scene";
import { createDirectorModel, updateDirectorModel } from "./director-models";
import type { DirectorKind, DirectorPose } from "@/types/director";

test("built-in models have finite metre-scale geometry and grounded compound props", () => {
    for (const kind of Object.keys(directorNames) as DirectorKind[]) {
        const object = directorObject(kind), model = createDirectorModel(object), bounds = new Box3().setFromObject(model);
        const size = bounds.getSize(new Vector3());
        assert.ok(size.toArray().every(value => Number.isFinite(value) && value > 0), kind);
        if (["person","chair","table","sofa","bed","door","window","tree","car"].includes(kind)) assert.ok(Math.abs(bounds.min.y) < 0.01, `${kind} bottom: ${bounds.min.y}`);
        model.traverse(child => { if (child instanceof Mesh) assert.ok(Array.from(child.geometry.attributes.position.array).every(Number.isFinite), `${kind} has no corrupt vertices`); });
    }
});
test("all person poses retain articulated wrists/ankles and independent editable material roles", () => {
    for (const pose of directorPoses) {
        const object = {...directorObject("person"), pose:pose.value as DirectorPose, appearance:{skin:"#a77654",hair:"#172f40",hairStyle:"long" as const}};
        const model = createDirectorModel(object), joints = new Set<string>(), materials = new Map<string,MeshStandardMaterial>();
        model.traverse(child => { if (child.userData.directorJoint) joints.add(child.userData.directorJoint); if (child instanceof Mesh) materials.set(child.material.userData.directorRole, child.material); });
        assert.deepEqual(joints,new Set(Object.keys(directorJoints)));
        const geometry = model.children[0];
        updateDirectorModel(model,{...object,color:"#ff3344",roughness:0.3,joints:{leftWrist:[0,25,0],rightAnkle:[10,0,0]}});
        assert.equal(model.children[0],geometry,"color and articulation updates reuse geometry");
        assert.equal(materials.get("primary")!.color.getHexString(),"ff3344"); assert.equal(materials.get("primary")!.roughness,0.3);
        assert.equal(materials.get("skin")!.color.getHexString(),"a77654"); assert.equal(materials.get("hair")!.color.getHexString(),"172f40");
        let angle=0;model.traverse(child=>{if(child.userData.directorJoint==="leftWrist")angle=child.rotation.y;});assert.ok(Math.abs(angle-Math.PI*25/180)<1e-8);
    }
});
test("door and window apertures remain open and fixed prop trim does not inherit primary paint", () => {
    for (const kind of ["door","window"] as const) {
        const object=directorObject(kind),model=createDirectorModel(object);model.updateMatrixWorld(true);
        const ray=new Raycaster(new Vector3(kind==="door"?0:0.3,kind==="door"?1:0.3,2),new Vector3(0,0,-1));
        assert.equal(ray.intersectObject(model,true).length,0,`${kind} opening is not filled with an opaque plane`);
    }
    const object=directorObject("car"),model=createDirectorModel(object);let glass:MeshStandardMaterial|undefined;
    model.traverse(child=>{if(child instanceof Mesh&&child.material.userData.directorRole==="glass")glass=child.material;});
    const before=glass!.color.getHexString();updateDirectorModel(model,{...object,color:"#cc2233"});assert.equal(glass!.color.getHexString(),before);
});
