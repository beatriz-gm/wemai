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
    arcTone: [.26, .5],      // o arco passa do azul da marca ao tom de pedra iluminada do túnel
    arcMerge: [.5, .7],      // e então se funde ao portal: resta só o contorno da abertura
    joints: [.24, .6],
    strips: [.32, .66],
    fade: [.9, 1]            // o que restar da arquitetura nas bordas se dissolve na chegada
  };

  /* Cor do arco: do azul-marinho da marca (com a luz azulada na borda interna) ao tom
     da pedra do túnel, iluminada pela paisagem — como a borda do vão nos frames 6 e 7.
     Ordem: preenchimento do arco; stops de #portal-face (borda interna → externa). */
  var ARC_NAVY = { fill: '#0B1F33', face: ['#7FA2C4', '#3D6389', '#0B1F33'] };
  var ARC_STONE = { fill: '#D6C9B7', face: ['#FBF3E8', '#ECE0D0', '#D6C9B7'] };

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

  function cameraDistance(p) {
    return CAMERA_START * Math.pow(view.cameraEnd / CAMERA_START, cameraEase(p));
  }

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

  // t: tempo da abertura (ms). Retorna o progresso p da câmera.
  function render(t) {
    var p = phase(t, T.camera);
    var camera = cameraDistance(p);
    var travel = Math.log(CAMERA_START / camera) / Math.log(CAMERA_START / view.cameraEnd);

    placePlane(markPlane, view.focal / camera);
    mark.style.opacity = easeInOutSine(phase(t, T.markIn));
    wordmark.style.opacity = 1 - easeInOutSine(phase(t, T.wordmarkOut));
    var light = easeInOutSine(phase(t, T.light));
    face.style.opacity = light.toFixed(4);   // a borda interna do arco ganha luz
    setTips(smooth(p, P.tips));
    setArcTone(smooth(p, P.arcTone));
    arc.style.opacity = (1 - smooth(p, P.arcMerge)).toFixed(4);

    // A paisagem se aproxima a partir do mesmo eixo; a água próxima, mais rápido.
    var far = 1 - LANDSCAPE_ZOOM * (1 - travel);
    landscape.style.transform = landscapeMatrix(far);
    landscapeNear.style.transform = landscapeMatrix(far * (1 - NEAR_DEPTH * (1 - travel)));

    if (tunnel) {
      var frame = landscapeFrame(far);
      tunnel.render({
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
        light: light,
        arch: smooth(p, P.arch),
        column: smooth(p, P.column),
        matter: smooth(p, P.matter),
        joints: smooth(p, P.joints),
        strips: smooth(p, P.strips),
        alpha: 1 - smooth(p, P.fade)
      });
    }
    return p;
  }

  // Só o trecho do arco que avança sobre o vão se dissolve; sem efeito, sem máscara
  // (a logo da identidade é exatamente o SVG original).
  function setTips(fade) {
    tipsFade.setAttribute('fill-opacity', fade.toFixed(4));
    if (fade > 0) arc.setAttribute('mask', 'url(#portal-tips)');
    else arc.removeAttribute('mask');
  }

  // tone: 0 = azul da marca; 1 = pedra do túnel.
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
