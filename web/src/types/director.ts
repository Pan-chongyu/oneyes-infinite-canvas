export type DirectorVector = [number, number, number];
export type DirectorKind = "person" | "box" | "sphere" | "cylinder";
export type DirectorPose = "stand" | "walk" | "sit" | "reach";
export type DirectorObject = {
    id: string;
    name: string;
    kind: DirectorKind;
    pose: DirectorPose;
    position: DirectorVector;
    rotation: DirectorVector;
    scale: DirectorVector;
    color: string;
};
export type DirectorScene = {
    schema: 1;
    objects: DirectorObject[];
    camera: { position: DirectorVector; target: DirectorVector; lens: number };
    light: { azimuth: number; elevation: number; intensity: number };
    background: string;
    floor: string;
    width: number;
    height: number;
    grid: boolean;
};
