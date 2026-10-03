"""Rebuild public v2 diagrams from one graph: native draw.io, SVG and PNG.

No source records or credentials are read. Pillow is needed only for PNG.
The Desktop CLI is not required; these are authored XML, not CLI exports.
"""
from pathlib import Path
import html
import math
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parents[1]
SOURCES, IMAGES = BASE / 'fontes', BASE / 'imagens'
INK, EDGE, BLUE = '#152c40', '#597085', '#e8f1f7'


def node(key, title, lines, x, y, w=300, h=170, kind='box', fill=BLUE):
    return dict(id=key, title=title, lines=lines, x=x, y=y, w=w, h=h, kind=kind, fill=fill)


def point(n, side):
    return {'l': (n['x'], n['y'] + n['h']/2), 'r': (n['x']+n['w'], n['y']+n['h']/2),
            't': (n['x']+n['w']/2, n['y']), 'b': (n['x']+n['w']/2, n['y']+n['h'])}[side]


def graph(title, subtitle, nodes, links, size, lanes=()):
    lookup = {n['id']: n for n in nodes}
    edges = []
    for index, link in enumerate(links):
        source, target, label, start, end, *optional = link
        a, b = point(lookup[source], start), point(lookup[target], end)
        waypoints = optional[0] if optional else []
        if not waypoints and a[0] != b[0] and a[1] != b[1]:
            waypoints = [((a[0]+b[0])/2, a[1]), ((a[0]+b[0])/2, b[1])]
        edges.append(dict(id=f'e{index}', source=source, target=target, label=label,
                          points=[a, *waypoints, b], dashed=len(optional)>1 and optional[1]))
    return dict(title=title, subtitle=subtitle, nodes=nodes, edges=edges, size=size, lanes=lanes)


def drawio_page(mxfile, graph_data, page_id):
    diagram = ET.SubElement(mxfile, 'diagram', id=page_id, name=graph_data['title'])
    width, height = graph_data['size']
    model = ET.SubElement(diagram, 'mxGraphModel', dx=str(width), dy=str(height), grid='1',
                          page='1', pageWidth=str(width), pageHeight=str(height))
    root = ET.SubElement(model, 'root')
    ET.SubElement(root, 'mxCell', id='0')
    ET.SubElement(root, 'mxCell', id='1', parent='0')
    texts = [node('heading', graph_data['title'], [], 35, 24, width-70, 48, 'text', '#ffffff'),
             node('subtitle', graph_data['subtitle'], [], 35, 78, width-70, 35, 'text', '#ffffff')]
    for n in [*texts, *graph_data['lanes'], *graph_data['nodes']]:
        kind = n['kind']
        shape = {'ellipse':'ellipse;', 'actor':'shape=umlActor;', 'gateway':'rhombus;',
                 'start':'ellipse;', 'end':'ellipse;strokeWidth=4;', 'text':'text;',
                 'lane':'swimlane;horizontal=0;startSize=45;'}.get(kind, 'rounded=1;')
        title = html.escape(n['title'])
        body = '<br/>'.join(html.escape(line) for line in n['lines'])
        value = f'<b>{title}</b>' + ('<br/><br/>'+body if body else '')
        style = shape + f'html=1;whiteSpace=wrap;fillColor={n["fill"]};strokeColor={EDGE};fontColor={INK};fontSize=16;'
        if kind == 'text':
            style += 'strokeColor=none;align=left;fontSize=22;'
        cell = ET.SubElement(root, 'mxCell', id=n['id'], value=value, style=style, vertex='1', parent='1')
        ET.SubElement(cell, 'mxGeometry', x=str(n['x']), y=str(n['y']), width=str(n['w']), height=str(n['h']), **{'as':'geometry'})
    for e in graph_data['edges']:
        style = f'edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;strokeColor={EDGE};fontSize=14;labelBackgroundColor=#ffffff;'
        if e['dashed']:
            style += 'dashed=1;endArrow=open;'
        if graph_data['title'].startswith('UML'):
            style += 'endArrow=none;'
        cell = ET.SubElement(root, 'mxCell', id=e['id'], value=e['label'], style=style, edge='1', parent='1',
                            source=e['source'], target=e['target'])
        geometry = ET.SubElement(cell, 'mxGeometry', relative='1', **{'as':'geometry'})
        if len(e['points']) > 2:
            points = ET.SubElement(geometry, 'Array', **{'as':'points'})
            for x, y in e['points'][1:-1]:
                ET.SubElement(points, 'mxPoint', x=str(x), y=str(y))


