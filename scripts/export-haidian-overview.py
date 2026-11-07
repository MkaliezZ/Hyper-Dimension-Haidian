"""Export the actual code-native ground and baked depth-scene artwork as a review image."""
from pathlib import Path
import argparse,json,math
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('--ground',required=True,type=Path);p.add_argument('--out',required=True,type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[1];c=json.loads((root/'data/campus.json').read_text(encoding='utf-8'));m=json.loads((root/'public/assets/coherent/manifest.json').read_text(encoding='utf-8'))
W,H=1400,900;scale=1.4;u0=-W/scale/2;v0=-H/scale/2-18
im=Image.new('RGBA',(W,H),'#d7e7e6');d=ImageDraw.Draw(im)
for layer,col in enumerate(['#c4d6cc','#b4cbbb','#9db9a1']):
 points=[(0,H)]+[(x,int(640+layer*36-28*math.sin(x/160+layer))) for x in range(0,W+30,30)]+[(W,H)];d.polygon(points,fill=col)
g=Image.open(a.ground).convert('RGBA');x0,z0,*_=c['bounds']
coeff=(1/(.78*scale),-1/(.39*scale),u0/.78-v0/.39-2*x0,1/(.78*scale),1/(.39*scale),u0/.78+v0/.39-2*z0)
ground=g.transform((W,H),Image.Transform.AFFINE,coeff,resample=Image.Resampling.NEAREST)
im.alpha_composite(ground)
atlas=Image.new('RGBA',(m['width'],m['height']))
for t in m['tiles']:atlas.alpha_composite(Image.open(root/'public/assets/coherent'/t['color']).convert('RGBA'),(t['x'],t['y']))
atlas=atlas.resize((round(atlas.width*scale/4),round(atlas.height*scale/4)),Image.Resampling.NEAREST)
im.alpha_composite(atlas,(round((m['left']-u0)*scale),round((m['top']-v0)*scale)))
fontfile='C:/Windows/Fonts/msyh.ttc'
font=ImageFont.truetype(fontfile,18);small=ImageFont.truetype(fontfile,16);title=ImageFont.truetype(fontfile,31)
d=ImageDraw.Draw(im);d.rounded_rectangle((32,30,540,125),4,fill='#fbf6e8',outline='#a7b49d',width=2);d.text((52,43),'海淀外国语 · 海淀校区',font=title,fill='#2f5263');d.text((54,89),'HYPER DIMENSION  /  HAIDIAN CAMPUS',font=small,fill='#667e73')
def label(text,x,z,dx=0,dy=0):
 u=.78*(x+z);v=.39*(z-x);xx=int((u-u0)*scale)+dx;yy=int((v-v0)*scale)+dy;b=d.textbbox((0,0),text,font=font);w=b[2]+24
 d.rectangle((xx-w//2,yy-16,xx+w//2,yy+17),fill='#fbf6e8',outline='#a5b199',width=1);d.text((xx-w//2+12,yy-12),text,font=font,fill='#3b554c')
label('北侧教学生活区',100,-180,-30,-16);label('艺术与科技空间',104,-40,0,-10);label('田径场与足球场',220,142,55,-5);label('南旱河与校园桥',15,130,-80,20);label('南岸教学区',-158,215,0,24)
d.rectangle((32,H-87,W-32,H-18),fill='#fbf6e8',outline='#a5b199');d.text((53,H-76),'校园建筑、河岸与运动空间  ·  26 栋建筑 / 33 个可选地点',font=font,fill='#365969');d.text((53,H-46),'布局参考公开校园总览，建筑与景观为像素化概括。',font=small,fill='#667c6c')
a.out.parent.mkdir(parents=True,exist_ok=True);im.convert('RGB').save(a.out);print(str(a.out.resolve()))
