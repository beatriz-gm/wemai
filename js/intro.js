/* ==========================================================================
   WEMAI — Abertura: do símbolo ao horizonte

   Sequência (storyboard): logo → luz → profundidade → túnel → travessia →
   paisagem → Home, numa única transformação contínua.

   Modelo
   Uma câmera em perspectiva avança num trilho, num eixo fixo da tela. Como no
   storyboard, o arco da logo é a SAÍDA, ao fundo; entre a câmera e ele nasce um
   corredor curto. Cada elemento tem a escala da sua profundidade
   (FOCAL / distância), então os planos se movem em proporções diferentes:
     - entrada: a camada do corredor mais próxima da câmera, que atravessa o
       quadro primeiro;
     - interior: camadas intermediárias — abóbada no círculo do arco e paredes
       retas, abertas embaixo (sem piso nem base);
     - saída: a logo original, a névoa que se abre no vão e a paisagem.
   Não há rotação, inclinação, deslocamento lateral nem curvas concorrentes:
   tudo segue o mesmo progresso u.

   Luz
   Ambiente quase imperceptível na identidade. Com a dissolução das letras, a
   borda interna do arco ganha luz e uma luminosidade azulada surge no vão. Com a
   aproximação, a paisagem se define e aquece as camadas junto à saída.

   Linha do tempo (ms) — cerca de 7,5 s até a interface assentar
     0    – 1400  Identidade: a logo surge e permanece intacta.
     2200 – 7200  Câmera: aproximação → espaço → travessia → chegada.
     2700 – 3900  Wordmark e assinatura se dissolvem; o arco e o vão ganham luz.
     a partir de  As camadas do corredor surgem uma a uma, com a aproximação.
       ~2900
     ~3000 – 6200 A paisagem aparece primeiro no vão do arco, depois abaixo dele.
     6200         A interface da Home começa a surgir.
   Até 2700 a tela mostra apenas o SVG original sobre o fundo claro.

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

  var exitPlane = layer.querySelector('[data-plane="exit"]');
  var markPlane = layer.querySelector('[data-plane="mark"]');
  var mark = layer.querySelector('[data-mark]');
  var wordmark = layer.querySelector('[data-wordmark]');
  var face = layer.querySelector('[data-face]');
  var haze = layer.querySelector('[data-haze]');
  var glow = layer.querySelector('[data-glow]');
  var ambientStops = layer.querySelectorAll('[data-ambient] stop');
  var openingArch = layer.querySelectorAll('[data-opening-arch]');
  var openingColumn = layer.querySelectorAll('[data-opening-column]');
  var corridorGroup = layer.querySelector('[data-corridor]');
  var layerGradient = layer.querySelector('[data-layer-gradient]');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var playing = root.classList.contains('intro-pending');

  /* --- Geometria do arco original -----------------------------------------
     M671 494.63 A261.5 261.5 0 1 1 1102 494.63 A252 252 0 1 0 671 494.63 Z
     Círculo externo: centro (886.5, 346.5), raio 261.5. */
  var ARC_X = 886.5;
  var ARC_TOP = 85;
  var OUTER_R = 261.5;
  var LOGO_WIDTH = 1445 - 327.58;          // largura desenhada da logo
  var LOGO_CENTER_Y = (85 + 821) / 2;

  /* --- Cena ------------------------------------------------------------------ */
  var IMAGE = { w: 941, h: 1672, posX: .58, posY: .5, horizon: .65 }; // horizonte do mar na imagem
  var AXIS_Y = 300;           // altura do eixo da câmera dentro do vão (unidades da logo)
  var CORRIDOR_LENGTH = 300;  // comprimento do corredor diante do arco (unidades da logo)
  var CORRIDOR_LAYERS = 8;
  // Meia-largura da seção do corredor: um pouco maior que o arco (ver #portal-layer).
  var CORRIDOR_R = 340;
  // No instante em que a entrada do corredor cruza as laterais da tela, o arco
  // ocupa esta fração da largura da entrada (define a perspectiva da cena).
  var ENTRY_PASS_RATIO = .62;
  var LANDSCAPE_ZOOM = .05;   // quanto a paisagem distante cresce durante a travessia
  var NEAR_DEPTH = .14;       // quanto a água próxima está "comprimida" no início (paralaxe)
  var SCROLL_PORTAL_ZOOM = .22;
  var SCROLL_LANDSCAPE_ZOOM = .04;
  var SCROLL_NEAR_ZOOM = .07;

  var T = {
    markIn: [200, 1400],
    camera: [2200, 7200],
    wordmarkOut: [2700, 3900],
    light: [2600, 3800],     // luz no arco e no vão, junto com a dissolução das letras
    ui: 6200,
    imageWaitMax: 4000
  };

  // Progresso da câmera (u) em que cada efeito acontece: tudo acompanha a aproximação.
  var U = {
    archOpen: [.04, .5],     // a paisagem se define no vão do arco
    columnOpen: [.22, .7],   // e depois abaixo dele, sem base
    layers: [.03, .42],      // janela em que as camadas surgem, uma a uma
    warm: [.25, .8],         // a luz da paisagem aquece as camadas junto à saída
    hazeOut: [.8, 1]         // a névoa restante se dissipa na chegada
  };

  /* Corredor: cor e opacidade de cada camada, da saída (índice 0) para a câmera.
     Junto à saída, pedra clara que esquenta com a luz da paisagem; perto da câmera,
     sombra fria. Sobrepostas, escurecem o espaço em direção às bordas da tela. */
  var LAYER_NEAR_EXIT = '#E9E2DA';
  var LAYER_NEAR_EXIT_WARM = '#EFD8BF';
  var LAYER_NEAR_CAMERA = '#5C6F86';
  var LAYER_OPACITY = .1;
  var LAYER_EDGE_OPACITY = .14; // filete de luz na borda de cada camada (quase imperceptível)

  /* Luz ambiente / parede ao redor do arco: na identidade, quase branca; com a
     aproximação, vira pedra clara iluminada (do centro para as bordas). */
  var AMBIENT_LIGHT = ['#FCFDFE', '#F9FBFC', '#EEF2F6'];
  var AMBIENT_EDGE_SHADOW = '#E3E9EF';      // primeira sombra leve, junto com a luz no arco
  var AMBIENT_STONE = ['#F1EAE2', '#E2E2E1', '#C3CCD6'];
  var STONE_RANGE = [.06, .5];

  var view = {};
  var frameId = 0;
  var finished = !playing;

  /* --- Curvas e cores ---------------------------------------------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function phase(t, range) { return clamp01((t - range[0]) / (range[1] - range[0])); }
  function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
  function smooth(t, range) { return easeInOutSine(phase(t, range)); }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function mixColor(a, b, m) {
    return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
  }

  function rgb(c) {
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  LAYER_NEAR_EXIT = hexToRgb(LAYER_NEAR_EXIT);
  LAYER_NEAR_EXIT_WARM = hexToRgb(LAYER_NEAR_EXIT_WARM);
  LAYER_NEAR_CAMERA = hexToRgb(LAYER_NEAR_CAMERA);
  AMBIENT_LIGHT = AMBIENT_LIGHT.map(hexToRgb);
  AMBIENT_EDGE_SHADOW = hexToRgb(AMBIENT_EDGE_SHADOW);
  AMBIENT_STONE = AMBIENT_STONE.map(hexToRgb);

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

  /* --- Corredor ------------------------------------------------------------- */

  // Cada camada: um retângulo com o seu próprio degradê (clonado de #portal-layer),
  // pintadas da saída para a câmera (a mais próxima por cima).
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var corridor = [];
  for (var c = 0; c < CORRIDOR_LAYERS; c++) {
    var gradient = layerGradient.cloneNode(true);
    gradient.id = 'portal-layer-' + c;
    gradient.removeAttribute('data-layer-gradient');
    layerGradient.parentNode.appendChild(gradient);

    var el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', '-20000');
    el.setAttribute('y', '-20000');
    el.setAttribute('width', '40000');
    el.setAttribute('height', '40000');
    el.setAttribute('fill', 'url(#portal-layer-' + c + ')');
    corridorGroup.appendChild(el);

    corridor.push({
      el: el,
      stops: gradient.querySelectorAll('stop'),
      depth: CORRIDOR_LENGTH * (c + 1) / CORRIDOR_LAYERS, // distância à frente do arco
      share: c / (CORRIDOR_LAYERS - 1)                     // 0 = junto à saída, 1 = entrada
    });
  }

  /* --- Medidas ----------------------------------------------------------- */

  function measure() {
    var w = hero.clientWidth;
    var h = hero.clientHeight;

    // Mesmo enquadramento de object-fit: cover + object-position do CSS.
    var fit = Math.max(w / IMAGE.w, h / IMAGE.h);
    var imageTop = (h - IMAGE.h * fit) * IMAGE.posY;
    var horizonY = imageTop + IMAGE.h * fit * IMAGE.horizon;

    // Início: a logo centralizada. O eixo da câmera (AXIS_Y) aparece sempre em vanishY.
    var startScale = Math.min(w * .62, 280) / LOGO_WIDTH;
    var vanishY = h * .47 - (LOGO_CENTER_Y - AXIS_Y) * startScale;

    // Fim: o arco (saída) já passou de todas as bordas; resta a paisagem da Home.
    var endScale = 1.25 * Math.max((vanishY + 10) / (AXIS_Y - ARC_TOP), (w / 2 + 10) / OUTER_R);

    // Perspectiva: quando a entrada do corredor cruza as laterais da tela, o arco
    // tem ENTRY_PASS_RATIO da largura dela. Daí resulta a distância focal.
    var entryPassScale = (w / 2) / CORRIDOR_R;
    var focal = CORRIDOR_LENGTH * ENTRY_PASS_RATIO * entryPassScale / (1 - ENTRY_PASS_RATIO);

    view = {
      w: w,
      h: h,
      horizonY: horizonY,
      vanishY: vanishY,
      focal: focal,
      startScale: startScale,
      endScale: endScale
    };

    // Um único centro de expansão para tudo (portal e paisagem): o eixo da câmera.
    // A paisagem usa matrizes explícitas (ver landscapeMatrix), por isso origem 0 0.
    landscape.style.transformOrigin = '0 0';
    landscapeNear.style.transformOrigin = '0 0';
    layer.style.transformOrigin = (w / 2) + 'px ' + vanishY + 'px';
  }

  /* --- Câmera ---------------------------------------------------------------- */

  // Cada plano é uma ampliação em torno do eixo: (ARC_X, AXIS_Y) fica sempre em (w/2, vanishY).
  function placePlane(el, scale) {
    var tx = view.w / 2 - ARC_X * scale;
    var ty = view.vanishY - AXIS_Y * scale;
    el.setAttribute('transform',
      'matrix(' + scale.toFixed(5) + ' 0 0 ' + scale.toFixed(5) + ' ' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ')');
  }

  // u = 0: logo; u = 1: chegada à Home.
  function setCamera(u) {
    var exitScale = view.startScale * Math.pow(view.endScale / view.startScale, u);
    var exitDistance = view.focal / exitScale;

    placePlane(exitPlane, exitScale);
    placePlane(markPlane, exitScale);

    // Cada camada do corredor está mais perto da câmera que o arco: cresce mais rápido.
    for (var i = 0; i < corridor.length; i++) {
      var distance = exitDistance - corridor[i].depth;
      if (distance <= view.focal / 200) {
        corridor[i].el.style.display = 'none'; // já ficou atrás da câmera
      } else {
        corridor[i].el.style.display = '';
        placePlane(corridor[i].el, view.focal / distance);
      }
    }

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

  /* --- Luz, abertura e corredor ------------------------------------------- */

  function setAppearance(t, u) {
    mark.style.opacity = easeInOutSine(phase(t, T.markIn));
    wordmark.style.opacity = 1 - easeInOutSine(phase(t, T.wordmarkOut));

    var light = easeInOutSine(phase(t, T.light));
    var archOpen = smooth(u, U.archOpen);
    var columnOpen = smooth(u, U.columnOpen);

    // A borda interna do arco ganha luz; a geometria não muda.
    face.style.opacity = light.toFixed(4);
    // Luz azulada no vão: cede lugar à paisagem conforme ela se define.
    glow.style.opacity = (light * (1 - archOpen)).toFixed(4);
    setAmbient(light, smooth(u, STONE_RANGE));

    setOpening(archOpen, columnOpen, smooth(u, U.hazeOut));
    setCorridor(u);
  }

  // A paisagem aparece primeiro no vão do arco, com pouco contraste, e depois abaixo
  // dele. Na chegada, a névoa restante se dissipa por completo.
  function setOpening(arch, column, out) {
    var i;
    for (i = 0; i < openingArch.length; i++) openingArch[i].setAttribute('stop-opacity', arch.toFixed(4));
    for (i = 0; i < openingColumn.length; i++) openingColumn[i].setAttribute('stop-opacity', column.toFixed(4));
    // Sem abertura, a máscara não é necessária (e a tela inicial fica exatamente lisa).
    if (arch > 0) haze.setAttribute('mask', 'url(#portal-opening)');
    else haze.removeAttribute('mask');
    haze.style.opacity = (1 - out).toFixed(4);
  }

  // light: primeira luz (bordas sombreiam de leve); stone: a parede vira pedra iluminada.
  function setAmbient(light, stone) {
    for (var i = 0; i < ambientStops.length; i++) {
      var base = i === ambientStops.length - 1
        ? mixColor(AMBIENT_LIGHT[i], AMBIENT_EDGE_SHADOW, light)
        : AMBIENT_LIGHT[i];
      ambientStops[i].setAttribute('stop-color', rgb(mixColor(base, AMBIENT_STONE[i], stone)));
    }
  }

  // As camadas surgem uma a uma, da saída para a câmera, acompanhando a aproximação.
  function setCorridor(u) {
    var warm = smooth(u, U.warm);
    var span = U.layers[1] - U.layers[0];
    var nearExit = mixColor(LAYER_NEAR_EXIT, LAYER_NEAR_EXIT_WARM, warm);
    for (var i = 0; i < corridor.length; i++) {
      var item = corridor[i];
      var start = U.layers[0] + item.share * span * .6;
      var visible = smooth(u, [start, start + span * .4]);
      var color = rgb(mixColor(nearExit, LAYER_NEAR_CAMERA, item.share));
      // Dentro da seção: transparente. Na borda: um filete de luz suave. Fora: a cor da camada.
      item.stops[0].setAttribute('stop-color', color);
      item.stops[1].setAttribute('stop-opacity', (LAYER_EDGE_OPACITY * visible).toFixed(4));
      item.stops[2].setAttribute('stop-color', color);
      item.stops[2].setAttribute('stop-opacity', (LAYER_OPACITY * visible).toFixed(4));
      item.stops[3].setAttribute('stop-color', color);
      item.stops[3].setAttribute('stop-opacity', (LAYER_OPACITY * visible).toFixed(4));
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
