/* ==========================================================================
   WEMAI — Abertura: do símbolo ao horizonte

   Sequência (storyboard): logo → primeira luz → paisagem surgindo → espaço
   nascendo → profundidade → travessia → saída → Home, num único movimento.

   Modelo
   Uma câmera avança num trilho, no eixo central, sem rotação nem desvio, por
   dentro de um túnel real (js/intro-tunnel.js, WebGL): piso, paredes, abóbada e,
   ao fundo, a parede com o vão.
   O arco da logo (SVG oficial, sem alterações) fica sobre a borda superior
   desse vão, projetado pela mesma câmera — por isso os dois nunca se separam.
   O vão desce das pontas do arco até o piso, sem nunca unir as pontas.

   Luz
   Tudo começa branco (as superfícies existem, mas estão totalmente expostas).
   Com a aproximação, a exposição baixa de forma contínua: a geometria ganha
   tom, contraste, juntas e frisos discretos. A paisagem aparece primeiro no
   vão do arco, depois abaixo dele, e ilumina o túnel a partir do fundo.

   Linha do tempo (ms) — cerca de 7 s
     0    – 1300  Identidade: a logo completa surge sobre branco.
     1300 – 7000  Câmera: aproximação → entrada → travessia → chegada.
     1600 – 2900  Primeira luz no arco; 1700 – 2900 o texto se dissolve.
     ~1800 –      Junto com a aproximação: a paisagem surge no vão e as paredes do
                  túnel começam a se formar ao redor.
     ~3600 – 5300 O arco assume o tom da pedra e se funde ao portal (fica o contorno).
     6200         A interface da Home começa a surgir.

   Sem WebGL (ou se o contexto gráfico for perdido), a abertura dá lugar à Home
   com um esmaecimento curto. Depois da abertura, o primeiro scroll avança a
   câmera mais um pouco (transform na GPU), sem prender a rolagem.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var hero = document.querySelector('[data-hero]');
  var layer = document.querySelector('[data-portal-layer]');
  var landscape = document.querySelector('[data-landscape]');
  var landscapeNear = document.querySelector('[data-landscape-near]');
  var skipButton = document.querySelector('[data-intro-skip]');
  if (!hero || !layer || !landscape || !landscapeNear) return;

  var canvas = layer.querySelector('[data-tunnel]');
  var markPlane = layer.querySelector('[data-plane="mark"]');
  var mark = layer.querySelector('[data-mark]');
  var wordmark = layer.querySelector('[data-wordmark]');
  var face = layer.querySelector('[data-face]');
  var arc = layer.querySelector('[data-arc]');
  var tipsFade = layer.querySelector('[data-tips-fade]');
  var faceStops = layer.querySelectorAll('[data-face-stop]');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var playing = root.classList.contains('intro-pending');

  /* --- Geometria do arco original -----------------------------------------
     M671 494.63 A261.5 261.5 0 1 1 1102 494.63 A252 252 0 1 0 671 494.63 Z
     Círculo externo: centro (886.5, 346.5), raio 261.5. Círculo interno:
     centro (886.5, 364), raio 252. As pontas ficam em x = 886.5 ± 215.5. */
  var ARC_X = 886.5;
  var ARC_TOP = 85;
  var OUTER_R = 261.5;
  var LOGO_WIDTH = 1445 - 327.58;          // largura desenhada da logo
  var LOGO_CENTER_Y = (85 + 821) / 2;

  /* --- Arquitetura (unidades da logo) ---------------------------------------
     O vão da parede do fundo segue a borda interna do arco e, da sua largura
     máxima, desce em ombreiras verticais até o piso: a mesma largura do arco em
     toda a altura. O túnel repete esse perfil, um pouco maior (abóbada
     concêntrica ao arco) e se estende por trás da câmera: desde que a estrutura se
     forma, ela já está dentro do túnel. A câmera fica na altura do centro do vão,
     então a saída permanece centralizada na tela durante a aproximação. */
  var GEOMETRY = {
    eye: 442,            // altura da câmera (o ponto de fuga): centro do vão
    floor: 800,
    spring: 346.5,       // onde a abóbada nasce das paredes (centro do arco)
    length: 2700,        // além da câmera: ela já começa dentro do túnel (sem fachada à vista)
    reveal: 22,          // espessura do vão
    arcCenterY: 346.5,
    outerR: OUTER_R,
    innerCenterY: 364,
    innerR: 252,
    jambX: 252,          // ombreiras: largura máxima do círculo interno do arco
    jambY: 364
  };
  var HALF_WIDTH = 285;   // meia-largura do túnel no mobile (o arco tem 261.5)

  /* --- Câmera ---------------------------------------------------------------
     Distância da câmera à parede do fundo: do enquadramento da identidade até o
     vão ocupar a tela. O avanço é contínuo, com início e chegada suaves. */
  var CAMERA_START = 2400;
  var CAMERA_END = 485;    // no mobile; em telas largas, mais perto (ver measure)
  var MOBILE_VIEW = .75;   // largura da tela / distância focal no mobile (referência)

  var IMAGE = { w: 941, h: 1672, posX: .58, posY: .5, horizon: .65 };
  var LANDSCAPE_ZOOM = .05;   // quanto a paisagem distante cresce durante a travessia
  var NEAR_DEPTH = .14;       // quanto a água próxima está "comprimida" no início (paralaxe)
  var SCROLL_PORTAL_ZOOM = .22;
  var SCROLL_LANDSCAPE_ZOOM = .04;
  var SCROLL_NEAR_ZOOM = .07;

  var T = {
    markIn: [200, 1300],
    camera: [1300, 7000],
    wordmarkOut: [1700, 2900],
    light: [1600, 2900],     // primeira luz no arco, junto com a dissolução das letras
    ui: 6200,
    imageWaitMax: 4000
  };

  // Progresso do tempo da câmera (p) em que cada mudança acontece.
  var P = {
    // Paisagem e túnel nascem juntos, com o início da aproximação.
    arch: [.08, .4],         // a paisagem surge no vão do arco, quase imperceptível no início
    column: [.24, .55],      // e depois abaixo dele, entre as ombreiras
    matter: [.08, .58],      // as superfícies saem do branco e ganham tom e contraste
    tips: [.08, .2],         // as pontas do arco sobre o vão somem assim que as paredes começam a surgir
    // Teste "abertura direta": assim que a câmera parte, o arco (ainda na cor da logo) já se
    // transforma na borda acesa da boca do túnel: a borda nasce exatamente sobre ele e os dois
    // crescem juntos até a boca, enquanto o arco se dissolve nela. O arco não vira um elemento
    // aceso antes; a mudança de cor é a própria passagem para a borda, que depois desce até o piso.
    rim: [.01, .12],         // a borda acende sobre o arco
    arcMerge: [.01, .12],    // enquanto o arco se dissolve nela
    // O arco é a margem da boca do túnel: cresce até ela logo no início, enquanto as paredes
    // surgem do branco. Sem porta.
    arcGrow: [0, .12],
    rimDown: [.08, .16],     // e desce pelas laterais até o piso, depois que as pontas sumiram
    rimThin: [.1, .22],      // a borda nasce com a espessura do arco e afina até o fio de luz
    joints: [.24, .6],
    strips: [.32, .66],
    // Tecnologia: quase invisível no início, surge com a formação do túnel, é mais
    // perceptível na travessia e enfraquece antes da saída (na Home, o canvas já não existe).
    techIn: [.16, .54],
    techOut: [.7, .9],
    techBuild: [.16, .6],    // ela nasce no vão e avança em direção à câmera
    fade: [.9, 1]           // o que restar da arquitetura nas bordas se dissolve na chegada
  };

  /* Celular (pointer: coarse): o wordmark e a assinatura se dissolvem acompanhando o
     crescimento do arco (o avanço da câmera, travel), e não um relógio próprio. Começam
     a sumir com a aproximação e se apagam até travel = WORDMARK_TRAVEL (p ≈ .19), quando
     as superfícies ainda mal surgem: as letras não ficam sobre as paredes. A curva termina
     suave e, como o avanço também parte devagar, não há início nem fim bruscos (no máximo
     ~1,1 de opacidade por segundo, menos que no desktop). As pontas do arco sobre o vão
     somem um pouco mais devagar, para o arco não mudar de forma de repente. */
  /* Experimento reversível "paredes de vidro": abra vidro.html (ou index.html?paredes=vidro).
     O parâmetro também liga a versão celular do túnel em qualquer aparelho, para a variante
     poder ser vista no PC sem o modo celular do navegador; sem ele, nada muda. */
  var WALL_GLASS = /[?&]paredes=vidro(&|$)/.test(location.search);
  var COARSE = WALL_GLASS || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var WORDMARK_TRAVEL = .12;
  // As pontas (abaixo do centro) somem devagar enquanto a forma da boca aparece; as laterais
  // acesas só descem depois que elas se foram, então uma não se sobrepõe à outra (ver rimDown).
  if (COARSE) P.tips = [0, .035];
  /* Experimento vidro: transição contínua do arco para o túnel. As pontas não são cortadas:
     somem devagar enquanto a borda desce até o piso (encontro com a forma do túnel); o arco
     muda de cor direto do azul da marca para o azul da borda do túnel (sem clarear antes) e só
     depois se funde na borda; o túnel sai do branco ao mesmo tempo, em ritmo constante. */
  if (WALL_GLASS) {
    P.tips = [.03, .19];
    P.rim = [.04, .16];
    P.arcMerge = [.1, .22];
    P.rimDown = [.06, .2];
    P.matter = [.02, .5];
  }
  var P_ARC_TONE = [0, .15];   // experimento vidro: cor do arco, do azul da marca ao da borda

  /* Saída distante (celular, referência tuneltech, frames 04–06). O arco da logo deixa de ser a
     própria saída: ele forma a entrada do túnel (plano z = ENTRY), perto da câmera, e a saída
     (z = 0) fica ENTRY mais longe. Assim, no meio da travessia, a estrutura ocupa o quadro e as
     linhas convergem para uma saída ainda pequena; ela só cresce no fim, até a paisagem
     preencher a tela. O começo (logo, letras, arco virando borda) e a chegada são os mesmos:
     a distância até a entrada segue a câmera de antes e a distância extra se fecha devagar
     (ver cameraDistance). No desktop, ENTRY = 0: tudo como antes. */
  var ENTRY = COARSE ? 4200 : 0;
  GEOMETRY.entry = ENTRY;
  GEOMETRY.length += ENTRY;
  var P_RIM_EXIT = [.18, .42];   // o fio de luz da saída acende com a formação do túnel

  /* Cor do arco: do azul-marinho da marca (com a luz azulada na borda interna) ao tom
     da pedra do túnel, iluminada pela paisagem — como a borda do vão nos frames 6 e 7.
     Ordem: preenchimento do arco; stops de #portal-face (borda interna → externa). */
  var ARC_NAVY = { fill: '#0B1F33', face: ['#7FA2C4', '#3D6389', '#0B1F33'] };
  // Teste "abertura direta": o arco vira luz ciano, a mesma da borda da boca do túnel, em que
  // se transforma (antes, azul do túnel: #5B86C2; antes ainda, pedra clara: #D6C9B7).
  var ARC_STONE = { fill: '#9EE3FF', face: ['#F7FDFF', '#C6F0FF', '#82D8FF'] };
  // Experimento vidro: o azul da borda acesa do túnel, sem passar pelo ciano claro.
  if (WALL_GLASS) ARC_STONE = { fill: '#3A92E6', face: ['#8CCBFF', '#4F9EE8', '#2C74C2'] };
  // Centro do arco (= centro da abóbada) e raio médio da faixa do arco, para o crescimento.
  var ARC_CY = 346.5, ARC_MID_R = (OUTER_R + 252) / 2;

  var view = {};
  var frameId = 0;
  var finished = !playing;
  var tunnel = null;

  /* --- Curvas -------------------------------------------------------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function phase(t, range) { return clamp01((t - range[0]) / (range[1] - range[0])); }
  function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
  function smooth(t, range) { return easeInOutSine(phase(t, range)); }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function mixHex(a, b, m) {
    var x = hexToRgb(a);
    var y = hexToRgb(b);
    return 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * m) + ',' +
      Math.round(x[1] + (y[1] - x[1]) * m) + ',' + Math.round(x[2] + (y[2] - x[2]) * m) + ')';
  }

  function cubicBezier(x1, y1, x2, y2) {
    function at(t, a, b) { return ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t; }
    function slope(t, a, b) { return 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a; }
    return function (x) {
      if (x <= 0 || x >= 1) return clamp01(x);
      var t = x;
      for (var i = 0; i < 8; i++) {
        var d = slope(t, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        t -= (at(t, x1, x2) - x) / d;
      }
      return at(clamp01(t), y1, y2);
    };
  }

  // Avanço em escala logarítmica (ritmo de aproximação constante), com partida e
  // chegada suaves: sem aceleração concentrada no final.
  var cameraEase = cubicBezier(.4, .1, .75, 1);

  // Câmera de antes: distância até o plano do arco da logo (a entrada).
  function entryDistance(p) {
    return CAMERA_START * Math.pow(view.cameraEnd / CAMERA_START, cameraEase(p));
  }
  // Distância até a saída: a da entrada mais o trecho extra, que se fecha com partida e
  // chegada suaves (acelera e desacelera sem salto), concentrado na segunda metade.
  function cameraDistance(p) {
    if (!ENTRY) return entryDistance(p);
    var s = smoothstepJs(phase(p, [.18, 1]));
    return entryDistance(p) + ENTRY * (1 - Math.pow(s, 2.5));
  }
  function smoothstepJs(u) { return u * u * (3 - 2 * u); }

  /* --- Medidas ----------------------------------------------------------- */

  function measure() {
    var w = hero.clientWidth;
    var h = hero.clientHeight;

    // Mesmo enquadramento de object-fit: cover + object-position do CSS.
    var fit = Math.max(w / IMAGE.w, h / IMAGE.h);
    var imageLeft = (w - IMAGE.w * fit) * IMAGE.posX;
    var imageTop = (h - IMAGE.h * fit) * IMAGE.posY;

    // Início: a logo centralizada. O olho da câmera (GEOMETRY.eye) aparece em vanishY.
    var startScale = Math.min(w * .62, 280) / LOGO_WIDTH;
    var vanishY = h * .47 - (LOGO_CENTER_Y - GEOMETRY.eye) * startScale;
    var focal = startScale * CAMERA_START;

    // Em telas mais largas que o celular, o túnel se alarga (menos que a tela, para a
    // parede do fundo não dominar o quadro): as paredes continuam visíveis nas laterais.
    var widthFactor = Math.sqrt(Math.max(1, (w / focal) / MOBILE_VIEW));
    var halfWidth = HALF_WIDTH * widthFactor;

    view = {
      w: w,
      h: h,
      horizonY: imageTop + IMAGE.h * fit * IMAGE.horizon,
      // Foto no enquadramento da Home (antes da matriz da câmera): fonte da luz do túnel.
      image: { x: imageLeft, y: imageTop, w: IMAGE.w * fit, h: IMAGE.h * fit },
      vanishY: vanishY,
      focal: focal,
      halfWidth: halfWidth,
      vaultRise: HALF_WIDTH + (halfWidth - HALF_WIDTH) * .35,
      startScale: startScale,
      // Chegada: o vão (ombreiras e topo do arco) já passou das bordas da tela.
      cameraEnd: Math.min(CAMERA_END, focal / Math.max(
        (w / 2) * 1.08 / GEOMETRY.jambX,
        vanishY * 1.05 / (GEOMETRY.eye - ARC_TOP)))
    };

    // A paisagem usa matrizes explícitas (ver landscapeFrame), por isso origem 0 0.
    landscape.style.transformOrigin = '0 0';
    landscapeNear.style.transformOrigin = '0 0';
    layer.style.transformOrigin = (w / 2) + 'px ' + vanishY + 'px';

    if (tunnel) tunnel.resize(w, h);
  }

  /* --- Câmera ---------------------------------------------------------------- */

  // A logo fica no plano da parede do fundo: (ARC_X, eye) sempre em (w/2, vanishY).
  function placePlane(el, scale) {
    var tx = view.w / 2 - ARC_X * scale;
    var ty = view.vanishY - GEOMETRY.eye * scale;
    el.setAttribute('transform',
      'matrix(' + scale.toFixed(5) + ' 0 0 ' + scale.toFixed(5) + ' ' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ')');
  }

  /* Enquadramento da paisagem: a Home a mostra ampliada (1 + LANDSCAPE_ZOOM) a partir
     do horizonte. Sobre esse enquadramento, o movimento da câmera aplica uma escala
     a a partir do eixo (w/2, vanishY). Composição: p → a·(1+Z)·p + deslocamento. */
  function landscapeFrame(a) {
    var b = 1 + LANDSCAPE_ZOOM;
    var cx = view.w / 2;
    return {
      scale: a * b,
      x: a * (1 - b) * cx + (1 - a) * cx,
      y: a * (1 - b) * view.horizonY + (1 - a) * view.vanishY
    };
  }

  function landscapeMatrix(a) {
    var f = landscapeFrame(a);
    return 'matrix(' + f.scale.toFixed(5) + ',0,0,' + f.scale.toFixed(5) + ',' + f.x.toFixed(2) + ',' + f.y.toFixed(2) + ')';
  }

  /* --- Quadro -------------------------------------------------------------- */

  // Câmera e cena do túnel no instante t (ms), sem tocar no DOM.
  function sceneAt(t) {
    var p = phase(t, T.camera);
    var camera = cameraDistance(p);
    // O ritmo da logo, das letras e da paisagem segue a câmera de antes.
    var travel = Math.log(CAMERA_START / entryDistance(p)) / Math.log(CAMERA_START / view.cameraEnd);
    var far = 1 - LANDSCAPE_ZOOM * (1 - travel);
    var frame = landscapeFrame(far);
    return {
      p: p,
      camera: camera,
      travel: travel,
      far: far,
      tunnel: {
        vanishY: view.vanishY,
        focal: view.focal,
        camera: camera,
        halfWidth: view.halfWidth,
        vaultRise: view.vaultRise,
        photo: {
          x: frame.scale * view.image.x + frame.x,
          y: frame.scale * view.image.y + frame.y,
          w: frame.scale * view.image.w,
          h: frame.scale * view.image.h
        },
        light: easeInOutSine(phase(t, T.light)),
        arch: smooth(p, P.arch),
        column: smooth(p, P.column),
        matter: smooth(p, P.matter),
        joints: smooth(p, P.joints),
        strips: smooth(p, P.strips),
        tech: smooth(p, P.techIn) * (1 - smooth(p, P.techOut)),
        build: smooth(p, P.techBuild),
        arcR: ARC_MID_R * arcScale(smooth(p, P.arcGrow)),
        arcGlow: 0,
        rimWide: 1 - smooth(p, P.rimThin),
        rim: smooth(p, P.rim),
        rimDown: smooth(p, P.rimDown),
        rimExit: ENTRY ? smooth(p, P_RIM_EXIT) : 0,
        form: COARSE ? 1 : 0,                         // formação gradual: só no celular
        struct: COARSE ? 1 : 0,                       // estrutura contínua: só no celular
        wallGlass: WALL_GLASS ? 1 : 0,                // experimento ?paredes=vidro
        vault: COARSE ? 1 : 0,                        // teto contínuo com juntas longitudinais: só no celular
        lineEarly: COARSE ? smooth(p, [.06, .26]) : 0,  // linhas de perspectiva antes das superfícies
        metal: COARSE ? 1 : 0,   // teste "metal azul acetinado": só no celular
        panel: COARSE ? 1 : 0,   // teste "lâminas de vidro" nos painéis: só no celular
        glow: COARSE ? 1 : 0,    // teste "luz embutida" nas linhas e feixes: só no celular
        ceil: COARSE ? 1 : 0,    // teste "teto estrutural": só no celular
        p: p,
        alpha: 1 - smooth(p, P.fade)
      }
    };
  }

  // t: tempo da abertura (ms). Retorna o progresso p da câmera.
  function render(t) {
    var scene = sceneAt(t);
    var p = scene.p;
    var camera = scene.camera;
    var travel = scene.travel;

    placePlane(markPlane, view.focal / Math.max(camera - ENTRY, 1));
    mark.style.opacity = easeInOutSine(phase(t, T.markIn));
    wordmark.style.opacity = COARSE
      ? (1 - Math.sin(phase(travel, [0, WORDMARK_TRAVEL]) * Math.PI / 2)).toFixed(4)
      : 1 - easeInOutSine(phase(t, T.wordmarkOut));
    face.style.opacity = scene.tunnel.light.toFixed(4);   // a borda interna do arco ganha luz
    setTips(smooth(p, P.tips));
    // O arco mantém a cor da logo até se dissolver na borda (experimento vidro: muda de cor antes).
    setArcTone(WALL_GLASS ? smooth(p, P_ARC_TONE) : 0);
    arc.style.opacity = (1 - smooth(p, P.arcMerge)).toFixed(4);
    setArcGrow(smooth(p, P.arcGrow));

    // A paisagem se aproxima a partir do mesmo eixo; a água próxima, mais rápido.
    var far = scene.far;
    landscape.style.transform = landscapeMatrix(far);
    landscapeNear.style.transform = landscapeMatrix(far * (1 - NEAR_DEPTH * (1 - travel)));

    if (tunnel) tunnel.render(scene.tunnel);
    return p;
  }

  // Só o trecho do arco que avança sobre o vão se dissolve; sem efeito, sem máscara
  // (a logo da identidade é exatamente o SVG original).
  function setTips(fade) {
    tipsFade.setAttribute('fill-opacity', fade.toFixed(4));
    if (fade > 0) arc.setAttribute('mask', 'url(#portal-tips)');
    else arc.removeAttribute('mask');
  }

  /* O arco cresce, a partir do próprio centro, até a faixa coincidir com a borda da boca do
     túnel (altura da abóbada: o alto do arco fica sobre o alto da boca). Só uma escala no grupo: o path da logo não muda. */
  function arcScale(g) { return 1 + (view.vaultRise / ARC_MID_R - 1) * g; }
  function setArcGrow(g) {
    if (!g) { arc.removeAttribute('transform'); return; }
    var s = arcScale(g);
    arc.setAttribute('transform', 'translate(' + ARC_X + ' ' + ARC_CY + ') scale(' + s.toFixed(5) + ') translate(' + (-ARC_X) + ' ' + (-ARC_CY) + ')');
  }

  // tone: 0 = azul da marca; 1 = luz da borda.
  function setArcTone(tone) {
    arc.style.fill = tone ? mixHex(ARC_NAVY.fill, ARC_STONE.fill, tone) : '';
    for (var i = 0; i < faceStops.length; i++) {
      faceStops[i].setAttribute('stop-color', mixHex(ARC_NAVY.face[i], ARC_STONE.face[i], tone));
    }
  }

  // Estado final (Home): a câmera já atravessou; a arquitetura saiu do quadro.
  function renderFinal() {
    placePlane(markPlane, view.focal / view.cameraEnd * 1.6);
    mark.style.opacity = 1;
    wordmark.style.opacity = 0;
    face.style.opacity = 1;
    setTips(1);
    setArcTone(1);
    setArcGrow(0);
    arc.style.opacity = 0;
    landscape.style.transform = landscapeMatrix(1);
    landscapeNear.style.transform = landscapeMatrix(1);
  }

  /* --- Primeiro scroll: a câmera avança um pouco mais ---------------------- */

  var scrollQueued = false;

  function applyScroll() {
    scrollQueued = false;
    var p = clamp01(window.scrollY / (view.h * .8));
    layer.style.transform = p ? 'scale(' + (1 + SCROLL_PORTAL_ZOOM * p).toFixed(4) + ')' : '';
    landscape.style.transform = landscapeMatrix(1 + SCROLL_LANDSCAPE_ZOOM * p);
    landscapeNear.style.transform = landscapeMatrix(1 + SCROLL_NEAR_ZOOM * p);
  }

  function onScroll() {
    if (!finished || scrollQueued || reducedMotion.matches) return;
    if (window.scrollY > view.h && layer.style.transform) return; // já fora da Home
    scrollQueued = true;
    requestAnimationFrame(applyScroll);
  }

  function onResize() {
    measure();
    if (finished) {
      renderFinal();
      applyScroll();
    } else {
      render(clock);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  /* --- Sem abertura: a Home já começa no estado final ------------------------ */

  var clock = 0;

  if (!playing) {
    measure();
    renderFinal();
    layer.classList.add('is-ready');
    if (canvas) canvas.remove();
    if (skipButton) skipButton.remove();
    applyScroll();
    return;
  }

  /* --- Abertura ------------------------------------------------------------- */

  clearTimeout(window.__wemaiIntroFailsafe);
  try { sessionStorage.setItem('wemai:intro-seen', '1'); } catch (e) {}
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  // A câmera só parte quando a paisagem estiver decodificada (com limite de espera).
  var imageReady = landscape.complete && landscape.naturalWidth > 0;
  if (!imageReady) {
    var markReady = function () { imageReady = true; };
    if (landscape.decode) landscape.decode().then(markReady, markReady);
    landscape.addEventListener('load', markReady);
    landscape.addEventListener('error', markReady);
  }

  var lastNow = 0;
  var waited = 0;
  var slowFrames = 0;
  var slowAtMinimum = 0;
  var calibrated = false;
  var CALIBRATION_TIME = 4300;   // túnel inteiro na tela (quadro 5 do storyboard)
  var revealed = false;

  function tick(now) {
    var dt = lastNow ? Math.min(now - lastNow, 64) : 0;
    lastNow = now;

    // Segura o relógio no fim da identidade até a imagem estar pronta.
    if (!imageReady && clock >= T.camera[0] && waited < T.imageWaitMax) {
      waited += dt;
    } else {
      clock += dt;
    }

    // Enquanto a logo está sozinha na tela, o túnel mede o próprio custo fora da tela (um
    // quadro de cada vez, num momento típico da travessia) e fixa a resolução antes de
    // aparecer: sem engasgos nem troca de resolução durante o movimento.
    if (tunnel && !calibrated && clock >= 300 && (tunnel.ready() || clock >= 1000)) {
      calibrated = tunnel.calibrate(sceneAt(CALIBRATION_TIME).tunnel);
      if (!tunnel) return;   // lento demais: já seguiu para a Home
    }

    // Com o túnel na tela, quadros lentos seguidos (abaixo de ~25 fps; 30 fps, como no modo
    // de economia de bateria do iPhone, é aceito) baixam um degrau de resolução. Se já está
    // na mínima e continua lento, a abertura dá lugar à Home em vez de se arrastar.
    if (tunnel && clock > T.camera[0] + 500) {
      slowFrames = dt > 40 ? slowFrames + 1 : 0;
      if (slowFrames >= 8) {
        slowFrames = 0;
        if (!tunnel.degrade() && ++slowAtMinimum >= 2) {
          skip();
          return;
        }
      }
    }

    try {
      render(clock);
    } catch (e) {
      skip();   // erro inesperado: segue para a Home, nunca fica parada
      return;
    }
    if (!revealed && clock >= T.ui) reveal();

    if (clock < T.camera[1]) frameId = requestAnimationFrame(tick);
    else finish();
  }

  function reveal() {
    revealed = true;
    root.classList.remove('intro-pending');
    if (skipButton) skipButton.remove();
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frameId);
    if (tunnel) tunnel.destroy();
    if (canvas) canvas.remove();
    measure();
    renderFinal();
    if (!revealed) reveal();
    removeIntroListeners();
    if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
    applyScroll();
  }

  /* Pular: a cena não salta; um esmaecimento curto leva ao estado final. */
  function skip() {
    if (finished) return;
    finish();
    if (reducedMotion.matches) return;
    if (layer.animate) {
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out' });
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') skip();
  }

  // Quem tenta rolar ou arrastar quer o conteúdo: a abertura dá passagem.
  function onUserScroll() {
    if (!revealed) skip();
  }

  function removeIntroListeners() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
  }

  // Túnel 3D. Se não houver WebGL, ou se o contexto for perdido, segue para a Home.
  if (canvas && window.WemaiTunnel) {
    tunnel = window.WemaiTunnel.create(canvas, GEOMETRY, function () {
      tunnel = null;
      skip();
    }, landscape);
  }
  measure();
  if (!tunnel) {
    skip();
    return;
  }

  if (skipButton) skipButton.addEventListener('click', skip);
  document.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onUserScroll, { passive: true });
  window.addEventListener('touchmove', onUserScroll, { passive: true });

  render(0);
  layer.classList.add('is-ready');
  frameId = requestAnimationFrame(tick);
})();
