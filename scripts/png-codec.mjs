import {deflateSync,inflateSync} from 'node:zlib';
const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc(data){let c=0xffffffff;for(const n of data)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),out.length-4);return out;}
export function encodePng({width,height,data}){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)Buffer.from(data.buffer,data.byteOffset+y*width*4,width*4).copy(scan,y*(width*4+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
export function decodePng(bytes){
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Not PNG');let at=8,width,height,type,parts=[];
  while(at<bytes.length){const n=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8),p=bytes.subarray(at+8,at+8+n);if(crc(bytes.subarray(at+4,at+8+n))!==bytes.readUInt32BE(at+8+n))throw Error('PNG CRC mismatch');if(name==='IHDR'){width=p.readUInt32BE(0);height=p.readUInt32BE(4);type=p[9];if(p[8]!==8||![2,6].includes(type)||p[12]!==0)throw Error('Only non-interlaced 8-bit RGB/RGBA PNG supported');}if(name==='IDAT')parts.push(p);at+=n+12;}
  const channels=type===6?4:3,stride=width*channels,raw=inflateSync(Buffer.concat(parts)),unfiltered=Buffer.alloc(stride*height),data=new Uint8ClampedArray(width*height*4);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  if(raw.length!==(stride+1)*height)throw Error('PNG scan length');
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw Error('Unknown PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?unfiltered[y*stride+x-channels]:0,b=y?unfiltered[(y-1)*stride+x]:0,c=y&&x>=channels?unfiltered[(y-1)*stride+x-channels]:0,v=raw[y*(stride+1)+1+x];unfiltered[y*stride+x]=(v+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}}
  for(let i=0;i<width*height;i++){data[i*4]=unfiltered[i*channels];data[i*4+1]=unfiltered[i*channels+1];data[i*4+2]=unfiltered[i*channels+2];data[i*4+3]=channels===4?unfiltered[i*channels+3]:255;}
  return {width,height,data};
}
