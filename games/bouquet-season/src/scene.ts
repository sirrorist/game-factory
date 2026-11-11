import {fieldSize} from './core/shop.ts';
import * as Phaser from 'phaser';
import { cellAt, cellCenter, cellCorners, fieldCells, sameCell, type Cell, type FieldSize, type Point } from './core/field.ts';
import { moduleAt, ownDeviceZone } from './core/effects.ts';
import { deviceZone, plantConditions } from './core/conditions.ts';
import { fitField, panField, toWorld, zoomField, type FieldView, type Viewport } from './core/camera.ts';
import { CATALOG, isPlant, type ObjectKind, type PlacedObject } from './core/layout.ts';
import type { GameState } from './core/state.ts';
import { FieldInput } from './field-input.ts';
import { livingObjects, newPlant, type PlantState } from './core/growth.ts';

export type FieldTool = {kind:ObjectKind} | {from:Cell} | null;
interface Options {
  ready: () => void;
  frame: (fps:number,objects:number) => void;
  viewport: () => Viewport;
  tap: (cell:Cell) => void;
  drop: (from:Cell|null,to:Cell) => void;
  context: (cell:Cell|null,cancelDrag:boolean) => void;
  // Сокращённые переходы: поле стоит неподвижно, без появления, покачивания и струй.
  reducedMotion: () => boolean;
}
type Stage = 'sprout' | 'bud' | 'bloom' | 'dead';
interface Sprite { box: Phaser.GameObjects.Container; sig: string; picZoom: number; order: number; baseY: number; cell: Cell; plant: boolean; lean: number; period: number; phase: number }

