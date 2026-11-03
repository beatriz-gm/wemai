/* ==========================================================================
   WEMAI — Navegação
   Menu mobile acessível (toque e teclado) e estado do cabeçalho na rolagem.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var header = document.querySelector('[data-header]');
  var toggle = document.querySelector('[data-menu-toggle]');
  var menu = document.getElementById('site-menu');
  var main = document.getElementById('conteudo');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (!header || !toggle || !menu) return;

  /* --- Menu ----------------------------------------------------------------- */

  function isOpen() {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  function openMenu() {
    root.classList.add('menu-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Fechar menu');
    if (main) main.inert = true;
    var first = menu.querySelector('a');
    // Aguarda o painel ficar visível para mover o foco.
    setTimeout(function () { if (isOpen() && first) first.focus(); }, 50);
  }

  function closeMenu(restoreFocus) {
    root.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menu');
    if (main) main.inert = false;
    if (restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', function () {
    if (isOpen()) closeMenu(false);
    else openMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;

    if (e.key === 'Escape') {
      closeMenu(true);
      return;
    }

    // Mantém o foco dentro do cabeçalho enquanto o menu está aberto.
    if (e.key === 'Tab') {
      var focusables = header.querySelectorAll('a[href], button:not([disabled])');
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  /* --- Links internos ------------------------------------------------------ */

  function goTo(target, hash) {
    target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (history.pushState) history.pushState(null, '', hash);
  }

  header.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var hash = link.getAttribute('href');
    var target = document.querySelector(hash);
    if (!target) return;

    e.preventDefault();
    var wasOpen = isOpen();
    closeMenu(false);
    // Com o menu aberto a rolagem está travada; espera o desbloqueio.
    if (wasOpen) requestAnimationFrame(function () { goTo(target, hash); });
    else goTo(target, hash);
  });

  /* --- Cabeçalho sólido assim que a rolagem começa ------------------------- */
  // Transparente sobre a paisagem em repouso; com fundo quando o texto passa por baixo.

  var solidQueued = false;

  function updateSolid() {
    solidQueued = false;
    header.classList.toggle('is-solid', window.scrollY > 24);
  }

  window.addEventListener('scroll', function () {
    if (solidQueued) return;
    solidQueued = true;
    requestAnimationFrame(updateSolid);
  }, { passive: true });

  updateSolid();
})();
