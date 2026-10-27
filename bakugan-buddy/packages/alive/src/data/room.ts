/** Points of interest in Preyas's room. He scans, then walks to one. */
export type ExplorePoint = {
  id: string;
  name: string;
  x: number;
  z: number;
};

export const EXPLORE_POINTS: readonly ExplorePoint[] = [
  { id: "window", name: "window", x: -3.3, z: -3.5 },
  { id: "shelf", name: "shelf", x: 3.5, z: -2.3 },
  { id: "cushion", name: "cushion", x: -2.6, z: 2.7 },
  { id: "plant", name: "plant", x: 2.9, z: 3.3 },
  { id: "door", name: "door", x: 0.3, z: 4.5 },
];
