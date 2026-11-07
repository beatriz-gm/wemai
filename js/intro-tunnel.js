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

   Camada de tecnologia (toda procedural: não depende de nenhuma imagem)
     - linhas estruturais finas no piso, paredes e abóbada, sempre no sentido do
       túnel (nervuras em arco leriam como "múltiplas passagens");
     - telas paralelas às paredes, espalhadas sem ordem e às vezes sobrepostas
       (WALL_PANELS). Umas são embutidas na parede e acendem no lugar; outras saem dela,
       soltas, com espessura, sombra e uma leve flutuação; dessas, algumas voltam para
       dentro e outras se fixam na parede durante a travessia (uProg). Iluminam-se como
       telas de computador (moldura fina, superfície que emite luz, modo claro ou escuro,
       reflexo do vidro) e espalham luz na parede e no piso. O conteúdo é fictício e
       animado (código, gráficos, aplicativos), sem texto legível. Ficam fora do cone de
       visão do vão, por isso nunca passam na frente da paisagem;
     - molduras, cantos de seleção, marcadores e linhas de conexão, sem conteúdo;
     - reflexo dos planos no piso e luz discreta contornando vão e abóbada.
     Ela nasce no vão e vem em direção à câmera (uBuild), com intensidade uTech.

   Este arquivo só desenha. O tempo e a câmera ficam em js/intro.js.
   ========================================================================== */

