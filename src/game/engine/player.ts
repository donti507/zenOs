import type Phaser from 'phaser';
import type {Direction} from '../systems/movement';
export const DIRECTIONS:Direction[]=['n','ne','e','se','s','sw','w','nw'];
/** Original code-owned explorer art, generated into 8 direction × 3 frame textures. */
export function createPlayerArt(scene:Phaser.Scene){
 for(const direction of DIRECTIONS)for(let frame=0;frame<3;frame++){
  const texture=scene.textures.createCanvas(`explorer-${direction}-${frame}`,40,56)!;const c=texture.context;
  const step=frame===1?-3:frame===2?3:0,back=direction.startsWith('n');
  c.fillStyle='#25334c';c.fillRect(12+step,39,7,12);c.fillRect(23-step,39,7,12);
  c.fillStyle='#433b91';c.beginPath();c.moveTo(20,20);c.lineTo(7,43);c.quadraticCurveTo(20,48,33,43);c.closePath();c.fill();
  c.fillStyle='#8b81e8';c.fillRect(13,23,15,14);c.fillStyle='#ead4ae';c.beginPath();c.arc(20,15,9,0,Math.PI*2);c.fill();
  c.fillStyle='#453939';c.beginPath();c.arc(20,12,10,Math.PI,Math.PI*2);c.fill();c.fillRect(10,8,4,10);
  if(back){c.fillStyle='#453939';c.beginPath();c.arc(20,14,9,0,Math.PI*2);c.fill();}
  else{const shift=direction.includes('e')?4:direction.includes('w')?-4:0;c.fillStyle='#29293e';c.fillRect(16+shift,15,2,2);c.fillRect(23+shift,15,2,2);}
  c.fillStyle='#efc66a';c.fillRect(18,28,4,4);texture.refresh();
 }
}
