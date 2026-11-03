"""Independently compare supported source files with both converted documents; no execution or network."""
import argparse,hashlib,json,posixpath,re,zipfile
from pathlib import Path
from html.parser import HTMLParser
import xml.etree.ElementTree as E

class ScriptData(HTMLParser):
 def __init__(self):super().__init__();self.active=False;self.parts=[];self.blocks=[]
 def handle_starttag(self,t,a):
  if t=='script':self.active=True;self.parts=[]
 def handle_data(self,s):
  if self.active:self.parts.append(s)
 def handle_endtag(self,t):
  if t=='script' and self.active:self.blocks.append(''.join(self.parts));self.active=False

def verify(xlsx,html,root):
 book=json.loads((root/'student-union-annual.json').read_text(encoding='utf8'))
 calendar=json.loads((root/'student-needs-annual.json').read_text(encoding='utf8'))
 parser=ScriptData();parser.feed(html.read_text(encoding='utf-8-sig'));raw=None
 for block in parser.blocks:
  try:d=json.loads(block)
  except ValueError:continue
  if isinstance(d,dict) and 'events' in d:assert raw is None,'Ambiguous source data';raw=d
 assert raw is not None,'No supported source calendar'
 by_id={e['entryId']:e for e in calendar['entries']}
 assert len(by_id)==len(raw['events']) and set(by_id)=={e['id'] for e in raw['events']},'Calendar entry identities differ'
 categories={'客观事件':'objective','学业事件':'academic','职业事件':'career','生活事件':'life'}
 for x in raw['events']:
  e=by_id[x['id']]
  assert e['title']==x['title'] and e['month']==x['month'] and e['category']==categories[x['category']],'Calendar identity/classification mismatch'
  assert next(c['name'].split(' / ')[0] for c in calendar['cohorts'] if c['id']==e['cohortIds'][0])==x['grade'],'Cohort mismatch'
  assert e['studentNeed']==x.get('studentNeed',x.get('need','')) and e['familyNeed']==x.get('familyNeed',''),'Need fields differ'
  for a,b in [('eventWindow','eventWindow'),('bestWindow','bestWindow' if 'bestWindow' in x else 'demandWindow'),('processWindow','processWindow'),('directImpact','directImpact'),('downstream','downstream')]:assert e[a]==x.get(b,''),'Time/impact field differs'
  for k in ['advance','basis','impactMechanism','chain']:
   if x.get(k):assert x[k] in e['description'],'Source context missing'
  assert x.get('applicability','') in e['applicability'],'Applicability missing'
  if x.get('ratingCondition'):assert x['ratingCondition'] in e['applicability'],'Rating condition missing'
  assert e['suggestedPriority']==(None if x['category']=='客观事件' else x.get('timing')),'Rating differs'
  assert e['sourceRefs']==['ref-'+str(v) for v in x.get('sourceIds',[])],'Source references differ'
 notes='\n'.join(calendar['assumptions'])
 for value in raw.get('assumptions',[]):assert value in notes,'Source assumption missing'
 for k in ['grades','definition','variants','examples']:
  for row in raw.get(k,[]):
   for value in row:assert str(value) in notes,'Source alternative/context missing'
 for row in raw.get('timing',{}).values():
  for value in row.values():assert value in notes,'Rating definition missing'
 for k in ['version','updated','checked']:
  if raw.get(k):assert str(raw[k]) in notes,'Source version/date missing'
 assert len(calendar['references'])==len(raw.get('sources',[])),'Reference count differs'
 for r in raw.get('sources',[]):
  out=next(v for v in calendar['references'] if v['id']=='ref-'+str(r['id']))
  assert out['title']==r['title'] and out['url']==r['url'] and out['scope']==r.get('scope','') and out['checkedAt']==raw.get('checked'),'Reference content differs'
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'};expected={}
 with zipfile.ZipFile(xlsx) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(v.itertext()) for v in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  rels={v.get('Id'):v.get('Target') for v in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  for idx,s in enumerate(E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)):
   target=rels[s.get('{'+ns['r']+'}id')];target=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
   assert target.startswith('xl/worksheets/'),'Unsupported worksheet target'
   cells={}
   for cell in E.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c',ns):
    v=cell.find('s:v',ns);v=v.text if v is not None else ''
    if cell.get('t')=='s':v=strings[int(v)]
    if cell.get('t')=='inlineStr':v=''.join(cell.find('s:is',ns).itertext())
    assert cell.find('s:f',ns) is None,'Formula input needs reviewed values';cells[cell.get('r')]=v
   for address,text in cells.items():
    m=re.fullmatch(r'([B-M])(\d+)',address)
    if not m or int(m[2])<=1:continue
    parts=re.split(r'((?:活动|公域|私域)\s*[：:])',text)
    if len(parts)==1:continue
    grade=cells.get('A'+m[2],'').strip()
    assert grade and cells.get(m[1]+'1','').isdigit(),'Unlabeled source row/month'
    for i in range(1,len(parts)-1,2):
     label=re.sub(r'\s*[：:]$','',parts[i]);part=parts[i+1].strip()
     if part and part not in ['无','-','—']:
      channel={'活动':'event','公域':'public','私域':'private'}[label]
      expected['sheet-'+str(idx+1)+'-'+address.lower()+'-'+channel]=(part,int(cells[m[1]+'1']),channel,grade.replace('Sophmore','Sophomore'))
 assert len(expected)==len(book['entries']) and set(expected)=={e['entryId'] for e in book['entries']},'Worksheet nonempty channel identities differ'
 for e in book['entries']:
  text,month,channel,grade=expected[e['entryId']]
  assert e['description']==text and e['month']==month and e['channel']==channel,'Worksheet channel content differs'
  assert next(c['name'] for c in book['cohorts'] if c['id']==e['cohortIds'][0])==grade,'Worksheet cohort differs'
 for path,doc in [(xlsx,book),(html,calendar)]:assert hashlib.sha256(path.read_bytes()).hexdigest()==doc['sourceHash'],'Source hash mismatch'
 return {'status':'PASS','sourceFilesReadOnly':True,'xlsxChannelRecords':len(expected),'calendarReferenceRecords':len(raw['events']),'calendarCohorts':len(calendar['cohorts']),'calendarReferences':len(calendar['references']),'contextNotes':len(calendar['assumptions']),'sourceFieldsCheckedForEveryRecord':True,'ratingConditionRecordsPreserved':sum(bool(x.get('ratingCondition')) for x in raw['events']),'variantNotesPreserved':len(raw.get('variants',[])),'publiclyPublished':False,'htmlExecuted':False}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--xlsx',type=Path,required=True);p.add_argument('--html',type=Path,required=True);p.add_argument('--converted',type=Path,required=True);a=p.parse_args()
 if not __debug__:raise RuntimeError('Run without -O: comparison assertions must remain enabled')
 try:result=verify(a.xlsx,a.html,a.converted)
 except Exception as exc:
  (a.converted/'source-fidelity.json').write_text(json.dumps({'status':'FAIL','reason':str(exc)},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
  raise
 (a.converted/'source-fidelity.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(result,ensure_ascii=False))