def render(graph_data, name):
    from PIL import Image, ImageDraw, ImageFont
    width, height = graph_data['size']
    image = Image.new('RGB', (width*2, height*2), 'white')
    canvas = ImageDraw.Draw(image)
    regular = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 32)
    bold = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 32)
    heading = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 52)
    small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 28)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
           f'<title>{html.escape(graph_data["title"])}</title>', '<rect width="100%" height="100%" fill="white"/>',
           f'<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="{EDGE}"/></marker></defs>']

    def text(value, x, y, font=regular, color=INK, center=False, size=16):
        canvas.text((x*2, y*2), value, font=font, fill=color, anchor='mm' if center else 'lm')
        anchor = 'middle' if center else 'start'
        weight = 'bold' if font in (bold, heading) else 'normal'
        svg.append(f'<text x="{x}" y="{y}" dominant-baseline="middle" text-anchor="{anchor}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{html.escape(value)}</text>')

    text(graph_data['title'], 35, 44, heading, size=26)
    text(graph_data['subtitle'], 35, 89, small, size=14)
    for n in graph_data['lanes']:
        box = (n['x']*2, n['y']*2, (n['x']+n['w'])*2, (n['y']+n['h'])*2)
        canvas.rectangle(box, fill=n['fill'], outline='#cad6df', width=2)
        svg.append(f'<rect x="{n["x"]}" y="{n["y"]}" width="{n["w"]}" height="{n["h"]}" fill="{n["fill"]}" stroke="#cad6df"/>')
        text(n['title'], n['x']+12, n['y']+18, bold)
    for e in graph_data['edges']:
        pts = e['points']
        if e['dashed']:
            for (ax,ay),(bx,by) in zip(pts,pts[1:]):
                length=math.hypot(bx-ax,by-ay)
                for step in range(0,int(length),12):
                    stop=min(step+7,length)
                    canvas.line(((ax+(bx-ax)*step/length)*2,(ay+(by-ay)*step/length)*2,
                                 (ax+(bx-ax)*stop/length)*2,(ay+(by-ay)*stop/length)*2),fill=EDGE,width=3)
        else:
            canvas.line([(x*2,y*2) for x,y in pts], fill=EDGE, width=3)
        arrow_style='' if graph_data['title'].startswith('UML') else ' marker-end="url(#arrow)"'
        svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in pts)}" fill="none" stroke="{EDGE}" stroke-width="1.5"'+arrow_style+(' stroke-dasharray="7 5"' if e['dashed'] else '')+'/>')
        x1,y1=pts[-2]; x2,y2=pts[-1]
        angle=math.atan2(y2-y1,x2-x1)
        arrow=[(x2*2,y2*2),((x2-10*math.cos(angle-.4))*2,(y2-10*math.sin(angle-.4))*2),((x2-10*math.cos(angle+.4))*2,(y2-10*math.sin(angle+.4))*2)]
        if not graph_data['title'].startswith('UML'):
            canvas.polygon(arrow, fill=EDGE)
    for n in graph_data['nodes']:
        x,y,w,h=n['x'],n['y'],n['w'],n['h']
        box=(x*2,y*2,(x+w)*2,(y+h)*2)
        if n['kind'] in ('ellipse','start','end'):
            canvas.ellipse(box, fill=n['fill'], outline=EDGE, width=3)
            svg.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{n["fill"]}" stroke="{EDGE}" stroke-width="1.5"/>')
            if n['kind']=='end':
                canvas.ellipse((x*2+8,y*2+8,(x+w)*2-8,(y+h)*2-8),outline=EDGE,width=3)
                svg.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2-4}" ry="{h/2-4}" fill="none" stroke="{EDGE}"/>')
        elif n['kind']=='gateway':
            pts=[(x+w/2,y),(x+w,y+h/2),(x+w/2,y+h),(x,y+h/2)]
            canvas.polygon([(a*2,b*2) for a,b in pts],fill=n['fill'],outline=EDGE,width=3)
            svg.append(f'<polygon points="{" ".join(f"{a},{b}" for a,b in pts)}" fill="{n["fill"]}" stroke="{EDGE}"/>')
        elif n['kind']=='actor':
            cx=x+w/2
            canvas.ellipse((cx*2-20,y*2,cx*2+20,y*2+40),outline=EDGE,width=3)
            for a,b,c,d in [(cx,y+20,cx,y+64),(cx-30,y+38,cx+30,y+38),(cx,y+64,cx-26,y+96),(cx,y+64,cx+26,y+96)]:
                canvas.line((a*2,b*2,c*2,d*2),fill=EDGE,width=3)
            svg.append(f'<g fill="none" stroke="{EDGE}" stroke-width="1.5"><circle cx="{cx}" cy="{y+10}" r="10"/><path d="M{cx} {y+20}V{y+64} M{cx-30} {y+38}H{cx+30} M{cx-26} {y+96}L{cx} {y+64}L{cx+26} {y+96}"/></g>')
            text(n['title'],cx,y+118,bold,center=True)
            continue
        else:
            canvas.rounded_rectangle(box,radius=14,fill=n['fill'],outline=EDGE,width=3)
            svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{n["fill"]}" stroke="{EDGE}"/>')
        lines=[(n['title'],bold),*[(line,regular) for line in n['lines']]]
        height_used=len(lines)*25
        top=y+(h-height_used)/2+12
        for index,(line,font) in enumerate(lines):
            text(line,x+w/2,top+index*25,font,center=True)
    for e in graph_data['edges']:
        if e['label']:
            segment=max(zip(e['points'],e['points'][1:]),key=lambda pair: abs(pair[1][0]-pair[0][0])+abs(pair[1][1]-pair[0][1]))
            x=(segment[0][0]+segment[1][0])/2; y=(segment[0][1]+segment[1][1])/2-12
            x,y=e.get('label_position',(x,y))
            tw=canvas.textlength(e['label'],font=small)/2+10
            canvas.rectangle(((x-tw/2)*2,(y-10)*2,(x+tw/2)*2,(y+10)*2),fill='white')
            svg.append(f'<rect x="{x-tw/2}" y="{y-10}" width="{tw}" height="20" fill="white"/>')
            text(e['label'],x,y,small,center=True,size=14)
    svg.append('</svg>')
    (IMAGES/f'{name}.svg').write_text('\n'.join(svg),encoding='utf-8')
    image.resize((width,height),Image.Resampling.LANCZOS).save(IMAGES/f'{name}.png')


