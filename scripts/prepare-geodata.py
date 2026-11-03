"""Rebuild UW's outdoor data from public sources. Runtime needs Node only, not GIS tools."""
from pathlib import Path
from datetime import datetime, timezone
import json, math, hashlib, urllib.request, urllib.parse, subprocess, os
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds
from rasterio.enums import Resampling
from rasterio.transform import from_bounds as raster_transform
from pyproj import Transformer
from shapely.geometry import shape, box, Point, LineString, mapping
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'sources'
DATA = ROOT / 'data'
ROI = [-122.3122, 47.6524, -122.3034, 47.6594]
DEM_URL = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/WA_KingCounty_2021_B21/TIFF/USGS_1M_10_x55y528_WA_KingCounty_2021_B21.tif'
CITY = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Building_Outlines_2023/FeatureServer/0'
UW = 'https://gis.maps.uw.edu/federated/rest/services/PublicData/PublicData/FeatureServer'
MAP_URL = 'https://cdn.uw.edu/wp-content/uploads/sites/57/2025/06/27100126/Web-Campus-Map-June-2025.pdf'
PROJECTION = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
INVERSE = Transformer.from_crs('EPSG:26910', 'EPSG:4326', always_xy=True)
origin_e, origin_n = PROJECTION.transform(-122.3079, 47.6562)
def project(x,y,z=None):
    e,n=PROJECTION.transform(x,y)
    return e-origin_e, origin_n-n
def local(feature):return transform(project, shape(feature['geometry']))
roi = transform(project, box(*ROI))
x0,z0,x1,z1=roi.bounds

def read(name):return json.loads((SOURCES/name).read_text(encoding='utf-8-sig'))
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
def fetch(url,name):
    target=SOURCES/name
    if target.exists():return target
    if os.name=='nt' and urllib.parse.urlparse(url).hostname=='gis.maps.uw.edu':
        subprocess.run(['powershell.exe','-NoProfile','-File',str(ROOT/'scripts/download-uw.ps1'),'-Uri',url,'-OutFile',str(target)],check=True)
    else:
        with urllib.request.urlopen(url,timeout=90) as response:target.write_bytes(response.read())
    return target
