/** Approved map geometry and asset names are code-owned, never supplied by a spec. */
export const TILE_WIDTH = 96, TILE_HEIGHT = 48, WORLD_SIZE = 15;
export type Position = { x: number; y: number };
export const VILLAGE = {
 id: 'isometric-village-v1',
 spawn: { x: 7, y: 9 },
 npcSlots: { square: { x: 7, y: 6 }, archive: { x: 4, y: 7 }, observatory: { x: 10, y: 7 } },
 gateSlots: ['east-gate', 'archive-gate', 'observatory-gate'],
 buildings: [{ x: 3, y: 3, asset: 'house-blue' }, { x: 10, y: 3, asset: 'house-red' }, { x: 3, y: 10, asset: 'house-red' }, { x: 10, y: 10, asset: 'house-blue' }],
} as const;
export function toWorld(p: Position): Position { return { x: (p.x - p.y) * TILE_WIDTH / 2 + TILE_WIDTH / 2, y: (p.x + p.y) * TILE_HEIGHT / 2 + TILE_HEIGHT / 2 }; }
export function fromWorld(p: Position): Position { const x=(p.x-TILE_WIDTH/2)/(TILE_WIDTH/2),y=(p.y-TILE_HEIGHT/2)/(TILE_HEIGHT/2);return {x:(x+y)/2,y:(y-x)/2}; }
export function blocked(x:number,y:number) {
 if(x<1||y<1||x>WORLD_SIZE-2||y>WORLD_SIZE-2)return true;
 return VILLAGE.buildings.some(b=>x>=b.x-.5&&x<=b.x+1.5&&y>=b.y-.5&&y<=b.y+1.5);
}
export function canStand(p:Position) { if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return false;const r=.23;return [[-r,-r],[r,-r],[-r,r],[r,r]].every(([x,y])=>!blocked(p.x+x,p.y+y)); }