receiving = graph('DER v2 · Carga, notas e conferência', 'Recorte das relações reais do backend · cardinalidades indicam um para muitos, salvo relação opcional explicitada', [
    node('supplier','Supplier',['PK id · código único','Fornecedor da carga'],40,150),
    node('invoice','Invoice',['PK id · FK supplier','Original privado / hash'],400,150),
    node('link','AppointmentInvoice',['FK appointment / invoice','Par e posição únicos'],760,150),
    node('ap','Appointment',['PK id · FK supplier / slot','Versão, revisão, 4 marcos','invoice principal legado'],1120,150),
    node('order','PurchaseOrder',['FK supplier · referência','Confirmação local com autor'],40,450),
    node('orderline','PurchaseOrderLine',['FK order · posição única','Quantidade pedida / unidade'],400,450),
    node('receipt','ReceiptLine',['FK carga / NF / item?','FK item pedido? / anterior?','Observado = aceito + recusado'],760,450),
    node('visit','WarehouseVisit',['FK appointment / warehouse','Sequência única por carga','Entrada / saída / recursos'],1120,450),
    node('item','InvoiceItem',['FK invoice · posição única','Declarado / unidade'],400,750),
    node('warehouse','Warehouse',['PK id · código único','Local físico atendido'],1120,750),
], [
    ('supplier','invoice','1:N','r','l'),('invoice','link','1:N','r','l'),('link','ap','N:1','r','l'),
    ('supplier','order','1:N','b','t'),('order','orderline','1:N','r','l'),('orderline','receipt','1:N','r','l'),
    ('ap','visit','1:N','b','t'),('warehouse','visit','1:N','t','b'),
    ('invoice','item','1:N','r','r',[(730,235),(730,835)]),
    ('item','receipt','1:N','r','b',[(910,835)]),
    ('ap','receipt','1:N','b','t',[(1270,385),(910,385)]),
], (1480,1010))
receiving['edges'][8]['label_position']=(730,680)

