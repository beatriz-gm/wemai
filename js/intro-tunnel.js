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
       telas de vidro quase transparente, definidas pela luz: contorno, barra de título e
       conteúdo luminosos, só nos tons claros da paleta, e espalham luz na parede e no piso. O conteúdo é fictício e
       animado (código, gráficos, aplicativos), sem texto legível. Ficam fora do cone de
       visão do vão, por isso nunca passam na frente da paisagem;
     - telas do mesmo tipo por todo o teto (CEIL_PANELS), acompanhando a curva da abóbada,
       alternadas dos dois lados do centro. Só aparecem onde o pixel vê a abóbada, por isso
       também nunca cobrem a paisagem;
     - molduras, cantos de seleção, marcadores e linhas de conexão, sem conteúdo;
     - reflexo dos planos no piso e luz discreta contornando vão e abóbada.
     Ela nasce no vão e vem em direção à câmera (uBuild), com intensidade uTech.
     No celular (pointer: coarse) toda essa camada é mais contida (TECH_MOBILE): a
     arquitetura é lida primeiro e a tecnologia aparece ao olhar melhor.

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
     parede; negativo, quando se fixam nela; 2, nada) e se a tela é azulada (1) ou branca (0).
     Distribuição regular: as telas avançam em passos iguais ao longo do túnel, alternando
     entre uma faixa alta e uma baixa, sem se sobrepor; as duas paredes ficam defasadas em
     meio passo. Todas ficam fora do cone de visão do vão: x = meia-largura − afastamento >
     252·(1 − z/2400). Cada parede tem até PANEL_SLOTS telas. */
  var WALL_PANELS = [
    [1, 30, 189, 383, 531, 0, .12, 2, 0],
    [1, 134, 294, 580, 746, 34, .24, 2, 1],
    [1, 223, 390, 388, 538, 32, .33, -.46, 0],
    [1, 338, 490, 599, 745, 0, .14, 2, 1],
    [1, 421, 590, 377, 532, 36, .22, .38, 0],
    [1, 526, 686, 603, 763, 42, .27, 2, 1],
    [1, 629, 793, 382, 528, 0, .14, 2, 0],
    [1, 729, 887, 586, 745, 33, .18, -.31, 1],
    [1, 826, 996, 376, 539, 42, .19, .32, 0],
    [1, 928, 1098, 572, 731, 0, .12, 2, 1],
    [-1, 75, 236, 612, 755, 0, .39, 2, 0],
    [-1, 184, 342, 378, 526, 38, .19, .35, 1],
    [-1, 271, 440, 574, 715, 30, .27, 2, 0],
    [-1, 381, 544, 399, 547, 0, .30, 2, 1],
    [-1, 487, 641, 575, 744, 30, .18, -.31, 0],
    [-1, 581, 731, 383, 546, 39, .23, .39, 1],
    [-1, 679, 838, 594, 741, 0, .13, 2, 0],
    [-1, 774, 941, 376, 527, 0, .14, 2, 1],
    [-1, 878, 1040, 602, 744, 42, .16, 2, 0],
    [-1, 980, 1138, 377, 539, 30, .12, -.25, 1]
  ];

  /* Telas no teto, na mesma lógica das paredes: arco inicial e final (a = θ·285, com θ o
     ângulo na abóbada, 0 no alto e negativo à esquerda), z inicial e final, afastamento da
     abóbada (0 = embutida), quando surgem, o que fazem depois (positivo: voltam; negativo:
     se fixam; 2: nada) e se a tela é azulada (1) ou branca (0). Avançam em passos iguais,
     alternando os lados do centro e três distâncias até o alto do teto. */
  var CEIL_PANELS = [
    [65, 224, 33, 208, 26, .50, 2, 1],
    [-353, -176, 160, 346, 23, .16, -.29, 0],
    [-9, 149, 300, 454, 0, .28, 2, 1],
    [-231, -72, 434, 590, 29, .36, .52, 0],
    [186, 340, 557, 733, 26, .16, 2, 1],
    [-157, 18, 687, 837, 0, .22, 2, 0],
    [51, 234, 816, 973, 25, .25, -.38, 1],
    [-333, -172, 948, 1100, 26, .14, .30, 0],
    [-6, 144, 1068, 1233, 0, .15, 2, 1],
    [-228, -53, 1214, 1366, 0, .12, 2, 0]
  ];

  var LOOSE_MIN = 22;
  // Conteúdo de cada tela, na ordem da tabela: 0 código, 1 barras, 2 gráfico, 3 aplicativos,
  // 4 medidor, 5 linhas de texto.
  var PANEL_KINDS = [2, 0, 3, 1, 4, 5, 0, 3, 2, 5, 1, 4];

  // Telas por parede e no teto (o shader percorre esse número em cada grupo). Em aparelhos
  // com poucos registros de uniform, cai para 8 (ver create).
  var PANEL_SLOTS = 10;
  var WALL_GAP = 2.5, PANEL_SPEED = 6.5;
  // Saída distante (celular): as telas se espalham pelo túnel mais longo, na mesma ordem e
  // tamanho (ver create).
  var PANEL_DEPTH = 1;

  function smoothstepJs(a, b, x) { var t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

  /* Movimento de uma tela no progresso p da câmera: afastamento da superfície (g),
     visibilidade, se é solta, e o deslocamento ao longo do comprimento (u) e da altura (v).
     Embutida: acende no lugar, com uma leve oscilação enquanto liga. Solta: sai da
     superfície e flutua de leve; pode voltar para dentro (out > 0) ou se fixar (out < 0). */
  function panelMotion(gap, tin, out, seed, p) {
    var back = out > 0 && out < 2 ? out : 2;
    var settle = out < 0 ? smoothstepJs(-out, -out + .08, p) : 0;
    var a = smoothstepJs(tin, tin + .07, p) * (1 - smoothstepJs(back, back + .07, p));
    if (gap < LOOSE_MIN) {
      return { g: WALL_GAP, vis: a < 1 ? a * (.55 + .45 * ((a * 6.7) % 1 >= .35 ? 1 : 0)) : a, loose: 0, u: 0, v: 0 };
    }
    var w = p * PANEL_SPEED + seed * 6.283, free = 1 - settle;
    return {
      g: Math.max(((gap + 4 * Math.sin(w * 1.3)) * free + WALL_GAP * settle) * a, 1),
      vis: smoothstepJs(0, .3, a),
      loose: 1,
      u: 9 * Math.sin(w * .6 + 2) * a * free,
      v: 5 * Math.sin(w * .8 + 1) * a * free
    };
  }

  /* Posição e estado das telas nos arrays do shader, uma vez por quadro (o shader não repete
     a conta em cada pixel). box: retângulo já com o movimento (paredes: z inicial e final, y
     de cima e de baixo; teto: arco inicial e final, z inicial e final). state: afastamento,
     visibilidade, solta = 1, tipo + 10 se azulada + semente. Paredes: posições
     0 a PANEL_SLOTS − 1 à direita, as seguintes à esquerda. */
  function panelUniforms(p, box, state, cbox, cstate) {
    var slot = [0, PANEL_SLOTS];
    box.fill(0); state.fill(0); cbox.fill(0); cstate.fill(0);
    WALL_PANELS.forEach(function (q, i) {
      var side = q[0] > 0 ? 0 : 1;
      var k = slot[side]++;
      if (k >= PANEL_SLOTS * (side + 1)) return;
      var seed = PANEL_KINDS[i % PANEL_KINDS.length] + 10 * q[8] + ((i * .618) % 1) * .98;
      var m = panelMotion(q[5], q[6], q[7], seed, p);
      var z0 = q[1] * PANEL_DEPTH;
      box.set([z0 + m.u, z0 + q[2] - q[1] + m.u, q[3] + m.v, q[4] + m.v], k * 4);
      state.set([m.g, m.vis, m.loose, seed], k * 4);
    });
    CEIL_PANELS.forEach(function (q, i) {
      if (i >= PANEL_SLOTS) return;
      var seed = PANEL_KINDS[(i + 5) % PANEL_KINDS.length] + 10 * q[7] + ((i * .618 + .3) % 1) * .98;
      var m = panelMotion(q[4], q[5], q[6], seed, p);
      var c0 = q[2] * PANEL_DEPTH;
      cbox.set([q[0] + m.v, q[1] + m.v, c0 + m.u, c0 + q[3] - q[2] + m.u], i * 4);
      cstate.set([m.g, m.vis, m.loose, seed], i * 4);
    });
  }

  /* Presença da camada de tecnologia (1 = como no desktop). No celular ela é mais contida:
     o túnel é lido primeiro como arquitetura e a tecnologia aparece ao olhar melhor.
     veil: véu de vidro; edge: contorno e halo das telas; ink: detalhes internos (barra,
     pontos, conteúdo, varredura); mark: cantos, marcadores e linhas de conexão; glow: luz
     das telas na parede e no piso; ceil: telas do teto (além dos fatores acima); ceilLines:
     linhas do teto; lines: linhas das paredes e do piso; rim: luz no contorno do vão;
     refl: reflexo das telas no piso; warm: quanto a luz das telas puxa para o branco quente
     da paisagem, em vez do azul frio. */
  var TECH_DESKTOP = { veil: 1, edge: 1, ink: 1, mark: 1, glow: 1, ceil: 1, ceilLines: 1, lines: 1, rim: 1, refl: 1, warm: 0 };
  var TECH_MOBILE = { veil: .7, edge: .6, ink: .4, mark: .35, glow: .55, ceil: .5, ceilLines: .55, lines: .85, rim: .75, refl: .6, warm: .3 };

  // Constantes da cena, injetadas no shader (mesma geometria usada pelo SVG da logo).
  function fragmentSource(g, touch) {
    function f(v) { return (+v).toFixed(3); }
    var k = touch ? TECH_MOBILE : TECH_DESKTOP;
    return [
      'precision highp float;',
      'uniform vec2 uView;uniform float uDpr,uVpY,uF,uCam,uW,uV;',
      'uniform float uMat,uArch,uCol,uLight,uStrip,uJoint,uAlpha,uTech,uBuild,uProg;',
      'uniform float uArcR,uArcG,uRim,uRimDown,uRimW,uMetal,uPanel,uGlow,uCeil,uRimX,uForm,uLineE,uStruct,uVault,uWallG;',
      'uniform sampler2D uPhoto,uDat,uNor;uniform vec4 uPh;uniform float uPhOk,uTexOk;',
      'uniform vec3 uBand[5];',
      'uniform vec4 uPB[' + 2 * PANEL_SLOTS + '],uPS[' + 2 * PANEL_SLOTS + '],uCB[' + PANEL_SLOTS + '],uCS[' + PANEL_SLOTS + '];',
      '#define SLOTS ' + PANEL_SLOTS,
      '#define K_VEIL ' + f(k.veil), '#define K_EDGE ' + f(k.edge), '#define K_INK ' + f(k.ink),
      '#define K_MARK ' + f(k.mark), '#define K_GLOW ' + f(k.glow), '#define K_CEIL ' + f(k.ceil),
      '#define K_CEIL_LINES ' + f(k.ceilLines), '#define K_LINES ' + f(k.lines), '#define K_RIM ' + f(k.rim),
      '#define K_REFL ' + f(k.refl), '#define K_WARM ' + f(k.warm),
      '#define EYE ' + f(g.eye),
      '#define FLOOR ' + f(g.floor),
      '#define SPRING ' + f(g.spring),
      '#define LEN ' + f(g.length),
      // Saída distante (só no celular): plano do arco da logo (entrada) e passo/quantidade das
      // camadas de luz, para cobrirem o túnel mais longo. No desktop: entrada 0, como antes.
      '#define ENTRY ' + f(g.entry || 0),
      '#define RIB_SP ' + f(g.entry ? 300 : 210),
      '#define RIB_N ' + (g.entry ? Math.ceil(g.length / 300) : 11),
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
    // Paleta (sRGB), teste "tons azuis" (references/tuneltech.png): superfícies no azul da
    // marca e luzes azuladas (frisos ciano, luz da saída fria).
    'const vec3 STONE_S=vec3(.360,.530,.790);',
    'const vec3 VAULT_S=vec3(.300,.470,.760);',
    'const vec3 FLOOR_S=vec3(.330,.500,.770);',
    'const vec3 STRIP=vec3(.55,.80,1.);',
    'const vec3 COOL=vec3(.78,.90,1.08);',     // tom da luz que entra pela saída
    'const vec3 HALO=vec3(.86,.93,1.);',       // primeira luz e névoa do vão
    // Exposição e luz: intensidade da janela, luz rebatida pelo piso, luz que circula
    // no túnel, frisos, luz do céu alto (arco) e força do reflexo no piso.
    'const float GAIN=4.6;const float BOUNCE=.6;const float AMB=.075;const float STRIP_K=3.;',
    'const float SKY=.45;const float REFL=1.25;',
    // Material: tamanho da textura, cor, relevo, brilho fosco, poros, manchas amplas e
    // ondulação do reflexo no piso.
    'const float TILE=330.;const float ALB_DETAIL=.35;const float RELIEF=.7;',
    'const float SHEEN=1.4;const float CAVITY=.5;const float MACRO=.10;const float RIPPLE=40.;',
    // Teste "metal azul acetinado" (só no celular, uMetal): rugosidade base e variação (manchas
    // amplas, médias e escovado ao longo do túnel), ondulação das normais (chapas levemente
    // empenadas), parte especular tingida pelo azul (metal), perda do difuso, força do reflexo
    // difuso do entorno e do brilho da saída.
    'const float MET_ROUGH=.34;const float MET_VAR=.24;const float MET_BRUSH=.08;const float MET_BEND=12.;',
    'const float MET_TINT=.7;const float MET_DIFF=.55;const float MET_ENV=2.2;const float MET_SHEEN=2.;const float MET_MIRROR=.32;',
    // Feixes de luz ciano (teste): cor, força e distância à parede (nas bordas do piso).
    'const vec3 BEAM=vec3(.70,.92,1.);const float BEAM_K=2.2;const float BEAM_BASE=.35;const float BEAM_EDGE=8.;',
    // Pulso nos feixes: espaçamento entre pulsos (ao longo do túnel), velocidade (pulsos por
    // abertura, em relação ao progresso da câmera) e força. O feixe fixo fica em BEAM_BASE da
    // força; o pulso mantém a sua.
    'const float PULSE_GAP=900.;const float PULSE_SPEED=6.;const float PULSE_K=1.6;',
    // Estrutura tecnológica (teste, references/Storyboard WEMAI_ Da Ideia ao Horizonte.png):
    // camadas de luz com o perfil do túnel (paredes + abóbada), em planos igualmente
    // espaçados: linhas finas, como tubos de luz ciano junto à superfície. Primeiro plano (a
    // partir da parede do fundo), passo, quantas o shader percorre, afastamento da superfície,
    // meia-espessura do tubo, cor do halo (ciano), cor do núcleo (quase branco, saturado de
    // luz), força do núcleo, do halo e da luz que a linha lança na parede, abóbada e piso.
    // Ficam fora do cone de visão do vão: nunca cobrem a paisagem.
    'const float RIB_Z0=160.;const float RIB_S=RIB_SP;',
    'const float RIB_W=5.;const float RIB_HW=.7;',
    'const vec3 RIB_C=vec3(.30,.82,1.);const vec3 RIB_CORE=vec3(.82,.97,1.);',
    // Mesma intensidade das linhas de luz do piso (fora do pulso: BEAM_K·BEAM_BASE).
    'const float RIB_K=.8;const float RIB_HALO=.18;const float RIB_SPILL=.12;',
    // Teste "luz embutida" (só no celular, uGlow): a luz das linhas fica num canal da
    // estrutura (fenda escura dos dois lados), com núcleo mais fino, halo curto e uma cauda
    // larga muito fraca (bloom leve e seletivo); mais forte nos encontros com as paredes, mais
    // fraca e fina ao longe (profundidade) e contida perto da câmera. A luz que ela lança na
    // superfície fica mais concentrada junto a ela.
    'const float LG_HW=.45;const float LG_HALO=.14;const float LG_TAIL=.025;const float LG_SLOT=.28;',
    'const float LG_JOIN=.7;const float LG_FAR=.5;const float LG_SPILL=.15;',
    // Abertura direta (teste, frames 08 e 09 da referência): não existe porta em momento
    // algum. O túnel termina na própria boca (paredes e abóbada em z = 0) e tudo o que está
    // dentro dela é abertura; o arco da logo passa direto para a borda da boca, um fio de luz
    // quase branco com halo ciano. Força do fio, do halo e do brilho sobre a paisagem.
    // Próxima da intensidade das linhas de luz do piso.
    'const float RIM_K=1.8;const float RIM_HALO=.45;const float RIM_OPEN=.4;',
    // A borda acende sob o arco (uRim) e desce pelas laterais até o piso (uRimDown).
    'float rimAt(float y){float yl=SPRING-20.+(FLOOR+60.-SPRING)*uRimDown;return uRim*(1.-smoothstep(yl-70.,yl,y));}',
    // Luz ciano da borda e do arco, para misturar em sRGB (lê como luz também sobre o branco).
    'const vec3 RIM_S=vec3(.62,.90,1.);',
    // Halo do arco da logo aceso (no plano do fundo): raio médio do arco neste instante.
    'float arcHalo(vec2 q){float fo=uCam/uF;float dd=q.y<=ARC_CY?abs(length(vec2(q.x,q.y-ARC_CY))-uArcR):length(vec2(abs(q.x)-uArcR,q.y-ARC_CY));',
    '  return (exp(-dd/(4.+fo))*.55+exp(-dd/40.)*.18)*uArcG;}',
    // Luz sobre a cor final (sRGB): puxa para o ciano e soma brilho; vale sobre branco e escuro.
    'vec3 glowOn(vec3 c,float h){h=min(h,1.5);return mix(c,RIM_S,min(h,1.)*.5)+RIM_S*h*.3;}',
    // Distância para dentro da boca do túnel (paredes e abóbada), no plano do fundo.
    'float mouthIn(vec2 q){return q.y>SPRING?uW-abs(q.x):(1.-length(vec2(q.x/uW,(q.y-SPRING)/uV)))*min(uW,uV);}',

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
    // Cor da paisagem na abertura em uma altura (faixas da foto, interpoladas).
    'vec3 bandAt(float y){float k=clamp((FLOOR-y)/(FLOOR-JAMB_Y)*4.-.5,0.,4.);',
    '  vec3 c=mix(uBand[0],uBand[1],clamp(k,0.,1.));c=mix(c,uBand[2],clamp(k-1.,0.,1.));',
    '  c=mix(c,uBand[3],clamp(k-2.,0.,1.));c=mix(c,uBand[4]*SKY*2.,clamp(k-3.,0.,1.));return lin(c);}',
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
    // Telas de computador, só nos tons claros da paleta: azul-claro #7FA2C4 e quase branco.
    // Véu branco ou azul-claríssimo; contorno e conteúdo em luz fria.
    'const vec3 TECH_SKY=vec3(.498,.635,.769);',
    'const vec3 SCREEN_TINT_TOP=vec3(.92,.95,.985);const vec3 SCREEN_TINT=vec3(.85,.90,.955);',
    'const vec3 SCREEN_LIGHT_TOP=vec3(.985,.99,1.);const vec3 SCREEN_LIGHT=vec3(.93,.955,.98);',
    'const float SCREEN_EMIT=1.22;',
    // Vidro quase transparente; o que define a tela é a luz (contorno, halo e conteúdo).
    'const float SCREEN_VEIL=0.14;const float SCREEN_EDGE=0.55;const float SCREEN_HALO=0.14;const float SCREEN_INK=0.6;',
    'const vec3 SCREEN_LUM=vec3(.86,.93,1.);',
    'const float GLASS_LINK=70.;',       // a linha de conexão vai além do vidro
    'const float PANEL_T=5.;',          // espessura das telas soltas
    // Teste "lâminas de vidro" (só no celular, uPanel): vidro fosco levemente fumê. Quanto o
    // vidro escurece o que está atrás, tom frio do fosco e quanto ele clareia (mais do lado da
    // saída), reflexo frio de Fresnel (mais forte quando visto de lado), bisel polido da borda,
    // sombra de contato da espessura e quanto sobra do conteúdo (estrutura, não interface).
    'const float PG_SMOKE=.78;const vec3 PG_TINT=vec3(.70,.80,.94);const float PG_FROST=.17;',
    'const vec3 PG_SHEEN=vec3(.80,.90,1.);const float PG_FRES=.5;const float PG_EDGE=1.1;',
    'const float PG_SHADOW=.30;const float PG_INK=.3;',
    // Teste "teto estrutural" (só no celular, uCeil): parte das telas do teto vira divisão da
    // própria abóbada (rente a ela, sem vidro, sem luz própria): fração delas, força da junta
    // escura, do bisel aceso do lado da saída e da leve diferença de tom da placa. As demais
    // seguem lâminas de vidro, sem conteúdo, com um fio de luz fino acompanhando a curvatura.
    'const float CE_SPLIT=.55;const float CE_SEAM=.42;const float CE_BEVEL=.30;const float CE_TONE=.06;',
    'const float CE_FROST=.45;const float CE_LINE=.55;',
    // Espaçamento das juntas longitudinais do teto contínuo (no arco da abóbada): a linha de
    // luz dos ombros (θ = .95) cai exatamente numa delas.
    'const float VAULT_SEAM=135.375;',
    // Experimento "paredes de vidro" (?paredes=vidro, só no celular, uWallG): a parede é feita
    // de lâminas de vidro de larguras irregulares (WG_W em média), algumas divididas na altura,
    // cada uma com densidade, recuo e inclinação próprios; atrás delas, a WG_D, uma segunda
    // camada mais escura e mais funda (WG_W2), vista por transparência, com juntas de luz fracas.
    'const float WG_W=170.;const float WG_W2=260.;const float WG_D=46.;',
    // Limites irregulares de uma sequência de células de largura média w (semente k).
    'vec3 wgCell(float z,float w,float k){float i=floor(z/w);',
    '  float b0=(i+(hash(vec2(i,k))-.5)*.6)*w,b1=(i+1.+(hash(vec2(i+1.,k))-.5)*.6)*w;',
    '  if(z<b0){b1=b0;i-=1.;b0=(i+(hash(vec2(i,k))-.5)*.6)*w;}',
    '  else if(z>b1){i+=1.;b0=b1;b1=(i+1.+(hash(vec2(i+1.,k))-.5)*.6)*w;}',
    '  return vec3(i,b0,b1);}',
    'float ceilStruct(vec4 st){return uCeil>.5&&fract(st.w)<CE_SPLIT?1.:0.;}',
    // Revelação: a tecnologia nasce no vão (z = 0) e avança em direção à câmera.
    'float techReveal(float z){float f=uBuild*(LEN+320.);return 1.-smoothstep(f-260.,f,z);}',
    // Plano de vidro em x = s·(uW − g), com g o afastamento da parede neste instante.
    // b: z inicial e final, y de cima e de baixo. vis: visibilidade. Retorna (corpo, traços);
    // L e F levam a posição no vidro e o tamanho do pixel para o acabamento (wallFace, screenFace).
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
    '  float st=fr*(.30+.70*cm*K_MARK);',
    // Marcador discreto: um traço curto no alto do plano.
    '  st=max(st,line(y-(y0+22.),.7,fy)*step(z0+26.,z)*step(z,z0+92.)*ins*.55*K_MARK);',
    // Linha de conexão até um pequeno nó, além da borda do vidro.
    '  float yc=y0+(y1-y0)*.32;',
    '  st=max(st,line(y-yc,.6,fy)*step(z1,z)*(1.-smoothstep(z1,zc,z))*.55*K_MARK);',
    '  st=max(st,(1.-smoothstep(2.6,2.6+fy,length(vec2((z-zc)*fy/fz,y-yc))))*.6*K_MARK);',
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
    // Face de uma tela de computador, de vidro quase transparente: um véu leve de vidro e,
    // em luz, o contorno com halo, a barra de título, os pontos da janela, o conteúdo e a
    // varredura. q: posição a partir do canto de cima à esquerda (como vista na imagem);
    // sz: tamanho; e: distância às bordas nos dois eixos; f: tamanho do pixel nos dois eixos;
    // S: estado (ver panelUniforms).
    // xd: direção da saída no plano da tela (q); fres: cosseno entre o olhar e a normal da tela.
    'void screenFace(inout vec3 c,vec2 q0,vec2 sz,vec2 e,vec2 f,vec4 S,float kf,vec2 xd,float cv,float kc){',
    '  float vis=S.y*uTech*kf;',
    '  float kd=floor(S.w),sd=fract(S.w);float dk=step(9.5,kd);kd-=dk*10.;',
    '  float fm=max(f.x,f.y);',
    '  float ins=smoothstep(-f.x,f.x,e.x)*smoothstep(-f.y,f.y,e.y);',
    '  vec2 uv=clamp(q0/sz,0.,1.);',
    '  vec3 lum=mix(lin(dk>.5?mix(SCREEN_LUM,TECH_SKY,.35):SCREEN_LUM),lin(TECH_LIGHT),K_WARM);',
    // Lâmina de vidro: o que está atrás aparece um pouco mais escuro e difuso (fumê fosco), o
    // vidro clareia do lado que recebe a luz da saída e reflete o frio do entorno quando visto
    // de lado (Fresnel). A borda é um bisel polido: acende do lado da saída e quase some do
    // outro; fora dela, a espessura projeta uma sombra curta do lado da câmera. O conteúdo
    // fica como estrutura discreta, sem barra de título, pontos ou varredura.
    '  if(uPanel>.5){',
    '    vec2 uc=uv-.5;float tw=clamp(dot(uc,xd)+.5,0.,1.);',
    // Teto estrutural: placa da abóbada separada por uma junta fina; o lado voltado para a
    // saída pega luz no bisel, o outro fica na sombra da junta. Some ao longe (sem cintilar).
    '    float ed0=min(e.x,e.y);',
    '    vec2 en0=e.x<e.y?vec2(q0.x<sz.x*.5?-1.:1.,0.):vec2(0.,q0.y<sz.y*.5?-1.:1.);',
    '    if(kc>.5&&ceilStruct(S)>.5){',
    '      float lo=(1.-smoothstep(3.,9.,fm))*S.y*uTech;',
    '      float fs=dot(en0,xd);',
    '      c*=1.+CE_TONE*(hash(vec2(sd*41.,3.))-.5)*2.*ins*lo;',
    '      c*=1.-line(ed0,.55,fm)*CE_SEAM*(.75+.25*max(-fs,0.))*lo;',
    '      c+=c*line(ed0-1.5,.45,fm)*max(fs,0.)*CE_BEVEL*2.5*lo;',
    '      c*=1.-(1.-smoothstep(0.,6.+fm,ed0))*ins*max(-fs,0.)*.10*lo;',
    '      return;',
    '    }',
    '    float fr=pow(1.-clamp(cv,0.,1.),5.);',
    '    float lb=dot(c,vec3(.2126,.7152,.0722));',
    '    float ceK=kc>.5&&uCeil>.5?CE_FROST:1.;',
    '    vec3 body=mix(c,vec3(lb)*lin(PG_TINT)*1.25,.3*ceK)*mix(1.,PG_SMOKE,ceK)+lin(PG_TINT)*PG_FROST*ceK*(.5+tw);',
    '    body+=lin(PG_SHEEN)*(PG_FRES*fr*(.35+.65*tw)+.035*(1.-smoothstep(0.,.3,abs(uc.x*.6+uc.y-.15))));',
    '    c=mix(c,body,ins*vis);',
    '    float ed=min(e.x,e.y);',
    '    vec2 en=e.x<e.y?vec2(q0.x<sz.x*.5?-1.:1.,0.):vec2(0.,q0.y<sz.y*.5?-1.:1.);',
    '    float sl=.3+.7*max(dot(en,xd),0.);',
    '    float bev=(1.-smoothstep(0.,2.2+fm,ed))*ins;',
    '    c+=lin(PG_SHEEN)*(bev*.4+line(ed,.45,fm)*.8)*sl*PG_EDGE*K_EDGE*vis;',
    '    float out_=1.-ins;',
    '    c*=1.-out_*exp(-max(-ed,0.)/(2.5+fm))*max(dot(en,-xd),0.)*PG_SHADOW*vis;',
    '    c+=lin(PG_SHEEN)*out_*line(-ed-1.6,.6,fm)*max(dot(en,xd),0.)*.35*PG_EDGE*vis;',
    '    vec2 q=q0-vec2(10.,12.);vec2 bb=sz-vec2(20.,22.);',
    '    float lod=1.-smoothstep(2.5,7.,fm);',
    // Teto: sem conteúdo; um fio de luz fino acompanha a curvatura junto à borda da saída.
    '    if(kc>.5&&uCeil>.5){',
    '      c+=lum*line(q0.y-(sz.y-6.),.45,f.y)*smoothstep(4.,10.,q0.x)*smoothstep(4.,10.,sz.x-q0.x)*CE_LINE*vis;',
    '      lod=0.;',
    '    }',
    '    if(lod>0.&&q.x>0.&&q.y>0.&&q.x<bb.x&&q.y<bb.y){',
    '      float ct=hud(q,bb,kd,sd,f.x,f.y)*step(q.x,S.y*bb.x*1.05);',
    '      c+=lum*min(ct,1.)*SCREEN_INK*PG_INK*K_INK*lod*vis*(.6+.4*tw);',
    '    }',
    '    return;',
    '  }',
    // Véu de vidro.
    '  vec3 scr=lin(dk>.5?mix(SCREEN_TINT_TOP,SCREEN_TINT,uv.y):mix(SCREEN_LIGHT_TOP,SCREEN_LIGHT,uv.y))*SCREEN_EMIT;',
    '  c=mix(c,scr,ins*SCREEN_VEIL*K_VEIL*vis);',
    // Contorno de luz, com halo dos dois lados da borda.
    '  float ed=min(e.x,e.y);',
    '  float edgeL=max(line(e.x,.8,f.x)*smoothstep(-f.y,0.,e.y),line(e.y,.8,f.y)*smoothstep(-f.x,0.,e.x));',
    '  c+=lum*(edgeL*SCREEN_EDGE+exp(-abs(ed)/5.)*SCREEN_HALO)*K_EDGE*vis;',
    // Barra de título: uma faixa de luz suave, com três pontos acesos.
    '  c+=lum*(1.-smoothstep(12.-f.y,12.+f.y,q0.y))*ins*SCREEN_HALO*.6*K_INK*vis;',
    '  float dots=0.;',
    '  dots=max(dots,1.-smoothstep(2.,2.+fm,length(q0-vec2(9.,6.))));',
    '  dots=max(dots,1.-smoothstep(2.,2.+fm,length(q0-vec2(16.,6.))));',
    '  dots=max(dots,1.-smoothstep(2.,2.+fm,length(q0-vec2(23.,6.))));',
    '  c+=lum*dots*ins*SCREEN_INK*K_INK*vis;',
    // Reflexo do vidro (faixa diagonal suave).
    '  c+=lin(TECH_GLASS)*(1.-smoothstep(0.,.22,abs(uv.x*.7+uv.y-.55)))*ins*.025*vis;',
    // Conteúdo em luz, escrito da esquerda para a direita; some quando a tela fica pequena demais.
    '  vec2 q=q0-vec2(10.,18.);vec2 bb=sz-vec2(20.,28.);',
    '  float lod=1.-smoothstep(2.5,7.,fm);',
    '  if(lod>0.&&q.x>0.&&q.y>0.&&q.x<bb.x&&q.y<bb.y){',
    '    float ct=hud(q,bb,kd,sd,f.x,f.y)*step(q.x,S.y*bb.x*1.05);',
    '    c+=lum*min(ct,1.)*SCREEN_INK*K_INK*lod*vis;',
    '  }',
    '  c+=lum*line(q0.y-sz.y*fract(uProg*2.2+sd),.8,f.y)*ins*SCREEN_HALO*.7*K_INK*vis;',
    '}',
    // Tela da parede à frente: desenha a espessura (soltas) e devolve os parâmetros da face
    // (q: posição e tamanho; e: distância às bordas e tamanho do pixel). b: retângulo;
    // S: estado; L e F vêm de glass.
    'void wallFace(inout vec3 c,vec2 d,vec4 b,vec4 S,vec4 L,vec2 F,out vec4 q,out vec4 e){',
    '  float s=d.x>0.?1.:-1.;float z=L.x,y=L.y,dz=L.z,dy=L.w,fz=F.x,fy=F.y;',
    '  if(S.z>.5){',
    '    float ins=smoothstep(-fz,fz,dz)*smoothstep(-fy,fy,dy);',
    '    float tp2=(uW-S.x+PANEL_T)/abs(d.x);float z2=uCam-tp2,y2=EYE+tp2*d.y;',
    '    float bk=smoothstep(-fz,fz,min(z2-b.x,b.y-z2))*smoothstep(-fy,fy,min(y2-b.z,b.w-y2));',
    '    c+=lin(SCREEN_LUM)*bk*(1.-ins)*SCREEN_EDGE*.45*K_EDGE*S.y*uTech;',
    '  }',
    '  q=vec4(s>0.?z-b.x:b.y-z,y-b.z,b.y-b.x,b.w-b.z);e=vec4(dz,dy,fz,fy);',
    '}',
    // Telas do teto. P: ponto da abóbada visto neste pixel; R: direção do raio; t: distância.
    // Coordenadas do teto: arco (θ·285) e z. Uma tela afastada g da abóbada é encontrada
    // recuando g ao longo da normal (aproximação boa para afastamentos pequenos diante do
    // raio da abóbada). Desenha a luz e a sombra delas na abóbada e devolve os parâmetros da
    // face da tela da frente (fs.y = 0: nenhuma), desenhada depois por screenFace.
    'void ceilingPanels(inout vec3 col,vec3 P,vec3 R,float t,out vec4 fq,out vec4 fe,out vec4 fs){',
    '  fq=vec4(0.);fe=vec4(0.);fs=vec4(0.);',
    '  float th=atan(P.x/uW,-(P.y-SPRING)/uV);float arc=th*285.;',
    '  vec3 dP=vec3(uW*cos(th),uV*sin(th),0.);',
    '  vec3 N=-normalize(vec3(P.x/(uW*uW),(P.y-SPRING)/(uV*uV),0.));',
    '  float kn=max(-dot(R,N),1e-3);vec3 Ta=dP*285./dot(dP,dP);',
    '  float best=1e9;vec4 Z=vec4(0.),S=vec4(0.);vec2 hit=vec2(0.);float sh=0.,gl=0.;',
    '  for(int i=0;i<SLOTS;i++){',
    '    vec4 b=uCB[i],st=uCS[i];',
    '    if(st.y<.01)continue;',
    '    float stc=ceilStruct(st);',
    '    vec2 c=vec2(b.x+b.y,b.z+b.w)*.5,h=vec2(b.y-b.x,b.w-b.z)*.5;',
    '    gl=max(gl,exp(-length(max(abs(vec2(arc,P.z)-c)-h,0.))/(14.+st.x*.6))*st.y*(1.-stc)*(1.-.5*uCeil));',
    '    if(st.z>.5&&stc<.5){',
    '      vec2 e=abs(vec2(arc,P.z*(1.-st.x/300.))-c)-h;float pen=3.+st.x*.5;',
    '      sh=max(sh,(1.-smoothstep(-pen,pen,e.x))*(1.-smoothstep(-pen,pen,e.y))*st.y);',
    '    }',
    '    float dt=st.x/kn*(1.-stc);vec3 D=-R*dt;float a=arc+dot(D,Ta);float z=P.z+D.z;',
    '    if(a<b.x-6.||a>b.y+6.||z<b.z-6.||z>b.w+6.)continue;',
    '    float sc=a>b.x&&a<b.y&&z>b.z&&z<b.w?t-dt:t-dt+1e5;',
    '    if(sc<best){best=sc;Z=b;S=st;hit=vec2(a,z);}',
    '  }',
    '  col*=1.-.42*sh*uTech*K_CEIL*K_CEIL;',
    '  col+=lin(TECH_GLOW)*gl*.30*K_GLOW*K_CEIL*uTech*(1.-.65*uPanel);',
    '  col*=1.-.14*gl*uPanel*uTech;',
    '  if(best>=1e9)return;',
    '  float fp=(best>=1e5?best-1e5:best)/uF;',
    // Na imagem, o lado da câmera (z maior) fica em cima.
    '  fq=vec4(hit.x-Z.x,Z.w-hit.y,Z.y-Z.x,Z.w-Z.z);',
    '  fe=vec4(min(hit.x-Z.x,Z.y-hit.x),min(hit.y-Z.z,Z.w-hit.y),fp,fp/max(kn/length(R),.12));',
    '  fs=S;',
    '}'
  ].join('\n');

  var SHADER_BODY = [
    /* Borda da boca do túnel, no plano do fundo (q): (fio, halo). Vale em qualquer pixel (névoa
       branca do início, paredes, paisagem), por isso a borda existe desde que o túnel se forma,
       mesmo antes de as superfícies ganharem cor. Mais fraca descendo para o piso. */
    // q: ponto no plano do arco (entrada); dist: distância da câmera a esse plano.
    'vec2 rimLight(vec2 q,float dist){',
    '  if(uRim<.001||q.y>FLOOR)return vec2(0.);',
    // Enquanto o arco cresce, a borda acompanha o tamanho dele (escala em torno do centro).
    '  float sc=uV/max(uArcR,1.);vec2 qs=vec2(q.x*sc,SPRING+(q.y-SPRING)*sc);',
    '  float fo=dist/uF;float sv=abs(mouthIn(qs))/sc;',
    '  float k=rimAt(q.y)*(1.-.7*smoothstep(FLOOR-200.,FLOOR-20.,q.y));',
    // Espessura do fio: no início, a mesma da faixa do arco (que vira a borda); afina depois.
    '  return vec2(line(sv,1.+3.8*uRimW,fo),exp(-sv/(5.+fo))*.8+exp(-sv/50.)*.15)*k;',
    '}',
    // Aplica borda e halo do arco sobre uma cor sRGB.
    // O fio puxa para o ciano (mais saturado sobre fundo claro, para ler como luz no branco) e soma
    // brilho (sobre o escuro).
    // Saída distante: a borda do arco da logo fica na entrada (z = ENTRY) e some quando a
    // câmera passa por ela; a saída (z = 0) tem o seu fio de luz, que acende com o túnel.
    'vec2 rims(vec2 d){',
    '  float de=uCam-ENTRY;vec2 o=vec2(0.);',
    '  if(de>1.)o=rimLight(vec2(de*d.x,EYE+de*d.y),de)*(ENTRY>0.?smoothstep(40.,500.,de):1.);',
    '  if(ENTRY>0.&&uRimX>.001){',
    '    vec2 q=vec2(uCam*d.x,EYE+uCam*d.y);',
    '    if(q.y<=FLOOR){float fo=uCam/uF;float sv=abs(mouthIn(q));',
    '      o+=vec2(line(sv,1.,fo),exp(-sv/(5.+fo))*.8+exp(-sv/50.)*.15)*uRimX*(1.-.7*smoothstep(FLOOR-200.,FLOOR-20.,q.y));}',
    '  }',
    '  return o;',
    '}',
    'vec3 rimOn(vec3 c,vec2 rl,float ah){c=glowOn(c,rl.y*RIM_HALO+ah);float k=min(rl.x,1.);float lu=dot(c,vec3(.3,.59,.11));vec3 cc=mix(vec3(.50,.86,1.),vec3(.20,.62,.96),smoothstep(.6,.95,lu));return mix(c,cc,k*mix(.6,.9,smoothstep(.6,.95,lu)))+vec3(.62,.88,1.)*rl.x*RIM_K*.16;}',
    'vec2 glasses(vec2 d,float mir,float soft,out vec4 L,out vec2 F,out vec4 Z,out vec4 S){',
    '  float best=1e9;Z=vec4(0.);S=vec4(0.);L=vec4(0.);F=vec2(1.);',
    // Paredes de vidro: as telas da parede saem (a própria parede é feita de lâminas).
    '  if(uWallG>.5)return vec2(0.);',
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
    // Além do fim das paredes: abertura direta (sem parede do fundo nem porta).
    '    t=uCam+REVEAL;surf=7.;',
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
    '    vec3 haze=mix(vec3(1.),HALO,uLight*(1.-smoothstep(.2,1.,r))*.6);',
    // Brilho da borda da boca do túnel espalhado sobre a paisagem.
    '    vec2 rl=rims(d);float ah=arcHalo(q);',
    // Halo do arco: sobre a névoa branca, puxa para o ciano; sobre a paisagem, soma luz.
    // Sobre a névoa branca, a luz puxa para o ciano; sobre a paisagem, soma.
    '    vec3 hz=a>.001?rimOn(haze,rl,ah):haze;',
    '    vec3 gw=(RIM_S*(rl.y*RIM_OPEN+ah*.45)+vec3(.85,.97,1.)*rl.x*RIM_K*.3)*(1.-a);',
    '    gl_FragColor=vec4(hz*a+gw,a)*uAlpha;return;',
    '  }',
    // Ainda totalmente exposto (branco): só o halo da primeira luz, sem calcular luz e material.
    '  if(uMat<.001){',
    '    float h0=exp(-pow(length(vec2(P.x,P.y-ARC_CY))/ARC_R-1.,2.)*3.)*step(abs(P.z),1.);',
    '    vec3 w0=mix(vec3(1.),HALO,uLight*h0*.45);',
    '    vec2 q0=vec2(uCam*d.x,EYE+uCam*d.y);',
    '    w0=rimOn(w0,rims(d),uArcG>.001?arcHalo(q0):0.);',
    '    gl_FragColor=vec4(w0,1.)*uAlpha;return;',
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
    // Teste "vidro": no lugar da textura de microcimento, vidro polido sobre o azul.
    '  vec3 Nn=N;float rough=.3,cav=1.;',
    // Vidro polido contínuo em todas as superfícies, sem placas nem frestas (menos
    // quadriculado; as únicas linhas no sentido do túnel são uma por lado no piso e na abóbada).
    '  if(surf==0.)rough=.14;else if(surf<=3.)rough=.16;',
    // Metal acetinado nas paredes e na abóbada: rugosidade que varia naturalmente, normais
    // levemente onduladas (a luz rasante da saída revela o volume) e pequenas variações de tom.
    // Os detalhes finos somem com a distância, para não cintilar.
    '  float met=0.;',
    '  if(uMetal>.001&&(surf==1.||surf==2.)){',
    '    met=uMetal;vec3 B=cross(N,T);float fd=1./(1.+t/1600.);',
    '    float m1=vnoise(uv/260.+3.1),m2=vnoise(uv/70.+7.3),br=vnoise(vec2(uv.x/520.,uv.y/3.2));',
    '    rough=mix(rough,MET_ROUGH+MET_VAR*(m1-.5)+(.6*MET_VAR*(m2-.5)+MET_BRUSH*(br-.5))*fd,met);',
    // Teto contínuo: na abóbada a ondulação se alonga no sentido do túnel, para o reflexo da
    // saída correr em faixas longitudinais, e não em anéis (que liam como arcos sucessivos).
    '    vec2 hu=uv/vec2(uVault>.5&&surf==2.?4200.:700.,380.);float h0=vnoise(hu),hx=vnoise(hu+vec2(.03,0.)),hy=vnoise(hu+vec2(0.,.03));',
    '    Nn=normalize(N-(T*(hx-h0)+B*(hy-h0))*MET_BEND*met);',
    '    alb*=1.+(.08*(m1-.5)+.10*(br-.5)*fd)*met;',
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
    '  vec3 wb=vec3(dot(Lavg,vec3(.2126,.7152,.0722)))/max(Lavg,vec3(1e-3))*COOL;',
    '  Ld*=wb;Lavg*=wb;',
    '  vec3 direct=alb*Ld*GAIN;',

    // Luz rebatida: o piso junto à saída como segunda área (só para quem o vê).
    '  vec3 bounce=vec3(0.);',
    '  if(surf!=0.){',
    '    float Fb=max(-rectF(P,Nn,vec3(-uW,FLOOR,0.),vec3(uW,FLOOR,0.),vec3(uW,FLOOR,520.),vec3(-uW,FLOOR,520.)),0.);',
    '    bounce=alb*lin(FLOOR_S)*Lavg*GAIN*BOUNCE*Fb;',
    '  }',
    // Luz que circula no túnel (inter-reflexão): mais forte junto à saída.
    '  float dz=max(P.z,0.)*2700./LEN;',   // saída distante: as quedas de luz acompanham o comprimento
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
    '    vec3 Fm=mix(vec3(Fs),mix(vec3(.04),alb,MET_TINT)+(1.-mix(vec3(.04),alb,MET_TINT))*pow(1.-max(dot(Vd,H),0.),5.),met);',
    '    col=col*mix(1.,MET_DIFF,met)+D*Fm*vis*nl*om*(a*a/(a2*a2))*Lavg*GAIN*SHEEN*mix(1.,MET_SHEEN,met)*cav;',
    // Reflexo difuso do entorno no metal: para baixo ele vê o piso iluminado pela saída, para
    // cima a abóbada mais escura; em direção à saída, a luz dela. Assim o tom muda com a
    // orientação da superfície (volume) e a transição entre luz e sombra é suave.
    '    if(met>0.){',
    '      float nv=max(dot(Nn,Vd),0.);vec3 R=reflect(-Vd,Nn);',
    '      vec3 F0=mix(vec3(.04),alb,MET_TINT);vec3 Fr=F0+(1.-F0)*pow(1.-nv,5.)*(1.-rough)*.6;',
    '      float dn=clamp(R.y*.5+.5,0.,1.);',
    '      vec3 env=Lavg*GAIN*AMB*(.2+1.4*dn*dn)*(.4+.6*exp(-dz/900.));',
    // Reflexo acetinado da própria saída: o raio refletido vai até o plano da boca; se cair
    // dentro dela, reflete a cor da paisagem naquela altura, borrado pela rugosidade (mais
    // borrado quanto mais longe da boca). É o que mostra o metal reagindo à luz.
    '      float sz=(zl-P.z)/min(R.z,-1e-3);vec2 hq=P.xy+R.xy*sz;float bw=10.+rough*sz*1.1;',
    '      float inw=(1.-smoothstep(-bw,bw,portalSd(hq)))*step(R.z,0.)*(28./(28.+bw*.25));',
    '      env+=bandAt(hq.y)*wb*GAIN*inw*MET_MIRROR;',
    '      col+=env*Fr*MET_ENV*met*ao;',
    '    }',
    '  }',


    // Sem frisos (teste): as faixas de luz junto ao piso e à nascente da abóbada saíram, para
    // as paredes não ficarem quadriculadas. Trecho do túnel onde os feixes existem:
    // Saída distante: a câmera expõe para o túnel enquanto está longe da saída (como uma
    // câmera real), para a estrutura manter o tom de antes; as luzes não entram nessa conta.
    /* Paredes de vidro (experimento): a cor já iluminada da parede vira o reflexo das lâminas
       da frente; por trás delas aparece a camada funda, com outra divisão (paralaxe real: o
       raio é prolongado até ela). Cada lâmina deixa ver mais ou menos o fundo (densidade, e
       mais reflexo quando vista de lado: Fresnel), reflete um pouco diferente (inclinação), tem
       o bisel aceso do lado da saída e a sombra do recuo do lado da câmera. */
    '  if(uWallG>.5&&surf==1.&&P.z>0.){',
    '    float sdw=P.x>0.?1.:-1.;vec3 base=col;',
    '    float lo=1.-smoothstep(3.,10.,fp);',
    '    vec3 c1=wgCell(P.z,WG_W,sdw*7.1+1.);',
    '    float hs=hash(vec2(c1.x,sdw*3.7));float ys=hs<.75?SPRING+60.+hash(vec2(c1.x,sdw*5.3))*(FLOOR-SPRING-170.):-1e4;',
    '    float up=P.y<ys?1.:0.;vec2 cid=vec2(c1.x,up+sdw*11.);',
    '    float den=.16+.52*hash(cid),rec=hash(cid+9.1),tl=hash(cid+3.7)-.5,eg=hash(cid+5.3);',
    '    float cv=abs(d.x)/length(vec3(d,1.));float fr=pow(1.-cv,5.);den=mix(den,1.,fr*.6);',
    '    float t2=(uW+WG_D)/abs(d.x);vec3 P2=vec3(t2*d.x,EYE+t2*d.y,uCam-t2);float fp2=t2/uF;',
    '    vec3 back=base*.34*vec3(.70,.86,1.22);',
    '    if(P2.y<FLOOR&&P2.y>SPRING-30.&&P2.z>0.){',
    '      vec3 c2=wgCell(P2.z,WG_W2,sdw*2.3+5.);float e2=min(P2.z-c2.y,c2.z-P2.z);',
    '      float h2=hash(vec2(c2.x,sdw*9.));float y2=SPRING+90.+h2*(FLOOR-SPRING-200.);',
    '      back*=(.65+.7*h2)*(.75+.5*smoothstep(FLOOR,SPRING,P2.y));',
    '      float l2=(1.-smoothstep(3.,10.,fp2))*smoothstep(SPRING-30.,SPRING+20.,P2.y);',
    '      back+=lin(BEAM)*(line(e2,.6,fp2)*.16+line(abs(P2.y-y2),.5,fp2)*.08*step(.4,h2))*l2;',
    '      back*=1.-(1.-smoothstep(0.,14.,e2))*.3;',
    '    }else back*=.7;',
    '    vec3 gc=base*(1.+.24*tl)*(1.+.16*(smoothstep(FLOOR,SPRING,P.y)-.5)*sign(tl));',
    '    col=mix(back,gc,den);',
    '    float ez0=P.z-c1.y,ez1=c1.z-P.z,eyy=abs(P.y-ys);',
    '    float ek=eg>.45?1.:.15;',
    '    col+=lin(PG_SHEEN)*((line(ez0,.5,fp)*.30+exp(-ez0/(7.+fp))*.10)*ek+line(eyy,.45,fp)*.18)*lo*Lavg*GAIN*.35;',
    '    col*=1.-(1.-smoothstep(0.,3.+rec*16.,ez1))*.38*lo;',
    '    col*=1.-(1.-smoothstep(0.,2.+rec*6.,eyy))*up*.25*lo;',
    '  }',
    '  if(ENTRY>0.)col*=pow(max(uCam/2400.,1.),1.25);',
    '  float inT=smoothstep(0.,40.,P.z)*(1.-smoothstep(LEN-40.,LEN,P.z));',
    /* Feixes de luz ciano (teste): duas linhas finas de luz ao longo do túnel, uma em cada
       extremidade do piso (junto às paredes), com um brilho suave em volta; convergem para a
       saída e reforçam a profundidade. Mais fracas perto da câmera, onde a perspectiva as
       engrossa. Acendem com uStrip. No teto não há linhas no comprimento (só os arcos). */
    // Formação gradual: força das linhas de luz já no começo (antes de acenderem de fato).
    '  float lnL=0.;float fE=uLineE*(LEN+400.);',   // as linhas varrem do fundo até a câmera
    '  float bm=0.;',
    '  float bslot=0.;',
    '  if(surf==0.){float da=uW-BEAM_EDGE-abs(P.x);',
    '    if(uGlow>.5){bm=line(da,.8,fp)+exp(-abs(da)/(4.+fp*1.1))*.16+exp(-abs(da)/(30.+fp*2.))*.03;bslot=line(abs(da)-2.6,.5,fp);}',
    '    else bm=line(da,1.2,fp)+exp(-abs(da)/(10.+fp*2.))*.22;}',
    // Luz embutida: a base da parede ao lado recebe um pouco da luz da linha do piso.
    '  if(surf==1.&&uGlow>.5)bm=exp(-(FLOOR-P.y)/16.)*.10+exp(-(FLOOR-P.y)/70.)*.025;',
    /* Estrutura contínua (celular, uStruct): no lugar dos arcos repetidos ao longo do corpo, a
       luz corre no sentido do túnel, embutida nos ombros da abóbada (uma de cada lado), como as linhas do piso: quatro guias contínuas que convergem para a saída. */
    '  if(uStruct>.5&&surf==2.){float ds=abs(abs(atan(P.x/uW,-(P.y-SPRING)/uV))-.95)*285.;',
    '    bm+=line(ds,.8,fp)+exp(-ds/(4.+fp*1.1))*.16+exp(-ds/(30.+fp*2.))*.03;bslot=max(bslot,line(ds-2.6,.5,fp));}',
    // Pulso de luz que corre pelos feixes em direção à saída (mais rápido que a câmera).
    '  float pf=fract(P.z/PULSE_GAP+uProg*PULSE_SPEED);float pulse=exp(-pf*9.)+exp(-(1.-pf)*40.)*.5;',
    '  col*=1.-bslot*LG_SLOT*inT*uStrip;',
    '  float bnear=uGlow>.5?(.25+.75*smoothstep(200.,1200.,t))*mix(1.,LG_FAR,smoothstep(900.,2400.,t)):.45+.55*smoothstep(150.,900.,t);',
    '  col+=lin(BEAM)*bm*inT*uStrip*BEAM_K*bnear*(BEAM_BASE+PULSE_K*pulse);',
    '  if(uForm>.5)lnL+=bm*inT*bnear*(1.-smoothstep(fE-400.,fE,P.z))*uLineE*.8;',
    // Lateral do vão e parede do fundo: mesmo tom quente das paredes do túnel e o mesmo
    // brilho suave junto ao piso (sem o friso), para não lerem como pilastra solta.
    '  if(surf==3.||surf==5.){',
    '    col*=mix(vec3(1.),vec3(.98,1.04,1.12),uMat);',
    '    col+=lin(STRIP)*exp(-(FLOOR-P.y)/55.)*.34*uStrip*STRIP_K;',
    '  }',

    // Tecnologia na arquitetura: uma única linha fina de cada lado do piso, no sentido do
    // túnel, alinhada às ombreiras do vão (na abóbada, a linha de cada lado é o feixe de luz).
    // Gravada na superfície (por isso entra antes do reflexo do piso).
    '  if(uTech>.001&&P.z>0.&&surf==0.){',
    '    float ln=line(abs(P.x)-JAMB_X,.8,fp);',
    // Mais fraca perto da câmera, onde a perspectiva a engrossa.
    '    float nearK=.45+.55*smoothstep(200.,1000.,t);',
    '    col=mix(col,lin(TECH_LINE),min(ln*.20,1.)*K_LINES*nearK*uTech*techReveal(P.z));',
    '  }',
    // Telas: sombra das soltas na parede e a luz delas na parede e no piso.
    '  if(uTech>.001&&surf<=1.&&P.z>0.&&uWallG<.5){',
    '    vec2 wl=wallLight(P.x>0.,P);',
    '    col*=1.-.42*wl.x*uTech*surf;',
    '    col+=lin(TECH_GLOW)*wl.y*.30*K_GLOW*uTech*(1.-.65*uPanel);',
    '    col*=1.-.14*wl.y*uPanel*uTech;',
    '  }',
    // Telas no teto (a face da tela é desenhada junto com as das paredes, mais adiante).
    '  vec4 cq=vec4(0.),ce=vec4(0.),cs=vec4(0.);',
    /* Teto contínuo (celular, uVault): as telas do teto saem e a abóbada vira uma superfície
       única, dividida só por juntas longitudinais finas (no sentido do túnel, da câmera até a
       saída), no mesmo acabamento das divisões estruturais: junta escura e bisel que pega luz.
       As linhas de luz dos ombros correm dentro de uma dessas juntas. Somem ao longe. */
    '  if(uVault>.5&&surf==2.){',
    '    float sa=atan(P.x/uW,-(P.y-SPRING)/uV)*285.;float sq=sa/VAULT_SEAM;',
    '    float dsm=abs(fract(sq+.5)-.5)*VAULT_SEAM;float sg=fract(sq+.5)<.5?-1.:1.;',
    '    float lo=(1.-smoothstep(3.,9.,fp))*smoothstep(0.,60.,P.z);',
    '    col*=1.-line(dsm,.55,fp)*CE_SEAM*lo;',
    '    col+=col*line(dsm-1.5,.45,fp)*step(0.,sg*sa)*CE_BEVEL*2.*lo;',
    '  }else',
    '  if(uTech>.001&&surf==2.&&P.z>0.)ceilingPanels(col,P,vec3(d,-1.),t,cq,ce,cs);',
    // Luz discreta nas bordas: contorna o vão e o encontro da abóbada com a parede do fundo.
    '  if(uTech>.001&&surf==3.){',
    '    float sdv=portalSd(P.xy);',
    '    float de=min(uW-abs(P.x),FLOOR-P.y);',
    '    if(P.y<SPRING)de=min(de,(1.-length(vec2(P.x/uW,(P.y-SPRING)/uV)))*min(uW,uV));',
    '    float rim=line(sdv-44.,.8,fp)*.55+exp(-abs(sdv-44.)/10.)*.14+exp(-max(de,0.)/12.)*.20;',
    '    col+=lin(TECH_LIGHT)*rim*K_RIM*uTech*techReveal(0.);',
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
    // Paredes de vidro (uWallG): reflexo mais natural, com contorno que se desfaz cada vez mais
    // longe da saída e força que cai aos poucos em direção à câmera (sem fim marcado).
    '    float blur=mix(8.+dz*.08,14.+dz*.24,uWallG);',
    '    float m=1.-smoothstep(-blur,blur,max(-mouthIn(qr),qr.y-FLOOR));',
    '    m*=mix(1.,.85-.6*smoothstep(0.,1500.,dz),uWallG);',
    // Reflexo alongado na vertical (como na água e na pedra polida): 5 amostras. O relevo
    // do piso o ondula levemente (pedra polida, não espelho).
    '    vec2 sr=toScreen(qr)+vec2(Nn.x,Nn.z)*RIPPLE;float sy=mix(4.+dz*.035,6.+dz*.07,uWallG);',
    '    vec3 rc=photo(sr)*.28+(photo(sr+vec2(0.,sy))+photo(sr-vec2(0.,sy)))*.22+(photo(sr+vec2(0.,2.*sy))+photo(sr-vec2(0.,2.*sy)))*.14;',
    '    rc*=GAIN*REFL;',
    '    col=mix(col,mix(col,rc,m),fr*.85*uCol);',   // fora do vão: o próprio túnel refletido
    '    frT=fr;',
    // Junto ao vão, o piso se dissolve na água (sem linha fechando a base do arco).
    '    float xe=uW+20.;',
    '    if(abs(P.x)<xe+20.){',
    '      float edge=smoothstep(-REVEAL,70.,P.z);',
    '      alpha=1.-(1.-edge)*uCol*(1.-smoothstep(xe-30.,xe+20.,abs(P.x)));',
    '    }',
    '  }',

    /* Camadas de luz (teste): linhas finas com o perfil do túnel, em planos ao longo dele, que
       a câmera atravessa. Cada uma se comporta como um tubo de luz real: núcleo fino quase
       branco, halo ciano que cai rápido (com uma cauda larga e fraca) e luz ciano lançada na
       superfície junto a ela (parede, abóbada e piso); refletida no piso polido. Nascem do vão
       em direção à câmera (como a tecnologia, uBuild) e acendem com os frisos (uStrip). Entram
       antes das telas, que ficam à frente delas. */
    '  if(uStrip>.001||uForm>.5&&uLineE>.001){',
    '    float nr=floor((uCam-RIB_Z0)/RIB_S);float rc=0.,rh=0.,rs=0.,lnE=0.;float fr0=uBuild*(LEN+320.);',
    '    for(int k=0;k<RIB_N;k++){',
    '      float zr=RIB_Z0+(nr-float(k))*RIB_S;if(zr<RIB_Z0-1.)break;',
    // Estrutura contínua: só as camadas junto à saída ficam (a última mais forte), emoldurando
    // o destino; no corpo do túnel não há arcos repetidos.
    '      float sm=uStruct>.5?1.-smoothstep(uVault>.5?200.:250.,uVault>.5?420.:650.,zr):1.;if(sm<.001)continue;',
    '      float on=(1.-smoothstep(fr0-260.,fr0,zr))*sm;',
    // Luz lançada na abóbada junto à linha (cai com a distância ao plano dela).
    '      if(surf==2.&&P.z>0.)rh+=mix(exp(-abs(P.z-zr)/38.)*RIB_SPILL,exp(-abs(P.z-zr)/16.)*LG_SPILL+exp(-abs(P.z-zr)/70.)*.03,uGlow)*on;',
    '      float tl=uCam-zr;float y=EYE+tl*d.y;float wk=on;',
    '      if(tl>=t)continue;',
    '      float x=tl*d.x;float fl=tl/uF;',
    '      float sr=y>SPRING?uW-abs(x):(1.-length(vec2(x/uW,(y-SPRING)/uV)))*min(uW,uV);',
    // Só os arcos, na parte de cima: a linha termina onde a abóbada nasce (sem descer as paredes).
    '      wk*=smoothstep(30.,240.,tl)*(1.-smoothstep(SPRING-40.,SPRING+4.,y));',
    '      float dl=abs(sr-RIB_W);',
    '      if(uForm>.5)lnE+=(line(dl,.6,fl)+exp(-dl/(4.+fl))*.25)*smoothstep(30.,240.,tl)*(1.-smoothstep(SPRING-40.,SPRING+4.,y))*(1.-smoothstep(fE-400.,fE,zr))*sm;',
    '      if(uGlow>.5){',
    '        float jn=1.+LG_JOIN*smoothstep(SPRING-170.,SPRING-40.,y);',
    '        float dp=mix(1.,LG_FAR,smoothstep(500.,2200.,tl))*(.7+.3*smoothstep(120.,520.,tl));',
    '        rs=max(rs,line(dl-1.9,.5,fl)*wk*step(tl,t));',
    '        rc+=line(dl,LG_HW,fl)*wk*jn*dp;',
    '        rh+=(exp(-dl/(3.5+fl*1.2))*LG_HALO+exp(-dl/(26.+fl*3.))*LG_TAIL)*wk*jn*dp;',
    '      }else{',
    '      rc+=line(dl,RIB_HW,fl)*wk;',
    '      rh+=exp(-dl/(10.+fl*2.))*RIB_HALO*wk;',
    '      }',
    '    }',
    '    col*=1.-rs*LG_SLOT*uStrip;',
    '    col+=lin(BEAM)*(rc*RIB_K+rh)*uStrip;',
    '    if(uForm>.5)lnL+=lnE*uLineE;',
    '  }',

    // Telas à frente da superfície; no piso, o reflexo delicado delas.
    '  if(uTech>.001){',
    '    vec4 L,Z,S,Lm,Zm,Sm;vec2 F,Fm;',
    '    vec2 g=glasses(d,0.,0.,L,F,Z,S)*vec2(1.-.85*uPanel,1.-.8*uPanel);',
    // O reflexo perde nitidez e força à medida que o piso se aproxima da câmera.
    '    if(surf==0.){',
    '      vec2 gr=glasses(d,1.,16.+dz*.05,Lm,Fm,Zm,Sm)*(.10+frT*1.4)*exp(-max(t-500.,0.)/700.);',
    // A cor da tela acesa aparece no reflexo.
    '      gr*=K_REFL;',
    '      if(Sm.y>.01)col+=lin(SCREEN_LUM)*(min(gr.x*2.2,1.)*SCREEN_HALO+gr.y*SCREEN_EDGE*.5)*uTech;',
    '      g=max(g,gr);',
    '    }',
    '    if(g.x+g.y>0.){',
    '      col=mix(col,lin(TECH_GLASS),g.x*SCREEN_VEIL*.4*K_VEIL*uTech);',
    '      col+=lin(SCREEN_LUM)*g.y*SCREEN_EDGE*.6*K_EDGE*uTech;',
    '    }',
    // Uma face por pixel: a tela da parede, se houver (fica à frente da abóbada); senão a do
    // teto. Assim o desenho da face existe uma vez só no shader.
    '    if(S.y>.01){wallFace(col,d,Z,S,L,F,cq,ce);cs=S;}',
    '    if(cs.y>.01){',
    '      vec2 xd=S.y>.01?vec2(d.x>0.?-1.:1.,0.):vec2(0.,1.);',
    '      float cv=S.y>.01?abs(d.x)/length(vec3(d,1.)):ce.z/max(ce.w,1e-4);',
    '      screenFace(col,cq.xy,cq.zw,ce.xy,ce.zw,cs,S.y>.01?1.:K_CEIL,xd,cv,S.y>.01?0.:1.);',
    '    }',
    // Borda da tela da parede do lado da saída, acesa pela luz.
    '    if(S.y>.01)col+=lin(TECH_LIGHT)*line(L.x-Z.x,1.,F.x)*smoothstep(-F.y,0.,L.w)*.35*K_EDGE*S.y*uTech*(1.-.6*uPanel);',
    '  }',

    // Câmera: curva neutra, saída em sRGB e grão fino (como a foto).
    '  col=enc(neutral(col));',
    '  col+=(hash(gl_FragCoord.xy)-.5)*.02;',
    // Primeira luz: halo quente ao redor do arco, antes de a matéria aparecer.
    '  float halo=exp(-pow(length(vec2(P.x,P.y-ARC_CY))/ARC_R-1.,2.)*3.)*step(abs(P.z),1.);',
    // Exposição: tudo começa branco e ganha tom e contraste progressivamente.
    '  vec3 white=mix(vec3(1.),HALO,uLight*halo*.45);',
    /* Formação gradual (celular): em vez de o túnel inteiro sair do branco de uma vez, cada
       parte se revela no seu tempo: primeiro o fundo, junto à saída, avançando em direção à
       câmera (profundidade crescente); abóbada antes das paredes, e o piso (com o reflexo) por
       último. Antes das superfícies, as linhas de luz já desenham a perspectiva sobre o branco,
       quase imperceptíveis. Ao fim de uMat, tudo chega ao mesmo estado de antes. */
    '  float mL=uMat;',
    '  if(uForm>.5){',
    '    float u=clamp(t/max(uCam,1.),0.,1.);',
    // Atraso: profundidade (o fundo primeiro) e superfície, contínuo nas quinas (a parede
    // atrasa descendo da abóbada até o piso; o piso, das bordas para o centro).
    '    float dl=(1.-u)*(1.-u)*.42;',
    '    if(surf==1.)dl+=.06*smoothstep(SPRING,FLOOR,P.y);',
    '    if(surf==0.)dl+=.06+.10*smoothstep(0.,uW*.8,uW-abs(P.x));',
    '    mL=smoothstep(0.,1.,clamp(uMat*1.9-dl,0.,1.));',
    '  }',
    '  col=mix(white,col,mL);',
    '  if(uForm>.5&&lnL>0.)col=mix(col,vec3(.60,.85,1.),min(lnL,1.)*(1.-mL)*.6);',
    // Borda da boca e halo do arco, já como luz na imagem final (visíveis desde o branco).
    '  {vec2 q0=vec2(uCam*d.x,EYE+uCam*d.y);col=rimOn(col,rims(d),uArcG>.001?arcHalo(q0):0.);}',
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
    PANEL_DEPTH = geometry.entry ? (geometry.length - 300) / 2400 : 1;
    try {
      var options = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
      gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      if (!gl) return null;
      var high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!high || high.precision < 16) return null;
      if (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < 128) PANEL_SLOTS = 8;
      var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

      program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource(geometry, coarse)));
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
      'uArcR', 'uArcG', 'uRim', 'uRimDown', 'uRimW', 'uMetal', 'uPanel', 'uGlow', 'uCeil', 'uRimX', 'uForm', 'uLineE', 'uStruct', 'uVault', 'uWallG',
      'uPhoto', 'uDat', 'uNor', 'uPh', 'uPhOk', 'uTexOk', 'uBand', 'uPB', 'uPS', 'uCB', 'uCS'];
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
    // Teste "painéis de vidro": a textura de microcimento não é usada (nem baixada).
    // loadTexture(TEXTURES.data, 1, dataTex);
    // loadTexture(TEXTURES.normal, 2, normalTex);

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
    var ceilBox = new Float32Array(4 * PANEL_SLOTS), ceilState = new Float32Array(4 * PANEL_SLOTS);
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
      gl.uniform1f(u.uArcR, s.arcR || 256.75);
      gl.uniform1f(u.uArcG, s.arcGlow || 0);
      gl.uniform1f(u.uRim, s.rim || 0);
      gl.uniform1f(u.uRimDown, s.rimDown || 0);
      gl.uniform1f(u.uRimW, s.rimWide || 0);
      gl.uniform1f(u.uMetal, s.metal || 0);
      gl.uniform1f(u.uPanel, s.panel || 0);
      gl.uniform1f(u.uGlow, s.glow || 0);
      gl.uniform1f(u.uCeil, s.ceil || 0);
      gl.uniform1f(u.uRimX, s.rimExit || 0);
      gl.uniform1f(u.uForm, s.form || 0);
      gl.uniform1f(u.uLineE, s.lineEarly || 0);
      gl.uniform1f(u.uStruct, s.struct || 0);
      gl.uniform1f(u.uVault, s.vault || 0);
      gl.uniform1f(u.uWallG, s.wallGlass || 0);
      panelUniforms(s.p, panelBox, panelState, ceilBox, ceilState);
      gl.uniform4fv(u.uCB, ceilBox);
      gl.uniform4fv(u.uCS, ceilState);
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
