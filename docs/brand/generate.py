import math
C=math.cos(math.radians(30))
def P(x,y,z,s,ox,oy): return (ox+(x-y)*C*s, oy+(x+y)*0.5*s - z*s)
def poly(pts,fill,sw): return '<polygon points="%s" fill="%s" stroke="#000" stroke-width="%s" stroke-linejoin="round"/>'%(" ".join("%.1f,%.1f"%p for p in pts),fill,sw)
def box(x0,x1,y0,y1,z0,z1,cols,s,ox,oy,sw):
    p=lambda x,y,z:P(x,y,z,s,ox,oy)
    top,fx,fy=cols
    return (poly([p(x1,y0,z0),p(x1,y1,z0),p(x1,y1,z1),p(x1,y0,z1)],fx,sw)+
            poly([p(x0,y1,z0),p(x1,y1,z0),p(x1,y1,z1),p(x0,y1,z1)],fy,sw)+
            poly([p(x0,y0,z1),p(x1,y0,z1),p(x1,y1,z1),p(x0,y1,z1)],top,sw))
WOOD=("#f0b860","#a85a1c","#cf8434"); GREY=("#f4f4f4","#8c8c8c","#d8d8d8"); YEL=("#ffe680","#c99a00","#ffcb00")
def icon(s,ox,oy,sw):
    o=""
    # legs (back first)
    for (lx,ly) in [(0.3,0.3),(9.2,0.3),(0.3,3.2),(9.2,3.2)]:
        o+=box(lx,lx+0.5,ly,ly+0.5,0,5,WOOD,s,ox,oy,sw)
    o+=box(0.3,9.7,3.3,3.6,1.8,2.4,WOOD,s,ox,oy,sw)          # stretcher
    o+=box(0,10,0,4,5,6,WOOD,s,ox,oy,sw)                    # bench top
    o+=box(1.5,8.5,1.4,1.9,6,13,GREY,s,ox,oy,sw)            # window
    o+=box(1.5,5,1.4,1.9,13,14.6,YEL,s,ox,oy,sw)            # yellow tab
    # window content on the front face (y=1.9): two docked panes
    p=lambda x,z:P(x,1.9,z,s,ox,oy)
    q=lambda x0,x1,z0,z1,f: poly([p(x0,z0),p(x1,z0),p(x1,z1),p(x0,z1)],f,sw*0.6)
    o+=q(2.1,5,6.6,12.4,"#3a6fd8")+q(5.3,7.9,9.7,12.4,"#3c9b2f")+q(5.3,7.9,6.6,9.4,"#ffffff")
    # close box on the tab
    pt=lambda x,z:P(x,1.9,z,s,ox,oy)
    o+=poly([pt(1.85,13.35),pt(2.75,13.35),pt(2.75,14.25),pt(1.85,14.25)],"#ffe680",sw*0.6)
    return o

F='font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="bold"'
def tab(x,y,w,h,label,fs):
    # BeOS window tab: yellow, hard bevel, close box left, zoom box right
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#ffcb00" stroke="#000" stroke-width="2"/>'
      f'<path d="M{x+2} {y+h-2}V{y+2}H{x+w-2}" fill="none" stroke="#fff3b0" stroke-width="2.5"/>'
      f'<path d="M{x+2} {y+h-2}H{x+w-2}V{y+2}" fill="none" stroke="#b88a00" stroke-width="2.5"/>'
      f'<rect x="{x+h*0.25}" y="{y+h*0.25}" width="{h*0.5}" height="{h*0.5}" fill="#ffe680" stroke="#000" stroke-width="1.5"/>'
      f'<text x="{x+h*1.0}" y="{y+h*0.72}" {F} font-size="{fs}" fill="#000">{label}</text>'
      f'<rect x="{x+w-h*0.85}" y="{y+h*0.22}" width="{h*0.55}" height="{h*0.55}" fill="#ffe680" stroke="#000" stroke-width="1.5"/>'
      f'<rect x="{x+w-h*0.85}" y="{y+h*0.22}" width="{h*0.3}" height="{h*0.3}" fill="#ffe680" stroke="#000" stroke-width="1.5"/>')
def frame(x,y,w,h):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#d8d8d8" stroke="#000" stroke-width="2"/>'
            f'<path d="M{x+2} {y+h-2}V{y+2}H{x+w-2}" fill="none" stroke="#fff" stroke-width="2.5"/>'
            f'<path d="M{x+2} {y+h-2}H{x+w-2}V{y+2}" fill="none" stroke="#8c8c8c" stroke-width="2.5"/>')
def svg(w,h,b): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{b}</svg>\n'

# 1 — Tab only: the wordmark IS a window tab, sitting on a grey window edge
L1=svg(620,140, tab(10,18,370,72,"Werkbank",46)+frame(10,88,600,34))
# 2 — Window lockup: tab + window whose body shows a docked layout
body=(frame(10,82,600,150)+
      '<rect x="26" y="98" width="230" height="118" fill="#3a6fd8" stroke="#000" stroke-width="2"/>'
      '<polyline points="38,196 80,160 116,176 160,128 240,148" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="miter"/>'
      '<rect x="264" y="98" width="330" height="54" fill="#3c9b2f" stroke="#000" stroke-width="2"/>'
      '<rect x="264" y="160" width="160" height="56" fill="#fff" stroke="#000" stroke-width="2"/>'
      '<rect x="432" y="160" width="162" height="56" fill="#ffcb00" stroke="#000" stroke-width="2"/>'
      '<rect x="276" y="174" width="120" height="7" fill="#8c8c8c"/><rect x="276" y="190" width="84" height="7" fill="#8c8c8c"/>')
L2=svg(620,244, tab(10,14,370,70,"Werkbank",44)+body)
# 3 — Icon + tab lockup
L3=svg(620,190, icon(9,82,120,2.2)+tab(196,58,410,70,"Werkbank",44)+'<text x="200" y="160" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="19" fill="#333">dockable workspaces for people and agents</text>')
ICON=svg(180,180, icon(10.5,92,130,2.4))
ICON32=svg(180,180, icon(10.5,92,130,5.5)).replace("width=\"180\" height=\"180\"","width=\"32\" height=\"32\"")
for n,s in [("tab",L1),("window",L2),("lockup",L3),("icon",ICON),("icon-32",ICON32)]:
    open(f"werkbank-beos-{n}.svg","w").write(s)

def inner(s): return s.split(">",1)[1].rsplit("</svg>",1)[0]
sheet=('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 900" width="860" height="900"><rect width="860" height="900" fill="#fff"/>'
 '<g font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#555">'
 '<text x="30" y="34">1 · Tab</text><text x="30" y="210">2 · Window</text><text x="30" y="500">3 · Icon + tab</text><text x="680" y="500">Icon, 180 / 32 px</text></g>'
 f'<g transform="translate(30,44)">{inner(L1)}</g><g transform="translate(30,222)">{inner(L2)}</g>'
 f'<g transform="translate(30,512)">{inner(L3)}</g>'
 f'<g transform="translate(660,520)">{inner(ICON)}</g><g transform="translate(734,706) scale(0.1778)">{inner(ICON32)}</g>'
 '<rect x="0" y="760" width="860" height="140" fill="#336698"/>'
 '<text x="30" y="790" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#dde">On a BeOS-blue desktop</text>'
 f'<g transform="translate(30,795) scale(.75)">{inner(L1)}</g><g transform="translate(560,770) scale(.62)">{inner(ICON)}</g>'
 '</svg>')
open("sheet.svg","w").write(sheet)
