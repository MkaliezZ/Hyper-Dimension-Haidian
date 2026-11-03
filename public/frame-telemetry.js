// Local rolling diagnostics only; no network reporting or visitor identifiers.
const percentile=(values,q)=>{if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b);return Number(s[Math.min(s.length-1,Math.floor(s.length*q))].toFixed(3));};
export function createFrameTelemetry(report){
  const frames=[],movingFrames=[];let previous=0,lastReport=0,passes=0,framesTotal=0,lastPasses=0,lastTotal=0;
  return {sample(now,cpuMs,moving,worldPasses=0){const interval=previous?now-previous:0;previous=now;framesTotal++;passes+=worldPasses;if(interval>0&&interval<1000){frames.push({interval,cpuMs});if(frames.length>180)frames.shift();if(moving){movingFrames.push({interval,cpuMs});if(movingFrames.length>180)movingFrames.shift();}}
    if(now-lastReport<1000)return;const span=(now-lastReport)/1000;lastReport=now;report({samples:frames.length,movingSamples:movingFrames.length,drawCpuP95Ms:percentile(frames.map(v=>v.cpuMs),.95),frameIntervalP95Ms:percentile(frames.map(v=>v.interval),.95),movingDrawCpuP95Ms:percentile(movingFrames.map(v=>v.cpuMs),.95),movingFrameIntervalP95Ms:percentile(movingFrames.map(v=>v.interval),.95),worldRasterPasses:passes,worldRasterPassesPerSecond:Number(((passes-lastPasses)/span).toFixed(2)),framesPerSecond:Number(((framesTotal-lastTotal)/span).toFixed(2))});lastPasses=passes;lastTotal=framesTotal;
  }};
}
