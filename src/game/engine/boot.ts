import Phaser from 'phaser';
import type {AdventureSpec} from '../spec';
import {VILLAGE,WORLD_SIZE,TILE_WIDTH,TILE_HEIGHT,toWorld,canStand,type Position} from '../templates/village';
import {facing,movePlayer,type Direction} from '../systems/movement';
import {createPlayerArt} from './player';
export type EngineHandle={setMovement:(vector:Position)=>void;setPaused:(value:boolean)=>void;getPosition:()=>Position;destroy:()=>void};
export type EngineOptions={parent:HTMLElement;spec:AdventureSpec;lowPerformance:boolean;reducedMotion:boolean;position?:Position;onReady:()=>void;onFailure:()=>void;onPosition:(p:Position)=>void};
/** Only imported dynamically by runtime.ts after spec validation. No spec field is a URL or code. */
export function bootAdventure(options:EngineOptions):EngineHandle{
 let vector={x:0,y:0},paused=false,disposed=false,failed=false,position=options.position&&canStand(options.position)?{...options.position}:{...VILLAGE.spawn};
 const factor=options.lowPerformance?.65:1;
 class World extends Phaser.Scene{
  private player!:Phaser.GameObjects.Sprite;private shadow!:Phaser.GameObjects.Ellipse;private direction:Direction='s';private lastReport=0;
  constructor(){super('village');}
  preload(){
   for(const name of ['ground','house-red','house-blue','roof-red'])this.load.image(name,`/game/kenney-isometric-buildings/${name}.png`);
   this.load.once('loaderror',()=>{failed=true;if(!disposed)options.onFailure();});
  }
  create(){
   if(disposed||failed)return;
   this.cache.tilemap.add('village-map',{format:Phaser.Tilemaps.Formats.TILED_JSON,data:{orientation:'isometric',renderorder:'right-down',width:WORLD_SIZE,height:WORLD_SIZE,tilewidth:TILE_WIDTH,tileheight:TILE_HEIGHT,infinite:false,version:1.10,tilesets:[{firstgid:1,name:'ground',tilewidth:TILE_WIDTH,tileheight:TILE_HEIGHT,tilecount:1,columns:1,image:'ground.png',imagewidth:TILE_WIDTH,imageheight:TILE_HEIGHT,margin:0,spacing:0}],layers:[{type:'tilelayer',name:'Ground',width:WORLD_SIZE,height:WORLD_SIZE,x:0,y:0,opacity:1,visible:true,data:Array(WORLD_SIZE*WORLD_SIZE).fill(1)}]}});
   const map=this.make.tilemap({key:'village-map'}),tiles=map.addTilesetImage('ground','ground')!;const ground=map.createLayer('Ground',tiles,0,0)!;
   ground.forEachTile(tile=>{const rim=tile.x===0||tile.y===0||tile.x===WORLD_SIZE-1||tile.y===WORLD_SIZE-1;const road=tile.x===7||tile.y===7||(tile.x>=6&&tile.x<=8&&tile.y>=6&&tile.y<=8);tile.tint=rim?0x667a8b:road?0xf7e6c4:(tile.x+tile.y)%2?0xa7c5a0:0xb5d1a9;});
   for(const house of VILLAGE.buildings){const p=toWorld({x:house.x+.5,y:house.y+.5});this.add.ellipse(p.x,p.y+12,130,36,0x26364b,.18).setDepth(p.y-1);this.add.image(p.x,p.y+28,house.asset).setOrigin(.5,1).setScale(1.1).setDepth(p.y+5);this.add.image(p.x,p.y-35,'roof-red').setOrigin(.5,1).setScale(1.1).setDepth(p.y+6);}
   // Fixed decorative trees. No spec-created assets, emitters, scripts or arbitrary scene objects.
   for(const cell of [{x:2,y:6},{x:2,y:8},{x:6,y:2},{x:8,y:2},{x:12,y:6},{x:12,y:8},{x:6,y:12},{x:8,y:12}]){
    const p=toWorld(cell),g=this.add.graphics().setDepth(p.y);g.fillStyle(0x625b4a).fillRect(p.x-4,p.y-28,8,30);g.fillStyle(0x54796a).fillTriangle(p.x,p.y-75,p.x-25,p.y-20,p.x+25,p.y-20);g.fillStyle(0x719a7d).fillTriangle(p.x,p.y-83,p.x-20,p.y-40,p.x+20,p.y-40);
   }
   createPlayerArt(this);
   for(const npc of options.spec.npcs){const p=toWorld(VILLAGE.npcSlots[npc.slot]);this.add.sprite(p.x,p.y,'explorer-s-0').setOrigin(.5,1).setTint(0xc5dff0).setDepth(p.y);this.add.text(p.x,p.y-66,npc.name,{fontFamily:'sans-serif',fontSize:'12px',color:'#f5f3ff',backgroundColor:'#34314b',padding:{x:7,y:4}}).setOrigin(.5,1).setDepth(p.y+1);}
   const p=toWorld(position);this.shadow=this.add.ellipse(p.x,p.y-2,28,10,0x26364b,.25);this.player=this.add.sprite(p.x,p.y,'explorer-s-0').setOrigin(.5,1).setScale(1.1);this.player.setDepth(p.y+2);
   this.cameras.main.setZoom(factor).startFollow(this.player,false,options.reducedMotion?1:.09,options.reducedMotion?1:.09);
   this.cameras.main.centerOn(p.x,p.y);this.lastReport=0;options.onPosition({...position});options.onReady();
  }
  update(time:number,delta:number){
   if(disposed||!this.player)return;
   const moving=!paused&&(vector.x!==0||vector.y!==0);if(moving){position=movePlayer(position,vector,delta);this.direction=facing(vector);}
   const p=toWorld(position);this.player.setPosition(p.x,p.y).setDepth(p.y+2);this.shadow.setPosition(p.x,p.y-2).setDepth(p.y-1);
   const frame=moving&&!options.reducedMotion?1+(Math.floor(time/140)%2):0;this.player.setTexture(`explorer-${this.direction}-${frame}`);
   // Throttled, cosmetic position updates only; no mastery or XP is client awarded.
   if(time-this.lastReport>250){this.lastReport=time;options.onPosition({...position});}
  }
 }
 const width=()=>Math.max(160,Math.round(options.parent.clientWidth*factor)),height=()=>Math.max(180,Math.round(options.parent.clientHeight*factor));
 const game=new Phaser.Game({type:options.lowPerformance?Phaser.CANVAS:Phaser.AUTO,parent:options.parent,width:width(),height:height(),transparent:true,audio:{noAudio:true},input:{keyboard:false,mouse:false,touch:false,gamepad:false},render:{antialias:!options.lowPerformance,pixelArt:false},fps:{target:options.lowPerformance?30:60,limit:options.lowPerformance?30:60},scene:[World],banner:false});
 const styleCanvas=()=>{if(game.canvas){game.canvas.style.width='100%';game.canvas.style.height='100%';game.canvas.setAttribute('aria-hidden','true');}};
 game.events.once(Phaser.Core.Events.READY,styleCanvas);styleCanvas();
 const observer=new ResizeObserver(()=>{if(!disposed){game.scale.resize(width(),height());styleCanvas();}});observer.observe(options.parent);
 return {setMovement:v=>{vector={...v};},setPaused:value=>{paused=value;if(value)vector={x:0,y:0};},getPosition:()=>({...position}),destroy:()=>{if(disposed)return;disposed=true;vector={x:0,y:0};observer.disconnect();game.destroy(true);if(game.isBooted)game.step(0,0);}};
}
