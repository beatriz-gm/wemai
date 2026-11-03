/* ==========================================================================
   WEMAI — Abertura: do símbolo ao horizonte

   Modelo
   Uma câmera em perspectiva avança em direção a uma passagem curta com a
   geometria exata do arco da logo. A passagem tem dois planos:
     - entrada: parede clara + arco + wordmark (a logo original);
     - saída:   o mesmo vão, PASSAGE_DEPTH unidades mais distante.
   A escala de cada plano é FOCAL / distância, então a entrada cresce mais
   rápido que a saída e a profundidade surge naturalmente, sem efeitos.
   A paisagem (imagem real) fica atrás de tudo e só aparece pelo vão.

   Ritmo
   A progressão da câmera é interpolada em escala logarítmica (zoom percebido
   como constante) com uma curva de início quase imperceptível e chegada longa.

   Linha do tempo (ms) — cerca de 7,5 s até a interface assentar
     0    – 1400  Identidade: a logo surge e permanece intacta.
     2200 – 7200  Câmera: aproximação → revelação → travessia → chegada.
     2700 – 3900  Wordmark e assinatura se dissolvem.
     2700 – 4500  Ao mesmo tempo, o vão se abre a partir do centro. O interior nasce
                  nos tons do fundo claro, então o arco ganha profundidade sem contraste.
     3000 – 5300  A névoa da saída se dissipa e a paisagem se define.
     ~2900 – 5800 Materialidade (cor, sombra, luz lateral) acompanha a aproximação.
     6200         A interface da Home começa a surgir.
   Até 2700 nada é acrescentado à logo: a parede é um plano inteiro, sem recortes,
   e a tela mostra apenas o SVG original.

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
  var backPlane = layer.querySelector('[data-plane="back"]');
  var mark = layer.querySelector('[data-mark]');
  var wordmark = layer.querySelector('[data-wordmark]');
  var shade = layer.querySelector('[data-shade]');
  var face = layer.querySelector('[data-face]');
  var wall = layer.querySelector('[data-wall]');
  var wallPaths = layer.querySelectorAll('[data-wall-path]');
  var revealStops = layer.querySelectorAll('[data-reveal-stop]');
  var interior = layer.querySelector('[data-interior]');
  var interiorStops = Array.prototype.map.call(interior.querySelectorAll('stop'), function (stop) {
    return { el: stop, at: parseFloat(stop.getAttribute('offset')) };
  });
  var floorStops = layer.querySelectorAll('[data-floor] stop');
  var sideLight = layer.querySelector('[data-side]');
  var haze = layer.querySelector('[data-haze]');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var playing = root.classList.contains('intro-pending');

  /* --- Geometria do arco original -----------------------------------------
     M671 494.63 A261.5 261.5 0 1 1 1102 494.63 A252 252 0 1 0 671 494.63 Z */
  var ARC_X = 886.5;                       // eixo de simetria
  var TIP_Y = 494.63;                      // base (reta entre as pontas)
  var INNER_R = 252;
  var HALF_CHORD = (1102 - 671) / 2;
  var INNER_CENTER_Y = TIP_Y - Math.sqrt(INNER_R * INNER_R - HALF_CHORD * HALF_CHORD);
  var INNER_TOP = INNER_CENTER_Y - INNER_R;
  var LOGO_WIDTH = 1445 - 327.58;          // largura desenhada da logo
  // Centro vertical da logo: no mobile ela não tem a frase de assinatura (termina em y = 720).
  var signatureHidden = window.matchMedia('(max-width: 767px)');
  function logoCenterY() { return (85 + (signatureHidden.matches ? 720 : 821)) / 2; }

  /* --- Cena ------------------------------------------------------------------ */
  var IMAGE = { w: 941, h: 1672, posX: .58, posY: .5, horizon: .65 }; // horizonte do mar na imagem
  var PASSAGE_DEPTH = 140;   // profundidade da passagem, em unidades da logo
  // Onde a câmera para: distância até a saída, em profundidades da passagem.
  // Acima de 1, ela para na soleira, com a moldura de entrada já além das bordas;
  // assim o arco sai de cena durante a desaceleração, sem "varrer" o quadro.
  var CAMERA_STOP = 1.5;
  var END_TOP = .035;        // topo do vão, ao final, como fração da altura da tela
  var LANDSCAPE_ZOOM = .05;  // quanto a paisagem distante cresce durante a travessia
  var NEAR_DEPTH = .14;      // quanto a água próxima está "comprimida" no início (paralaxe)
  var CAMERA_DRIFT = 38;     // desvio lateral da câmera no meio da travessia, em unidades da logo
  var SCROLL_PORTAL_ZOOM = .22;
  var SCROLL_LANDSCAPE_ZOOM = .04;
  var SCROLL_NEAR_ZOOM = .07;

  // Contornos da parede de entrada: plano inteiro (logo intacta) e com o vão aberto.
  var WALL_SOLID = 'M-20000 -20000 H20000 V20000 H-20000 Z';
  var WALL_OPEN = WALL_SOLID + ' M671 494.63 A261.5 261.5 0 1 1 1102 494.63 Z';

  var T = {
    markIn: [200, 1400],
    camera: [2200, 7200],
    wordmarkOut: [2700, 3900],
    reveal: [2700, 4500],   // o vão começa a se abrir junto com a dissolução das letras
    haze: [3000, 5300],     // a névoa da saída se dissipa e a paisagem se define
    ui: 6200,
    imageWaitMax: 4000
  };

  /* Materialidade: o interior nasce nos tons do fundo claro e ganha a cor do arco
     conforme a câmera se aproxima (progresso da câmera, não do relógio). Assim o
     escurecimento acompanha a profundidade percebida e nunca acontece de repente. */
  var MATERIAL_RANGE = [.02, .62];
  var INTERIOR_LIGHT = ['#FBF4EA', '#F4F6F8', '#EDF1F4', '#E6EBF0', '#E1E7EC', '#DEE4EA'];
  var INTERIOR_MATERIAL = ['#F6E2C8', '#C6D1DB', '#8A9FB4', '#55708C', '#3A5672', '#304B67'];
  var FLOOR_LIGHT = ['#F1F3F5', '#E6EBEF', '#DCE3E9'];
  var FLOOR_MATERIAL = ['#8E9CAD', '#4F657D', '#2A4259'];

  var REVEAL_REACH = .3; // alcance inicial da transparência a partir do centro do vão

  var view = {};
  var frameId = 0;
  var finished = !playing;

  /* --- Curvas ------------------------------------------------------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function phase(t, range) { return clamp01((t - range[0]) / (range[1] - range[0])); }
  function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function mixColor(a, b, m) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * m) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * m) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * m) + ')';
  }

  INTERIOR_LIGHT = INTERIOR_LIGHT.map(hexToRgb);
  INTERIOR_MATERIAL = INTERIOR_MATERIAL.map(hexToRgb);
  FLOOR_LIGHT = FLOOR_LIGHT.map(hexToRgb);
  FLOOR_MATERIAL = FLOOR_MATERIAL.map(hexToRgb);

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

  /* --- Medidas ----------------------------------------------------------- */

  function measure() {
    var w = hero.clientWidth;
    var h = hero.clientHeight;

    // Mesmo enquadramento de object-fit: cover + object-position do CSS.
    var fit = Math.max(w / IMAGE.w, h / IMAGE.h);
    var imageTop = (h - IMAGE.h * fit) * IMAGE.posY;
    var horizonY = imageTop + IMAGE.h * fit * IMAGE.horizon;

    // Final: o vão cobre a tela, com a base logo abaixo da borda inferior
    // e o topo um pouco abaixo da borda superior (a arquitetura emoldura a cena).
    var bottom = h + 8;
    var top = h * END_TOP;
    var endScale = (bottom - top) / (TIP_Y - INNER_TOP);

    // Altura dos olhos (constante): um pouco acima do piso do portal,
    // de modo que o horizonte da imagem seja o ponto de fuga final.
    var eye = TIP_Y - (bottom - horizonY) / endScale;

    // Início: a logo centralizada. O ponto de fuga parte da altura da logo e
    // desce até o horizonte real durante a aproximação (leve inclinação da câmera).
    var startScale = Math.min(w * .62, 280) / LOGO_WIDTH;
    var startVanish = h * .47 - (logoCenterY() - eye) * startScale;

    var focal = endScale * CAMERA_STOP * PASSAGE_DEPTH;
    var startBack = focal / (focal / startScale + PASSAGE_DEPTH);

    view = {
      w: w,
      h: h,
      horizonY: horizonY,
      startVanish: startVanish,
      eye: eye,
      focal: focal,
      startBack: startBack,
      endBack: endScale
    };

    var origin = (w / 2) + 'px ' + horizonY + 'px';
    landscape.style.transformOrigin = origin;
    landscapeNear.style.transformOrigin = origin;
    layer.style.transformOrigin = origin;
  }

  /* --- Câmera ---------------------------------------------------------------- */

  // camX: deslocamento lateral da câmera (unidades da logo). O ponto de fuga fica no
  // centro da tela, então planos mais próximos se deslocam mais: paralaxe real.
  function placePlane(plane, scale, vanishY, camX) {
    var tx = view.w / 2 - (ARC_X + camX) * scale;
    var ty = vanishY - view.eye * scale;
    plane.setAttribute('transform',
      'matrix(' + scale.toFixed(5) + ' 0 0 ' + scale.toFixed(5) + ' ' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ')');
  }

  // u = 0: logo; u = 1: chegada à Home.
  function setCamera(u) {
    var backScale = view.startBack * Math.pow(view.endBack / view.startBack, u);
    var frontDistance = view.focal / backScale - PASSAGE_DEPTH;
    var vanishY = view.startVanish + (view.horizonY - view.startVanish) * easeInOutSine(clamp01(u / .75));
    // Leve arco lateral: centrada no início e no fim, deslocada no meio da travessia.
    var camX = CAMERA_DRIFT * Math.sin(Math.PI * u);

    placePlane(backPlane, backScale, vanishY, camX);

    // Depois que a câmera cruza a entrada, ela fica fora de cena.
    if (frontDistance > view.focal / 200) {
      var frontScale = view.focal / frontDistance;
      frontPlane.style.display = '';
      placePlane(frontPlane, frontScale, vanishY, camX);
      lightInterior(frontScale / backScale, camX);
    } else {
      frontPlane.style.display = 'none';
    }

    var farScale = 1 + LANDSCAPE_ZOOM * u;
    landscape.style.transform = 'scale(' + farScale.toFixed(4) + ')';
    // A água próxima começa comprimida em direção ao horizonte e alcança o plano distante no fim.
    landscapeNear.style.transform = 'scale(' + (farScale * (1 - NEAR_DEPTH * (1 - u))).toFixed(4) + ')';
  }

  /* Iluminação do interior ao longo da profundidade.
     Em coordenadas do plano de saída, a borda de entrada é a mesma circunferência
     ampliada k vezes a partir do ponto de vista (ARC_X + camX, eye). Um gradiente
     radial com foco nesse ponto percorre então o interior exatamente da saída (1/k)
     até a entrada (1). */
  function lightInterior(k, camX) {
    var vx = ARC_X + camX;
    var cx = vx + (ARC_X - vx) * k;
    var cy = view.eye + (INNER_CENTER_Y - view.eye) * k;
    interior.setAttribute('fx', vx.toFixed(2));
    interior.setAttribute('fy', view.eye.toFixed(2));
    interior.setAttribute('cx', cx.toFixed(2));
    interior.setAttribute('cy', cy.toFixed(2));
    interior.setAttribute('r', (INNER_R * k).toFixed(2));
    var exit = 1 / k;
    for (var i = 0; i < interiorStops.length; i++) {
      interiorStops[i].el.setAttribute('offset', (exit + (1 - exit) * interiorStops[i].at).toFixed(4));
    }
  }

  function setAppearance(t, u) {
    mark.style.opacity = easeInOutSine(phase(t, T.markIn));
    wordmark.style.opacity = 1 - easeInOutSine(phase(t, T.wordmarkOut));
    haze.style.opacity = 1 - easeInOutSine(phase(t, T.haze));
    setMaterial(easeInOutSine(phase(u, MATERIAL_RANGE)));

    // Revelação a partir do centro do vão: o centro clareia primeiro e a abertura
    // se espalha até as bordas, como luz atravessando — nunca um ponto ou contorno nítido.
    var p = easeInOutSine(phase(t, T.reveal));
    setWall(p);
    if (p > 0 && p < 1) {
      revealStops[0].setAttribute('stop-opacity', p.toFixed(4));
      revealStops[1].setAttribute('offset', (REVEAL_REACH + (1 - REVEAL_REACH) * p).toFixed(4));
      revealStops[1].setAttribute('stop-opacity', clamp01((p - .3) / .7).toFixed(4));
    }
  }

  // m = 0: tudo nos tons do fundo claro; m = 1: material, luz lateral e sombras completas.
  function setMaterial(m) {
    var i;
    for (i = 0; i < interiorStops.length; i++) {
      interiorStops[i].el.setAttribute('stop-color', mixColor(INTERIOR_LIGHT[i], INTERIOR_MATERIAL[i], m));
    }
    for (i = 0; i < floorStops.length; i++) {
      floorStops[i].setAttribute('stop-color', mixColor(FLOOR_LIGHT[i], FLOOR_MATERIAL[i], m));
    }
    sideLight.style.opacity = m;
    shade.style.opacity = m;
    face.style.opacity = m;
  }

  /* A parede só ganha o vão quando a revelação começa. Antes disso é um plano
     inteiro, sem nenhuma borda além das da própria logo; durante a revelação, uma
     máscara única abre o vão; depois, o contorno externo do arco vira o recorte. */
  var wallState = '';

  function setWall(p) {
    var state = p <= 0 ? 'solid' : p >= 1 ? 'open' : 'opening';
    if (state === wallState) return;
    wallState = state;
    for (var i = 0; i < wallPaths.length; i++) {
      wallPaths[i].setAttribute('d', state === 'open' ? WALL_OPEN : WALL_SOLID);
      wallPaths[i].setAttribute('fill-rule', 'evenodd');
    }
    if (state === 'opening') wall.setAttribute('mask', 'url(#portal-opening)');
    else wall.removeAttribute('mask');
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
    landscape.style.transform = 'scale(' + (1 + LANDSCAPE_ZOOM + SCROLL_LANDSCAPE_ZOOM * p).toFixed(4) + ')';
    landscapeNear.style.transform = 'scale(' + (1 + LANDSCAPE_ZOOM + SCROLL_NEAR_ZOOM * p).toFixed(4) + ')';
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