def query(service,fields):
    return service+'/query?'+urllib.parse.urlencode({'where':'1=1','geometry':','.join(map(str,[-122.314,47.6500,-122.2990,47.6620])),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','outFields':fields,'outSR':4326,'f':'geojson','returnGeometry':'true','resultRecordCount':2000})

def main():
    global x0,z0,x1,z1
    SOURCES.mkdir(exist_ok=True);DATA.mkdir(exist_ok=True)
    fetch(query(CITY,'OBJECTID,OUTLINE_ID,AREA'),'buildings-uw.geojson')
    fetch(query(UW+'/12','OBJECTID,FacName,FacCode,YearBuilt,FeatureStatus,Underground'),'uw-building-names.geojson')
    fetch(query(UW+'/35','OBJECTID'),'uw-layer-35.geojson')
    fetch(query(UW+'/36','OBJECTID'),'uw-layer-36.geojson')
    raw=read('buildings-uw.geojson');official=read('uw-building-names.geojson')
    assert not raw.get('exceededTransferLimit') and not official.get('exceededTransferLimit')
    names=[]
    for f in official['features']:
        if f['properties'].get('FeatureStatus')=='Inactive' or f['properties'].get('Underground')=='Yes':continue
        g=local(f)
        if not g.is_empty and g.intersects(roi):names.append((g,f['properties']))
    # Read just the required GeoTIFF window via verified HTTP ranges; do not download 238MB.
    dem_path=DATA/'terrain-uw-dem.tif'
    if not dem_path.exists():
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_CONNECTTIMEOUT='25',GDAL_HTTP_TIMEOUT='90'):
            with rasterio.open(DEM_URL) as source:
                bbox=transform_bounds('EPSG:4326',source.crs,*ROI,densify_pts=21)
                assert source.bounds.left <= bbox[0] and source.bounds.bottom <= bbox[1] and source.bounds.right >= bbox[2] and source.bounds.top >= bbox[3], 'DEM does not cover campus'
                window=from_bounds(*bbox,transform=source.transform).round_offsets().round_lengths()
                cropped=source.read(1,window=window)
                profile=source.profile.copy();profile.update(width=cropped.shape[1],height=cropped.shape[0],transform=source.window_transform(window),compress='deflate')
                with rasterio.open(dem_path,'w',**profile) as target:target.write(cropped,1)
                save(SOURCES/'terrain-coverage.json',{'url':DEM_URL,'sourceCrs':str(source.crs),'sourceBounds':list(source.bounds),'requestedBounds':list(bbox),'sourceResolution':list(source.res),'cropShape':list(cropped.shape),'fullyCoversMvp':True,'verticalDatum':'not independently verified'})
    step=6
    width=math.ceil((x1-x0)/step)+1;height=math.ceil((z1-z0)/step)+1
    with rasterio.open(dem_path) as dem:
        grid=dem.read(1,out_shape=(height,width),resampling=Resampling.bilinear)
        assert np.isfinite(grid).all() and (grid>-200).all() and (grid<300).all(), 'Missing or implausible terrain samples'
        # DEM crop is in EPSG26910; use its exact extent rather than a lon/lat envelope approximation.
        x0=dem.bounds.left-origin_e;x1=dem.bounds.right-origin_e;z0=origin_n-dem.bounds.top;z1=origin_n-dem.bounds.bottom
    baseline=float(np.floor(np.min(grid)/5)*5)
    heights=np.round(grid-baseline,2)
    def elevation(x,z):
        fx=max(0,min(width-1,(x-x0)/(x1-x0)*(width-1)));fz=max(0,min(height-1,(z-z0)/(z1-z0)*(height-1)))
        i=min(width-2,int(fx));j=min(height-2,int(fz));a=fx-i;b=fz-j
        return round(float(heights[j,i]*(1-a)*(1-b)+heights[j,i+1]*a*(1-b)+heights[j+1,i]*(1-a)*b+heights[j+1,i+1]*a*b),2)
    footprints=[];polygons=[]
    for f in raw['features']:
        original=local(f)
        if not original.is_valid:original=original.buffer(0)
        clipped=original.intersection(roi)
        if clipped.is_empty:continue
        parts=list(clipped.geoms) if clipped.geom_type=='MultiPolygon' else [clipped]
        for index,g in enumerate(parts):
            if g.geom_type!='Polygon' or g.area<15:continue
            matches=[(g.intersection(n).area,n,p) for n,p in names if n.intersects(g)]
            match=max(matches,key=lambda row:row[0]) if matches else None
            props=match[2] if match and match[0]/g.area>.25 else {}
            name=props.get('FacName') or ''
            code=props.get('FacCode') or ''
            rings=[[[round(x,2),round(z,2)] for x,z in g.exterior.coords]]+[[[round(x,2),round(z,2)] for x,z in ring.coords] for ring in g.interiors]
            building_id=f"sea-{f['properties']['OBJECTID']}-{index}"
            inferred_height={'DEN':18,'RAI':17,'SAV':18,'SUZ':23,'HUB':17,'KNE':18,'MGH':19,'OUG':16}.get(code,13)
            point=g.representative_point();base_y=max(elevation(x,z) for x,z in g.exterior.coords)
            footprints.append({'id':building_id,'name':name,'code':code,'rings':rings,'height':inferred_height,'heightStatus':'inferred','baseY':round(base_y,2),'centroid':[round(point.x,2),round(point.y,2)],'sourceObjectId':f['properties']['OBJECTID'],'outlineId':f['properties'].get('OUTLINE_ID'),'labelSource':'uw-buildings' if name else None})
            polygons.append(g)
    blocked=unary_union(polygons)
    path_rows=[];linework=[]
    for layer,kind in [(35,'sidewalk'),(36,'road')]:
        data=read(f'uw-layer-{layer}.geojson');assert not data.get('exceededTransferLimit')
        for feature in data['features']:
            geom=local(feature).intersection(roi)
            segments=list(geom.geoms) if geom.geom_type in ['MultiLineString','GeometryCollection'] else [geom]
            for segment in segments:
                if segment.geom_type!='LineString' or segment.length<1:continue
                segment=segment.simplify(.4)
                pts=[[round(x,2),elevation(x,z)+.12,round(z,2)] for x,z in segment.coords]
                path_rows.append({'id':f"uw-{layer}-{feature['properties']['OBJECTID']}-{len(path_rows)}",'kind':kind,'points':pts})
                if kind=='sidewalk':
                    # Exclude footprint interiors; no artificial shortcut through a hall.
                    outdoors=segment.difference(blocked.buffer(.15))
                    linework.extend(list(outdoors.geoms) if outdoors.geom_type=='MultiLineString' else [outdoors])
    noded=unary_union([line for line in linework if line.geom_type=='LineString' and line.length>.5])
    lines=list(noded.geoms) if noded.geom_type=='MultiLineString' else [noded]
    nodes=[];indices={};edges={}
    def node(x,z):
        key=(round(x),round(z))
        if key not in indices:
            indices[key]=len(nodes);nodes.append([key[0],elevation(*key)+.18,key[1]])
        return indices[key]
    for line in lines:
        pts=list(line.simplify(.6).coords)
        for a,b in zip(pts,pts[1:]):
            i=node(*a);j=node(*b)
            if i==j:continue
            segment=LineString([(nodes[i][0],nodes[i][2]),(nodes[j][0],nodes[j][2])])
            if segment.intersection(blocked.buffer(-.4)).length>.5:continue
            pair=tuple(sorted([i,j]));edges[pair]=round(math.dist(nodes[i],nodes[j]),2)
    # UW drawing polylines are cartographic, not a pre-built network. Weld only tiny
    # endpoint gaps; every join is bounded to 3m and checked against building interiors.
    snapped=0
    for i,a in enumerate(nodes):
        for j in range(i):
            b=nodes[j];gap=math.hypot(a[0]-b[0],a[2]-b[2])
            if .1<gap<=3 and tuple(sorted([i,j])) not in edges:
                join=LineString([(a[0],a[2]),(b[0],b[2])])
                if join.intersection(blocked.buffer(-.4)).length<=.3:
                    edges[tuple(sorted([i,j]))]=round(math.dist(a,b),2);snapped+=1
    adjacency=[set() for _ in nodes]
    for a,b in edges:adjacency[a].add(b);adjacency[b].add(a)
    remaining=set(range(len(nodes)));components=[]
    while remaining:
        start=remaining.pop();component={start};stack=[start]
        while stack:
            for j in adjacency[stack.pop()]:
                if j in remaining:remaining.remove(j);component.add(j);stack.append(j)
        components.append(component)
    largest=max(components,key=len)
    remap={old:new for new,old in enumerate(sorted(largest))};nodes=[nodes[i] for i in sorted(largest)]
    edge_rows=[[remap[a],remap[b],distance] for (a,b),distance in edges.items() if a in largest and b in largest]
    defs=[
      ('denny','Denny Hall','丹尼楼','DEN','history','校园起点 · 1895','建成于1895年，是UW现址校园最早的建筑。其陡坡屋顶和中央穹顶体现法国文艺复兴复兴式的历史特征。','denny-hra'),
      ('raitt','Raitt Hall','赖特楼','RAI','history','The Quad · 建筑群','Raitt Hall构成The Quad周边的历史建筑群。本版依据UW历史资源资料与2025地图确认其位置，细部采用概念化表达。','raitt-hra'),
      ('savery','Savery Hall','萨弗里楼','SAV','history','学院哥特式 · 1917','Savery Hall分1917年与1920年两期建成，由Bebb and Gould设计。砖、石和陶土细部体现学院哥特式风格。','savery-hra'),
      ('quad','The Quad','文理方庭',None,'landscape','校园里的开放客厅','The Quad位于Raitt、Savery等教学建筑之间，是本次中央校园户外导览的一处停留点。绿地与树木在本版作风格化表达，不代表实时花期。','campus-map'),
      ('red-square','Red Square','红场',None,'landscape','从这里开始认识校园','2025 UW校园总图标出Red Square，周边有Odegaard、Kane及Suzzallo等建筑。本版以这里作为访客导览起点。','campus-map'),
      ('suzzallo','Suzzallo Library','苏扎罗图书馆','SUZ','learning','阅读与校园记忆','Suzzallo Library位于Red Square东侧，名称与位置已对照UW官方建筑图层和2025校园地图。本版只展示外部体量，不虚构室内布局。','uw-buildings'),
      ('fountain','Drumheller Fountain','德鲁姆赫勒喷泉',None,'landscape','Rainier Vista · 景观轴线','2025 UW校园总图在Rainier Vista附近标示Drumheller Fountain。本版以概念水池和景观轴线表现其场地关系，不代表实时喷泉状态。','campus-map'),
      ('hub','Husky Union Building','学生中心 HUB','HUB','student','下一站，校园生活','HUB是UW学生联合活动建筑。历史资源附录记载首翼于1949年完工，后续分期扩建；当前体量采用2023建筑轮廓和官方位置核对。','hub-hra'),
      ('kane','Kane Hall','凯恩楼','KNE','learning','Red Square · 教学节点','Kane Hall的名称和位置来自UW官方建筑图层与2025校园地图。可在这里查看资料或规划下一处户外导览点；未核实当前课程与开放信息。','uw-buildings'),
    ]
    anchors={'quad':(-122.30691,47.65743),'red-square':(-122.30953,47.65597),'fountain':(-122.30780,47.65380)}
    landmarks=[]
    for id,name,zh,code,category,subtitle,description,source_id in defs:
        if code:
            matches=[(g,p) for g,p in names if p.get('FacCode')==code]
            assert matches,code
            g,p=max(matches,key=lambda x:x[0].area);point=g.representative_point();x,z=point.x,point.y
            building=max((b for b in footprints if b['code']==code),key=lambda b:shape({'type':'Polygon','coordinates':b['rings']}).area,default=None)
        else:x,z=project(*anchors[id]);building=None
        # Map-calibrated public-side approach points, not claimed surveyed doors.
        hints={'SUZ':(-122.30895,47.65590),'HUB':(-122.30575,47.65545),'KNE':(-122.30930,47.65625)}
        hx,hz=project(*hints[code]) if code in hints else (x,z)
        arrival=min(range(len(nodes)),key=lambda i:math.hypot(nodes[i][0]-hx,nodes[i][2]-hz))
        offset=math.hypot(nodes[arrival][0]-x,nodes[arrival][2]-z)
        assert offset<100,(id,'public network too far away',offset)
        lon,lat=INVERSE.transform(x+origin_e,origin_n-z)
        landmarks.append({'id':id,'name':name,'nameZh':zh,'category':category,'subtitle':subtitle,'description':description,'point':[round(x,2),elevation(x,z),round(z,2)],'lonLat':[round(lon,7),round(lat,7)],'buildingId':building['id'] if building else None,'arrivalNode':arrival,'arrivalOffsetMetres':round(offset,1),'positionSource':'UW building geometry' if code else 'map-calibrated approximate outdoor landmark','sourceIds':[source_id,'campus-map'],'heightStatus':'inferred' if building else 'not-applicable'})
    source_rows=[
      {'id':'seattle-outlines','title':'Seattle Building Outlines 2023','url':'https://catalog.data.gov/dataset/building-outlines-2023','usedFor':'真实建筑底面；不含建筑高度','credit':'City of Seattle, Enterprise Data; 2023 ortho-derived outlines','date':'2023 imagery / catalog updated 2025','certainty':'published GIS footprint'},
      {'id':'usgs-dem','title':'USGS 1m DEM · King County 2021','url':DEM_URL,'usedFor':'真实地形；裁剪后6m显示采样','credit':'U.S. Geological Survey, 3DEP','date':'King County 2021 project','certainty':'sampled elevation; vertical datum not independently rechecked'},
      {'id':'campus-map','title':'UW Campus Map · June 2025','url':MAP_URL,'usedFor':'校园名称、位置与地标关系；未复制原图作为界面素材','credit':'University of Washington','date':'2025-06','certainty':'reference map'},
      {'id':'uw-buildings','title':'UW Engineering Services · Buildings','url':UW+'/12','usedFor':'官方建筑名称和轮廓匹配','credit':'Engineering Services, University of Washington','date':'retrieved 2026-10-28','certainty':'published GIS; no building heights'},
      {'id':'uw-sidewalks','title':'UW Public GIS · Sidewalks / Roads','url':UW+'/35','usedFor':'户外步行网络与道路场地关系','credit':'Engineering Services, University of Washington','date':'retrieved 2026-10-28','certainty':'conceptual navigation; real closures/ADA not verified'},
    ]
    for id,name in [('denny-hra','denny-hall'),('savery-hra','savery-hall'),('raitt-hra','raitt-hall'),('hub-hra','husky-union-building')]:
        source_rows.append({'id':id,'title':name.replace('-',' ').title()+' · Historic Resources Addendum','url':f'https://facilities.uw.edu/files/media/{name}-hra.pdf','usedFor':'历史与形制参考；不作为当前营业或室内状态','credit':'UW Facilities and named report authors','certainty':'historical publication'})
    campus={'format':'hyper-dimension.geo-campus/v1','id':'uw-seattle','version':'0.1.0','name':'University of Washington · Seattle','crs':'EPSG:26910','axes':'Y_UP_X_EAST_Z_SOUTH','originEastingNorthing':[round(origin_e,4),round(origin_n,4)],'bounds':[round(x0,2),round(z0,2),round(x1,2),round(z1,2)],'terrain':{'width':width,'height':height,'bounds':[round(x0,2),round(z0,2),round(x1,2),round(z1,2)],'referenceElevation':baseline,'heights':heights.flatten().tolist(),'sourceResolutionMetres':1,'displayGridMetres':6,'verticalExaggeration':1},'buildings':footprints,'paths':path_rows,'graph':{'nodes':nodes,'edges':edge_rows,'source':'uw-sidewalks','snapToleranceMetres':3,'shortEndpointJoins':snapped,'discardedDisconnectedComponents':len(components)-1},'landmarks':landmarks,'sources':source_rows,'assumptions':['所有建筑高度和屋顶体量均为推定，不是LiDAR或测量结果。','公开轮廓与道路来自不同年份，局部可能存在偏差；不据此确认当前施工和通行状态。','树木、色彩、窗格、喷泉与装饰为原创风格化表达。','仅户外概念导览；未制作真实室内、实时开放、无障碍/安全或紧急疏散路线。','非UW官方产品；原始公开PDF作为研究资料保留链接，不随公共运行包再分发。']}
    save(DATA/'campus-unsealed.json',campus)
    knowledge=[{'id':'uw-'+p['id'],'title':p['name']+' '+p['nameZh'],'body':p['description'],'keywords':[p['name'],p['nameZh'],p['id'],p['category']],'published':True,'revision':1,'sourceLabel':next(s['title'] for s in source_rows if s['id']==p['sourceIds'][0]),'entityId':p['id']} for p in landmarks]
    knowledge.append({'id':'uw-scope','title':'导览范围与资料边界','body':'这里是基于Hyper Dimension Base的UW中央校园非官方MVP。提供公开地标资料、3D地形和概念户外步行路线。建筑高度推定，未核实实时开放、预约、课程与无障碍。访问方Agent可遵循A2A协议访问公开能力。','keywords':['范围','MVP','导览','接待','agent','a2a'],'published':True,'revision':1,'sourceLabel':'UW MVP scope and source review'})
    save(DATA/'reception.json',{'format':'uw.reception-binding/v1','knowledge':knowledge,'agents':[{'agentId':'uw-reception','name':'UW 空间接待','description':'公开UW资料与户外导览，非UW官方服务','skills':['space.information','uw.campus.route']} ]})
    save(ROOT/'evidence/geodata-build.json',{'status':'PASS','at':datetime.now(timezone.utc).isoformat(),'crs':'EPSG:26910','boundsLonLat':ROI,'buildings':len(footprints),'paths':len(path_rows),'graphNodes':len(nodes),'graphEdges':len(edge_rows),'landmarks':len(landmarks),'terrainGrid':[width,height],'elevationRange':[float(grid.min()),float(grid.max())],'originalTerrainSourceBytes':238454157,'croppedTerrainBytes':dem_path.stat().st_size,'routeNetwork':'largest connected component; exterior sidewalks, 3m maximum checked endpoint welds','heightMeasured':False,'labelGeocoderUsed':False})
    print(json.dumps({'status':'PASS','buildings':len(footprints),'nodes':len(nodes),'edges':len(edge_rows),'landmarks':len(landmarks),'terrainGrid':[width,height]}))

if __name__=='__main__':main()
