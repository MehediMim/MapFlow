// Snap in screen pixels so the magnetic range stays consistent at any zoom.
export function snapTimeline({value,targets,offsets=[0],min=0,pixelsPerFrame,threshold=10}){
  const raw=Math.max(min,Math.round(value));
  let result={value:raw,target:null},distance=Infinity;
  for(const target of targets){
    for(const offset of offsets){
      const candidate=target-offset;
      if(candidate<min)continue;
      const delta=Math.abs(candidate-raw)*pixelsPerFrame;
      if(delta<=threshold&&delta<distance){result={value:candidate,target};distance=delta;}
    }
  }
  return result;
}
