"""Read supplied workbook/calendar as data. Never execute HTML or overwrite input files."""
import argparse,hashlib,json,re,zipfile,posixpath
from pathlib import Path
from html.parser import HTMLParser
import xml.etree.ElementTree as E

SCHEMA='hyper-dimension.annual-operations/v1'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cohort(s):return re.sub(r'[^a-z0-9]+','-',s.replace('Sophmore','Sophomore').lower()).strip('-')
def entry(**kw):
 d=dict(month=8,cohortIds=[],category='community',channel='event',description='',studentNeed='',familyNeed='',applicability='',eventWindow='',bestWindow='',processWindow='',directImpact='',downstream='',suggestedPriority=None,sourceRefs=[],requiresDateVerification=True,targetBase=3)
 d.update(kw);return d
def package(p,name,source,cohorts,refs,assumptions,entries):
 return dict(schema=SCHEMA,packageId=name,version=1,name=source,sourceLabel=source+'；用户提供的规划材料，仍需本校负责人复核',sourceHash=digest(p),exampleOnly=False,startMonth=8,cohorts=cohorts,references=refs,assumptions=assumptions,entries=entries)
class Scripts(HTMLParser):
 def __init__(self):super().__init__();self.inside=False;self.current=[];self.blocks=[]
 def handle_starttag(self,t,a):
  if t=='script':self.inside=True;self.current=[]
 def handle_data(self,d):
  if self.inside:self.current.append(d)
 def handle_endtag(self,t):
  if t=='script' and self.inside:self.blocks.append(''.join(self.current));self.inside=False
def calendar(p):
 parser=Scripts();parser.feed(p.read_text(encoding='utf-8-sig'));data=None
 for text in parser.blocks:
  try:c=json.loads(text)
  except (ValueError,TypeError):continue
  if isinstance(c,dict) and isinstance(c.get('events'),list) and isinstance(c.get('grades'),list):
   if data is not None:raise ValueError('More than one calendar data block; select the intended source explicitly')
   data=c
 if data is None:raise ValueError('No supported JSON calendar block; HTML scripts were not executed')
 cs=[dict(id=cohort(g[0]),name=g[0]+' / '+g[1]) for g in data['grades']]
 refs=[dict(id='ref-'+str(r['id']),title=r['title'],url=r['url'],checkedAt=data.get('checked'),scope=r.get('scope','')) for r in data.get('sources',[])]
 cats={'客观事件':'objective','学业事件':'academic','职业事件':'career','生活事件':'life'};out=[]
 for x in data['events']:
  if x['category'] not in cats:raise ValueError('Unknown calendar category')
  chain=cats[x['category']]+'-'+hashlib.sha256(str(x.get('chain',x['title'])).encode()).hexdigest()[:16]
  description='\n'.join(filter(None,['资料主线：'+str(x.get('chain','')) if x.get('chain') else '',x.get('advance'),x.get('basis'),x.get('impactMechanism')]))
  applicability='\n'.join(filter(None,[x.get('applicability'),('评级适用条件：'+x['ratingCondition']) if x.get('ratingCondition') else '']))
  out.append(entry(entryId=x['id'],month=x['month'],cohortIds=[cohort(x['grade'])],category=cats[x['category']],channel='public',chainId=chain,title=x['title'],description=description,studentNeed=x.get('studentNeed',x.get('need','')),familyNeed=x.get('familyNeed',''),applicability=applicability,eventWindow=x.get('eventWindow',''),bestWindow=x.get('bestWindow',x.get('demandWindow','')),processWindow=x.get('processWindow',''),directImpact=x.get('directImpact',''),downstream=x.get('downstream',''),suggestedPriority=None if cats[x['category']]=='objective' else x.get('timing'),sourceRefs=['ref-'+str(i) for i in x.get('sourceIds',[])],targetBase=3))
 context=list(data.get('assumptions',[]))
 context.append('原材料版本：'+str(data.get('version','未注明'))+'；更新日期：'+str(data.get('updated','未注明'))+'；来源核对日期：'+str(data.get('checked','未注明')))
 for grade in data['grades']:context.append('年级情境：'+'；'.join(str(v) for v in grade))
 for label in ['definition','variants','examples']:
  heading={'definition':'事件分类口径','variants':'适用分支','examples':'跨月评级示例'}[label]
  for row in data.get(label,[]):context.append(heading+'：'+'；'.join(str(v) for v in row))
 for name,timing in data.get('timing',{}).items():context.append('评级口径 '+name+'：'+'；'.join(str(v) for v in timing.values()))
 return package(p,'student-needs-calendar',data.get('title','学生需求年历'),cs,refs,context,out)