people=graph('DER v2 · Pessoa/dia e responsabilidade financeira', 'Atividade física e apuração usam o mesmo WorkerDay; somente uma participação financeira por pessoa/data/origem',[
    node('worker','Worker',['PK id · matrícula única','is_active preserva histórico'],40,150),
    node('day','WorkerDay',['FK worker','UNIQUE pessoa/data/origem'],450,150),
    node('activity','LaborActivity',['FK WorkerDay / local','Recebimento? / equipamento?','Presença / uso / horários'],860,150),
    node('history','LaborActivityRevision',['FK activity / actor','Motivo + snapshot'],1270,150),
    node('bulletin','DailyBulletin',['UNIQUE local responsável/data','Versão / revisão / cálculo','DRAFT ou CLOSED'],40,450),
    node('participant','BulletinParticipant',['FK bulletin / worker','WorkerDay único (novos)','Fração 1 ou 0,5'],450,450),
    node('allocation','IndividualAllocation',['FK bulletin / worker / day','UNIQUE boletim/revisão/pessoa','Exato, centavos, política, ativo'],860,450),
    node('revision','BulletinRevision',['FK bulletin / actor','Motivo + snapshot'],1270,450),
    node('line','BulletinLine',['FK bulletin · categoria única','3 movimentos / preço'],40,750),
    node('daily','BulletinDailyService',['FK bulletin · tipo único','FULL 90.1731 / HALF 45.0786'],450,750),
    node('production','ProductionRecord',['FK bulletin','UNIQUE source_key/origem','Quantidade / preço'],860,750),
    node('issue','LaborRuleOccurrence',['FK bulletin / worker?','Fração proposta / atividade?','Pendente bloqueia este boletim'],1270,750),
],[
    ('worker','day','1:N','r','l'),('day','activity','1:N','r','l'),('activity','history','1:N','r','l'),
    ('day','participant','0..1 financeiro','b','t'),('bulletin','participant','1:N','r','l'),
    ('bulletin','line','1:N','b','t'),('bulletin','daily','1:N','b','t',[(190,700),(600,700)]),
    ('bulletin','allocation','1:N','t','t',[(190,370),(1010,370)]),
    ('bulletin','revision','1:N','b','b',[(190,670),(1420,670)]),
    ('bulletin','production','1:N','l','b',[(20,535),(20,980),(1010,980)]),
    ('bulletin','issue','1:N','l','b',[(10,535),(10,1015),(1420,1015)]),
],(1630,1080))
people['edges'][3]['label_position']=(600,410)
people['edges'][7]['label_position']=(880,358)

usecases=graph('UML v2 · Atores e casos de uso', 'Associações representam permissões; a ordem temporal está no BPMN. Administrador executa as ações autorizadas dos perfis.',[
    node('supplier','Fornecedor',[],50,200,150,135,'actor'),
    node('purchasing','Compras',[],50,470,150,135,'actor'),
    node('gate','Portaria',[],50,740,150,135,'actor'),
    node('warehouse','Armazém',[],1450,260,150,135,'actor'),
    node('manager','Gestão',[],1450,650,150,135,'actor'),
    node('documents','Anexar / vincular notas',['Solicitar a própria carga'],300,180,370,120,'ellipse'),
    node('review','Conferir documentos',['Decidir divergências / pedido'],300,470,370,120,'ellipse'),
    node('gateevents','Registrar chegada e saída',['Corrigir marcos com motivo'],300,760,370,120,'ellipse'),
    node('visits','Executar visitas / conferência',['Recursos, exceções, quantidades'],930,180,370,120,'ellipse'),
    node('labor','Registrar atividades e boletim',['Fechar / reabrir / transferir'],930,395,370,120,'ellipse'),
    node('catalog','Cadastrar / inativar pessoas',['Equipamentos: Armazém/admin'],930,610,370,120,'ellipse'),
    node('reports','Consultar apuração e RH',['Cobertura / cenário / ocorrências'],930,825,370,120,'ellipse'),
],[
    ('supplier','documents','','r','l'),('purchasing','review','','r','l'),('gate','gateevents','','r','l'),
    ('warehouse','visits','','l','r'),('warehouse','labor','','l','r'),('warehouse','catalog','','l','r',[(1390,327),(1390,670)]),
    ('manager','reports','','l','r'),('manager','catalog','','l','r'),
],(1650,1040),[node('boundary','Sistema de recebimento e mão de obra',[],250,125,1110,870,'lane','#f9fbfd')])

