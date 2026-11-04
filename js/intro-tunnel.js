/* ==========================================================================
   WEMAI — Abertura: o túnel em 3D (WebGL)

   A arquitetura é calculada por pixel, com geometria analítica (ray casting
   num único shader de tela cheia): cada pixel lança um raio a partir da
   câmera e encontra a superfície real que está à frente dele. Assim, piso,
   paredes, abóbada e parede do fundo têm perspectiva exata.

   Espaço (unidades da logo; y para baixo, como no SVG)
     x: centrado no eixo do arco (ARC_X)       y: altura         z: distância à
     frente da parede do fundo (z = 0). A câmera fica em (0, eye, camera).

   Estrutura
     - túnel: paredes verticais (x = ±halfWidth) sob uma abóbada (semielipse
       com semieixos halfWidth × vaultRise, nascendo em y = spring); vai além
       da câmera, que já começa dentro dele;
     - piso (y = floor);
     - parede do fundo (z = 0) com o vão: o círculo interno do arco da logo e,
       da sua largura máxima, ombreiras verticais até o piso. O vão tem
       espessura (reveal); depois dele, transparência: a paisagem (HTML) aparece
       por trás do canvas.

   Imagem (visualização arquitetônica)
     - cor em espaço linear e curva de câmera neutra (Khronos PBR Neutral);
     - a abertura é uma janela de luz: iluminação difusa exata de uma área
       poligonal (4 faixas + arco), com a cor de cada faixa tirada da própria foto;
     - luz rebatida: o piso junto à saída como segunda área de luz, e luz que
       circula no túnel;
     - material mineral (microcimento): textura PBR CC0 (ambientCG Concrete034)
       com albedo, relevo, rugosidade e altura, em duas escalas misturadas;
       brilho fosco (GGX) da luz rasante da saída;
     - piso polido: reflexo da foto com Fresnel, alongado na vertical.

   Este arquivo só desenha. O tempo e a câmera ficam em js/intro.js.
   ========================================================================== */

