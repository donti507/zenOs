import {it,expect} from 'vitest';
import {canStand,toWorld,fromWorld,VILLAGE} from '../templates/village';
import {facing,normalizeVector,movePlayer} from '../systems/movement';
it('round-trips isometric coordinates, supports eight directions and normalizes diagonal speed',()=>{
 for(const p of [{x:1,y:1},{x:7.3,y:8.6},{x:13,y:13}]){const round=fromWorld(toWorld(p));expect(round.x).toBeCloseTo(p.x);expect(round.y).toBeCloseTo(p.y);}
 const vectors=[{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},{x:-1,y:-1},{x:0,y:-1},{x:1,y:-1}];expect(vectors.map(facing)).toEqual(['e','se','s','sw','w','nw','n','ne']);expect(Math.hypot(...Object.values(normalizeVector(1,1)))).toBeCloseTo(1);expect(normalizeVector(.5,0)).toEqual({x:.5,y:0});
});
it('blocks village edges and building footprints while keeping the spawn walkable',()=>{
 expect(canStand(VILLAGE.spawn)).toBe(true);for(const p of [{x:0,y:7},{x:14,y:7},{x:3,y:3},{x:4.2,y:4.2}])expect(canStand(p)).toBe(false);
 let p={x:1.3,y:7};for(let i=0;i<300;i++)p=movePlayer(p,{x:-1,y:-1},16);expect(canStand(p)).toBe(true);expect(p.x).toBeGreaterThanOrEqual(1.23);
});
it('caps elapsed time after stalls and keeps diagonal and cardinal walking speeds equal',()=>{
 const p={x:7,y:9},a=toWorld(movePlayer(p,{x:1,y:0},16)),b=toWorld(movePlayer(p,{x:1,y:1},16)),origin=toWorld(p);expect(Math.hypot(a.x-origin.x,a.y-origin.y)).toBeCloseTo(Math.hypot(b.x-origin.x,b.y-origin.y));expect(movePlayer(p,{x:1,y:0},5000)).toEqual(movePlayer(p,{x:1,y:0},40));expect(movePlayer(p,{x:0,y:0},16)).toEqual(p);
});
