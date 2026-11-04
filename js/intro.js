/* ==========================================================================
   WEMAI — Abertura: do símbolo ao horizonte

   Conceito
   A logo inicia a transformação e o espaço inteiro ganha profundidade; o túnel
   surge como continuação disso. O arco nunca é fechado: não há máscara com a
   forma do vão, base nem piso.

   Modelo
   Uma câmera em perspectiva avança num trilho. Três elementos, todos em escala
   FOCAL / distância a partir do mesmo eixo fixo da tela:
     - entrada: a logo original (arco + wordmark + assinatura);
     - camadas: contornos abertos do próprio arco, em linhas finas de baixa
       opacidade, em várias profundidades — à frente e atrás da logo;
     - saída: um campo de profundidade em degradê. As bordas da tela são paredes
       próximas e claras, o centro se aprofunda e a saída para a paisagem se abre
       sem contorno.
   Não há rotação, inclinação, deslocamento lateral nem curvas concorrentes:
   tudo segue o mesmo progresso u.

   Ritmo
   A câmera é interpolada em escala logarítmica (zoom percebido como constante),
   com início quase imperceptível e chegada longa. Cores e sombras acompanham o
   progresso da câmera, não o relógio: o centro escurece conforme a profundidade
   se torna perceptível.

   Linha do tempo (ms) — cerca de 7,5 s até a interface assentar
     0    – 1400  Identidade: a logo surge e permanece intacta.
     2200 – 7200  Câmera: aproximação → espaço → travessia → chegada.
     0 →          Luz ambiente quase imperceptível: mais luminosa atrás do arco.
     2700 – 3900  Wordmark e assinatura se dissolvem; luz azulada e difusa no vão.
     2800 – 4300  As camadas aparecem, muito sutis, e passam a fluir para fora do quadro.
     ~2900 – 5800 O espaço ganha materialidade: paredes claras, centro mais profundo.
     3400 – 5500  A saída se abre em degradê e a paisagem se define; sua luz
                  aquece a região do interior junto à saída.
     6200         A interface da Home começa a surgir.
   Até 2700 a tela mostra apenas o SVG original sobre o fundo claro (com luz ambiente).

   Depois da abertura, o primeiro scroll avança a câmera mais um pouco usando
   apenas transform (composição na GPU), sem prender a rolagem.
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

  var frontPlane = layer.querySelector('[data-plane="front"]');
  var exitPlane = layer.querySelector('[data-plane="exit"]');
  var mark = layer.querySelector('[data-mark]');
  var wordmark = layer.querySelector('[data-wordmark]');
  var face = layer.querySelector('[data-face]');
  var spaceStops = layer.querySelectorAll('[data-space] stop');
  var floorStops = layer.querySelectorAll('[data-floor] stop');
  var haze = layer.querySelector('[data-haze]');
  var glow = layer.querySelector('[data-glow]');
  var ambientEdge = layer.querySelector('[data-ambient] stop:last-child');
  var spaceLayers = layer.querySelectorAll('[data-space-layer]');
  var ribTemplate = layer.querySelector('[data-rib-template]');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var playing = root.classList.contains('intro-pending');

  /* --- Geometria do arco original -----------------------------------------
     M671 494.63 A261.5 261.5 0 1 1 1102 494.63 A252 252 0 1 0 671 494.63 Z */
  var ARC_X = 886.5;                       // eixo de simetria
  var TIP_Y = 494.63;                      // altura das pontas
  var INNER_R = 252;
  var HALF_CHORD = (1102 - 671) / 2;
  var INNER_CENTER_Y = TIP_Y - Math.sqrt(INNER_R * INNER_R - HALF_CHORD * HALF_CHORD);
  var INNER_TOP = INNER_CENTER_Y - INNER_R;
  var LOGO_WIDTH = 1445 - 327.58;          // largura desenhada da logo
  var LOGO_CENTER_Y = (85 + 821) / 2;

  /* --- Cena ------------------------------------------------------------------ */
  var IMAGE = { w: 941, h: 1672, posX: .58, posY: .5, horizon: .65 }; // horizonte do mar na imagem
  var PASSAGE_DEPTH = 140;   // distância entre a entrada (logo) e a saída, em unidades da logo
  // Onde a câmera para: distância até a saída, em profundidades da passagem.
  // Acima de 1, ela para logo depois de a entrada sair do quadro, sem "varrê-lo".
  var CAMERA_STOP = 1.5;
  var END_TOP = .035;        // referência do enquadramento final, como fração da altura da tela
  var LANDSCAPE_ZOOM = .05;  // quanto a paisagem distante cresce durante a travessia
  var NEAR_DEPTH = .14;      // quanto a água próxima está "comprimida" no início (paralaxe)
  var SCROLL_PORTAL_ZOOM = .22;
  var SCROLL_LANDSCAPE_ZOOM = .04;
  var SCROLL_NEAR_ZOOM = .07;

  var T = {
    markIn: [200, 1400],
    camera: [2200, 7200],
    wordmarkOut: [2700, 3900],
    glow: [2600, 3800],     // luz azulada no vão, junto com a dissolução das letras
    ribs: [2800, 4300],
    exit: [3400, 5500],
    ui: 6200,
    imageWaitMax: 4000
  };

  /* Campo de profundidade (stops do gradiente #portal-space, do centro da saída
     para as bordas da tela). Começa inteiro na cor do fundo e ganha materialidade
     com a aproximação. SPACE_OPEN: quanto cada stop fica transparente quando a
     saída se abre (1 = paisagem totalmente visível). */
  var MATERIAL_RANGE = [.03, .65];
  var SPACE_LIGHT = '#FAFCFD';
  var SPACE_MATERIAL = ['#F5E4CF', '#EEDCC8', '#B3BFCC', '#33506E', '#8DA0B5', '#E2E8EE'];
  var SPACE_OPEN = [1, 1, .6, 0, 0, 0];
  var FLOOR_MATERIAL = '#DCE3EA'; // piso próximo: claro, levemente frio

  /* Luz natural da paisagem: quando a saída se abre, a região do interior mais
     próxima dela ganha um tom quente de pedra iluminada (peso por stop). */
  var SPACE_SUNLIT = ['#F5E4CF', '#F2DEC8', '#E6D2BD', '#5E6F84', '#8DA0B5', '#E2E8EE'];
  var SUN_WEIGHT = [0, .4, .55, .3, 0, 0];

  // Luz ambiente da tela inicial: as bordas sombreiam levemente quando a transformação começa.
  var AMBIENT_EDGE = ['#EEF2F6', '#E3E9EF'];

  /* Camadas: profundidades em frações da passagem a partir da saída (0 = saída,
     1 = entrada, onde está a logo — por isso não há camada em 1). Peso: as mais
     distantes são mais discretas. */
  var RIBS = [
    { depth: 1 / 3, weight: .45 },
    { depth: 2 / 3, weight: .65 },
    { depth: 4 / 3, weight: 1 },
    { depth: 5 / 3, weight: .9 },
    { depth: 2, weight: .8 },
    { depth: 7 / 3, weight: .7 },
    { depth: 8 / 3, weight: .6 }
  ];
  var RIB_OPACITY = .24;
  var RIB_ON_LIGHT = '#4E6680';  // linha sobre o fundo claro
  var RIB_ON_DEEP = '#F1E3D2';   // linha sobre o espaço já aprofundado

  var view = {};
  var frameId = 0;
  var finished = !playing;

  /* --- Curvas e cores ---------------------------------------------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function phase(t, range) { return clamp01((t - range[0]) / (range[1] - range[0])); }
  function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  // asArray: devolve [r, g, b] em vez de 'rgb(...)', para misturas encadeadas.
  function mixColor(a, b, m, asArray) {
    var c = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
    if (asArray) return c;
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  SPACE_LIGHT = hexToRgb(SPACE_LIGHT);
  SPACE_MATERIAL = SPACE_MATERIAL.map(hexToRgb);
  FLOOR_MATERIAL = hexToRgb(FLOOR_MATERIAL);
  SPACE_SUNLIT = SPACE_SUNLIT.map(hexToRgb);
  AMBIENT_EDGE = AMBIENT_EDGE.map(hexToRgb);
  RIB_ON_LIGHT = hexToRgb(RIB_ON_LIGHT);
  RIB_ON_DEEP = hexToRgb(RIB_ON_DEEP);

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

  // Início quase imperceptível, aceleração suave e chegada longa.
  var cameraEase = cubicBezier(.55, 0, .2, 1);

  /* --- Camadas ------------------------------------------------------------- */

  var ribs = RIBS.map(function (rib, i) {
    var el = i === 0 ? ribTemplate : ribTemplate.cloneNode(false);
    if (i > 0) ribTemplate.parentNode.appendChild(el);
    return { el: el, depth: rib.depth, weight: rib.weight };
  });

  /* --- Medidas ----------------------------------------------------------- */

  function measure() {
    var w = hero.clientWidth;
    var h = hero.clientHeight;

    // Mesmo enquadramento de object-fit: cover + object-position do CSS.
    var fit = Math.max(w / IMAGE.w, h / IMAGE.h);
    var imageTop = (h - IMAGE.h * fit) * IMAGE.posY;
    var horizonY = imageTop + IMAGE.h * fit * IMAGE.horizon;

    // Escala final da saída: a mesma referência de enquadramento usada pela Home.
    var bottom = h + 8;
    var top = h * END_TOP;
    var endScale = (bottom - top) / (TIP_Y - INNER_TOP);

    var startScale = Math.min(w * .62, 280) / LOGO_WIDTH;

    /* Eixo da câmera (trilho). Um único ponto fixo na tela, do início ao fim:
       tudo se expande a partir dele, sem inclinação nem deslocamento lateral.
       axisY (unidades da logo) é a altura do eixo; vanishY é onde ele aparece
       na tela. São resolvidos para que (a) a logo comece centralizada e (b) o
       enquadramento final seja o da Home:
         início: vanishY + (LOGO_CENTER_Y - axisY) · startScale = 0,47 · h
         fim:    vanishY + (INNER_TOP - axisY) · endScale = top                 */
    var startOffset = h * .47 - LOGO_CENTER_Y * startScale;
    var axisY = (top - startOffset - INNER_TOP * endScale) / (startScale - endScale);
    var vanishY = startOffset + axisY * startScale;

    var focal = endScale * CAMERA_STOP * PASSAGE_DEPTH;
    var startExit = focal / (focal / startScale + PASSAGE_DEPTH);

    view = {
      w: w,
      h: h,
      horizonY: horizonY,
      vanishY: vanishY,
      axisY: axisY,
      focal: focal,
      startExit: startExit,
      endExit: endScale
    };

    // Um único centro de expansão para tudo (portal e paisagem): o eixo da câmera.
    // A paisagem usa matrizes explícitas (ver landscapeMatrix), por isso origem 0 0.
    landscape.style.transformOrigin = '0 0';
    landscapeNear.style.transformOrigin = '0 0';
    layer.style.transformOrigin = (w / 2) + 'px ' + vanishY + 'px';
  }

  /* --- Câmera ---------------------------------------------------------------- */

  // Cada plano é uma ampliação em torno do eixo: (ARC_X, axisY) fica sempre em (w/2, vanishY).
  function placePlane(el, scale) {
    var tx = view.w / 2 - ARC_X * scale;
    var ty = view.vanishY - view.axisY * scale;
    el.setAttribute('transform',
      'matrix(' + scale.toFixed(5) + ' 0 0 ' + scale.toFixed(5) + ' ' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ')');
  }

  // Posiciona um elemento a `depth` profundidades da passagem à frente da saída.
  // Quando ele fica atrás da câmera, é ocultado.
  function placeAtDepth(el, exitDistance, depth) {
    var distance = exitDistance - depth * PASSAGE_DEPTH;
    if (distance <= view.focal / 200) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    placePlane(el, view.focal / distance);
  }

  // u = 0: logo; u = 1: chegada à Home.
  function setCamera(u) {
    var exitScale = view.startExit * Math.pow(view.endExit / view.startExit, u);
    var exitDistance = view.focal / exitScale;

    placePlane(exitPlane, exitScale);
    placeAtDepth(frontPlane, exitDistance, 1);
    for (var i = 0; i < ribs.length; i++) placeAtDepth(ribs[i].el, exitDistance, ribs[i].depth);

    // A paisagem se aproxima a partir do mesmo eixo da câmera; a água próxima,
    // mais rápido que céu e montanhas. Em u = 1 ambas coincidem com a Home.
    var far = 1 - LANDSCAPE_ZOOM * (1 - u);
    landscape.style.transform = landscapeMatrix(far);
    landscapeNear.style.transform = landscapeMatrix(far * (1 - NEAR_DEPTH * (1 - u)));
  }

  /* Enquadramento da paisagem: a Home a mostra ampliada (1 + LANDSCAPE_ZOOM) a partir
     do horizonte. Sobre esse enquadramento, o movimento da câmera aplica uma escala
     a a partir do eixo (w/2, vanishY). Composição: p → a·(1+Z)·p + deslocamento. */
  function landscapeMatrix(a) {
    var b = 1 + LANDSCAPE_ZOOM;
    var cx = view.w / 2;
    var homeX = (1 - b) * cx;
    var homeY = (1 - b) * view.horizonY;
    var x = a * homeX + (1 - a) * cx;
    var y = a * homeY + (1 - a) * view.vanishY;
    var scale = a * b;
    return 'matrix(' + scale.toFixed(5) + ',0,0,' + scale.toFixed(5) + ',' + x.toFixed(2) + ',' + y.toFixed(2) + ')';
  }

  /* --- Aparência -------------------------------------------------------------- */

  function setAppearance(t, u) {
    mark.style.opacity = easeInOutSine(phase(t, T.markIn));
    wordmark.style.opacity = 1 - easeInOutSine(phase(t, T.wordmarkOut));

    var m = easeInOutSine(phase(u, MATERIAL_RANGE));
    var open = easeInOutSine(phase(t, T.exit));
    var light = easeInOutSine(phase(t, T.glow));
    setSpace(m, open);
    setLight(light, open);
    setRibs(m, easeInOutSine(phase(t, T.ribs)));
    face.style.opacity = m;
  }

  // m: materialidade (0 = fundo claro chapado); open: abertura da saída.
  function setSpace(m, open) {
    var i;
    // Antes da transformação, só a névoa (cor do fundo) é desenhada: a tela é
    // exatamente a logo original sobre o fundo claro.
    var idle = m === 0 && open === 0;
    for (i = 0; i < spaceLayers.length; i++) spaceLayers[i].style.display = idle ? 'none' : '';
    for (i = 0; i < spaceStops.length; i++) {
      var base = mixColor(SPACE_LIGHT, SPACE_MATERIAL[i], m, true);
      spaceStops[i].setAttribute('stop-color', mixColor(base, SPACE_SUNLIT[i], open * SUN_WEIGHT[i]));
      spaceStops[i].setAttribute('stop-opacity', (1 - SPACE_OPEN[i] * open).toFixed(4));
    }
    var floor = mixColor(SPACE_LIGHT, FLOOR_MATERIAL, m);
    for (i = 0; i < floorStops.length; i++) floorStops[i].setAttribute('stop-color', floor);
    // A névoa garante a tela inicial inteira na cor do fundo e se dissipa com a abertura.
    haze.style.opacity = (1 - open).toFixed(4);
  }

  /* Evolução da luz: a luminosidade azulada surge no vão enquanto as letras se
     dissolvem e cede lugar à luz da paisagem quando a saída se abre; as bordas do
     fundo ganham uma sombra leve. */
  function setLight(light, open) {
    glow.style.opacity = (light * (1 - .75 * open)).toFixed(4);
    ambientEdge.setAttribute('stop-color', mixColor(AMBIENT_EDGE[0], AMBIENT_EDGE[1], light));
  }

  function setRibs(m, visible) {
    var color = mixColor(RIB_ON_LIGHT, RIB_ON_DEEP, m);
    for (var i = 0; i < ribs.length; i++) {
      ribs[i].el.style.stroke = color;
      ribs[i].el.style.opacity = (RIB_OPACITY * ribs[i].weight * visible).toFixed(4);
    }
  }

  function renderFinal() {
    setAppearance(Infinity, 1);
    setCamera(1);
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
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  /* --- Sem abertura: a Home já começa no estado final ------------------------ */

  measure();

  if (!playing) {
    renderFinal();
    layer.classList.add('is-ready');
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

  var clock = 0;
  var lastNow = 0;
  var waited = 0;
  var revealed = false;

  function render(t) {
    var u = cameraEase(phase(t, T.camera));
    setAppearance(t, u);
    setCamera(u);
    if (!revealed && t >= T.ui) reveal();
  }

  function tick(now) {
    var dt = lastNow ? Math.min(now - lastNow, 64) : 0;
    lastNow = now;

    // Segura o relógio no fim da identidade até a imagem estar pronta.
    if (!imageReady && clock >= T.camera[0] && waited < T.imageWaitMax) {
      waited += dt;
    } else {
      clock += dt;
    }

    render(clock);

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

  if (skipButton) skipButton.addEventListener('click', skip);
  document.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onUserScroll, { passive: true });
  window.addEventListener('touchmove', onUserScroll, { passive: true });

  render(0);
  layer.classList.add('is-ready');
  frameId = requestAnimationFrame(tick);
})();