// Высота боковой грани клетки и цвета зон: жёлтый - свет, голубой - полив.
const DEPTH = 11, SUN = 0xe0a93a, WATER = 0x4f9fb0;
const color = (kind: ObjectKind) => CATALOG.find(c => c.kind === kind)!.color;
function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}
const light = (c: number, t = .28) => mix(c, 0xfff8ea, t);
const dark = (c: number, t = .25) => mix(c, 0x2b2a3a, t);
const pts = (list: Point[]) => list.map(p => new Phaser.Math.Vector2(p.x, p.y));
const key = (c: Cell) => `${c.q},${c.r}`;
// Детерминированный шум: одна и та же клетка всегда выглядит одинаково.
const noise = (q: number, r: number, k = 0) => {
  const s = Math.sin(q * 127.1 + r * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const shrink = (corners: Point[], c: Point, k: number, dx = 0, dy = 0): Point[] =>
  corners.map(p => ({ x: c.x + (p.x - c.x) * k + dx, y: c.y + (p.y - c.y) * k + dy }));
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const backOut = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function stageOf(crop: PlantState): Stage {
  if (crop.wilt === 3) return 'dead';
  if (crop.yield) return 'bloom';
  return crop.growth >= 4 ? 'bud' : 'sprout';
}
// Контур клетки - заливка между двумя вложенными шестиугольниками, а не толстая линия:
// у линий в Phaser нет стыков, и на углах появлялись щели.
function band(g: Phaser.GameObjects.Graphics, k: Point[], c: Point, outer: number, inner: number, fill: (i: number) => number, alpha = 1, dashes = 1): void {
  const o = shrink(k, c, outer), n = shrink(k, c, inner);
  for (let i = 0; i < 6; i++) for (let j = 0; j < dashes; j++) {
    const t0 = j / dashes, t1 = (j + 1) / dashes, i2 = (i + 1) % 6;
    g.fillStyle(fill(i * dashes + j), alpha);
    g.fillPoints(pts([lerp(o[i]!, o[i2]!, t0), lerp(o[i]!, o[i2]!, t1), lerp(n[i]!, n[i2]!, t1), lerp(n[i]!, n[i2]!, t0)]), true);
  }
}

export class WorkshopScene extends Phaser.Scene {
  #shadow!: Phaser.GameObjects.Graphics;
  #overlay!: Phaser.GameObjects.Graphics;
  #glow!: Phaser.GameObjects.Graphics;
  #marks!: Phaser.GameObjects.Graphics;
  #fxLayer!: Phaser.GameObjects.Graphics;
  #tiles = new Map<string, { g: Phaser.GameObjects.Graphics; sig: string; order: number }>();
  #sprites = new Map<string, Sprite>();
  #ghost: Sprite | null = null;
  #shadowSize: FieldSize | null = null;
  #wet: Point[] = [];
  #sparkles: Point[] = [];
  #sprinklers: Point[] = [];
  #controls?: FieldInput;
  #options: Options;
  #state: GameState | null = null;
  #tool: FieldTool = null;
  #selected: Cell | null = null;
  #view?: FieldView;
  #hover: Cell | null = null;
  #dragFrom: Cell | null = null;
  #blocked = true;
  #elapsed = 0;
  #t = 0;
  // Появление поля: время начала, затем время, с которого проявляются эффекты зон.
  #intro: number | null = null;
  #fxStart = 0;
  // Неподвижные тень и клетки запекаются в текстуру: Canvas 2D иначе перерисовывает
  // сотни фигур каждый кадр. При глубоком увеличении текстура была бы огромной -
  // тогда клетки рисуются вживую.
  #baked?: Phaser.GameObjects.RenderTexture;
  #bakedZoom = 0;
  #bakeDirty = true;
  // Объекты тоже рисуются в текстуры - по одной на вид, стадию и масштаб; покачивание и
  // приседание остаются трансформациями контейнера. При жесте масштаба текстуры
  // пересоздаются, когда масштаб постоял 0,15 с.
  #picZoom = 0;
  #zoomedAt = 0;
  #pictures = new Set<string>();
  constructor(options: Options) {super('workshop');this.#options=options;}
  create(): void {
    this.#shadow=this.add.graphics().setDepth(0);
    this.#overlay=this.add.graphics().setDepth(2);
    this.#glow=this.add.graphics().setDepth(2.5).setBlendMode(Phaser.BlendModes.ADD);
    this.#marks=this.add.graphics().setDepth(4);
    this.#fxLayer=this.add.graphics().setDepth(5);
    const canvas=this.game.canvas;canvas.tabIndex=0;canvas.setAttribute('aria-label','Поле оранжереи: 19 клеток');canvas.dataset.intro='done';
    this.#controls=new FieldInput(canvas,{
      active:()=>!this.#blocked && !!this.#state?.season,
      cell:p=>this.#view?cellAt(toWorld(this.#view,p),this.#size()):null,
      occupied:c=>!!this.#state?.season?.layout.objects.some(o=>sameCell(o,c)),
      hover:(p,from)=>{this.#hover=p&&this.#view?cellAt(toWorld(this.#view,p),this.#size()):null;this.#dragFrom=from;this.#paintOverlay();},
      tap:this.#options.tap,drop:this.#options.drop,context:this.#options.context,
      pan:(dx,dy)=>{if(this.#view){this.#view=panField(this.#view,dx,dy);this.#applyCamera();}},
      zoom:(factor,anchor)=>{if(this.#view){this.#view=zoomField(this.#view,factor,anchor);this.#applyCamera();}},
    });
    this.scale.on('resize',this.#resize,this);
    this.events.once('shutdown',()=>{this.scale.off('resize',this.#resize,this);this.#controls?.destroy();});
    this.#options.ready();this.#resize();
  }
  #size(){return fieldSize(this.#state?.season?.access??[]);}
  setState(state:GameState|null,tool:FieldTool,selected:Cell|null=null): void {
    const newSeason=state?.season?.number!==this.#state?.season?.number;
    this.#state=state;this.#tool=tool;this.#selected=selected;
    this.game?.canvas?.setAttribute('aria-label',`Поле оранжереи: ${this.#size()} клеток`);
    if(!this.#overlay)return;
    if(newSeason&&state?.season)this.#startIntro();
    if(newSeason||!this.#view){this.#controls?.cancel();this.#view=fitField(this.#options.viewport(),this.#size());}
    else {
      const rect=this.#options.viewport();
      if(Object.keys(rect).some(k=>rect[k as keyof Viewport]!==this.#view!.rect[k as keyof Viewport])){
        const fit=fitField(rect,this.#size());this.#view={...fit,center:this.#view.center,zoom:fit.zoom*this.#view.zoom/this.#view.fitZoom};
      }
    }
    this.#picZoom=this.#view.zoom;
    this.#rebuild();this.#applyCamera();this.#dropPictures();
  }
  setInputBlocked(blocked:boolean): void {
    if(this.input)this.input.enabled=!blocked;
    if(blocked&&!this.#blocked)this.#controls?.cancel();
    this.#blocked=blocked;
  }
  overview(): void {this.#controls?.cancel();this.#view=fitField(this.#options.viewport(),this.#size());this.#applyCamera();this.#syncPictures();this.#paintOverlay();}
  #syncPictures(): void {
    if(!this.#view||this.#picZoom===this.#view.zoom)return;
    this.#picZoom=this.#view.zoom;this.#rebuild();this.#dropPictures();
  }
  // Текстуры прежнего масштаба больше никем не используются.
  #dropPictures(): void {
    const tag=`@${this.#picZoom}`;
    for(const id of this.#pictures)if(!id.endsWith(tag)){this.textures.remove(id);this.#pictures.delete(id);}
  }
  #picture(kind:ObjectKind,stage:Stage|'',wilt:number,scale:number): Phaser.GameObjects.Image {
    // Границы рисунка до масштаба объекта: тень, листья, самый высокий цветок и абажур лампы.
    const L=-26,T=-68,W=56,H=80,zoom=Math.min(this.#picZoom*scale,10),id=`bouquet:${kind}|${stage}|${wilt}|${scale}@${this.#picZoom}`;
    if(!this.textures.exists(id)){
      const g=this.make.graphics({},false);
      g.fillStyle(0x3b3426,.18).fillEllipse(4,2,34,12);
      if(kind==='lamp')this.#lamp(g);else if(kind==='sprinkler')this.#sprinklerBody(g);else this.#plant(g,kind,stage as Stage,color(kind),wilt);
      const texture=this.textures.addDynamicTexture(id,Math.ceil(W*zoom),Math.ceil(H*zoom))!;
      texture.camera.setOrigin(0,0).setZoom(zoom).setScroll(L,T);
      texture.draw(g).render();g.destroy();this.#pictures.add(id);
    }
    return this.add.image(L*scale,T*scale,id).setOrigin(0,0).setScale(scale/zoom);
  }
  cancelGesture(): void {this.#controls?.cancel();}
  #resize(): void {this.overview();}
  // Камера Phaser повторяет FieldView: мировая точка center попадает в центр rect,
  // поэтому toScreen/toWorld ввода и картинка совпадают без пересчёта каждой точки.
  #applyCamera(): void {
    const view=this.#view,cam=this.cameras?.main;if(!view||!cam)return;
    const {width:w,height:h}=this.scale;
    cam.setZoom(view.zoom);
    cam.centerOn(view.center.x+(w/2-view.rect.x-view.rect.width/2)/view.zoom,view.center.y+(h/2-view.rect.y-view.rect.height/2)/view.zoom);
    if(view.zoom!==this.#bakedZoom)this.#bakeDirty=true;
    if(view.zoom!==this.#picZoom)this.#zoomedAt=this.#t;
  }
  #bake(): void {
    this.#bakeDirty=false;
    const tiles=[...this.#tiles.values()].sort((a,b)=>a.order-b.order),zoom=this.#view?.zoom??1;
    const live=(on:boolean)=>{this.#shadow.setVisible(on);for(const t of tiles)t.g.setVisible(on);this.#baked?.setVisible(!on);};
    if(!tiles.length){live(true);return;}
    const corners=fieldCells(this.#size()).flatMap(cellCorners);
    const left=Math.min(...corners.map(p=>p.x))-16,top=Math.min(...corners.map(p=>p.y))-16;
    const width=Math.max(...corners.map(p=>p.x))+16-left,height=Math.max(...corners.map(p=>p.y))+DEPTH+50-top;
    if(width*zoom>4096||height*zoom>4096){live(true);this.#bakedZoom=0;return;}
    const w=Math.ceil(width*zoom),h=Math.ceil(height*zoom);
    if(!this.#baked)this.#baked=this.add.renderTexture(0,0,w,h).setOrigin(0,0).setDepth(1);
    else if(this.#baked.width!==w||this.#baked.height!==h)this.#baked.resize(w,h);
    const rt=this.#baked.setPosition(left,top).setScale(1/zoom);
    live(true);rt.clear();
    // Разрешение текстуры равно масштабу камеры: на экране пиксель в пиксель.
    // Масштаб - камерой самой текстуры: собственный scale объекта при записи в неё не учитывается.
    rt.camera.setOrigin(0,0).setZoom(zoom).setScroll(left,top);
    for(const g of [this.#shadow,...tiles.map(t=>t.g)])rt.draw(g);
    rt.render();live(false);this.#bakedZoom=zoom;
  }
  #startIntro(): void {
    this.#bakeDirty=true;
    if(this.#options.reducedMotion()){this.#intro=null;this.#fxStart=-1;return;}
    // Во время появления клетки движутся по одной - рисуются вживую.
    this.#shadow.setVisible(true);for(const t of this.#tiles.values())t.g.setVisible(true);this.#baked?.setVisible(false);
    this.#intro=this.#t;this.game.canvas.dataset.intro='running';
  }
  #rebuild(): void {
    const s=this.#state?.season;
    const size=this.#size(),cells=s?[...fieldCells(size)].sort((a,b)=>cellCenter(a).y-cellCenter(b).y||cellCenter(a).x-cellCenter(b).x):[];
    const present=new Set(cells.map(key));
    for(const [k,tile] of this.#tiles)if(!present.has(k)){tile.g.destroy();this.#tiles.delete(k);this.#bakeDirty=true;}
    this.#wet=[];this.#sparkles=[];this.#sprinklers=[];this.#glow.clear();this.#marks.clear();
    if(!s){
      this.#shadow.clear();this.#shadowSize=null;
      for(const sprite of this.#sprites.values())sprite.box.destroy();
      this.#sprites.clear();this.#paintOverlay();return;
    }
    if(this.#shadowSize!==size){this.#paintShadow(cells);this.#shadowSize=size;this.#bakeDirty=true;}
    const objects=s.layout.objects,fx=s.effects,living=livingObjects(objects,s.garden.plants);
    const lit=new Set<string>(),wet=new Set<string>();
    for(const device of living.filter(o=>!isPlant(o.kind))){
      for(const c of deviceZone(device,living,fx,size))(device.kind==='lamp'?lit:wet).add(key(c));
      if(moduleAt(fx,device)?.effect==='E4')for(const c of ownDeviceZone(device,fx,size)){lit.add(key(c));wet.add(key(c));}
    }
    cells.forEach((cell,order)=>{
      const object=objects.find(o=>sameCell(o,cell)),c=cellCenter(cell);
      const type=!object?'meadow':isPlant(object.kind)?'bed':'slab';
      let l=false,w=false;
      // Под устройствами зон нет; растение берёт условия с учётом эффектов вида.
      if(type!=='slab'){
        const conditions=object?plantConditions(living,object,fx,size):null;
        l=conditions?conditions.light:lit.has(key(cell));w=conditions?conditions.water:wet.has(key(cell));
      }
      const selected=!!this.#selected&&sameCell(this.#selected,cell);
      const sig=`${type}|${l}|${w}|${selected}`,old=this.#tiles.get(key(cell));
      if(old?.sig!==sig){old?.g.destroy();this.#tiles.set(key(cell),{g:this.#tile(cell,type,l,w,selected).setDepth(1+order/1000),sig,order});this.#bakeDirty=true;}
      else old.order=order;
      if(w)this.#wet.push({x:c.x+16,y:c.y+10});
    });
    for(const [k,sprite] of this.#sprites)if(!objects.some(o=>key(o)===k)){sprite.box.destroy();this.#sprites.delete(k);}
    for(const object of objects){
      const crop=s.garden.plants.find(p=>sameCell(p,object));
      const sig=this.#signature(object,crop),old=this.#sprites.get(key(object)),order=cells.findIndex(c=>sameCell(c,object));
      if(old?.sig!==sig||old.picZoom!==this.#picZoom){old?.box.destroy();this.#sprites.set(key(object),this.#sprite(object,crop,1,order));}
      const c=cellCenter(object);
      if(crop&&stageOf(crop)==='bloom')this.#sparkles.push({x:c.x+15,y:c.y+6-28*1.4-12});
      if(object.kind==='sprinkler')this.#sprinklers.push({x:c.x,y:c.y+6-14*1.3});
      if(object.kind==='lamp')for(const [w,a] of [[170,.05],[120,.07],[70,.1],[34,.16]] as const){
        this.#glow.fillStyle(0xffd27a,a).fillEllipse(c.x,c.y-30,w,w*.7);
      }
      // Значок модуля - поверх объектов, у переднего края клетки.
      if(moduleAt(fx,object)){
        const x=c.x+14,y=c.y+14,g=this.#marks;
        g.fillStyle(0xeee3fa).fillCircle(x,y,5.5);g.lineStyle(1.4,0x594166).strokeCircle(x,y,5.5);
        g.lineBetween(x-2.4,y,x+2.4,y).lineBetween(x,y-2.4,x,y+2.4);
      }
    }
    this.#paintOverlay();
  }
  #signature(o:PlacedObject,crop?:PlantState):string{
    if(!isPlant(o.kind))return o.kind;
    const p=crop??newPlant(o);
    return `${o.kind}|${stageOf(p)}|${p.wilt}|${p.growth}|${p.yield?1:0}|${p.recovering}`;
  }
  // Мягкая тень острова: несколько полупрозрачных слоёв вместо размытия.
  #paintShadow(cells:Cell[]): void {
    const g=this.#shadow.clear();
    for(const [k,a,dy] of [[1.22,.025,30],[1.16,.03,26],[1.1,.035,22],[1.04,.04,18],[1,.05,15]] as const){
      g.fillStyle(0x3b4a3c,a);
      for(const cell of cells)g.fillPoints(pts(shrink(cellCorners(cell),cellCenter(cell),k,0,dy)),true);
    }
  }
  #tile(cell:Cell,type:'meadow'|'bed'|'slab',lit:boolean,wet:boolean,selected:boolean): Phaser.GameObjects.Graphics {
    const g=this.add.graphics(),c=cellCenter(cell),k=cellCorners(cell),n=noise(cell.q,cell.r);
    const slab=type==='slab',top=slab?mix(0xd9d2bf,0xcfc7b0,n):mix(0x9fc58a,0xb4cf8d,n);
    // Боковые грани: видны две нижние, левая на свету, правая в тени.
    const side=(a:Point,b:Point,col:number)=>{
      g.fillStyle(col,1).fillPoints(pts([a,b,{x:b.x,y:b.y+DEPTH},{x:a.x,y:a.y+DEPTH}]),true);
      g.fillStyle(slab?0xbdb39b:0x7fa86c,1).fillPoints(pts([a,b,{x:b.x,y:b.y+3},{x:a.x,y:a.y+3}]),true);
    };
    side(k[2]!,k[3]!,slab?0xa89c84:0x9b7a57);
    side(k[1]!,k[2]!,slab?0x8f846e:0x7f6248);
    g.fillStyle(top,1).fillPoints(pts(k),true);
    // Верх светлее к левому верхнему краю - общий источник света.
    g.fillStyle(light(top,.22),1).fillPoints(pts(shrink(k,c,.78,-3,-3)),true);
    g.fillStyle(light(top,.32),1).fillPoints(pts(shrink(k,c,.5,-6,-5)),true);
    if(lit)g.fillStyle(0xffe2a0,.38).fillPoints(pts(shrink(k,c,.92)),true);
    if(wet)g.fillStyle(0x9fd6e0,.36).fillPoints(pts(shrink(k,c,.92)),true);
    // Контур зоны: оба условия сразу - жёлто-голубая зебра.
    if(lit&&wet)band(g,k,c,.8,.73,i=>i%2?WATER:SUN,1,4);
    else if(lit||wet)band(g,k,c,.8,.75,()=>lit?SUN:WATER,.9);
    if(type==='bed'){
      g.fillStyle(0x8a6a4a,1).fillEllipse(c.x,c.y+5,38,18);
      g.fillStyle(0xa8835c,1).fillEllipse(c.x-2,c.y+3,30,12);
      g.fillStyle(0xbf9a70,1).fillEllipse(c.x-5,c.y+1,14,5);
    }else if(!slab){
      // Луг: травинки и редкие цветочки, чтобы пустая клетка не была плоской.
      for(let i=0;i<7;i++){
        const x=c.x-24+noise(cell.q,cell.r,i)*48,y=c.y-14+noise(cell.q,cell.r,i+20)*28;
        g.lineStyle(1.6,dark(top,.18),1).lineBetween(x,y,x-1.5,y-5);
        g.lineBetween(x+2,y,x+3,y-4);
      }
      if(n>.55){g.fillStyle(0xfff4e0,1).fillCircle(c.x+14*(n-.5),c.y+8,2.2);g.fillStyle(0xf0b93a,1).fillCircle(c.x+14*(n-.5),c.y+8,1);}
    }else{
      for(const [dx,dy,w] of [[-16,-6,18],[14,-8,16],[-4,12,20]] as const){
        g.fillStyle(0xa99f88,1).fillEllipse(c.x+dx,c.y+dy+2,w,w*.5);
        g.fillStyle(0xe6dfcc,1).fillEllipse(c.x+dx-1,c.y+dy,w*.9,w*.42);
      }
    }
    if(selected){
      band(g,k,c,.93,.86,()=>0xfffdf4);
      band(g,k,c,.86,.835,()=>0xe5654b,.9);
    }
    return g;
  }
  #sprite(o:PlacedObject,crop:PlantState|undefined,alpha:number,order:number): Sprite {
    const c=cellCenter(o),box=this.add.container(c.x,c.y+6).setAlpha(alpha).setDepth(3+(c.y+2000)/100000+(alpha<1?1e-6:0));
    const plant=isPlant(o.kind),p=crop??newPlant(o);
    box.add(this.#picture(o.kind,plant?stageOf(p):'',plant?p.wilt:0,o.kind==='lamp'?1.2:o.kind==='sprinkler'?1.3:1.4));
    if(plant){
      // Полоска роста под грядкой: стадии видны на цветке, точные числа - в карточке.
      const bar=this.add.graphics(),dead=p.wilt===3,fill=p.wilt?0xb75f40:p.yield?0x3f874e:p.recovering?0x6f96a4:0x849c5e;
      bar.fillStyle(0x45513e,.85).fillRoundedRect(-13,9,26,4.5,2.2);
      bar.fillStyle(0xf3ead6,1).fillRoundedRect(-12,10,24,2.5,1.2);
      if(p.growth||dead)bar.fillStyle(fill,1).fillRoundedRect(-12,10,24*(dead?1:Math.min(1,p.growth/8)),2.5,1.2);
      box.add(bar);
    }
    return {box,sig:this.#signature(o,crop),picZoom:this.#picZoom,order,baseY:c.y+6,cell:o,plant,lean:plant?p.wilt*6:0,period:3.6+noise(o.q,o.r)*1.8,phase:noise(o.q,o.r,3)*Math.PI*2};
  }
  #leaf(g:Phaser.GameObjects.Graphics,x:number,y:number,dir:1|-1,len:number,dry:number): void {
    const tip={x:x+dir*len,y:y-len*.45};
    g.fillStyle(mix(0x7fb069,0xa68a5b,dry),1).fillTriangle(x,y,tip.x,tip.y,x+dir*len*.45,y-len*.55);
    g.fillStyle(mix(0x5b8f50,0x8a7351,dry),1).fillTriangle(x,y,tip.x,tip.y,x+dir*len*.55,y+len*.05);
  }
  #plant(g:Phaser.GameObjects.Graphics,kind:ObjectKind,stage:Stage,tone:number,wilt:number): void {
    if(stage==='dead'){
      // Погибшее растение: сухой согнутый стебель и поникший бутон.
      g.lineStyle(3,0x8a7351,1).beginPath();g.moveTo(0,0);g.lineTo(2,-10);g.lineTo(9,-16);g.strokePath();
      this.#leaf(g,0,-4,-1,9,1);
      g.fillStyle(0x7a6448,1).fillEllipse(10,-14,7,9);
      return;
    }
    const dry=wilt*.3,base=mix(tone,0x9b8054,dry),h=stage==='sprout'?9:stage==='bud'?22:28;
    g.lineStyle(3.4,mix(0x4f7f46,0x8a7351,dry),1).lineBetween(0,0,0,-h);
    g.lineStyle(1.4,mix(0x8fbd78,0xb09a70,dry),1).lineBetween(-1,-2,-1,-h+4);
    const L=light(base),D=dark(base),y=-h;
    if(stage==='sprout'){
      this.#leaf(g,0,-5,-1,10,dry);this.#leaf(g,0,-8,1,9,dry);
      // Цветной кончик ростка: вид посадки читается с первого дня.
      g.fillStyle(base,1).fillCircle(0,y-3,4.6);g.fillStyle(L,1).fillCircle(-1.6,y-4.6,1.3);
      return;
    }
    this.#leaf(g,0,-7,-1,14,dry);this.#leaf(g,0,-13,1,12,dry);
    if(stage==='bud'){
      g.fillStyle(0x5b8f50,1).fillTriangle(-6,y+4,6,y+4,0,y-2);
      g.fillStyle(L,1).fillTriangle(-5,y,0,y-14,0,y+1);
      g.fillStyle(D,1).fillTriangle(5,y,0,y-14,0,y+1);
      return;
    }
    switch(kind){
      case 'tulip':{
        g.fillStyle(D,1).fillPoints(pts([{x:0,y:y+4},{x:12,y:y-4},{x:10,y:y-20},{x:4,y:y-12}]),true);
        g.fillStyle(L,1).fillPoints(pts([{x:0,y:y+4},{x:-12,y:y-4},{x:-10,y:y-20},{x:-4,y:y-12}]),true);
        g.fillStyle(base,1).fillPoints(pts([{x:-6,y:y+2},{x:6,y:y+2},{x:5,y:y-16},{x:0,y:y-24},{x:-5,y:y-16}]),true);
        g.fillStyle(light(base,.45),1).fillTriangle(-5,y-16,0,y-24,0,y-6);
        break;
      }
      case 'rose':{
        g.fillStyle(D,1).fillEllipse(0,y-6,30,22);
        g.fillStyle(base,1).fillEllipse(-1,y-8,24,17);
        g.fillStyle(L,1).fillEllipse(-2,y-10,15,10);
        g.lineStyle(1.6,D,1).beginPath();g.arc(-1,y-10,5,.4,4.6);g.strokePath();
        g.fillStyle(light(base,.5),1).fillTriangle(-12,y-8,-6,y-15,-3,y-7);
        break;
      }
      case 'gerbera':{
        g.fillStyle(D,1).fillEllipse(0,y-6,34,18);
        for(let i=0;i<14;i++){
          const a=i/14*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);
          g.fillStyle(i%2?base:L,1).fillTriangle(-sa*4,y-8+ca*2.4,ca*17,y-8+sa*10,sa*4,y-8-ca*2.4);
        }
        g.fillStyle(0x6b4a2c,1).fillEllipse(0,y-8,12,7.5);
        g.fillStyle(0xf0b93a,1).fillEllipse(-1.5,y-9,6,3.5);
        break;
      }
      case 'chrysanthemum':{
        for(const [r,col,lift] of [[14,D,0],[10,base,4],[5.5,L,8],[0,light(base,.45),10]] as const){
          const count=r?12:1;
          for(let i=0;i<count;i++){
            const a=i/count*Math.PI*2+r;
            g.fillStyle(i%3?col:light(col,.15),1).fillEllipse(Math.cos(a)*r,y-8-lift+Math.sin(a)*r*.55,8,6);
          }
        }
        break;
      }
      case 'lily':{
        for(let i=0;i<6;i++){
          const a=i/6*Math.PI*2-Math.PI/2,ca=Math.cos(a),sa=Math.sin(a),tip={x:ca*17,y:y-8+sa*11};
          g.fillStyle(mix(i<3?0xfffaf0:0xe9dcc4,0x9b8054,dry),1).fillTriangle(-sa*6,y-8+ca*3.5,tip.x,tip.y,sa*6,y-8-ca*3.5);
          g.lineStyle(1.4,0xe7a3a0,.9).lineBetween(0,y-8,tip.x*.7,y-8+(tip.y-y+8)*.7);
        }
        g.fillStyle(0xe7a3a0,1).fillEllipse(0,y-8,9,6);
        g.lineStyle(1.2,0x8a5a2e,1);
        for(const dx of [-4,0,4]){g.lineBetween(0,y-8,dx,y-16);g.fillStyle(0xc0752f,1).fillCircle(dx,y-16,1.5);}
        break;
      }
      default:{
        // Гвоздика: зубчатая чашечка веером.
        g.fillStyle(0x5b8f50,1).fillTriangle(-5,y+4,5,y+4,0,y-6);
        const edge:Point[]=[{x:-4,y:y-2}];
        for(let i=0;i<=10;i++)edge.push({x:-15+i*3,y:y-12-(i%2?7:0)-Math.sin(i/10*Math.PI)*6});
        edge.push({x:4,y:y-2});
        g.fillStyle(D,1).fillPoints(pts(edge),true);
        g.fillStyle(base,1).fillPoints(pts(shrink(edge,{x:0,y:y-6},.8,-1,-1)),true);
        g.fillStyle(L,1).fillPoints(pts(shrink(edge,{x:0,y:y-6},.5,-2,-3)),true);
      }
    }
  }
  #lamp(g:Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x56645a,1).fillRect(-2.5,-46,5,46);
    g.fillStyle(0x7a8a7e,1).fillRect(-2.5,-46,2,46);
    g.fillStyle(0x56645a,1).fillEllipse(0,0,18,7);
    g.fillStyle(0xb88a3e,1).fillPoints(pts([{x:-16,y:-44},{x:16,y:-44},{x:8,y:-58},{x:-8,y:-58}]),true);
    g.fillStyle(0xe0b25a,1).fillPoints(pts([{x:-16,y:-44},{x:0,y:-44},{x:0,y:-58},{x:-8,y:-58}]),true);
    g.fillStyle(0xfff1c2,1).fillEllipse(0,-43,18,6);
  }
  // Низкий широкий дождеватель: ширина втрое больше высоты, коромысло рисуется отдельно.
  #sprinklerBody(g:Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x2f6460,1).fillEllipse(0,0,32,13);g.fillRect(-16,-8,32,8);
    g.fillStyle(0x3e7f7a,1).fillRect(-16,-8,13,8);
    g.fillStyle(0x5aa39c,1).fillEllipse(0,-8,32,13);
    g.fillStyle(0x7cc0b8,1).fillEllipse(-4,-9.5,18,6);
    g.fillStyle(0xb88a3e,1).fillRect(-2.5,-14,5,6);
    g.fillStyle(0xe0b25a,1).fillEllipse(0,-14,8,3.5);
  }
  #polygon(cell:Cell,fill:number,alpha=1,inset=.94): void {
    const c=cellCenter(cell);
    this.#overlay.fillStyle(fill,alpha).fillPoints(pts(shrink(cellCorners(cell),c,inset)),true);
  }
  // Подсветка выбора и превью зоны - над клетками, но под объектами.
  #paintOverlay(): void {
    if(!this.#overlay)return;
    this.#overlay.clear();
    const s=this.#state?.season;
    if(!s){this.#setGhost(null);return;}
    const objects=s.layout.objects,size=this.#size();
    let kind: ObjectKind | undefined;
    const from=this.#dragFrom??(this.#tool&&'from'in this.#tool?this.#tool.from:null);
    if(from)kind=objects.find(o=>sameCell(o,from))?.kind;
    else if(this.#tool&&'kind'in this.#tool)kind=this.#tool.kind;
    else if(this.#hover)kind=objects.find(o=>sameCell(o,this.#hover!))?.kind;
    if(from)this.#polygon(from,0xb6c9a5);
    if(this.#tool||this.#dragFrom)for(const c of fieldCells(size)){
      if(!objects.some(o=>sameCell(o,c)))this.#polygon(c,0xe8f1d2,.35);
    }
    const fx=s.effects;
    const zoneObjects=this.#hover&&kind&&(from||this.#tool)?[...objects.filter(o=>!from||!sameCell(o,from)),{...this.#hover,kind,adaptation:0 as const}]:objects;
    const zoneEffects=from&&this.#hover?{...fx,modules:fx.modules.map(m=>m.at&&sameCell(m.at,from)?{...m,at:this.#hover}:m)}:fx;
    if(this.#hover && (kind==='lamp'||kind==='sprinkler'))for(const c of deviceZone(this.#hover,zoneObjects,zoneEffects,size)){
      const center=cellCenter(c),k=cellCorners(c),tone=kind==='lamp'?SUN:WATER;
      this.#polygon(c,kind==='lamp'?0xffe2a0:0x9fd6e0,.55,.92);
      band(this.#overlay,k,center,.84,.74,()=>tone,1);
    }
    let ghost: PlacedObject | null=null;
    if(this.#hover){
      const valid=!objects.some(o=>sameCell(o,this.#hover!)) || (!!from&&sameCell(from,this.#hover));
      this.#polygon(this.#hover,valid?0x77a779:0xd98b74,.5);
      if(kind && (this.#tool||this.#dragFrom) && valid)ghost={...this.#hover,kind,adaptation:0};
    }
    this.#setGhost(ghost,from?s.garden.plants.find(p=>sameCell(p,from)):undefined);
  }
  #setGhost(ghost:PlacedObject|null,plant?:PlantState): void {
    const sig=ghost?`${key(ghost)}|${this.#signature(ghost,plant)}@${this.#picZoom}`:'';
    if((this.#ghost?.sig??'')===sig)return;
    this.#ghost?.box.destroy();this.#ghost=null;
    if(ghost){this.#ghost=this.#sprite(ghost,plant,.65,0);this.#ghost.sig=sig;}
  }
  override update(_time:number,delta:number): void {
    const dt=Math.min(delta/1000,.05);
    this.#controls?.update(dt);this.#elapsed+=dt;this.#t+=dt;
    if(this.#elapsed>=.5){this.#elapsed=0;this.#options.frame(this.game.loop.actualFps,this.children.length);}
    const still=this.#options.reducedMotion();
    if(this.#intro!==null)this.#playIntro(still);
    else if(this.#bakeDirty&&this.#state?.season)this.#bake();
    if(this.#t-this.#zoomedAt>=.15)this.#syncPictures();
    const fxAlpha=still||this.#fxStart<0?1:clamp01((this.#t-this.#fxStart)/.5)*(this.#intro===null?1:0);
    this.#glow.setAlpha(fxAlpha*(still?.85:.82+.08*Math.sin(this.#t*1.4)));
    for(const sprite of [...this.#sprites.values(),...(this.#ghost?[this.#ghost]:[])]){
      // Покачивание от основания: контейнер стоит на земле. Увядание наклоняет цветок.
      sprite.box.angle=sprite.lean+(still||!sprite.plant?0:Math.sin(this.#t*Math.PI*2/sprite.period+sprite.phase)*2.2);
      const chosen=!!this.#selected&&sameCell(this.#selected,sprite.cell)&&sprite.box.alpha===1;
      // Выбранный объект не прыгает, а приседает от основания.
      const squash=chosen&&!still?Math.max(0,Math.sin(this.#t*Math.PI/.62))**2:0;
      sprite.box.setScale(1+.08*squash,1-.1*squash);
    }
    this.#paintFx(fxAlpha,still);
  }
  // Клетки встают на место по очереди; эффекты зон проявляются после поля.
  #playIntro(still:boolean): void {
    const tiles=[...this.#tiles.values()],count=Math.max(1,tiles.length),step=Math.min(.03,.7/count);
    const elapsed=this.#t-this.#intro!,done=still||elapsed>step*count+.42;
    const at=(order:number)=>done?1:clamp01((elapsed-order*step)/.42);
    for(const tile of tiles){const p=at(tile.order);tile.g.setAlpha(p).setY(-18*(1-backOut(p)));}
    for(const sprite of this.#sprites.values()){const p=at(sprite.order);sprite.box.setAlpha(p).setY(sprite.baseY-18*(1-backOut(p)));}
    this.#shadow.setAlpha(done?1:clamp01((elapsed-step*count*.5)/.5));
    if(done){this.#intro=null;this.#fxStart=still?-1:this.#t;this.game.canvas.dataset.intro='done';}
  }
  // Коромысло, струи, круги на политых клетках и блёстки готовых цветов - каждый кадр.
  #paintFx(alpha:number,still:boolean): void {
    const g=this.#fxLayer.clear();
    if(!alpha||!this.#state?.season)return;
    g.setAlpha(alpha);
    if(!still)for(const [i,w] of this.#wet.entries()){
      const p=(this.#t*.55+i*.37)%1;
      g.lineStyle(1.4,WATER,.7*(1-p)).strokeEllipse(w.x,w.y,6+p*16,(6+p*16)*.45);
    }
    for(const [i,sp] of this.#sparkles.entries()){
      const a=still?.8:Math.max(0,Math.sin(this.#t*2.2+i*1.7)),r=2+a*3;
      g.fillStyle(0xfffbe8,a);
      g.fillTriangle(sp.x-r,sp.y,sp.x+r,sp.y,sp.x,sp.y-r*1.8).fillTriangle(sp.x-r,sp.y,sp.x+r,sp.y,sp.x,sp.y+r*1.8);
    }
    for(const [n,{x,y}] of this.#sprinklers.entries()){
      const rot=still?.6:this.#t*1.6+n,ex=Math.cos(rot)*21,ey=Math.sin(rot)*21*.45;
      g.lineStyle(4,0xb88a3e,1).lineBetween(x-ex,y-ey,x+ex,y+ey);
      g.fillStyle(0xe0b25a,1).fillCircle(x-ex,y-ey,3.2).fillCircle(x+ex,y+ey,3.2);
      if(still)continue;
      for(let i=0;i<14;i++){
        const p=(this.#t*.8+i/14*2)%1,a=rot+(i%2?Math.PI:0)-p*.9,d=20+p*52;
        g.fillStyle(0xcfeef2,.95*(1-p)).fillCircle(x+Math.cos(a)*d,y+Math.sin(a)*d*.45-Math.sin(p*Math.PI)*22,2.2);
      }
    }
  }
}