def workbook(p):
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
 out=[];refs=[];cohorts={};nsr='{'+ns['r']+'}'
 with zipfile.ZipFile(p) as z:
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  rels={x.attrib['Id']:x.attrib['Target'] for x in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  for idx,sh in enumerate(E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)):
   target=rels[sh.attrib[nsr+'id']];target=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target);cells={}
   if not target.startswith('xl/worksheets/'):raise ValueError('Unexpected worksheet target')
   for c in E.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c',ns):
    if c.find('s:f',ns) is not None:raise ValueError('Formula-containing input needs a reviewed values-only copy; formulas were not executed')
    v=c.find('s:v',ns);v=v.text if v is not None else ''
    if c.get('t')=='s':v=shared[int(v)]
    if c.get('t')=='inlineStr':v=''.join(c.find('s:is',ns).itertext())
    cells[c.get('r')]=v
   months={key[:-1]:int(v) for key,v in cells.items() if re.fullmatch('[B-M]1',key) and str(v).isdigit() and 1<=int(v)<=12}
   for key,text in cells.items():
    match=re.fullmatch(r'([B-M])(\d+)',key)
    if not match or int(match[2])<=1 or match[1] not in months:continue
    grade=cells.get('A'+match[2],'').strip()
    if not grade or not re.match(r'^(Grade\s+\d+|Freshman|Sophomore|Sophmore|Junior|Senior|Graduate\s+\d+)$',grade):continue
    cid=cohort(grade);cohorts[cid]=dict(id=cid,name=grade.replace('Sophmore','Sophomore'))
    sections=list(re.finditer(r'(活动|公域|私域)\s*[：:]',text))
    if not sections:continue
    ref='sheet-'+str(idx+1)+'-'+key.lower();used=False
    for k,m in enumerate(sections):
     body=text[m.end():sections[k+1].start() if k+1<len(sections) else len(text)].strip()
     if not body or body in ['无','-','—']:continue
     channel={'活动':'event','公域':'public','私域':'private'}[m[1]]
     title=re.split('[；;\n]',body)[0].strip()[:140]
     target=4 if any(w in body for w in ['团购','银行卡','手机卡','coupon','购物','购车']) else 1 if channel=='public' and '攻略' in body else 3
     out.append(entry(entryId=ref+'-'+channel,month=months[match[1]],cohortIds=[cid],channel=channel,chainId=channel+'-'+hashlib.sha256(title.encode()).hexdigest()[:16],title=title,description=body,applicability='负责人结合本校年级与实际需求确认后采用。',eventWindow=grade+' '+str(months[match[1]])+'月的规划位置，不是实际日期。',sourceRefs=[ref],targetBase=target));used=True
    if used:refs.append(dict(id=ref,title=sh.get('name')+'!'+key,url=None,checkedAt=None,scope='原表格单元格；空白栏目未推断为任务或指标'))
 if not out:raise ValueError('No supported month/cohort/channel records')
 return package(p,'student-union-channel-plan','学生会活动与渠道运营表',list(cohorts.values()),refs,['原表按8月至次年7月排列，没有给出具体学年和硬截止。','空白年级、空白栏目与内部运营指标不补造；费用、计分权重与奖励预算仍需实际确认。','活动、公域与私域仅表示工作渠道；不自动发布、建群、转交个人资料或执行交易。'],out)
def main():
 p=argparse.ArgumentParser();p.add_argument('--xlsx',type=Path,required=True);p.add_argument('--html',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--version',type=int,default=1);a=p.parse_args()
 if not 1<=a.version<=100000:raise ValueError('Version must be a positive supported revision')
 if a.out.exists():raise ValueError('Output exists; source and previous conversion preserved')
 x=workbook(a.xlsx);h=calendar(a.html)
 x['version']=a.version;h['version']=a.version
 a.out.mkdir(parents=True,mode=0o700)
 for name,d in [('student-union-annual.json',x),('student-needs-annual.json',h)]:
  (a.out/name).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 (a.out/'provenance.json').write_text(json.dumps({'status':'CONVERTED_NEEDS_SCHOOL_REVIEW','converterVersion':'0.7.1','documentVersion':a.version,'inputs':[{'name':a.xlsx.name,'sha256':digest(a.xlsx)},{'name':a.html.name,'sha256':digest(a.html)}],'counts':{'channelRecords':len(x['entries']),'calendarReferenceRecords':len(h['entries']),'calendarContextNotes':len(h['assumptions'])},'originalsUnchanged':True,'htmlExecuted':False,'publishesContent':False},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print(json.dumps({'status':'CONVERTED_NEEDS_SCHOOL_REVIEW','channelRecords':len(x['entries']),'calendarReferenceRecords':len(h['entries'])}))
if __name__=='__main__':main()