(function () {
  'use strict';

  var VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  // Material CC0 (ambientCG Concrete034), 1024²: data = R albedo, G rugosidade, B altura.
  var TEXTURES = { data: 'img/tunel-mineral-data.jpg', normal: 'img/tunel-mineral-normal.jpg' };

  /* Telas na parede: lado (1 direita, −1 esquerda), z inicial e final, y de cima e de baixo,
     quanto se afastam da parede (abaixo de LOOSE_MIN, a tela é embutida na parede), quando
     surgem, o que fazem depois (progresso da câmera: positivo, quando voltam para dentro da
     parede; negativo, quando se fixam nela; 2, nada) e se a tela é escura (1) ou clara (0).
     Todas ficam fora do cone de visão do vão: x = meia-largura − afastamento >
     252·(1 − z/2400). Cada parede tem até PANEL_SLOTS telas. */
  var WALL_PANELS = [
    [1, 61, 358, 537, 675, 0, .22, 2, 0],
    [1, 134, 387, 378, 654, 0, .35, 2, 1],
    [1, 143, 334, 458, 599, 29, .23, -.38, 0],
    [1, 239, 404, 641, 750, 41, .30, 2, 0],
    [1, 284, 517, 388, 662, 34, .33, 2, 1],
    [1, 326, 442, 484, 693, 0, .20, 2, 1],
    [1, 468, 698, 355, 449, 29, .15, -.36, 0],
    [1, 560, 796, 501, 685, 0, .22, 2, 1],
    [1, 623, 870, 332, 556, 27, .17, 2, 1],
    [1, 740, 998, 389, 522, 0, .17, 2, 1],
    [1, 834, 992, 322, 510, 35, .15, .29, 0],
    [1, 847, 1021, 452, 569, 0, .18, 2, 0],
    [1, 892, 1060, 593, 693, 54, .14, -.28, 0],
    [1, 918, 1194, 523, 692, 29, .11, .26, 1],
    [1, 976, 1183, 477, 683, 45, .11, -.27, 0],
    [1, 1054, 1271, 352, 602, 56, .12, .25, 0],
    [-1, 31, 154, 332, 514, 25, .39, -.52, 0],
    [-1, 70, 241, 406, 498, 26, .10, .24, 1],
    [-1, 106, 198, 497, 765, 30, .34, 2, 1],
    [-1, 137, 298, 412, 601, 33, .37, .57, 1],
    [-1, 207, 304, 340, 480, 0, .30, 2, 0],
    [-1, 318, 416, 550, 719, 36, .37, -.51, 0],
    [-1, 322, 553, 374, 513, 29, .17, .30, 1],
    [-1, 432, 709, 366, 486, 0, .28, 2, 0],
    [-1, 487, 692, 520, 729, 30, .20, .42, 1],
    [-1, 548, 704, 642, 751, 0, .12, 2, 0],
    [-1, 713, 925, 484, 725, 62, .21, .36, 1],
    [-1, 756, 909, 341, 602, 41, .20, -.33, 0],
    [-1, 810, 1112, 526, 674, 0, .15, 2, 1],
    [-1, 841, 1027, 445, 611, 27, .14, .30, 1],
    [-1, 860, 994, 342, 444, 0, .18, 2, 1],
    [-1, 957, 1051, 518, 773, 0, .12, 2, 1]
  ];

  var LOOSE_MIN = 22;
  // Conteúdo de cada tela, na ordem da tabela: 0 código, 1 barras, 2 gráfico, 3 aplicativos,
  // 4 medidor, 5 linhas de texto.
  var PANEL_KINDS = [2, 0, 3, 1, 4, 5, 0, 3, 2, 5, 1, 4];

  // Telas por parede (o shader percorre esse número em cada lado). Em aparelhos com poucos
  // registros de uniform, cai para 8 (ver create).
  var PANEL_SLOTS = 16;
  var WALL_GAP = 2.5, PANEL_SPEED = 6.5;

  function smoothstepJs(a, b, x) { var t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

  /* Posição e estado de cada tela no progresso p da câmera, nos arrays do shader: box
     (z inicial e final, y de cima e de baixo, já com o movimento) e state (afastamento da
     parede, visibilidade, solta = 1, tipo + 10 se escura + semente). Posições
     0 a PANEL_SLOTS − 1: parede direita; as seguintes: esquerda. Calculado uma vez por
     quadro, para o shader não repetir a conta em cada pixel. */
  function panelUniforms(p, box, state) {
    var slot = [0, PANEL_SLOTS];
    box.fill(0); state.fill(0);
    WALL_PANELS.forEach(function (q, i) {
      var side = q[0] > 0 ? 0 : 1;
      var k = slot[side]++;
      if (k >= PANEL_SLOTS * (side + 1)) return;
      var seed = PANEL_KINDS[i % PANEL_KINDS.length] + 10 * q[8] + ((i * .618) % 1) * .98;
      var back = q[7] > 0 && q[7] < 2 ? q[7] : 2;       // volta para dentro da parede
      var settle = q[7] < 0 ? smoothstepJs(-q[7], -q[7] + .08, p) : 0;   // se fixa nela
      var a = smoothstepJs(q[6], q[6] + .07, p) * (1 - smoothstepJs(back, back + .07, p));
      var g, vis, dy = 0, dz = 0, loose = q[5] >= LOOSE_MIN;
      if (!loose) {
        // Embutida: acende no lugar, com uma leve oscilação enquanto liga.
        g = WALL_GAP;
        vis = a < 1 ? a * (.55 + .45 * ((a * 6.7) % 1 >= .35 ? 1 : 0)) : a;
      } else {
        // Solta: sai da parede e flutua de leve; pode voltar para dentro ou se fixar nela.
        var w = p * PANEL_SPEED + seed * 6.283, free = 1 - settle;
        g = Math.max(((q[5] + 4 * Math.sin(w * 1.3)) * free + WALL_GAP * settle) * a, 1);
        vis = smoothstepJs(0, .3, a);
        dy = 5 * Math.sin(w * .8 + 1) * a * free;
        dz = 9 * Math.sin(w * .6 + 2) * a * free;
      }
      box.set([q[1] + dz, q[2] + dz, q[3] + dy, q[4] + dy], k * 4);
      state.set([g, vis, loose ? 1 : 0, seed], k * 4);
    });
  }

  // Constantes da cena, injetadas no shader (mesma geometria usada pelo SVG da logo).
  function fragmentSource(g) {
    function f(v) { return (+v).toFixed(3); }
    return [
      'precision highp float;',
      'uniform vec2 uView;uniform float uDpr,uVpY,uF,uCam,uW,uV;',
      'uniform float uMat,uArch,uCol,uLight,uStrip,uJoint,uAlpha,uTech,uBuild,uProg;',
      'uniform sampler2D uPhoto,uDat,uNor;uniform vec4 uPh;uniform float uPhOk,uTexOk;',
      'uniform vec3 uBand[5];',
      'uniform vec4 uPB[' + 2 * PANEL_SLOTS + '],uPS[' + 2 * PANEL_SLOTS + '];',
      '#define SLOTS ' + PANEL_SLOTS,
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
      SHADER_HEAD,
      SHADER_BODY
    ].join('\n');
  }

  var SHADER_HEAD = [
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

    // Camada de tecnologia. Cores da marca: traço #3D6389; vidro e luz, quase brancos.
    'const vec3 TECH_LINE=vec3(.239,.388,.537);',
    'const vec3 TECH_GLASS=vec3(.93,.97,1.);',
    'const vec3 TECH_LIGHT=vec3(1.,.97,.93);',
    'const vec3 TECH_GLOW=vec3(.80,.90,1.);',   // luz fria das telas
    // Telas de computador, na paleta da marca: azul-marinho #0B1F33, azul #3D6389, azul-claro
    // #7FA2C4 e quase branco. Escuras (fundo marinho, conteúdo claro) ou claras.
    'const vec3 TECH_NAVY=vec3(.043,.122,.2);',
    'const vec3 SCREEN_DARK_TOP=vec3(.09,.23,.36);const vec3 SCREEN_DARK=vec3(.055,.145,.235);',
    'const vec3 SCREEN_LIGHT_TOP=vec3(.985,.99,1.);const vec3 SCREEN_LIGHT=vec3(.93,.955,.98);',
    'const vec3 SCREEN_INK_DARK=vec3(.62,.80,.96);',
    'const float SCREEN_EMIT=1.22;const float SCREEN_OPACITY=.86;',
    'const float GLASS_LINK=70.;',       // a linha de conexão vai além do vidro
    'const float PANEL_T=5.;',          // espessura das telas soltas
    // Revelação: a tecnologia nasce no vão (z = 0) e avança em direção à câmera.
    'float techReveal(float z){float f=uBuild*(LEN+320.);return 1.-smoothstep(f-260.,f,z);}',
    // Plano de vidro em x = s·(uW − g), com g o afastamento da parede neste instante.
    // b: z inicial e final, y de cima e de baixo. vis: visibilidade. Retorna (corpo, traços);
    // L e F levam a posição no vidro e o tamanho do pixel para o acabamento (panelExtras).
    // mir = 1: visto no reflexo do piso (y espelhado), com contornos mais suaves (soft).
    'vec2 glass(vec2 d,float s,vec4 b,float g,float vis,float mir,float soft,out vec4 L,out vec2 F){',
    '  L=vec4(0.);F=vec2(1.);',
    '  float sx=s*d.x;if(sx<1e-4)return vec2(0.);',
    '  float z0=b.x,z1=b.y,y0=b.z,y1=b.w;',
    '  float X=uW-g;float tp=X/sx;float z=uCam-tp;',
    '  float zc=z1+GLASS_LINK;',
    '  if(z<z0-24.||z>zc+6.)return vec2(0.);',
    '  float y=EYE+tp*d.y;if(mir>.5)y=2.*FLOOR-y;',
    '  if(y<y0-6.||y>y1+6.)return vec2(0.);',
    '  float fy=tp/uF+soft;float fz=tp*tp/(X*uF)+soft;',
    '  float dz=min(z-z0,z1-z);float dy=min(y-y0,y1-y);',
    '  L=vec4(z,y,dz,dy);F=vec2(fz,fy);',
    '  float ins=smoothstep(-fz,fz,dz)*smoothstep(-fy,fy,dy);',
    // Corpo: um pouco mais denso do lado da saída, onde pega mais luz.
    '  float body=ins*(.62+.38*(1.-smoothstep(z0,z1,z)));',
    '  float fr=max(line(dz,.7,fz)*smoothstep(-fy,0.,dy),line(dy,.7,fy)*smoothstep(-fz,0.,dz));',
    // Cantos de seleção: o traço da moldura se reforça só junto aos vértices.
    '  float cm=(1.-smoothstep(38.,46.,dz))*(1.-smoothstep(20.,24.,dy));',
    '  float st=fr*(.30+.70*cm);',
    // Marcador discreto: um traço curto no alto do plano.
    '  st=max(st,line(y-(y0+22.),.7,fy)*step(z0+26.,z)*step(z,z0+92.)*ins*.55);',
    // Linha de conexão até um pequeno nó, além da borda do vidro.
    '  float yc=y0+(y1-y0)*.32;',
    '  st=max(st,line(y-yc,.6,fy)*step(z1,z)*(1.-smoothstep(z1,zc,z))*.55);',
    '  st=max(st,(1.-smoothstep(2.6,2.6+fy,length(vec2((z-zc)*fy/fz,y-yc))))*.6);',
    '  return vec2(body,st)*vis;',
    '}',
    // Teste barato em cada tela; o desenho completo é feito só para a mais próxima da câmera.
    // Quem é atingida só pela borda (espessura, linha de conexão) perde para um vidro de fato.
    // b: retângulo; st: (afastamento, visibilidade, solta, tipo + semente) — ver panelUniforms.
    'void wallPick(inout float best,inout vec4 Z,inout vec4 S,float iv,float dy,float mir,vec4 b,vec4 st){',
    '  if(st.y<.01)return;',
    '  float tp=(uW-st.x)*iv;float z=uCam-tp;float y=EYE+tp*dy;if(mir>.5)y=2.*FLOOR-y;',
    '  if(z<b.x-24.||z>b.y+GLASS_LINK+6.||y<b.z-6.||y>b.w+6.)return;',
    '  float sc=z>b.x&&z<b.y?tp:tp+1e5;',
    '  if(sc<best){best=sc;Z=b;S=st;}',
    '}',
    'void pickPanels(bool r,inout float best,inout vec4 Z,inout vec4 S,float iv,float dy,float mir){',
    '  for(int i=0;i<SLOTS;i++)wallPick(best,Z,S,iv,dy,mir,r?uPB[i]:uPB[i+SLOTS],r?uPS[i]:uPS[i+SLOTS]);',
    '}',
    // Luz da tela na parede e no piso: brilho frio ao redor e, nas soltas, a sombra na parede
    // (a luz vem da saída: a sombra cai do lado da câmera). Retorna (sombra, brilho).
    'vec2 panelLight(vec3 P,vec4 b,vec4 st){',
    '  if(st.y<.01)return vec2(0.);',
    '  vec2 c=vec2(b.x+b.y,b.z+b.w)*.5,h=vec2(b.y-b.x,b.w-b.z)*.5;',
    '  float o=length(vec3(max(abs(P.zy-c)-h,0.),uW-abs(P.x)));',
    '  float gl=exp(-o/(14.+st.x*.6))*st.y;',
    '  if(st.z<.5)return vec2(0.,gl);',
    '  float f=(uW-st.x)/uW;vec2 e=abs(vec2(P.z*f,430.+(P.y-430.)*f)-c)-h;',
    '  float pen=3.+st.x*.5;',
    '  return vec2((1.-smoothstep(-pen,pen,e.x))*(1.-smoothstep(-pen,pen,e.y))*st.y,gl);',
    '}',
    'vec2 wallLight(bool r,vec3 P){',
    '  vec2 o=vec2(0.);',
    '  for(int i=0;i<SLOTS;i++)o=max(o,panelLight(P,r?uPB[i]:uPB[i+SLOTS],r?uPS[i]:uPS[i+SLOTS]));',
    '  return o;',
    '}',
    // Trecho de x entre a e b, com antialiasing.
    'float seg(float x,float a,float b,float f){return smoothstep(a-f,a+f,x)*(1.-smoothstep(b-f,b+f,x));}',
    // Conteúdo fictício e animado, sem texto legível. q: posição na área útil; b: tamanho.
    'float hud(vec2 q,vec2 b,float kd,float sd,float fu,float fv){',
    '  if(kd<.5){',                         // código: linhas recuadas, em trechos
    '    float i=floor(q.y/9.);float y=q.y-(i+.5)*9.;float h=hash(vec2(i,sd*91.));',
    '    float ind=floor(h*3.)*10.;float l1=ind+12.+h*28.;float l2=l1+8.+fract(h*7.)*36.;',
    '    float on=max(seg(q.x,ind,l1,fu),seg(q.x,l1+6.,l2,fu)*step(.3,fract(h*13.)));',
    '    return line(y,.9,fv)*on*(i<.5?1.:.7);',
    '  }',
    '  if(kd<1.5){',                        // barras que oscilam
    '    float w=b.x/7.;float i=floor(q.x/w);float x=q.x-(i+.5)*w;',
    '    float h=(.2+.7*hash(vec2(i,sd*53.)))*(.85+.15*sin(uProg*18.+i*1.7))*b.y;',
    '    float f=(1.-smoothstep(w*.28-fu,w*.28+fu,abs(x)))*smoothstep(b.y-h-fv,b.y-h+fv,q.y);',
    '    return max(f*.6,line(q.y-b.y,.7,fv));',
    '  }',
    '  if(kd<2.5){',                        // gráfico de linha que corre
    '    float y=b.y*(.2+.6*vnoise(vec2(q.x/b.x*4.5+uProg*3.+sd*17.,sd*31.)));',
    '    float g=max(line(mod(q.y,b.y/3.)-b.y/6.,.45,fv)*.3,line(q.y-b.y,.7,fv));',
    '    return max(max(line(q.y-y,1.,fv*1.6),smoothstep(y,y+b.y,q.y)*.25*step(y,q.y)),g);',
    '  }',
    '  if(kd<3.5){',                        // aplicativos: ícones com uma linha embaixo
    '    vec2 cs=b/vec2(3.,2.);vec2 c=floor(q/cs);vec2 l=q-(c+vec2(.5,.4))*cs;',
    '    float r=min(cs.x,cs.y)*.24;float fm=max(fu,fv);',
    '    float sq=length(max(abs(l)-r*.6,0.))-r*.4;float h=hash(c+sd*37.);',
    '    float ic=h>.5?1.-smoothstep(-fm,fm,sq):line(sq,.6,fm);',
    '    return max(ic*.75,line(l.y-r*1.6,.7,fv)*seg(l.x,-r,r*.5,fu)*.6);',
    '  }',
    '  if(kd<4.5){',                        // medidor: anel com um arco que avança
    '    vec2 l=q-b*.5;float r=min(b.x,b.y)*.34;float ln=length(l);',
    '    float an=atan(l.y,l.x)/(2.*PI)+.5;float arc=step(an,.25+.5*fract(sd+uProg*.6));',
    '    return max(line(ln-r,.6,fu)*.5,line(ln-r,1.5,fu)*arc);',
    '  }',
    // Linhas de texto, sem letras.
    '  float i=floor(q.y/11.);float y=q.y-(i+.5)*11.;float len=i<.5?.42:.3+.65*hash(vec2(i,sd*91.));',
    '  return line(y,i<.5?1.6:.9,fv)*(1.-smoothstep(len*b.x-fu,len*b.x+fu,q.x))*(i<.5?1.:.7);',
    '}',
    // Acabamento da tela da frente, como uma tela de computador: espessura (soltas), moldura
    // fina escura, superfície que emite luz (clara ou escura), barra de título, reflexo do
    // vidro, conteúdo e varredura. b: retângulo; S: (afastamento, visibilidade, solta,
    // tipo + 10 se escura + semente); L e F vêm de glass.
    'void panelExtras(inout vec3 c,vec2 d,vec4 b,vec4 S,vec4 L,vec2 F){',
    '  float s=d.x>0.?1.:-1.;float z=L.x,y=L.y,dz=L.z,dy=L.w,fz=F.x,fy=F.y;',
    '  float vis=S.y*uTech;',
    '  float kd=floor(S.w),sd=fract(S.w);float dk=step(9.5,kd);kd-=dk*10.;',
    '  float ins=smoothstep(-fz,fz,dz)*smoothstep(-fy,fy,dy);',
    '  if(S.z>.5){',
    '    float tp2=(uW-S.x+PANEL_T)/abs(d.x);float z2=uCam-tp2,y2=EYE+tp2*d.y;',
    '    float bk=smoothstep(-fz,fz,min(z2-b.x,b.y-z2))*smoothstep(-fy,fy,min(y2-b.z,b.w-y2));',
    '    c=mix(c,lin(mix(TECH_NAVY,TECH_LINE,.45)),bk*(1.-ins)*.75*vis);',
    '  }',
    // Moldura e superfície.
    '  float bz=smoothstep(-fz,fz,dz-3.)*smoothstep(-fy,fy,dy-3.);',
    '  float qx=s>0.?z-b.x:b.y-z;',
    '  vec2 uv=clamp(vec2(qx,y-b.z)/vec2(b.y-b.x,b.w-b.z),0.,1.);',
    '  vec3 scr=dk>.5?lin(mix(SCREEN_DARK_TOP,SCREEN_DARK,uv.y)):lin(mix(SCREEN_LIGHT_TOP,SCREEN_LIGHT,uv.y))*SCREEN_EMIT;',
    '  c=mix(c,lin(TECH_NAVY),ins*(1.-bz)*.9*vis);',
    '  c=mix(c,scr,bz*SCREEN_OPACITY*vis);',
    // Barra de título com três pontos, como uma janela.
    '  float fm=max(fz,fy);float ty=y-b.z;',
    '  c=mix(c,dk>.5?lin(TECH_NAVY):lin(vec3(.84,.89,.95)),(1.-smoothstep(12.-fy,12.+fy,ty))*bz*.85*vis);',
    '  float dots=0.;',
    '  dots=max(dots,1.-smoothstep(2.,2.+fm,length(vec2(qx-9.,ty-6.))));',
    '  dots=max(dots,1.-smoothstep(2.,2.+fm,length(vec2(qx-16.,ty-6.))));',
    '  dots=max(dots,1.-smoothstep(2.,2.+fm,length(vec2(qx-23.,ty-6.))));',
    '  c=mix(c,lin(dk>.5?SCREEN_INK_DARK:TECH_LINE),dots*bz*.7*vis);',
    // Reflexo do vidro: faixa diagonal suave; brilho junto às bordas; borda do lado da saída.
    '  c+=lin(TECH_GLASS)*(1.-smoothstep(0.,.22,abs(uv.x*.7+uv.y-.55)))*bz*(dk>.5?.05:.03)*vis;',
    '  c+=lin(TECH_GLOW)*exp(-max(min(dz,dy)-3.,0.)/6.)*bz*(dk>.5?.10:.06)*vis;',
    '  c+=lin(TECH_LIGHT)*line(z-b.x,1.,fz)*smoothstep(-fy,0.,dy)*.35*vis;',
    // Conteúdo, escrito da esquerda para a direita; some quando a tela fica estreita demais.
    '  vec3 ink=dk>.5?lin(SCREEN_INK_DARK)*1.15:lin(TECH_LINE);',
    '  vec2 q=vec2(qx,ty)-vec2(10.,18.);vec2 bb=vec2(b.y-b.x,b.w-b.z)-vec2(20.,28.);',
    '  float lod=1.-smoothstep(2.5,7.,fz);',
    '  if(lod>0.&&q.x>0.&&q.y>0.&&q.x<bb.x&&q.y<bb.y){',
    '    float ct=hud(q,bb,kd,sd,fz,fy)*step(q.x,S.y*bb.x*1.05);',
    '    c=mix(c,ink,min(ct,1.)*.85*lod*vis);',
    '  }',
    '  c+=lin(TECH_GLOW)*line(y-mix(b.z,b.w,fract(uProg*2.2+sd)),.8,fy)*bz*(dk>.5?.18:.08)*vis;',
    '}'
  ].join('\n');

  var SHADER_BODY = [
    'vec2 glasses(vec2 d,float mir,float soft,out vec4 L,out vec2 F,out vec4 Z,out vec4 S){',
    '  float best=1e9;Z=vec4(0.);S=vec4(0.);L=vec4(0.);F=vec2(1.);',
    '  pickPanels(d.x>0.,best,Z,S,1./abs(d.x),d.y,mir);',
    '  if(best>=1e9){S=vec4(0.);return vec2(0.);}',
    '  return glass(d,d.x>0.?1.:-1.,Z,S.x,S.y,mir,soft,L,F);',
    '}',

    'void main(){',
    '  vec2 px=vec2(gl_FragCoord.x,uView.y*uDpr-gl_FragCoord.y)/uDpr;',
    '  vec2 d=vec2((px.x-uView.x*.5)/uF,(px.y-uVpY)/uF);',
    // Em largura ímpar de canvas, a coluna central cai exatamente em x = 0, onde a luz da
    // abertura degenera (arestas coplanares) e aparecia um fio vertical na abóbada.
    '  if(abs(d.x)<1e-4)d.x=1e-4;',
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

    // Tecnologia na arquitetura: linhas finas no sentido do túnel e marcadores curtos,
    // gravados na superfície (por isso entram antes do reflexo do piso).
    '  if(uTech>.001&&P.z>0.){',
    '    float ln=0.,mk=0.;float fz=fp*t/uW;',
    '    if(surf==0.){',
    '      float ax=abs(P.x);fz=fp*t/(FLOOR-EYE);',
    '      ln=line(ax-JAMB_X,.8,fp)+line(ax-JAMB_X*.5,.6,fp)*.5;',
    '      mk=grid(P.z,360.,120.,.9,fz)*(1.-smoothstep(9.,13.,abs(ax-JAMB_X)));',
    '    }else if(surf==1.){',
    '      ln=line(P.y-470.,.7,fp)+line(P.y-655.,.6,fp)*.5;',
    '      mk=grid(P.z,360.,300.,.9,fz)*(1.-smoothstep(8.,12.,abs(P.y-470.)));',
    '    }else if(surf==2.){',
    '      float as=abs(atan(P.x/uW,-(P.y-SPRING)/uV)*uW);',
    '      ln=line(as-uW*.62,.7,fp)+line(as-uW*.2,.6,fp)*.5;',
    '      mk=grid(P.z,360.,300.,.9,fz)*(1.-smoothstep(8.,12.,abs(as-uW*.62)));',
    '    }',
    // Mais fracas perto da câmera, onde a perspectiva as engrossa.
    '    float nearK=.45+.55*smoothstep(200.,1000.,t);',
    '    col=mix(col,lin(TECH_LINE),min(ln*.20+mk*.30,1.)*nearK*uTech*techReveal(P.z));',
    '  }',
    // Telas: sombra das soltas na parede e a luz delas na parede e no piso.
    '  if(uTech>.001&&surf<=1.&&P.z>0.){',
    '    vec2 wl=wallLight(P.x>0.,P);',
    '    col*=1.-.42*wl.x*uTech*surf;',
    '    col+=lin(TECH_GLOW)*wl.y*.30*uTech;',
    '  }',
    // Luz discreta nas bordas: contorna o vão e o encontro da abóbada com a parede do fundo.
    '  if(uTech>.001&&surf==3.){',
    '    float sdv=portalSd(P.xy);',
    '    float de=min(uW-abs(P.x),FLOOR-P.y);',
    '    if(P.y<SPRING)de=min(de,(1.-length(vec2(P.x/uW,(P.y-SPRING)/uV)))*min(uW,uV));',
    '    float rim=line(sdv-44.,.8,fp)*.55+exp(-abs(sdv-44.)/10.)*.14+exp(-max(de,0.)/12.)*.20;',
    '    col+=lin(TECH_LIGHT)*rim*uTech*techReveal(0.);',
    '  }',

    // Piso polido: reflexo da foto pelo vão, com Fresnel.
    '  float alpha=1.;float frT=0.;',
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
    '    frT=fr;',
    // Junto ao vão, o piso se dissolve na água (sem linha fechando a base do arco).
    '    if(abs(P.x)<JAMB_X+20.){',
    '      float edge=smoothstep(-REVEAL,70.,P.z);',
    '      alpha=1.-(1.-edge)*uCol*(1.-smoothstep(JAMB_X-30.,JAMB_X+20.,abs(P.x)));',
    '    }',
    '  }',

    // Telas à frente da superfície; no piso, o reflexo delicado delas.
    '  if(uTech>.001){',
    '    vec4 L,Z,S,Lm,Zm,Sm;vec2 F,Fm;',
    '    vec2 g=glasses(d,0.,0.,L,F,Z,S);',
    // O reflexo perde nitidez e força à medida que o piso se aproxima da câmera.
    '    if(surf==0.){',
    '      vec2 gr=glasses(d,1.,16.+dz*.05,Lm,Fm,Zm,Sm)*(.10+frT*1.4)*exp(-max(t-500.,0.)/700.);',
    // A cor da tela acesa aparece no reflexo.
    '      if(Sm.y>.01)col=mix(col,step(9.5,floor(Sm.w))>.5?lin(SCREEN_DARK):lin(SCREEN_LIGHT)*SCREEN_EMIT,min(gr.x*2.2,1.)*.55*uTech);',
    '      g=max(g,gr);',
    '    }',
    '    if(g.x+g.y>0.){',
    '      col=mix(col,lin(TECH_GLASS),g.x*.15*uTech);',
    '      col=mix(col,lin(TECH_LINE),g.y*.46*uTech);',
    '    }',
    '    if(S.y>.01)panelExtras(col,d,Z,S,L,F);',
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
      if (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < 128) PANEL_SLOTS = 8;

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
      'uMat', 'uArch', 'uCol', 'uLight', 'uStrip', 'uJoint', 'uAlpha', 'uTech', 'uBuild', 'uProg',
      'uPhoto', 'uDat', 'uNor', 'uPh', 'uPhOk', 'uTexOk', 'uBand', 'uPB', 'uPS'];
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
      // decode() pode ser rejeitado mesmo com a imagem válida (alguns navegadores móveis):
      // nesse caso, ainda se usa a imagem quando ela terminar de carregar.
      function uploadOnLoad() {
        if (img.complete && img.naturalWidth) upload();
        else img.onload = upload;
      }
      img.src = touch ? src.replace('.jpg', '-512.jpg') : src;
      if (img.decode) img.decode().then(upload, uploadOnLoad);
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
    var panelBox = new Float32Array(8 * PANEL_SLOTS), panelState = new Float32Array(8 * PANEL_SLOTS);
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
      gl.uniform1f(u.uTech, s.tech);
      gl.uniform1f(u.uBuild, s.build);
      gl.uniform1f(u.uProg, s.p);
      panelUniforms(s.p, panelBox, panelState);
      gl.uniform4fv(u.uPB, panelBox);
      gl.uniform4fv(u.uPS, panelState);
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
