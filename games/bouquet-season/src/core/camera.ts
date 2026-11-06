import { fieldCells, cellCorners, type Point, type FieldSize } from './field.ts';
export interface Viewport { x: number; y: number; width: number; height: number }
export interface FieldView { center: Point; zoom: number; fitZoom: number; rect: Viewport; size: FieldSize }
function bounds(size: FieldSize): { left: number; right: number; top: number; bottom: number } {
  const points=fieldCells(size).flatMap(cellCorners);
  return { left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)) };
}
export const FIELD_TOP = 72, FIELD_BOTTOM = 30;
export function fitField(rect: Viewport, size: FieldSize = 19): FieldView {
  const b=bounds(size);
  // Сверху - запас под цветы верхнего ряда, снизу - под боковые грани клеток и тень.
  const zoom=Math.max(.05,Math.min(rect.width/(b.right-b.left+24),rect.height/(b.bottom-b.top+FIELD_TOP+FIELD_BOTTOM)));
  return { center:{x:(b.left+b.right)/2,y:(b.top+b.bottom)/2-(FIELD_TOP-FIELD_BOTTOM)/2},zoom,fitZoom:zoom,rect,size };
}
export const toScreen = (view: FieldView, p: Point): Point => ({ x:view.rect.x+view.rect.width/2+(p.x-view.center.x)*view.zoom,y:view.rect.y+view.rect.height/2+(p.y-view.center.y)*view.zoom });
export const toWorld = (view: FieldView, p: Point): Point => ({ x:view.center.x+(p.x-view.rect.x-view.rect.width/2)/view.zoom,y:view.center.y+(p.y-view.rect.y-view.rect.height/2)/view.zoom });
function limit(view: FieldView): FieldView {
  const b=bounds(view.size);
  return { ...view,center:{x:Math.max(b.left,Math.min(b.right,view.center.x)),y:Math.max(b.top,Math.min(b.bottom,view.center.y))} };
}
export function panField(view: FieldView, dx: number, dy: number): FieldView {
  return limit({...view,center:{x:view.center.x-dx/view.zoom,y:view.center.y-dy/view.zoom}});
}
export function zoomField(view: FieldView, factor: number, anchor: Point): FieldView {
  const before=toWorld(view,anchor);
  const zoom=Math.max(view.fitZoom,Math.min(view.fitZoom*4,view.zoom*factor));
  const after=toWorld({...view,zoom},anchor);
  return limit({...view,zoom,center:{x:view.center.x+before.x-after.x,y:view.center.y+before.y-after.y}});
}