bpmn_nodes=[
    node('request','Solicitar carga',['Notas / horário global'],100,160,250,90),
    node('start','',[],170,760,45,45,'start','#dff0e8'),
    node('fork','+',[],290,750,65,65,'gateway','#fff4d9'),
    node('gatein','Chegada à Portaria',['Independe das aprovações'],440,325,260,85),
    node('review','Conferir notas / pedido',['Compras decide'],440,505,260,85),
    node('destinations','Confirmar destinos',['Armazém após Compras'],710,690,250,95),
    node('join','+',[],1020,710,65,65,'gateway','#fff4d9'),
    node('visits','Executar visitas',['Sequência / recursos'],1150,690,230,95),
    node('receipt','Conferir todos os itens',['Aceito / recusado / motivo'],1440,690,250,95),
    node('resolved','×',[],1770,705,75,75,'gateway','#fff4d9'),
    node('decision','Decidir divergência',['Compras / justificativa'],1680,505,260,85),
    node('lastout','Última saída do local',['Descarga concluída'],1930,690,250,95),
    node('gateout','Saída da Portaria',['Permanência total'],1930,325,250,85),
    node('end','',[],2270,345,45,45,'end','#dff0e8'),
]
bpmn=graph('BPMN v2 · Chegada, aprovação, visitas e saída', 'Percurso principal: chegada pode anteceder aprovação; divergência impede concluir a última visita. Exceções constam no texto do processo.',bpmn_nodes,[
    ('request','start','solicitação','b','t',[(225,285),(190,285)],True),
    ('start','fork','','r','l'),('fork','gatein','','t','l',[(322,367)]),
    ('fork','review','','t','l',[(370,782),(370,547)]),('review','destinations','aprovado','b','t',[(570,650),(835,650)]),
    ('gatein','join','chegada registrada','r','t',[(1052,367)]),('destinations','join','','r','l'),
    ('join','visits','','r','l'),('visits','receipt','','r','l'),('receipt','resolved','resolvido?','r','l'),
    ('resolved','decision','não','t','b'),('decision','resolved','decisão','r','r',[(1880,547),(1880,742)]),
    ('resolved','lastout','sim','r','l'),('lastout','gateout','','t','b'),('gateout','end','','r','l'),
],(2380,970),[
    node('supplier_pool','Fornecedor / cadastro assistido',[],40,125,2300,145,'lane','#f3f6f9'),
    node('gate_lane','Portaria',[],40,290,2300,150,'lane','#f2f7fb'),
    node('purchase_lane','Compras',[],40,460,2300,150,'lane','#f8f8f3'),
    node('warehouse_lane','Armazém',[],40,630,2300,280,'lane','#f2f8f4'),
])


