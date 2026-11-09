import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { directorAppearance } from "@/lib/canvas/director-scene";
import type { DirectorJoint, DirectorObject, DirectorVector } from "@/types/director";

/** Built-in metre-scale models: local geometry only, with editable material roles. */
export function createDirectorModel(object: DirectorObject) {
    const group = new THREE.Group(), materials = new Map<string, THREE.MeshStandardMaterial>();
    const material = (role = "primary") => {
        if (!materials.has(role)) materials.set(role, new THREE.MeshStandardMaterial({ color: ({ dark: "#252a30", glass: "#9ac5cf", wood: "#80634b", metal: "#89949a", light: "#f3e9d3", white: "#eee9e0" } as Record<string,string>)[role] || object.color, roughness: role === "glass" ? 0.16 : role === "metal" ? 0.3 : 0.8, metalness: role === "metal" ? 0.7 : 0 }));
        const value = materials.get(role)!; value.userData.directorRole = role; return value;
    };
    const part = (parent: THREE.Group, geometry: THREE.BufferGeometry, position: DirectorVector, role = "primary", scale?: DirectorVector) => {
        const mesh = new THREE.Mesh(geometry, material(role)); mesh.position.fromArray(position); if (scale) mesh.scale.fromArray(scale); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    const box = (parent: THREE.Group, size: DirectorVector, position: DirectorVector, role = "primary") => part(parent, new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.12), position, role);
    const ball = (parent: THREE.Group, size: DirectorVector, position: DirectorVector, role = "primary") => part(parent, new THREE.SphereGeometry(1, 24, 16), position, role, size);
    const joint = (parent: THREE.Group, name: DirectorJoint, position: DirectorVector) => { const pivot = new THREE.Group(); pivot.position.fromArray(position); pivot.userData.directorJoint = name; parent.add(pivot); return pivot; };
    const bone = (parent: THREE.Group, name: DirectorJoint, a: DirectorVector, b: DirectorVector, radius: number, role: string) => {
        const direction = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), pivot = joint(parent,name,a), end = direction.toArray();
        const mesh = part(pivot,new THREE.CapsuleGeometry(radius,Math.max(0,direction.length()-radius*2),6,16),direction.clone().multiplyScalar(0.5).toArray(),role);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
        ball(pivot,[radius,radius,radius],[0,0,0],role);ball(pivot,[radius,radius,radius],end,role);return {pivot,end};
    };
    if (object.kind === "person") {
        const seated = object.pose === "sit", crouched = object.pose === "crouch", hip = seated ? 0.64 : crouched ? 0.65 : 0.94, shoulder = hip + 0.46;
        const torso = joint(group,"torso",[0,hip,0]), head = joint(torso,"head",[0,0.56,0]);
        ball(torso,[0.18,0.13,0.12],[0,0.02,0],"bottom");
        ball(torso,[0.22,0.27,0.13],[0,0.25,0]);
        part(torso,new THREE.CylinderGeometry(0.055,0.065,0.13,20),[0,0.51,0],"skin");
        ball(head,[0.135,0.17,0.125],[0,0.14,0],"skin");
        ball(head,[0.038,0.046,0.06],[0,0.12,0.12],"skin");
        box(head,[0.06,0.012,0.01],[0,0.057,0.116],"skin");
        for (const side of [-1,1]) {
            ball(head,[0.025,0.045,0.025],[side*0.13,0.12,0],"skin");
            ball(head,[0.028,0.018,0.012],[side*0.052,0.16,0.112],"white");
            ball(head,[0.01,0.012,0.006],[side*0.052,0.16,0.124],"dark");
            box(head,[0.048,0.009,0.009],[side*0.052,0.192,0.114],"hair");
        }
        if (object.appearance?.hairStyle !== "none") {
            part(head,new THREE.SphereGeometry(1,24,16,0,Math.PI*2,0,Math.PI*0.54),[0,0.15,-0.006],"hair",[0.142,0.176,0.132]);
            if (object.appearance?.hairStyle === "long") box(head,[0.27,0.36,0.09],[0,0.05,-0.095],"hair");
        }
        for (const side of [-1,1]) {
            const name = side < 0 ? "left" : "right", x = side*0.12, stride = object.pose === "walk" ? side*0.23 : 0;
            const thigh = bone(group,`${name}Leg`,[x,hip,0],[x,seated ? hip : crouched ? 0.38 : 0.52,seated ? 0.4 : crouched ? 0.3 : stride],0.085,"bottom");
            const ankle: DirectorVector = [x,0.09,seated ? 0.43 : -stride];
            const shin = bone(thigh.pivot,`${name}Knee`,thigh.end,new THREE.Vector3(...ankle).sub(new THREE.Vector3(x,hip,0)).toArray(),0.064,"bottom");
            const foot = joint(shin.pivot,`${name}Ankle`,shin.end);
            box(foot,[0.135,0.12,0.26],[0,-0.02,0.065],"shoes"); box(foot,[0.14,0.025,0.265],[0,-0.072,0.065],"dark");
            const waving = object.pose === "wave" && side > 0, reaching = object.pose === "reach", shoulderPoint: DirectorVector = [side*0.22,shoulder-hip,0];
            const elbow: DirectorVector = waving ? [side*0.4,shoulder+0.12,0] : reaching ? [side*0.3,shoulder-0.08,0.3] : [side*0.31,shoulder-0.25,-stride];
            const hand: DirectorVector = waving ? [side*0.35,shoulder+0.38,0.03] : reaching ? [side*0.27,shoulder-0.02,0.6] : [side*0.3,shoulder-0.5,stride];
            const arm = bone(torso,`${name}Arm`,shoulderPoint,[elbow[0],elbow[1]-hip,elbow[2]],0.057,"primary");
            const forearm = bone(arm.pivot,`${name}Elbow`,arm.end,[hand[0]-shoulderPoint[0],hand[1]-shoulder,hand[2]],0.042,"skin");
            const wrist = joint(forearm.pivot,`${name}Wrist`,forearm.end), handModel = new THREE.Group(); wrist.add(handModel);
            handModel.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),new THREE.Vector3(...forearm.end).sub(new THREE.Vector3(...arm.end)).normalize());
            box(handModel,[0.075,0.09,0.035],[0,-0.025,0],"skin");
            for (let finger=0;finger<4;finger++) part(handModel,new THREE.CapsuleGeometry(0.009,0.035,4,8),[(finger-1.5)*0.018,-0.086,0],"skin");
            const thumb = box(handModel,[0.025,0.055,0.025],[side*0.045,-0.035,0.01],"skin"); thumb.rotation.z=side*0.45;
        }
    } else if (object.kind === "chair") {
        box(group,[0.5,0.09,0.5],[0,0.47,0]); box(group,[0.5,0.48,0.075],[0,0.74,-0.22]);
        for (const x of [-0.19,0.19]) for (const z of [-0.19,0.19]) box(group,[0.055,0.44,0.055],[x,0.22,z],"wood");
    } else if (object.kind === "table") {
        box(group,[1.5,0.09,0.85],[0,0.75,0]);
        for (const x of [-0.63,0.63]) for (const z of [-0.31,0.31]) box(group,[0.07,0.705,0.07],[x,0.3525,z],"wood");
    } else if (object.kind === "sofa") {
        box(group,[2,0.24,0.86],[0,0.26,0]); box(group,[1.95,0.62,0.18],[0,0.59,-0.35]);
        for (const x of [-0.91,0.91]) box(group,[0.18,0.43,0.86],[x,0.48,0]);
        for (const x of [-0.42,0.42]) box(group,[0.8,0.16,0.65],[x,0.45,0.07]);
        for (const x of [-0.8,0.8]) for (const z of [-0.3,0.3]) box(group,[0.09,0.14,0.09],[x,0.07,z],"wood");
    } else if (object.kind === "bed") {
        box(group,[1.65,0.32,2.15],[0,0.16,0],"wood"); box(group,[1.6,0.22,2.1],[0,0.42,0],"white"); box(group,[1.7,0.9,0.1],[0,0.45,-1.03],"wood");
        box(group,[1.62,0.045,1.4],[0,0.55,0.3]); for (const x of [-0.4,0.4]) box(group,[0.64,0.12,0.37],[x,0.58,-0.7],"white");
    } else if (object.kind === "door" || object.kind === "window") {
        const door = object.kind === "door", w = door ? 1 : 1.5, h = door ? 2.1 : 1.2;
        for (const x of [-w/2,w/2]) box(group,[0.09,h,0.12],[x,h/2,0]);
        box(group,[w,0.09,0.12],[0,h-0.045,0]);
        if (!door) { box(group,[w,0.09,0.12],[0,0.045,0]); box(group,[w,0.045,0.06],[0,h/2,0]); box(group,[0.045,h,0.06],[0,h/2,0]); }
    } else if (object.kind === "tree") {
        part(group,new THREE.CylinderGeometry(0.1,0.17,1.6,16),[0,0.8,0],"wood");
        for (const [x,y,z,r] of [[0,1.9,0,0.72],[-0.42,1.62,0.08,0.51],[0.43,1.7,-0.07,0.54],[0,2.32,0.08,0.42]]) ball(group,[r,r*0.9,r],[x,y,z]);
    } else if (object.kind === "car") {
        box(group,[1.75,0.52,4.1],[0,0.58,0]); box(group,[1.5,0.62,1.95],[0,1.08,-0.28]);
        box(group,[1.36,0.45,0.035],[0,1.1,0.71],"glass"); box(group,[1.36,0.42,0.035],[0,1.1,-1.27],"glass");
        for (const side of [-1,1]) {
            for (const z of [-0.77,0.2]) box(group,[0.025,0.4,0.86],[side*0.756,1.1,z],"glass");
            for (const z of [-1.25,1.25]) { const wheel=part(group,new THREE.CylinderGeometry(0.32,0.32,0.18,24),[side*0.85,0.32,z],"dark"); wheel.rotation.z=Math.PI/2; const hub=part(group,new THREE.CylinderGeometry(0.17,0.17,0.19,20),[side*0.86,0.32,z],"metal"); hub.rotation.z=Math.PI/2; }
            box(group,[0.42,0.13,0.045],[side*0.58,0.68,2.06],"light"); box(group,[0.15,0.12,0.15],[side*0.93,1.02,0.5]);
        }
        box(group,[1.4,0.12,0.055],[0,0.42,2.07],"dark");
    } else {
        const geometry = object.kind === "box" ? new RoundedBoxGeometry(1,1,1,2,0.035) : object.kind === "sphere" ? new THREE.SphereGeometry(0.5,32,24) : object.kind === "cone" ? new THREE.ConeGeometry(0.5,1,32) : object.kind === "torus" ? new THREE.TorusGeometry(0.35,0.15,16,48) : object.kind === "plane" ? new THREE.BoxGeometry(2,2,0.05) : new THREE.CylinderGeometry(0.4,0.4,1,32);
        part(group,geometry,[0,0,0]);
    }
    group.userData.directorId = object.id;
    updateDirectorModel(group,object); return group;
}

export const directorModelShape = (object: DirectorObject) => `${object.kind}:${object.pose}:${object.appearance?.hairStyle || "short"}`;
export function updateDirectorModel(group: THREE.Group, object: DirectorObject) {
    const appearance = { ...directorAppearance, ...object.appearance }, updated = new Set<THREE.Material>();
    group.traverse(child => {
        if (child.userData.directorJoint) child.rotation.set(...(object.joints?.[child.userData.directorJoint as DirectorJoint] || [0,0,0]).map(THREE.MathUtils.degToRad) as DirectorVector);
        if (!(child instanceof THREE.Mesh) || updated.has(child.material)) return;
        const material = child.material as THREE.MeshStandardMaterial, role = material.userData.directorRole;
        if (role === "primary") { material.color.set(object.color); material.roughness=object.roughness??0.72;material.metalness=object.metalness??0; }
        else if (["skin","hair","bottom","shoes"].includes(role)) material.color.set(appearance[role as "skin"|"hair"|"bottom"|"shoes"]);
        updated.add(material);
    });
}
