import type { Cell, Point } from './core/field.ts';

interface InputOptions {
  active: () => boolean;
  cell: (p: Point) => Cell | null;
  occupied: (c: Cell) => boolean;
  hover: (p: Point | null, from: Cell | null) => void;
  tap: (c: Cell) => void;
  drop: (from: Cell | null, to: Cell) => void;
  context: (cell: Cell | null, cancelDrag: boolean) => void;
  pan: (dx: number, dy: number) => void;
  zoom: (factor: number, anchor: Point) => void;
}
// Один палец/левая кнопка работают с объектами; два пальца/средняя — только с камерой.
export class FieldInput {
  #canvas: HTMLCanvasElement;
  #options: InputOptions;
  #events = new AbortController();
  #points = new Map<number,Point>();
  #start: Point | null = null;
  #from: Cell | null = null;
  #dragging = false;
  #cameraGesture = false;
  #middle = false;
  #keys = new Set<string>();
  #fieldPointers = new Set<number>();
  #suppressClick = false;
  constructor(canvas: HTMLCanvasElement, options: InputOptions) {
    this.#canvas=canvas;this.#options=options;
    const signal=this.#events.signal;
    // Совместимый click после pointerup не должен попасть в только что открытый drawer.
    document.addEventListener('pointerdown',event=>{this.#suppressClick=false;this.#fieldPointers.delete(event.pointerId);},{signal,capture:true});
    document.addEventListener('pointerup',event=>{
      if(this.#fieldPointers.delete(event.pointerId))this.#suppressClick=true;
    },{signal,capture:true});
    document.addEventListener('pointercancel',event=>this.#fieldPointers.delete(event.pointerId),{signal,capture:true});
    document.addEventListener('click',event=>{
      if(this.#suppressClick && event.detail>0){this.#suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}
    },{signal,capture:true});
    canvas.addEventListener('pointerdown',this.#down,{signal});
    canvas.addEventListener('pointermove',this.#move,{signal});
    canvas.addEventListener('pointerup',this.#up,{signal});
    canvas.addEventListener('pointercancel',this.cancel,{signal});
    canvas.addEventListener('lostpointercapture',this.#lost,{signal});
    canvas.addEventListener('contextmenu',event=>{
      if(!options.active())return;
      event.preventDefault();
      const cell=options.cell(this.#position(event));
      const cancelDrag=this.#dragging || this.#from!==null;
      this.cancel();options.context(cell,cancelDrag);
    },{signal});
    canvas.addEventListener('pointerleave',()=>{if(!this.#points.size)options.hover(null,null);},{signal});
    canvas.addEventListener('wheel',event=>{
      if(!options.active())return;event.preventDefault();options.zoom(Math.exp(-event.deltaY*.0015),this.#position(event));
    },{signal,passive:false});
    window.addEventListener('keydown',event=>{
      if(!options.active() || event.ctrlKey || event.metaKey || event.altKey
        || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable]')))return;
      // Физическая позиция не меняется при переключении раскладки или Shift.
      const code=event.code;
      if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(code)){event.preventDefault();this.#keys.add(code);}
    },{signal});
    window.addEventListener('keyup',event=>this.#keys.delete(event.code),{signal});
    window.addEventListener('blur',this.cancel,{signal});
  }
  #position = (e: {clientX:number;clientY:number}): Point => {
    const r=this.#canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};
  };
  #down = (e: PointerEvent): void => {
    if(!this.#options.active() || (e.pointerType==='mouse' && e.button!==0 && e.button!==1))return;
    e.preventDefault();this.#canvas.focus({preventScroll:true});
    this.#fieldPointers.add(e.pointerId);
    this.#points.set(e.pointerId,this.#position(e));this.#canvas.setPointerCapture(e.pointerId);
    if(this.#points.size===1){
      this.#start=this.#position(e);const cell=this.#options.cell(this.#start);
      this.#from=cell && this.#options.occupied(cell)?cell:null;
      this.#dragging=false;this.#middle=e.button===1;this.#cameraGesture=this.#middle;
      if(!this.#middle)this.#options.hover(this.#start,null);
    }else{this.#cameraGesture=true;this.#dragging=false;this.#from=null;this.#options.hover(null,null);}
  };
  #move = (e: PointerEvent): void => {
    if(!this.#options.active())return;
    const p=this.#position(e);const old=this.#points.get(e.pointerId);
    if(!old){if(e.pointerType!=='touch')this.#options.hover(p,null);return;}
    if(this.#points.size>=2){
      const entries=[...this.#points.entries()].slice(0,2);
      const a=entries[0]!,b=entries[1]!;
      const midpoint={x:(a[1].x+b[1].x)/2,y:(a[1].y+b[1].y)/2};
      const distance=Math.hypot(a[1].x-b[1].x,a[1].y-b[1].y);
      this.#points.set(e.pointerId,p);
      const na=this.#points.get(a[0])!,nb=this.#points.get(b[0])!;
      const next={x:(na.x+nb.x)/2,y:(na.y+nb.y)/2};
      if(distance>1)this.#options.zoom(Math.hypot(na.x-nb.x,na.y-nb.y)/distance,midpoint);
      this.#options.pan(next.x-midpoint.x,next.y-midpoint.y);return;
    }
    this.#points.set(e.pointerId,p);
    if(this.#middle){this.#options.pan(p.x-old.x,p.y-old.y);return;}
    if(this.#cameraGesture)return;
    if(this.#start && Math.hypot(p.x-this.#start.x,p.y-this.#start.y)>6)this.#dragging=true;
    this.#options.hover(p,this.#dragging?this.#from:null);
  };
  #up = (e: PointerEvent): void => {
    if(!this.#points.has(e.pointerId))return;
    const cell=this.#options.cell(this.#position(e));
    const perform=this.#options.active() && !this.#cameraGesture && this.#points.size===1;
    const from=this.#from,drag=this.#dragging;
    this.#points.delete(e.pointerId);
    if(this.#canvas.hasPointerCapture(e.pointerId))this.#canvas.releasePointerCapture(e.pointerId);
    if(!this.#points.size){this.#start=null;this.#from=null;this.#dragging=false;this.#cameraGesture=false;this.#middle=false;}
    this.#options.hover(null,null);
    if(perform && cell){if(drag)this.#options.drop(from,cell);else this.#options.tap(cell);}
  };
  #lost = (e: PointerEvent): void => { if(this.#points.has(e.pointerId))this.cancel(); };
  cancel = (): void => {
    const ids=[...this.#points.keys()];this.#points.clear();this.#keys.clear();
    this.#start=null;this.#from=null;this.#dragging=false;this.#cameraGesture=false;this.#middle=false;
    for(const id of ids)if(this.#canvas.hasPointerCapture(id))this.#canvas.releasePointerCapture(id);
    this.#options.hover(null,null);
  };
  update(dt: number): void {
    if(!this.#options.active() || !this.#keys.size)return;
    const x=Number(this.#keys.has('KeyD')||this.#keys.has('ArrowRight'))-Number(this.#keys.has('KeyA')||this.#keys.has('ArrowLeft'));
    const y=Number(this.#keys.has('KeyS')||this.#keys.has('ArrowDown'))-Number(this.#keys.has('KeyW')||this.#keys.has('ArrowUp'));
    const length=Math.hypot(x,y)||1;
    this.#options.pan(-x/length*360*dt,-y/length*360*dt);
  }
  destroy(): void {this.cancel();this.#events.abort();}
}