(function () {
  'use strict';

  var VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  // Material CC0 (ambientCG Concrete034), 1024²: data = R albedo, G rugosidade, B altura.
  var TEXTURES = { data: 'img/tunel-mineral-data.jpg', normal: 'img/tunel-mineral-normal.jpg' };

  // Constantes da cena, injetadas no shader (mesma geometria usada pelo SVG da logo).
  function fragmentSource(g) {
    function f(v) { return (+v).toFixed(3); }
    return [
      'precision highp float;',
      'uniform vec2 uView;uniform float uDpr,uVpY,uF,uCam,uW,uV;',
      'uniform float uMat,uArch,uCol,uLight,uStrip,uJoint,uAlpha;',
      'uniform sampler2D uPhoto,uDat,uNor;uniform vec4 uPh;uniform float uPhOk,uTexOk;',
      'uniform vec3 uBand[5];',
      '#define EYE ' + f(g.eye),
      '#define FLOOR ' + f(g.floor),
      '#define SPRING ' + f(g.spring),
      '#define LEN ' + f(g.length),
      '#define REVEAL ' + f(g.reveal),
      '#define ARC_CY ' + f(g.arcCenterY),
      '#define ARC_R ' + f(g.outerR),
      '#define IN_CY ' + f(g.innerCenterY),
      '#define IN_R ' + f(g.innerR),
      '#define JAMB_X ' + f(g.jambX),
      '#define JAMB_Y ' + f(g.jambY),
      SHADER_BODY
    ].join('\n');
  }

  var SHADER_BODY = [
    '#define PI 3.14159265',
    // Paleta (sRGB): pedra clara e quente; frisos.
    'const vec3 STONE_S=vec3(.905,.874,.836);',
    'const vec3 VAULT_S=vec3(.872,.862,.852);',
    'const vec3 FLOOR_S=vec3(.915,.888,.852);',
    'const vec3 STRIP=vec3(1.,.80,.58);',
    // Exposição e luz: intensidade da janela, luz rebatida pelo piso, luz que circula
    // no túnel, frisos, luz do céu alto (arco) e força do reflexo no piso.
    'const float GAIN=4.6;const float BOUNCE=.6;const float AMB=.075;const float STRIP_K=3.;',
    'const float SKY=.45;const float REFL=1.25;',
    // Material: tamanho da textura, cor, relevo, brilho fosco, poros, manchas amplas e
    // ondulação do reflexo no piso.
    'const float TILE=330.;const float ALB_DETAIL=.35;const float RELIEF=.7;',
    'const float SHEEN=1.4;const float CAVITY=.5;const float MACRO=.10;const float RIPPLE=40.;',

    'vec3 lin(vec3 c){return c*c*(.31+.69*c);}',            // sRGB → linear (aprox.)
    'vec3 enc(vec3 c){return pow(max(c,0.),vec3(1./2.2));}',

    // Curva neutra (Khronos PBR Neutral): preserva o tom, comprime só os claros.
    'vec3 neutral(vec3 c){',
    '  float x=min(c.r,min(c.g,c.b));float off=x<.08?x-6.25*x*x:.04;c-=off;',
    '  float pk=max(c.r,max(c.g,c.b));if(pk<.76)return c;',
    '  float d=.24;float np=1.-d*d/(pk+d-.76);c*=np/pk;',
    '  float g=1.-1./(.15*(pk-np)+1.);return mix(c,vec3(np),g);',
    '}',

    // Linha fina com antialiasing analítico: d = distância à linha, fp = tamanho do pixel.
    'float line(float d,float hw,float fp){float w=max(hw,fp*.5);return (hw/w)*(1.-smoothstep(w,w+fp,abs(d)));}',
    'float grid(float c,float s,float off,float hw,float fp){float q=c-off;return line(q-s*floor(q/s+.5),hw,fp);}',
    // Hash só com aritmética (seno é caro em GPU de celular).
    'float hash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    // Ruído de valor: manchas amplas do microcimento e mistura das duas escalas da textura.
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}',

    // Distância (aprox.) até a borda do vão; negativa dentro.
    'float portalSd(vec2 q){',
    '  if(q.y<JAMB_Y) return length(vec2(q.x,q.y-IN_CY))-IN_R;',
    '  return max(abs(q.x)-JAMB_X,q.y-FLOOR);',
    '}',

    // Saída do raio (no plano xy, a partir do olho) por um perfil "retângulo + arco".
    // kind: 0 piso, 1 parede/ombreira, 2 abóbada/arco. Retorna t.
    'float exitProfile(vec2 d,float hw,float top,float rx,float ry,float cy,out float kind){',
    '  float tf=d.y>0.?(FLOOR-EYE)/d.y:1e9;',
    '  float tw=abs(d.x)>1e-6?hw/abs(d.x):1e9;',
    '  if(tf<=tw){kind=0.;return tf;}',
    '  if(EYE+tw*d.y>=top){kind=1.;return tw;}',
    '  vec2 s=vec2(d.x/rx,d.y/ry);float o=(EYE-cy)/ry;',
    '  float a=dot(s,s),b=2.*o*s.y,c=o*o-1.;',
    '  kind=2.;return (-b+sqrt(max(b*b-4.*a*c,0.)))/(2.*a);',
    '}',

    // Fator de forma de um polígono (Lambert): soma por aresta do ângulo × normal.
    // Com sinal: negativo quando o polígono está atrás da superfície (sem luz).
    'float edgeF(vec3 a,vec3 b,vec3 N){vec3 c=cross(a,b);float l=length(c);return l>1e-7?atan(l,dot(a,b))*dot(c/l,N):0.;}',
    'float rectF(vec3 P,vec3 N,vec3 a,vec3 b,vec3 c,vec3 d){',
    '  a=normalize(a-P);b=normalize(b-P);c=normalize(c-P);d=normalize(d-P);',
    '  return (edgeF(a,b,N)+edgeF(b,c,N)+edgeF(c,d,N)+edgeF(d,a,N))/(2.*PI);',
    '}',

    // Ponto do plano do vão → posição na tela → cor da foto (linear).
    'vec2 toScreen(vec2 q){return vec2(uView.x*.5+q.x*uF/uCam,uVpY+(q.y-EYE)*uF/uCam);}',
    // Foto reduzida, sem mipmaps: a leitura não depende do nível de detalhe automático
    // (que oscila entre quadros fora de fluxo uniforme e fazia a luz piscar).
    'vec3 photo(vec2 s){',
    '  if(uPhOk<.5){float h=clamp((FLOOR-EYE-(s.y-uVpY)*uCam/uF)/700.,0.,1.);return lin(mix(vec3(1.,.82,.62),vec3(.62,.72,.86),h));}',
    '  return lin(texture2D(uPhoto,clamp((s-uPh.xy)/uPh.zw,0.,1.)).rgb);',
    '}',

    'void main(){',
    '  vec2 px=vec2(gl_FragCoord.x,uView.y*uDpr-gl_FragCoord.y)/uDpr;',
    '  vec2 d=vec2((px.x-uView.x*.5)/uF,(px.y-uVpY)/uF);',
    '  float kind;',
    '  float tT=exitProfile(d,uW,SPRING,uW,uV,SPRING,kind);',
    '  float tFac=uCam-LEN;',
    '  float t;vec3 N;float surf;',       // surf: 0 piso 1 parede 2 abóbada 3 fundo 4 fachada 5 ombreira 6 arco 7 aberto
    '  float tFl=d.y>0.?(FLOOR-EYE)/d.y:1e9;',
    '  if(tFac>0.&&tT<tFac){',
    '    if(tFl<tFac){t=tFl;surf=0.;}else{t=tFac;surf=4.;}',
    '  }else if(tT<=uCam){',
    '    t=tT;surf=kind;',
    '  }else{',
    '    vec2 q=vec2(uCam*d.x,EYE+uCam*d.y);',
    '    if(portalSd(q)>0.){t=uCam;surf=3.;}',
    '    else{',
    '      float pk;float tP=exitProfile(d,JAMB_X,JAMB_Y,IN_R,IN_R,IN_CY,pk);',
    '      if(tP<uCam+REVEAL){t=tP;surf=pk==0.?0.:pk+4.;}',
    '      else{t=uCam+REVEAL;surf=7.;}',
    '    }',
    '  }',
    '  vec3 P=vec3(t*d.x,EYE+t*d.y,uCam-t);',
    '  float fp=t/uF;',                    // tamanho do pixel na superfície (unidades)

    // Vão aberto: névoa que se dissolve e deixa ver a paisagem por trás do canvas.
    '  if(surf==7.){',
    '    vec2 q=vec2(uCam*d.x,EYE+uCam*d.y);',
    '    float ry=q.y>ARC_CY?ARC_R*1.32:ARC_R;',
    '    float r=length(vec2(q.x/ARC_R,(q.y-ARC_CY)/ry));',
    '    float clear=max(uArch*(1.-smoothstep(.45+.75*uArch,1.12+.75*uArch,r)),uCol);',
    '    float a=1.-clear;',
    '    vec3 haze=mix(vec3(1.),vec3(1.,.955,.91),uLight*(1.-smoothstep(.2,1.,r))*.6);',
    '    gl_FragColor=vec4(haze*a,a)*uAlpha;return;',
    '  }',
    // Ainda totalmente exposto (branco): só o halo da primeira luz, sem calcular luz e material.
    '  if(uMat<.001){',
    '    float h0=exp(-pow(length(vec2(P.x,P.y-ARC_CY))/ARC_R-1.,2.)*3.)*step(abs(P.z),1.);',
    '    gl_FragColor=vec4(mix(vec3(1.),vec3(1.,.955,.91),uLight*h0*.45),1.)*uAlpha;return;',
    '  }',

    // Superfície: normal, albedo (linear) e base tangente para o relevo.
    '  vec3 alb;vec3 T;vec2 uv;',
    '  if(surf==0.){N=vec3(0.,-1.,0.);alb=FLOOR_S;T=vec3(1.,0.,0.);uv=P.xz;}',
    '  else if(surf==1.||surf==5.){N=vec3(-sign(P.x),0.,0.);alb=STONE_S;T=vec3(0.,0.,1.);uv=P.zy;}',
    '  else if(surf==2.){N=-normalize(vec3(P.x/(uW*uW),(P.y-SPRING)/(uV*uV),0.));alb=VAULT_S;T=vec3(0.,0.,1.);',
    '    uv=vec2(P.z,atan(P.x/uW,-(P.y-SPRING)/uV)*uW);}',
    '  else if(surf==3.||surf==4.){N=vec3(0.,0.,1.);alb=STONE_S;T=vec3(1.,0.,0.);uv=P.xy;}',
    '  else{N=-normalize(vec3(P.x,P.y-IN_CY,0.));alb=STONE_S;T=vec3(0.,0.,1.);',
    '    uv=vec2(P.z,atan(P.x,-(P.y-IN_CY))*IN_R);}',
    '  alb=lin(alb);',
    // Material PBR (albedo, relevo, rugosidade, altura) em duas escalas misturadas por
    // ruído, para não repetir; manchas amplas; só os poros mais fundos escurecem.
    '  vec3 Nn=N;float rough=.7,cav=1.;',
    '  if(uTexOk>.5){',
    '    vec2 tc=uv/TILE;',
    '    vec2 tc2=mat2(.8,-.6,.6,.8)*uv/(TILE*2.3)+vec2(.37,.11);',
    '    float w=smoothstep(.35,.65,vnoise(uv/520.));',
    '    vec3 dm=mix(texture2D(uDat,tc).rgb,texture2D(uDat,tc2).rgb,w);',
    '    float macro=vnoise(uv/700.)*.6+vnoise(uv/260.)*.4;',
    '    alb*=(1.+(dm.r-.5)*ALB_DETAIL)*(1.+(macro-.5)*MACRO);',
    '    vec3 n1=texture2D(uNor,tc).xyz*2.-1.,n2=texture2D(uNor,tc2).xyz*2.-1.;',
    '    n2.xy=mat2(.8,.6,-.6,.8)*n2.xy;',
    '    vec3 tn=mix(n1,n2,w);',
    '    vec3 B=cross(N,T);',
    // Piso polido: menos da metade do relevo das paredes.
    '    Nn=normalize(N*tn.z+(T*tn.x+B*tn.y)*RELIEF*(surf==0.?.45:1.));',
    '    rough=mix(.5,.9,clamp((dm.g-.45)/.3,0.,1.));',
    '    cav=mix(1.,smoothstep(0.,.25,dm.b),CAVITY);',
    '  }',

    // Luz da paisagem: a abertura dividida em faixas, cada uma com a cor média da foto
    // naquela altura (calculada em JS). No próprio vão (z = 0) a parede do fundo bloqueia
    // a luz de forma exata; dentro da espessura do vão, a janela é a face externa.
    // Faixas vizinhas compartilham a borda horizontal (cada vértice e aresta é calculado uma
    // vez); o arco nasce da borda de cima da última faixa (JAMB_X = IN_R, JAMB_Y = IN_CY).
    '  float zl=P.z<0.?-REVEAL:0.;',
    '  vec3 Ld=vec3(0.);vec3 Lsum=vec3(0.);',
    '  vec3 l0=normalize(vec3(-JAMB_X,FLOOR,zl)-P),r0=normalize(vec3(JAMB_X,FLOOR,zl)-P);',
    '  float hb=edgeF(l0,r0,Nn);',
    '  for(int i=0;i<4;i++){',
    '    float y1=FLOOR-(FLOOR-JAMB_Y)*float(i+1)/4.;',
    '    vec3 l1=normalize(vec3(-JAMB_X,y1,zl)-P),r1=normalize(vec3(JAMB_X,y1,zl)-P);',
    '    float ht=edgeF(l1,r1,Nn);',
    '    float F=max((hb+edgeF(r0,r1,Nn)-ht+edgeF(l1,l0,Nn))/(2.*PI),0.);',
    '    vec3 c=lin(uBand[i]);Ld+=c*F;Lsum+=c;',
    '    l0=l1;r0=r1;hb=ht;',
    '  }',
    // Arco: semicírculo em 6 segmentos, da ombreira direita à esquerda, fechado pela borda hb.
    '  float sA=hb;vec3 pv=r0;',
    '  for(int i=1;i<=6;i++){float a=float(i)*PI/6.;',
    '    vec3 v=i==6?l0:normalize(vec3(IN_R*cos(a),IN_CY-IN_R*sin(a),zl)-P);sA+=edgeF(pv,v,Nn);pv=v;}',
    // O céu alto é menos intenso que o horizonte do pôr do sol.
    '  vec3 cA=lin(uBand[4]);cA=mix(vec3(dot(cA,vec3(.2126,.7152,.0722))),cA,.5)*SKY;',
    '  Ld+=cA*max(sA,0.)/(2.*PI);Lsum+=cA*1.5;',
    '  vec3 Lavg=Lsum/5.5;',
    // Balanço de branco da câmera: a luz da paisagem tinge o túnel, sem dominar o tom.
    '  vec3 wb=mix(vec3(1.),vec3(dot(Lavg,vec3(.2126,.7152,.0722)))/max(Lavg,vec3(1e-3)),.8);',
    '  Ld*=wb;Lavg*=wb;',
    '  vec3 direct=alb*Ld*GAIN;',

    // Luz rebatida: o piso junto à saída como segunda área (só para quem o vê).
    '  vec3 bounce=vec3(0.);',
    '  if(surf!=0.){',
    '    float Fb=max(-rectF(P,Nn,vec3(-uW,FLOOR,0.),vec3(uW,FLOOR,0.),vec3(uW,FLOOR,520.),vec3(-uW,FLOOR,520.)),0.);',
    '    bounce=alb*lin(FLOOR_S)*Lavg*GAIN*BOUNCE*Fb;',
    '  }',
    // Luz que circula no túnel (inter-reflexão): mais forte junto à saída.
    '  float dz=max(P.z,0.);',
    '  vec3 amb=alb*Lavg*GAIN*AMB*(.38+.62*exp(-dz/900.));',
    // Oclusão dos cantos (só na luz indireta; a direta já é exata).
    '  float ao=1.;',
    '  if(surf==1.||surf==2.) ao*=1.-.04*exp(-max(P.z,0.)/45.);',
    '  if(surf==1.) ao*=1.-.25*exp(-(FLOOR-P.y)/70.);',
    '  if(surf==0.) ao*=1.-.25*exp(-max(uW-abs(P.x),0.)/70.);',
    '  if(surf==3.){',
    '    float de=min(uW-abs(P.x),FLOOR-P.y);',
    '    if(P.y<SPRING) de=min(de,(1.-length(vec2(P.x/uW,(P.y-SPRING)/uV)))*min(uW,uV));',
    '    ao*=1.-.04*exp(-max(de,0.)/45.);',
    '  }',
    // Espessura do vão: mesmo tom da parede do fundo junto ao arco (luz do céu aberto,
    // sem a luz direta rasante), para a borda ler como aresta fina, não como moldura.
    '  if(surf>=5.){direct=alb*Lavg*GAIN*.42;amb=alb*Lavg*GAIN*.075;}',
    // Junto à parede do fundo, paredes e abóbada recebem a luz que ela rebate.
    '  if(surf==1.||surf==2.) amb+=alb*Lavg*GAIN*.28*exp(-max(P.z,0.)/140.);',
    // Na quina com a lateral do vão, a parede recebe a luz dela (sem linha escura no encontro).
    '  if(surf==1.) amb+=alb*Lavg*GAIN*.40*exp(-max(P.z,0.)/22.);',
    // Piso sob as laterais do vão: recebe a luz delas (sem sombra entre a base e a abertura).
    '  if(surf==0.) amb+=alb*Lavg*GAIN*(.30*exp(-max(P.z,0.)/60.)+.45*exp(-max(P.z,0.)/14.))*smoothstep(JAMB_X-12.,JAMB_X+6.,abs(P.x));',
    // Parede do fundo: recebe a luz rebatida pelo piso e pelas paredes junto à saída,
    // mais forte ao redor do vão.
    '  if(surf==3.){float sp=exp(-pow(max(portalSd(P.xy),0.)/190.,2.));amb+=alb*Lavg*GAIN*(.14+.30*sp);}',
    '  vec3 col=(direct+(bounce+amb)*ao)*cav;',

    // Brilho fosco (GGX) da luz da saída nas paredes, abóbada e vão: a rugosidade do
    // material varia ponto a ponto e a luz rasante revela a superfície. A janela é uma
    // área grande: o lóbulo se alarga com ela (aproximação de Karis).
    '  if(surf==1.||surf==2.||surf>=5.){',
    '    vec3 Vd=normalize(vec3(0.,EYE,uCam)-P);',
    '    vec3 Lv=vec3(0.,(IN_CY-IN_R+FLOOR)*.5,zl)-P;float ld=length(Lv);Lv/=ld;',
    '    float nl=max(dot(Nn,Lv),0.);',
    '    vec3 H=normalize(Lv+Vd);float nh=max(dot(Nn,H),0.);',
    '    float a=rough*rough;float a2=min(a+300./ld,1.);',
    '    float a4=a2*a2;float dn=nh*nh*(a4-1.)+1.;float D=a4/(PI*dn*dn);',
    '    float Fs=.04+.96*pow(1.-max(dot(Vd,H),0.),5.);',
    '    float lh=dot(Lv,H);float vis=.25/max(lh*lh,.1);',
    '    float om=min(3.2e5*max(-Lv.z,0.)/(ld*ld),1.5);',
    '    col+=D*Fs*vis*nl*om*(a*a/(a2*a2))*Lavg*GAIN*SHEEN*cav;',
    '  }',

    // Juntas: sulcos rasos (escurecem a luz, não são traços). Sem junta na quina com a
    // parede do fundo (ela recortaria a lateral do vão).
    '  float j=0.;',
    '  if(surf==0.) j=grid(P.x,150.,75.,.9,fp);',
    '  else if(surf==1.) j=max(grid(P.y,165.,SPRING,.8,fp),grid(P.z,130.,0.,.8,fp*t/uW)*smoothstep(20.,60.,P.z));',
    '  else if(surf==2.) j=grid(atan(P.x/uW,-(P.y-SPRING)/uV)*uW,uW*.3927,0.,.8,fp)*.5;',
    '  col*=1.-.10*uJoint*j*step(0.,P.z);',

    // Frisos: fonte linear junto ao piso e à nascente da abóbada, que ilumina o entorno.
    '  float inT=smoothstep(0.,40.,P.z)*(1.-smoothstep(LEN-40.,LEN,P.z));',
    '  float st=0.;',
    '  if(surf==1.){',
    '    st=line(FLOOR-P.y,2.2,fp)*1.25+exp(-(FLOOR-P.y)/55.)*.34;',
    '    st+=line(P.y-SPRING,1.6,fp)*.85+exp(-abs(P.y-SPRING)/70.)*.24;',
    '  }else if(surf==0.){',
    '    st=exp(-(uW-abs(P.x))/50.)*.36*step(abs(P.x),uW);',
    '  }else if(surf==2.){',
    '    st=exp(-(SPRING-P.y)/70.)*.22;',
    '  }',
    '  col+=lin(STRIP)*st*inT*uStrip*STRIP_K;',
    // Lateral do vão e parede do fundo: mesmo tom quente das paredes do túnel e o mesmo
    // brilho suave junto ao piso (sem o friso), para não lerem como pilastra solta.
    '  if(surf==3.||surf==5.){',
    '    col*=mix(vec3(1.),vec3(1.14,1.07,.99),uMat);',
    '    col+=lin(STRIP)*exp(-(FLOOR-P.y)/55.)*.34*uStrip*STRIP_K;',
    '  }',

    // Piso polido: reflexo da foto pelo vão, com Fresnel.
    '  float alpha=1.;',
    '  if(surf==0.){',
    '    vec3 v=normalize(vec3(d.x,d.y,-1.));',
    '    vec3 Nr=normalize(mix(N,Nn,.35));',
    '    float c=clamp(-dot(v,Nr),0.,1.);',
    // Trechos mais lisos refletem mais (a rugosidade do material varia).
    '    float fr=(.04+.96*pow(1.-c,5.))*mix(1.2,.7,clamp((rough-.5)/.4,0.,1.));',
    '    float yr=2.*FLOOR-(EYE+uCam*d.y);vec2 qr=vec2(uCam*d.x,yr);',
    '    float blur=8.+dz*.08;',
    '    float m=1.-smoothstep(-blur,blur,portalSd(qr));',
    // Reflexo alongado na vertical (como na água e na pedra polida): 5 amostras. O relevo
    // do piso o ondula levemente (pedra polida, não espelho).
    '    vec2 sr=toScreen(qr)+vec2(Nn.x,Nn.z)*RIPPLE;float sy=4.+dz*.035;',
    '    vec3 rc=photo(sr)*.28+(photo(sr+vec2(0.,sy))+photo(sr-vec2(0.,sy)))*.22+(photo(sr+vec2(0.,2.*sy))+photo(sr-vec2(0.,2.*sy)))*.14;',
    '    rc*=GAIN*REFL;',
    '    col=mix(col,mix(col,rc,m),fr*.85*uCol);',   // fora do vão: o próprio túnel refletido
    // Junto ao vão, o piso se dissolve na água (sem linha fechando a base do arco).
    '    if(abs(P.x)<JAMB_X+20.){',
    '      float edge=smoothstep(-REVEAL,70.,P.z);',
    '      alpha=1.-(1.-edge)*uCol*(1.-smoothstep(JAMB_X-30.,JAMB_X+20.,abs(P.x)));',
    '    }',
    '  }',

    // Câmera: curva neutra, saída em sRGB e grão fino (como a foto).
    '  col=enc(neutral(col));',
    '  col+=(hash(gl_FragCoord.xy)-.5)*.02;',
    // Primeira luz: halo quente ao redor do arco, antes de a matéria aparecer.
    '  float halo=exp(-pow(length(vec2(P.x,P.y-ARC_CY))/ARC_R-1.,2.)*3.)*step(abs(P.z),1.);',
    // Exposição: tudo começa branco e ganha tom e contraste progressivamente.
    '  vec3 white=mix(vec3(1.),vec3(1.,.955,.91),uLight*halo*.45);',
    '  col=mix(white,col,uMat);',
    '  gl_FragColor=vec4(col*alpha,alpha)*uAlpha;',
    '}'
  ].join('\n');

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    }
    return shader;
  }

  // Textura provisória de 1×1 (relevo neutro) até a imagem carregar.
  function makeTexture(gl, unit, repeat) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 255, 255]));
    var wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
  }

  /* Cria o renderizador. Retorna null se WebGL não estiver disponível ou falhar;
     quem chama segue sem o túnel (ver js/intro.js). onLost: o túnel não pode continuar
     (contexto perdido, ou aparelho lento demais mesmo na resolução mínima).
     photo: a <img> da paisagem (fonte da luz e do reflexo). */
  function create(canvas, geometry, onLost, photo) {
    var gl, program;
    try {
      var options = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
      gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      if (!gl) return null;
      var high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!high || high.precision < 16) return null;

      program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource(geometry)));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
      gl.useProgram(program);

      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(program, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    } catch (e) {
      return null;
    }

    var names = ['uView', 'uDpr', 'uVpY', 'uF', 'uCam', 'uW', 'uV',
      'uMat', 'uArch', 'uCol', 'uLight', 'uStrip', 'uJoint', 'uAlpha',
      'uPhoto', 'uDat', 'uNor', 'uPh', 'uPhOk', 'uTexOk', 'uBand'];
    var u = {};
    for (var i = 0; i < names.length; i++) u[names[i]] = gl.getUniformLocation(program, names[i]);

    // Texturas: 0 foto (sem repetir), 1 dados do material, 2 relevo do material.
    var photoTex = makeTexture(gl, 0, false);
    var dataTex = makeTexture(gl, 1, true);
    var normalTex = makeTexture(gl, 2, true);
    gl.uniform1i(u.uPhoto, 0);
    gl.uniform1i(u.uDat, 1);
    gl.uniform1i(u.uNor, 2);

    var lost = false;
    var photoOk = false, texCount = 0;
    var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    // Material: até carregar (ou se não puder ser usado), o túnel segue com a pedra lisa.
    // A imagem é decodificada fora da thread principal (decode) antes de ir para a GPU, para
    // não engasgar a animação. Telas de toque usam a versão de 512².
    function loadTexture(src, unit, tex) {
      var img = new Image();
      function upload() {
        if (lost) return;
        try {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          texCount++;
        } catch (e) { /* sem o material: pedra lisa */ }
      }
      img.src = touch ? src.replace('.jpg', '-512.jpg') : src;
      if (img.decode) img.decode().then(upload, function () {});
      else img.onload = upload;
    }
    loadTexture(TEXTURES.data, 1, dataTex);
    loadTexture(TEXTURES.normal, 2, normalTex);

    // A foto, reduzida, vira textura do reflexo (sem mipmaps) e uma miniatura lida no
    // processador, de onde sai a cor de cada faixa de luz da abertura.
    var thumb = null, TW = 48, TH = 96;
    function tryPhoto() {
      if (photoOk || !photo || !photo.complete || !photo.naturalWidth) return;
      try {
        var c = document.createElement('canvas');
        c.width = 128; c.height = 256;
        c.getContext('2d').drawImage(photo, 0, 0, 128, 256);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, photoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        var t = document.createElement('canvas');
        t.width = TW; t.height = TH;
        var tx = t.getContext('2d');
        tx.drawImage(photo, 0, 0, TW, TH);
        thumb = tx.getImageData(0, 0, TW, TH).data;
        photoOk = true;
      } catch (e) {
        photo = null;   // não pode ser lida (ex.: aberta direto do disco): luz padrão
      }
    }

    // Cor (sRGB 0–1) da miniatura num ponto u,v, com interpolação bilinear.
    function thumbAt(uu, vv, out) {
      var x = Math.min(Math.max(uu * TW - .5, 0), TW - 1.001), y = Math.min(Math.max(vv * TH - .5, 0), TH - 1.001);
      var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      for (var ch = 0; ch < 3; ch++) {
        var a = thumb[(y0 * TW + x0) * 4 + ch], b = thumb[(y0 * TW + x0 + 1) * 4 + ch];
        var c = thumb[((y0 + 1) * TW + x0) * 4 + ch], d = thumb[((y0 + 1) * TW + x0 + 1) * 4 + ch];
        out[ch] += ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) / 255;
      }
    }

    // Cor média de cada faixa da abertura (4 faixas retas + arco), vista agora na tela.
    // Sem a foto, um degradê do horizonte quente ao céu.
    var bands = new Float32Array(15);
    function computeBands(s) {
      var g = geometry, k = s.focal / s.camera, ph = s.photo;
      var rects = [];
      for (var i = 0; i < 4; i++) {
        rects.push([-g.jambX, g.jambX, g.floor - (g.floor - g.jambY) * (i + 1) / 4, g.floor - (g.floor - g.jambY) * i / 4]);
      }
      rects.push([-g.innerR * .75, g.innerR * .75, g.innerCenterY - g.innerR * .95, g.innerCenterY]);
      for (var b = 0; b < 5; b++) {
        var r = rects[b], acc = [0, 0, 0], n = 0;
        for (var iy = 0; iy < 3; iy++) {
          for (var ix = 0; ix < 7; ix++) {
            var qx = r[0] + (r[1] - r[0]) * (ix + .5) / 7, qy = r[2] + (r[3] - r[2]) * (iy + .5) / 3;
            if (photoOk) {
              var sx = size.w / 2 + qx * k, sy = s.vanishY + (qy - g.eye) * k;
              thumbAt((sx - ph.x) / ph.w, (sy - ph.y) / ph.h, acc);
            } else {
              var h = Math.min(Math.max((g.floor - qy) / 700, 0), 1);
              acc[0] += 1 + (.62 - 1) * h; acc[1] += .82 + (.72 - .82) * h; acc[2] += .62 + (.86 - .62) * h;
            }
            n++;
          }
        }
        bands[b * 3] = acc[0] / n; bands[b * 3 + 1] = acc[1] / n; bands[b * 3 + 2] = acc[2] / n;
      }
    }

    function fail() {
      if (lost) return;
      lost = true;
      if (onLost) onLost();
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      fail();
    });

    /* Resolução. Base: até 2x no desktop (superamostragem em telas 1x) e até 1,5x em
       telas de toque, com teto de pixels. Sobre ela, quality (0,5–1) se ajusta ao aparelho
       (ver calibrate). */
    var size = { w: 0, h: 0 };
    var MAX_PIXELS = 2.6e6;
    var quality = 1, MIN_QUALITY = .5;
    var BUDGET = touch ? 9 : 12;   // ms de GPU por quadro (folga maior no celular)
    var samples = [], probe = new Uint8Array(4);
    var fbo = null, fboTex = null;

    function resize(w, h) {
      var ratio = window.devicePixelRatio || 1;
      var base = touch ? Math.min(1.5, ratio) : Math.min(2, Math.max(1.5, ratio));
      var dpr = Math.min(base, Math.sqrt(MAX_PIXELS / (w * h))) * quality;
      size = { w: w, h: h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (!lost) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    // s: estado da cena (câmera, luz, abertura, posição da foto) calculado por js/intro.js.
    function setScene(s) {
      tryPhoto();
      computeBands(s);
      gl.uniform3fv(u.uBand, bands);
      gl.uniform2f(u.uView, size.w, size.h);
      gl.uniform1f(u.uDpr, canvas.width / size.w);
      gl.uniform1f(u.uVpY, s.vanishY);
      gl.uniform1f(u.uF, s.focal);
      gl.uniform1f(u.uCam, s.camera);
      gl.uniform1f(u.uW, s.halfWidth);
      gl.uniform1f(u.uV, s.vaultRise);
      gl.uniform1f(u.uMat, s.matter);
      gl.uniform1f(u.uArch, s.arch);
      gl.uniform1f(u.uCol, s.column);
      gl.uniform1f(u.uLight, s.light);
      gl.uniform1f(u.uStrip, s.strips);
      gl.uniform1f(u.uJoint, s.joints);
      gl.uniform1f(u.uAlpha, s.alpha);
      gl.uniform4f(u.uPh, s.photo.x, s.photo.y, s.photo.w, s.photo.h);
      gl.uniform1f(u.uPhOk, photoOk ? 1 : 0);
      gl.uniform1f(u.uTexOk, texCount === 2 ? 1 : 0);
    }

    function dropFramebuffer() {
      if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(fboTex); }
      fbo = fboTex = null;
    }

    /* Calibração, feita por js/intro.js enquanto a logo está sozinha na tela: desenha o
       quadro s (o túnel inteiro) num framebuffer fora da tela, do tamanho do canvas, e mede
       o tempo da GPU (a leitura de 1 pixel força a espera). Com a menor de três medidas, a
       resolução cai até caber no orçamento — antes de o túnel aparecer. Retorna true ao
       concluir (ou se não for possível medir: fica o ajuste por quadros lentos). */
    function calibrate(s) {
      if (lost) return true;
      try {
        if (!fbo) {
          fboTex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, fboTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            dropFramebuffer();
            return true;
          }
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        }
        setScene(s);
        var t0 = performance.now();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
        samples.push(performance.now() - t0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } catch (e) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        dropFramebuffer();
        return true;
      }
      if (samples.length < 3) return false;
      dropFramebuffer();
      var best = Math.min(samples[0], samples[1], samples[2]);
      if (best <= BUDGET) return true;
      // O custo acompanha o número de pixels (quality²).
      var q = quality * Math.sqrt(BUDGET / best);
      if (q < MIN_QUALITY * .7) { fail(); return true; }   // nem na resolução mínima seria fluido
      quality = Math.max(MIN_QUALITY, q);
      resize(size.w, size.h);
      return true;
    }

    return {
      resize: resize,
      calibrate: calibrate,
      // Material e foto prontos (a calibração mede o custo real).
      ready: function () { return texCount === 2 && photoOk; },
      render: function (s) {
        if (lost) return;
        setScene(s);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      // Quadros lentos durante a abertura: um degrau a menos de resolução. Retorna false
      // quando já está na mínima.
      degrade: function () {
        if (quality <= MIN_QUALITY) return false;
        quality = Math.max(MIN_QUALITY, quality * .75);
        resize(size.w, size.h);
        return true;
      },
      destroy: function () {
        var ext = !lost && gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        lost = true;
      }
    };
  }

  window.WemaiTunnel = { create: create };
})();
