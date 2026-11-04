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
     - interior: camadas intermediárias — abóbada e paredes, abertas embaixo (sem
       piso nem base). Cada seção tem borda definida e uma face de pedra iluminada:
       larga na entrada (espessura), um filete no interior; frisos de luz nas paredes;
     - saída: a logo original, a névoa que se abre no vão e a paisagem.
   Não há rotação, inclinação, deslocamento lateral nem curvas concorrentes:
   tudo segue o mesmo progresso u.

   Luz
   Ambiente quase imperceptível na identidade. Com a dissolução das letras, a
   borda interna do arco ganha luz e uma luminosidade azulada surge no vão. Com a
   aproximação, a paisagem se define e aquece as camadas junto à saída.

   Linha do tempo (ms) — cerca de 7 s até a interface assentar
     0    – 1300  Identidade: a logo surge sobre branco puro e permanece intacta.
     1900 – 6900  Câmera: aproximação → espaço → travessia → chegada. Desde o primeiro
                  avanço, o branco assume os tons do túnel.
     2400 – 3600  Wordmark e assinatura se dissolvem; o arco e o vão ganham luz.
     ~2000 –      As camadas do corredor surgem uma a uma; frisos de luz em perspectiva
                  marcam as paredes e se dissolvem antes da chegada.
     ~2200 – 5900 A paisagem aparece primeiro no vão do arco, depois abaixo dele.
     5900         A interface da Home começa a surgir.
   Até 1900 a tela mostra apenas o SVG original sobre branco.

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
  var railLines = layer.querySelectorAll('[data-rails] line');

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
  var CORRIDOR_LENGTH = 340;  // comprimento do corredor diante do arco (unidades da logo)
  var CORRIDOR_LAYERS = 7;
  // Meia-largura da seção do corredor no mobile: um pouco maior que o arco (ver
  // #portal-layer). Em telas mais largas, a seção se alarga na proporção da tela.
  var CORRIDOR_R = 340;
  var CORRIDOR_BASE_ASPECT = .62;
  // No instante em que a entrada do corredor cruza as laterais da tela, o arco
  // ocupa esta fração da largura da entrada (define a perspectiva da cena).
  var ENTRY_PASS_RATIO = .58;
  var LANDSCAPE_ZOOM = .05;   // quanto a paisagem distante cresce durante a travessia
  var NEAR_DEPTH = .14;       // quanto a água próxima está "comprimida" no início (paralaxe)
  var SCROLL_PORTAL_ZOOM = .22;
  var SCROLL_LANDSCAPE_ZOOM = .04;
  var SCROLL_NEAR_ZOOM = .07;

  var T = {
    markIn: [200, 1300],
    camera: [1900, 6900],
    wordmarkOut: [2400, 3600],
    light: [2300, 3500],     // luz no arco e no vão, junto com a dissolução das letras
    ui: 5900,
    imageWaitMax: 4000
  };

  // Progresso da câmera (u) em que cada efeito acontece: tudo acompanha a aproximação.
  var U = {
    tone: [0, .45],          // o branco assume os tons do túnel desde o primeiro avanço
    archOpen: [.05, .5],     // a paisagem se define no vão do arco
    columnOpen: [.25, .7],   // e depois abaixo dele, sem base
    layers: [.02, .35],      // janela em que as camadas surgem, uma a uma
    rails: [.06, .3],        // os frisos aparecem
    railsOut: [.68, .9],     // e se dissolvem antes da chegada
    warm: [.2, .75],         // a luz da paisagem aquece as camadas junto à saída
    hazeOut: [.82, 1]        // a névoa restante se dissipa na chegada
  };

  /* Corredor: cor e opacidade de cada camada, da saída (índice 0) para a câmera.
     Junto à saída, pedra clara que esquenta com a luz da paisagem; perto da câmera,
     sombra fria. Sobrepostas, escurecem o espaço em direção às bordas da tela. */
  var LAYER_NEAR_EXIT = '#DDD4C9';
  var LAYER_NEAR_EXIT_WARM = '#E6CDB1';
  var LAYER_NEAR_CAMERA = '#4C5F76';
  var LAYER_OPACITY = .17;

  /* Face de cada camada: faixa de pedra iluminada logo após a borda da seção. Na entrada
     do corredor ela é larga (a borda frontal, com espessura); no interior, um filete —
     as linhas discretas de profundidade. Offsets do gradiente #portal-layer. */
  var FACE_COLOR = '#F2E8DC';
  var SECTION_EDGE = .86;
  var FACE_ENTRY = { width: .032, opacity: .5 };
  var FACE_INTERIOR = { width: .008, opacity: .15 };

  /* Ambiente: branco puro na identidade; com o avanço da câmera, assume os tons do
     túnel — pedra quente junto à saída, fria em direção às bordas. */
  var AMBIENT_WHITE = '#FFFFFF';
  var GLOW_OPACITY = .6;       // luz azulada no vão: presente, sem formar halo
  var AMBIENT_TUNNEL = ['#ECE5DC', '#D8DDE2', '#A8B4C1'];

  /* Frisos de luz: duas retas junto à base das paredes do corredor (y = 640, abaixo das
     pontas do arco, sem nunca se unirem), como faixas de luz quente que convergem para a
     saída. Ficam abaixo do eixo da câmera, então descem em diagonal — nenhuma linha
     horizontal cruza a marca. x: lado (-1 esquerda, 1 direita). */
  var RAILS = [
    { x: -1, y: 640 },
    { x: 1, y: 640 }
  ];
  var RAIL_COLOR = '#E2C29C';
  var RAIL_OPACITY = .6;

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
  AMBIENT_WHITE = hexToRgb(AMBIENT_WHITE);
  AMBIENT_TUNNEL = AMBIENT_TUNNEL.map(hexToRgb);

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

  // Início quase imperceptível, meio contido (tempo para perceber o corredor) e chegada longa.
  var cameraEase = cubicBezier(.5, 0, .28, 1);

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

    var isEntry = c === CORRIDOR_LAYERS - 1;
    var faceSpec = isEntry ? FACE_ENTRY : FACE_INTERIOR;
    var stops = gradient.querySelectorAll('stop');
    stops[0].setAttribute('offset', SECTION_EDGE);
    stops[1].setAttribute('offset', SECTION_EDGE + .002);
    stops[2].setAttribute('offset', SECTION_EDGE + faceSpec.width);
    stops[3].setAttribute('offset', SECTION_EDGE + faceSpec.width + .03);

    corridor.push({
      el: el,
      gradient: gradient,
      stops: stops,
      face: faceSpec,
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

    // Largura do corredor: proporcional ao formato da tela (no mobile, CORRIDOR_R).
    var widthFactor = Math.max(1, (w / h) / CORRIDOR_BASE_ASPECT);
    var corridorHalf = CORRIDOR_R * widthFactor;
    for (var i = 0; i < corridor.length; i++) {
      corridor[i].gradient.setAttribute('gradientTransform',
        'translate(886.5 346.5) scale(' + (.2316 * widthFactor).toFixed(4) + ' 1) translate(-886.5 -346.5)');
    }

    // Perspectiva: quando a entrada do corredor cruza as laterais da tela, o arco
    // tem ENTRY_PASS_RATIO da largura dela. Daí resulta a distância focal.
    var entryPassScale = (w / 2) / corridorHalf;
    var focal = CORRIDOR_LENGTH * ENTRY_PASS_RATIO * entryPassScale / (1 - ENTRY_PASS_RATIO);

    view = {
      w: w,
      h: h,
      horizonY: horizonY,
      vanishY: vanishY,
      focal: focal,
      corridorHalf: corridorHalf,
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

    placeRails(exitDistance);

    // A paisagem se aproxima a partir do mesmo eixo da câmera; a água próxima,
    // mais rápido que céu e montanhas. Em u = 1 ambas coincidem com a Home.
    var far = 1 - LANDSCAPE_ZOOM * (1 - u);
    landscape.style.transform = landscapeMatrix(far);
    landscapeNear.style.transform = landscapeMatrix(far * (1 - NEAR_DEPTH * (1 - u)));
  }

  /* Frisos: cada um é o segmento de uma reta das paredes, da saída (profundidade 0)
     até a entrada do corredor — ou até perto da câmera, se ela já estiver dentro dele.
     Como todos os pontos usam a mesma projeção, as retas convergem para o eixo. */
  function placeRails(exitDistance) {
    var nearest = Math.min(CORRIDOR_LENGTH, exitDistance - view.focal / 40);
    for (var i = 0; i < railLines.length; i++) {
      var rail = RAILS[i];
      var x = ARC_X + rail.x * view.corridorHalf;
      var a = project(x, rail.y, exitDistance);
      var b = project(x, rail.y, exitDistance - Math.max(0, nearest));
      railLines[i].setAttribute('x1', a[0].toFixed(1));
      railLines[i].setAttribute('y1', a[1].toFixed(1));
      railLines[i].setAttribute('x2', b[0].toFixed(1));
      railLines[i].setAttribute('y2', b[1].toFixed(1));
    }
  }

  // Ponto (x, y) da cena, a uma distância da câmera, em coordenadas de tela.
  function project(x, y, distance) {
    var scale = view.focal / distance;
    return [view.w / 2 + (x - ARC_X) * scale, view.vanishY + (y - AXIS_Y) * scale];
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
    glow.style.opacity = (GLOW_OPACITY * light * (1 - archOpen)).toFixed(4);
    setAmbient(smooth(u, U.tone));

    setOpening(archOpen, columnOpen, smooth(u, U.hazeOut));
    setCorridor(u);
    setRails(u);
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

  // tone: 0 = branco puro; 1 = tons do túnel.
  function setAmbient(tone) {
    for (var i = 0; i < ambientStops.length; i++) {
      ambientStops[i].setAttribute('stop-color', rgb(mixColor(AMBIENT_WHITE, AMBIENT_TUNNEL[i], tone)));
    }
  }

  function setRails(u) {
    var visible = smooth(u, U.rails) * (1 - smooth(u, U.railsOut));
    for (var i = 0; i < railLines.length; i++) {
      railLines[i].style.stroke = RAIL_COLOR;
      railLines[i].style.opacity = (RAIL_OPACITY * visible).toFixed(4);
    }
  }

  // As camadas surgem uma a uma, das bordas da tela (perto da câmera) para a saída,
  // acompanhando a aproximação: primeiro o espaço ao redor, depois a profundidade.
  function setCorridor(u) {
    var warm = smooth(u, U.warm);
    var span = U.layers[1] - U.layers[0];
    var nearExit = mixColor(LAYER_NEAR_EXIT, LAYER_NEAR_EXIT_WARM, warm);
    for (var i = 0; i < corridor.length; i++) {
      var item = corridor[i];
      var start = U.layers[0] + (1 - item.share) * span * .6;
      var visible = smooth(u, [start, start + span * .4]);
      var color = rgb(mixColor(nearExit, LAYER_NEAR_CAMERA, item.share));
      // Dentro da seção: transparente. Na borda: a face de pedra iluminada (espessura).
      // Fora: a sombra da camada, que se acumula em direção às bordas da tela.
      var faceOpacity = (item.face.opacity * visible).toFixed(4);
      item.stops[1].setAttribute('stop-opacity', faceOpacity);
      item.stops[2].setAttribute('stop-opacity', faceOpacity);
      item.stops[3].setAttribute('stop-color', color);
      item.stops[3].setAttribute('stop-opacity', (LAYER_OPACITY * visible).toFixed(4));
      item.stops[4].setAttribute('stop-color', color);
      item.stops[4].setAttribute('stop-opacity', (LAYER_OPACITY * visible).toFixed(4));
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
