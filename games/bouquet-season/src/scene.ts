import {fieldSize} from './core/shop.ts';
import * as Phaser from 'phaser';
import { cellAt, cellCenter, cellCorners, fieldCells, sameCell, type Cell } from './core/field.ts';
import { moduleAt } from './core/effects.ts';
import { deviceZone, plantConditions } from './core/conditions.ts';
import { fitField, panField, toScreen, toWorld, zoomField, type FieldView, type Viewport } from './core/camera.ts';
import { CATALOG, isPlant, type ObjectKind, type PlacedObject } from './core/layout.ts';
import type { GameState } from './core/state.ts';
import { FieldInput } from './field-input.ts';
import { livingObjects, newPlant, type PlantState } from './core/growth.ts';

// Одна непрерывная капля: без плечиков на стыке треугольника и круга.
const WATER_DROP=Array.from({length:40},(_,i)=>{
  const a=i*Math.PI*2/40;
  return {x:4.5*Math.sin(a)*Math.sin(a/2),y:-5+4.5*(1-Math.cos(a))};
});

export type FieldTool = {kind:ObjectKind} | {from:Cell} | null;
interface Options {
  ready: () => void;
  frame: (fps:number,objects:number) => void;
  viewport: () => Viewport;
  tap: (cell:Cell) => void;
  drop: (from:Cell|null,to:Cell) => void;
  context: (cell:Cell|null,cancelDrag:boolean) => void;
}
export class WorkshopScene extends Phaser.Scene {
  #backdrop!: Phaser.GameObjects.Graphics;
  #board!: Phaser.GameObjects.Graphics;
  #controls?: FieldInput;
  #options: Options;
  #state: GameState | null = null;
  #tool: FieldTool = null;
  #view?: FieldView;
  #hover: Cell | null = null;
  #dragFrom: Cell | null = null;
  #blocked = true;
  #elapsed = 0;
  constructor(options: Options) {super('workshop');this.#options=options;}
  create(): void {
    this.#backdrop=this.add.graphics();this.#board=this.add.graphics();
    const canvas=this.game.canvas;canvas.tabIndex=0;canvas.setAttribute('aria-label','Поле оранжереи: 19 клеток');
    this.#controls=new FieldInput(canvas,{
      active:()=>!this.#blocked && !!this.#state?.season,
      cell:p=>this.#view?cellAt(toWorld(this.#view,p),this.#size()):null,
      occupied:c=>!!this.#state?.season?.layout.objects.some(o=>sameCell(o,c)),
      hover:(p,from)=>{this.#hover=p&&this.#view?cellAt(toWorld(this.#view,p),this.#size()):null;this.#dragFrom=from;this.#paintBoard();},
      tap:this.#options.tap,drop:this.#options.drop,context:this.#options.context,
      pan:(dx,dy)=>{if(this.#view){this.#view=panField(this.#view,dx,dy);this.#paintBoard();}},
      zoom:(factor,anchor)=>{if(this.#view){this.#view=zoomField(this.#view,factor,anchor);this.#paintBoard();}},
    });
    this.scale.on('resize',this.#resize,this);
    this.events.once('shutdown',()=>{this.scale.off('resize',this.#resize,this);this.#controls?.destroy();});
    this.#options.ready();this.#resize();
  }
  #size(){return fieldSize(this.#state?.season?.access??[]);}
  setState(state:GameState|null,tool:FieldTool): void {
    const newSeason=state?.season?.number!==this.#state?.season?.number;
    this.#state=state;this.#tool=tool;
    this.game?.canvas?.setAttribute('aria-label',`Поле оранжереи: ${this.#size()} клеток`);
    if(this.#board){
      if(newSeason||!this.#view)this.overview();
      else {
        const rect=this.#options.viewport();
        if(Object.keys(rect).some(key=>rect[key as keyof Viewport]!==this.#view!.rect[key as keyof Viewport])){
          const fit=fitField(rect,this.#size());this.#view={...fit,center:this.#view.center,zoom:fit.zoom*this.#view.zoom/this.#view.fitZoom};
        }
        this.#paintBoard();
      }
    }
  }
  setInputBlocked(blocked:boolean): void {
    if(this.input)this.input.enabled=!blocked;
    if(blocked&&!this.#blocked)this.#controls?.cancel();
    this.#blocked=blocked;
  }
  overview(): void {this.#controls?.cancel();this.#view=fitField(this.#options.viewport(),this.#size());this.#paintBoard();}
  cancelGesture(): void {this.#controls?.cancel();}
  #resize(): void {
    const {width:w,height:h}=this.scale;
    this.#backdrop.clear().fillStyle(0xd4e2ce).fillRect(0,0,w,h);
    this.#backdrop.lineStyle(2,0xb4cbb5,.7).strokeRoundedRect(w*.08,-h*.3,w*.84,h*.8,60);
    this.#backdrop.lineBetween(w*.5,0,w*.5,h*.48);this.#backdrop.lineBetween(w*.08,h*.18,w*.92,h*.18);
    this.#backdrop.fillStyle(0xf6d9a1,.8).fillCircle(w*.79,h*.13,Math.min(w,h)*.12);
    this.overview();
  }
  #polygon(cell:Cell,color:number,alpha=1,inset=.94): void {
    if(!this.#view)return;
    const center=cellCenter(cell);
    const points=cellCorners(cell).map(p=>toScreen(this.#view!,{x:center.x+(p.x-center.x)*inset,y:center.y+(p.y-center.y)*inset}));
    this.#board.fillStyle(color,alpha).lineStyle(Math.max(1,this.#view.zoom),0x6e8c65,.7).beginPath();
    this.#board.moveTo(points[0]!.x,points[0]!.y);
    for(const p of points.slice(1))this.#board.lineTo(p.x,p.y);
    this.#board.closePath().fillPath().strokePath();
  }
  #paintBoard(): void {
    if(!this.#board||!this.#view)return;
    this.#board.clear();if(!this.#state?.season)return;
    const objects=this.#state.season.layout.objects;
    for(const cell of fieldCells(this.#size()))this.#polygon(cell,0xf0e4c8);
    let kind: ObjectKind | undefined;
    const from=this.#dragFrom??(this.#tool&&'from'in this.#tool?this.#tool.from:null);
    if(from)kind=objects.find(o=>sameCell(o,from))?.kind;
    else if(this.#tool&&'kind'in this.#tool)kind=this.#tool.kind;
    else if(this.#hover)kind=objects.find(o=>sameCell(o,this.#hover!))?.kind;
    if(from)this.#polygon(from,0xb6c9a5);
    if(this.#tool||this.#dragFrom)for(const c of fieldCells(this.#size())){
      if(!objects.some(o=>sameCell(o,c)))this.#polygon(c,0xc9ddac,.5);
    }
    const fx=this.#state.season.effects;
    const zoneObjects=this.#hover&&kind&&(from||this.#tool)?[...objects.filter(o=>!from||!sameCell(o,from)),{...this.#hover,kind,adaptation:0 as const}]:objects;
    const zoneEffects=from&&this.#hover?{...fx,modules:fx.modules.map(m=>m.at&&sameCell(m.at,from)?{...m,at:this.#hover}:m)}:fx;
    if(this.#hover && (kind==='lamp'||kind==='sprinkler'))for(const c of deviceZone(this.#hover,zoneObjects,zoneEffects,this.#size())){
      this.#polygon(c,kind==='lamp'?0xf2c957:0x6abac3,.65);
    }
    let ghost: PlacedObject | null=null;
    if(this.#hover){
      const valid=!objects.some(o=>sameCell(o,this.#hover!)) || (!!from&&sameCell(from,this.#hover));
      this.#polygon(this.#hover,valid?0x77a779:0xd98b74,.5);
      if(kind && (this.#tool||this.#dragFrom) && valid)ghost={...this.#hover,kind,adaptation:0};
    }
    const sourcePlant=from?this.#state.season.garden.plants.find(p=>sameCell(p,from)):undefined;
    const sprites:{object:PlacedObject;alpha:number;plant?:PlantState}[]=[...objects.map(object=>({object,alpha:1})),...(ghost?[{object:ghost,alpha:.65,plant:sourcePlant}]:[])];
    // Тени ниже значков условий; сами объекты всегда выше подсветки и значков.
    for(const {object,alpha} of sprites){
      const p=toScreen(this.#view,cellCenter(object)),s=this.#view.zoom;
      this.#board.fillStyle(0x445d44,.16*alpha).fillEllipse(p.x+4*s,p.y+7*s,36*s,13*s);
    }
    const living=livingObjects(objects,this.#state.season.garden.plants);
    for(const object of objects){
      const conditions=plantConditions(living,object,this.#state?.season?.effects,this.#size());
      if(conditions?.light)this.#drawCondition(object,'light');
      if(conditions?.water)this.#drawCondition(object,'water');
    }
    for(const sprite of sprites.sort((a,b)=>cellCenter(a.object).y-cellCenter(b.object).y))this.#drawObject(sprite.object,sprite.alpha,sprite.plant);
    for(const object of objects)if(moduleAt(fx,object)){
      const p=toScreen(this.#view,cellCenter(object)),z=this.#view.zoom,g=this.#board,x=p.x+18*z,y=p.y-17*z;
      g.fillStyle(0xeee3fa).fillCircle(x,y,5*z);g.lineStyle(Math.max(1,z),0x594166).strokeCircle(x,y,5*z);
      g.lineStyle(Math.max(1,z),0x594166).lineBetween(x-2*z,y,x+2*z,y).lineBetween(x,y-2*z,x,y+2*z);
    }
  }
  #drawCondition(cell:Cell,condition:'light'|'water'): void {
    const center=toScreen(this.#view!,cellCenter(cell)),s=this.#view!.zoom;
    const x=center.x+(condition==='light'?-24:24)*s,y=center.y+8*s,g=this.#board;
    g.fillStyle(0xf7f3e7).fillCircle(x,y,7*s);
    g.lineStyle(Math.max(1,s),0x45513e).strokeCircle(x,y,7*s);
    if(condition==='light'){
      g.lineStyle(Math.max(1,s),0x986e24);
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4;
        g.lineBetween(x+Math.cos(a)*4*s,y+Math.sin(a)*4*s,x+Math.cos(a)*5.5*s,y+Math.sin(a)*5.5*s);
      }
      g.fillStyle(0xe7bb52).fillCircle(x,y,3*s);
    }else{
      g.fillStyle(0x468d9d).beginPath().moveTo(x,y-5*s);
      for(const p of WATER_DROP.slice(1))g.lineTo(x+p.x*s,y+p.y*s);
      g.closePath().fillPath();
    }
  }
  #drawObject(o:PlacedObject,alpha:number,previewPlant?:PlantState): void {
    const p=toScreen(this.#view!,cellCenter(o)),s=this.#view!.zoom;
    const g=this.#board,color=CATALOG.find(c=>c.kind===o.kind)!.color;
    // Единый контур обязателен для каждого выставляемого объекта и его превью.
    const outline=0x45513e,edge=Math.max(1,2*s);
    if(isPlant(o.kind)){
      const crop=previewPlant??this.#state?.season?.garden.plants.find(plant=>sameCell(plant,o))??newPlant(o);
      const dead=crop.wilt===3;
      g.fillStyle(0xb87c56,alpha).fillRoundedRect(p.x-11*s,p.y-3*s,22*s,17*s,4*s);
      g.lineStyle(edge,outline,alpha).strokeRoundedRect(p.x-11*s,p.y-3*s,22*s,17*s,4*s);
      const head={x:p.x+crop.wilt*3*s,y:p.y-(dead?15:26-crop.wilt*3)*s};
      g.lineStyle(5*s,outline,alpha).lineBetween(p.x,p.y-2*s,head.x,head.y+4*s);
      g.lineStyle(3*s,dead?0x8a7351:0x467950,alpha).lineBetween(p.x,p.y-2*s,head.x,head.y+4*s);
      g.fillStyle(crop.wilt>=2?0x9b8054:0x65955d,alpha).fillEllipse(p.x-6*s,p.y-13*s,14*s,7*s);
      g.lineStyle(edge,outline,alpha).strokeEllipse(p.x-6*s,p.y-13*s,14*s,7*s);
      if(dead){
        g.lineStyle(3*s,outline,alpha).lineBetween(head.x-4*s,head.y-4*s,head.x+4*s,head.y+4*s);
        g.lineBetween(head.x+4*s,head.y-4*s,head.x-4*s,head.y+4*s);
      }else if(crop.growth===0){
        g.fillStyle(outline,alpha).fillCircle(head.x,head.y,12*s);
        g.fillStyle(color,alpha).fillCircle(head.x,head.y,10*s);
        g.fillStyle(0xf7e7a7,alpha).fillCircle(head.x,head.y,3*s);
      }else if(o.kind==='tulip'){
        const points=[[-13,-10],[-6,-5],[0,-13],[6,-5],[13,-10],[11,5],[5,12],[-5,12],[-11,5]];
        const bloom=(scale:number,c:number)=>{g.fillStyle(c,alpha).beginPath();for(let i=0;i<points.length;i++){const [x,y]=points[i]!;if(i===0)g.moveTo(head.x+x!*s*scale,head.y+y!*s*scale);else g.lineTo(head.x+x!*s*scale,head.y+y!*s*scale);}g.closePath().fillPath();};
        bloom(crop.yield?1:.8,outline);bloom(crop.yield?.82:.62,color);
      }else if(o.kind==='lily'){
        for(const [radius,c] of [[16,outline],[13,color]] as const){g.fillStyle(c,alpha).beginPath();for(let i=0;i<12;i++){const a=-Math.PI/2+i*Math.PI/6,r=i%2?radius*.42:radius;const x=head.x+Math.cos(a)*r*s,y=head.y+Math.sin(a)*r*s;if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}g.closePath().fillPath();}
        g.fillStyle(0xd7a23e,alpha).fillCircle(head.x,head.y,3*s);
      }else if(o.kind==='gerbera'){
        for(const [radius,c] of [[7,outline],[5,color]] as const)for(let i=0;i<12;i++){const a=i*Math.PI/6;g.fillStyle(c,alpha).fillEllipse(head.x+Math.cos(a)*8*s,head.y+Math.sin(a)*8*s,radius*s,radius*1.5*s);}
        g.fillStyle(outline,alpha).fillCircle(head.x,head.y,5*s);g.fillStyle(0x6e4933,alpha).fillCircle(head.x,head.y,3*s);
      }else{
        const radius=crop.yield?7:5,offset=crop.yield?8:6;
        // Общий тёмный силуэт до заливки лепестков — без внутренних швов.
        for(let i=0;i<7;i++){const a=i*Math.PI*2/7;g.fillStyle(outline,alpha).fillCircle(head.x+Math.cos(a)*offset*s,head.y+Math.sin(a)*(offset-1)*s,(radius+2)*s);}
        for(let i=0;i<7;i++){const a=i*Math.PI*2/7;g.fillStyle(color,alpha).fillCircle(head.x+Math.cos(a)*offset*s,head.y+Math.sin(a)*(offset-1)*s,radius*s);}
        g.fillStyle(0xf7e7a7,alpha).fillCircle(head.x,head.y,4*s);
      }
      if(o.kind==='rose'&&crop.growth>0&&!dead){g.lineStyle(Math.max(1,s),outline,alpha).strokeCircle(head.x,head.y,6*s);g.lineStyle(Math.max(1,s),outline,alpha).lineBetween(head.x-3*s,head.y,head.x+2*s,head.y+3*s);}
      const bar=crop.wilt?0xb75f40:crop.yield?0x3f874e:crop.recovering?0x6f96a4:0x849c5e;
      g.fillStyle(outline,alpha).fillRoundedRect(p.x-13*s,p.y+17*s,26*s,4*s,2*s);
      g.fillStyle(0xe0dfca,alpha).fillRoundedRect(p.x-12*s,p.y+18*s,24*s,2*s,s);
      if(crop.growth || dead)g.fillStyle(bar,alpha).fillRoundedRect(p.x-12*s,p.y+18*s,24*s*(dead?1:crop.growth/8),2*s,s);
    }else if(o.kind==='lamp'){
      g.fillStyle(0x6b7860,alpha).fillRoundedRect(p.x-13*s,p.y+2*s,26*s,9*s,4*s);
      g.lineStyle(edge,outline,alpha).strokeRoundedRect(p.x-13*s,p.y+2*s,26*s,9*s,4*s);
      g.lineStyle(7*s,outline,alpha).lineBetween(p.x,p.y+3*s,p.x,p.y-24*s);
      g.lineStyle(4*s,0x76826c,alpha).lineBetween(p.x,p.y+3*s,p.x,p.y-24*s);
      // Общий силуэт без miter-выступов от пересечения двух stroke-контуров.
      g.fillStyle(outline,alpha).fillTriangle(p.x-17*s,p.y-19*s,p.x+17*s,p.y-19*s,p.x,p.y-36*s);
      g.fillStyle(color,alpha).fillTriangle(p.x-13.5*s,p.y-20*s,p.x+13.5*s,p.y-20*s,p.x,p.y-32.5*s);
      g.fillStyle(outline,alpha).fillEllipse(p.x,p.y-19*s,36*s,10*s);
      g.fillStyle(0xffeab3,alpha).fillEllipse(p.x,p.y-19*s,32*s,6*s);
    }else{
      g.fillStyle(color,alpha).fillRoundedRect(p.x-13*s,p.y-10*s,26*s,23*s,6*s);
      g.lineStyle(edge,outline,alpha).strokeRoundedRect(p.x-13*s,p.y-10*s,26*s,23*s,6*s);
      g.lineStyle(8*s,outline,alpha).lineBetween(p.x,p.y-10*s,p.x,p.y-24*s);
      g.lineStyle(5*s,0x426b70,alpha).lineBetween(p.x,p.y-10*s,p.x,p.y-24*s);
      g.fillStyle(0x416f74,alpha).fillRoundedRect(p.x-17*s,p.y-27*s,34*s,7*s,3*s);
      g.lineStyle(edge,outline,alpha).strokeRoundedRect(p.x-17*s,p.y-27*s,34*s,7*s,3*s);
      g.fillStyle(0xd8f3ed,alpha).fillCircle(p.x,p.y,4*s);
    }
  }
  override update(_time:number,delta:number): void {
    this.#controls?.update(Math.min(delta/1000,.05));this.#elapsed+=Math.min(delta/1000,.05);
    if(this.#elapsed>=.5){this.#elapsed=0;this.#options.frame(this.game.loop.actualFps,this.children.length);}
  }
}