def write_bpmn():
    ns='http://www.omg.org/spec/BPMN/20100524/MODEL'
    ET.register_namespace('',ns)
    definitions=ET.Element(f'{{{ns}}}definitions',id='DefinitionsV2',targetNamespace='urn:recebimento:v2')
    external=ET.SubElement(definitions,f'{{{ns}}}process',id='SupplierProcess',isExecutable='false')
    ET.SubElement(external,f'{{{ns}}}task',id='request',name='Solicitar carga com notas')
    process=ET.SubElement(definitions,f'{{{ns}}}process',id='ReceivingProcess',isExecutable='false')
    lanes=ET.SubElement(process,f'{{{ns}}}laneSet',id='Roles')
    assignments={'Portaria':['gatein','gateout','end'],'Compras':['review','decision'],
                 'Armazém':['start','fork','destinations','join','visits','receipt','resolved','lastout']}
    for index,(name,ids) in enumerate(assignments.items()):
        lane=ET.SubElement(lanes,f'{{{ns}}}lane',id=f'Lane{index}',name=name)
        for key in ids:
            ET.SubElement(lane,f'{{{ns}}}flowNodeRef').text=key
    for n in bpmn_nodes:
        if n['id']=='request': continue
        tag={'start':'startEvent','end':'endEvent','fork':'parallelGateway','join':'parallelGateway','resolved':'exclusiveGateway'}.get(n['id'],'task')
        element=ET.SubElement(process,f'{{{ns}}}{tag}',id=n['id'],name=n['title'] if n['title'] not in {'+','×',''} else n['id'])
        if n['id']=='start':
            ET.SubElement(element,f'{{{ns}}}messageEventDefinition')
    for e in bpmn['edges']:
        if e['source']=='request': continue
        ET.SubElement(process,f'{{{ns}}}sequenceFlow',id=e['id'],sourceRef=e['source'],targetRef=e['target'],name=e['label'])
    collaboration=ET.SubElement(definitions,f'{{{ns}}}collaboration',id='ReceivingCollaboration')
    ET.SubElement(collaboration,f'{{{ns}}}participant',id='SupplierParticipant',name='Fornecedor',processRef='SupplierProcess')
    ET.SubElement(collaboration,f'{{{ns}}}participant',id='ReceivingParticipant',name='Recebimento na unidade',processRef='ReceivingProcess')
    ET.SubElement(collaboration,f'{{{ns}}}messageFlow',id='RequestMessage',sourceRef='request',targetRef='start',name='Solicitação')
    ndi='http://www.omg.org/spec/BPMN/20100524/DI'
    dc='http://www.omg.org/spec/DD/20100524/DC'
    di='http://www.omg.org/spec/DD/20100524/DI'
    for prefix,uri in [('bpmndi',ndi),('dc',dc),('di',di)]: ET.register_namespace(prefix,uri)
    drawing=ET.SubElement(definitions,f'{{{ndi}}}BPMNDiagram',id='DiagramV2')
    plane=ET.SubElement(drawing,f'{{{ndi}}}BPMNPlane',id='PlaneV2',bpmnElement='ReceivingCollaboration')
    bounds=[('SupplierParticipant',40,125,2300,145),('ReceivingParticipant',35,285,2310,635),
            ('Lane0',40,290,2300,150),('Lane1',40,460,2300,150),('Lane2',40,630,2300,280)]
    bounds.extend((n['id'],n['x'],n['y'],n['w'],n['h']) for n in bpmn_nodes)
    for key,x,y,w,h in bounds:
        shape=ET.SubElement(plane,f'{{{ndi}}}BPMNShape',id=f'Shape_{key}',bpmnElement=key,isHorizontal='true')
        ET.SubElement(shape,f'{{{dc}}}Bounds',x=str(x),y=str(y),width=str(w),height=str(h))
    for edge in bpmn['edges']:
        key='RequestMessage' if edge['source']=='request' else edge['id']
        shape=ET.SubElement(plane,f'{{{ndi}}}BPMNEdge',id=f'Edge_{key}',bpmnElement=key)
        for x,y in edge['points']: ET.SubElement(shape,f'{{{di}}}waypoint',x=str(x),y=str(y))
    ET.indent(definitions)
    ET.ElementTree(definitions).write(SOURCES/'recebimento-v2.bpmn',encoding='utf-8',xml_declaration=True)


if __name__=='__main__':
    IMAGES.mkdir(exist_ok=True)
    for filename, pages in [('der-v2',[receiving,people]),('casos-uso-v2',[usecases]),('recebimento-bpmn-v2',[bpmn])]:
        mxfile=ET.Element('mxfile',host='app.diagrams.net',type='device',version='26.0.0')
        for index,page in enumerate(pages): drawio_page(mxfile,page,f'page_{index}')
        ET.indent(mxfile)
        ET.ElementTree(mxfile).write(SOURCES/f'{filename}.drawio',encoding='utf-8',xml_declaration=True)
    for name,data in [('der-recebimento-v2',receiving),('der-pessoas-v2',people),('casos-uso-v2',usecases),('recebimento-bpmn-v2',bpmn)]:
        render(data,name)
    write_bpmn()
    print('3 fontes draw.io, 1 BPMN, 4 SVG e 4 PNG escritos a partir dos grafos públicos.')
