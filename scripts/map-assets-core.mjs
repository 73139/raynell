// Public tarkov.dev CRS: map bounds are world X/Z before coordinateRotation.
export const MAP_REVISION='2026-11-13-559ecd59-v1';
export const CONFIG_COMMIT='559ecd5902b1836ab8e1ef1bc008f5730b6fce89';
export const SVG_COMMIT='5a8b6115d1c0cf56f2ebaac1a96fa5ae3074d178';
export function tileRectangle(config,zoom=3){
 const [sx,ox,sy,oy]=config.transform,angle=(config.coordinateRotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),scale=2**zoom;
 const points=config.bounds.flatMap(([x])=>config.bounds.map(([,z])=>({x:(sx*(x*c-z*s)+ox)*scale,y:(-sy*(x*s+z*c)+oy)*scale})));
 const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
 const width=Math.max(...points.map(p=>p.x))-left,height=Math.max(...points.map(p=>p.y))-top;
 const size=config.tileSize||256;
 return {left,top,width,height,size,zoom,x0:Math.floor(left/size),y0:Math.floor(top/size),x1:Math.ceil((left+width)/size)-1,y1:Math.ceil((top+height)/size)-1};
}
export function makeMapCatalog(upstream){
 const maps=upstream.filter(g=>g.maps.some(c=>c.projection==='interactive')).map(group=>{
  const original=group.maps.find(c=>c.projection==='interactive');
  const config=structuredClone(original),key=group.normalizedName,folder='./maps/latest/'+key+'/';
  config.assetRevision=MAP_REVISION;config.sourceSvg=original.svgPath||'';
  if(original.svgPath)config.sourceSvg='https://raw.githubusercontent.com/the-hideout/tarkov-dev-svg-maps/'+SVG_COMMIT+'/'+original.svgPath.split('/').pop();
  if(config.tilePath){
   config.svgLayer||=key==='the-lab'?'First_Level':key==='icebreaker'?'Infirmary':'Ground_Level';
   config.svgBounds=structuredClone(config.bounds);
   let rectangle=tileRectangle(config,3);if(Math.max(rectangle.width,rectangle.height)>2600)rectangle=tileRectangle(config,2);
   config.bundleZoom=rectangle.zoom;config.bundleSize=[Math.ceil(rectangle.width),Math.ceil(rectangle.height)];
   config.floorAssets={[config.svgLayer]:folder+'main.png',__all__:folder+'all.png'};
   config.layers=(config.layers||[]).map((layer,i)=>{
    const result={...layer};result.svgLayer||=layer.tilePath===config.tilePath?config.svgLayer:'Floor_'+i;
    if(result.svgLayer!==config.svgLayer)config.floorAssets[result.svgLayer]=folder+result.svgLayer+(result.tilePath?'.png':'.svg');
    return result;
   });
   if(config.layers.some(layer=>!layer.tilePath))config.floorAssets.__all__=folder+'all.svg';
   config.svgPath=config.floorAssets[config.svgLayer];
  }else config.svgPath=folder+'main.svg';
  return {...group,maps:[config]};
 });
 return {revision:MAP_REVISION,checkedAt:'2026-11-13',configCommit:CONFIG_COMMIT,svgCommit:SVG_COMMIT,source:'https://github.com/the-hideout/tarkov-dev/blob/'+CONFIG_COMMIT+'/src/data/maps.json',maps};
}
