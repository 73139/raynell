// Pure camera math. Keep the map inside the viewport while allowing modest edge panning.
export function clampAxis(pan, scaledLength, viewportLength, margin=24) {
  if (![pan,scaledLength,viewportLength].every(Number.isFinite) || viewportLength<=0 || scaledLength<=0) return 0;
  if (scaledLength <= viewportLength) return (viewportLength-scaledLength)/2;
  const padding=Math.min(margin,viewportLength*0.06);
  return Math.min(padding,Math.max(viewportLength-scaledLength-padding,pan));
}
export function clampCamera({panX,panY,zoom,imageWidth,imageHeight,viewportWidth,viewportHeight}) {
  return {
    panX:clampAxis(panX,imageWidth*zoom,viewportWidth),
    panY:clampAxis(panY,imageHeight*zoom,viewportHeight),
  };
}
export function preserveCameraOnResize({panX,panY,zoom,fitZoom,oldWidth,oldHeight,newWidth,newHeight,imageWidth,imageHeight}) {
  const newFit=Math.min(newWidth/imageWidth,newHeight/imageHeight)*0.95;
  if (![oldWidth,oldHeight,newWidth,newHeight,imageWidth,imageHeight,zoom,fitZoom,newFit].every(Number.isFinite) ||
    oldWidth<=0 || oldHeight<=0 || newWidth<=0 || newHeight<=0 || zoom<=0 || fitZoom<=0) return null;
  // Preserve the point under the previous viewport center and the relative zoom level.
  const centerX=(oldWidth/2-panX)/zoom,centerY=(oldHeight/2-panY)/zoom;
  const newZoom=Math.max(newFit*.7,Math.min(newFit*16,zoom*(newFit/fitZoom)));
  return {fitZoom:newFit,zoom:newZoom,...clampCamera({
    panX:newWidth/2-centerX*newZoom,panY:newHeight/2-centerY*newZoom,zoom:newZoom,
    imageWidth,imageHeight,viewportWidth:newWidth,viewportHeight:newHeight,
  })};
}