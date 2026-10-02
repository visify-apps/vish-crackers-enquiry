/* In-app notice / confirm — never use window.alert / confirm. */
window.VishDialog = (function () {
  let root = null;
  let resolver = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensure() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'vish-dialog';
    root.className = 'vish-dialog';
    root.hidden = true;
    root.innerHTML =
      '<div class="vish-dialog-backdrop" data-dialog-cancel="1"></div>' +
      '<div class="vish-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="vish-dialog-title">' +
      '<p class="vish-dialog-kicker" id="vish-dialog-kicker" hidden></p>' +
      '<h2 id="vish-dialog-title"></h2>' +
      '<p class="vish-dialog-body" id="vish-dialog-body"></p>' +
      '<div class="vish-dialog-actions" id="vish-dialog-actions"></div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-dialog-cancel]')) finish(false);
      else if (e.target.closest('[data-dialog-ok]')) finish(true);
    });
    return root;
  }

  function finish(value) {
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove('vish-dialog-open');
    const fn = resolver;
    resolver = null;
    if (typeof fn === 'function') fn(value);
  }

  function open(options) {
    options = options || {};
    ensure();
    if (resolver) finish(false);

    const kicker = root.querySelector('#vish-dialog-kicker');
    const title = root.querySelector('#vish-dialog-title');
    const body = root.querySelector('#vish-dialog-body');
    const actions = root.querySelector('#vish-dialog-actions');

    if (options.kicker) {
      kicker.hidden = false;
      kicker.textContent = options.kicker;
    } else {
      kicker.hidden = true;
      kicker.textContent = '';
    }
    title.textContent = options.title || '';
    body.textContent = options.body || '';

    const mode = options.mode === 'confirm' ? 'confirm' : 'notice';
    if (mode === 'confirm') {
      actions.className = 'vish-dialog-actions is-pair';
      actions.innerHTML =
        '<button type="button" class="btn-dialog btn-dialog-cancel" data-dialog-cancel="1">' +
        escapeHtml(options.cancelLabel || 'Cancel') +
        '</button>' +
        '<button type="button" class="btn-dialog btn-dialog-ok" data-dialog-ok="1">' +
        escapeHtml(options.confirmLabel || 'Continue') +
        '</button>';
    } else {
      actions.className = 'vish-dialog-actions is-single';
      actions.innerHTML =
        '<button type="button" class="btn-dialog btn-dialog-ok" data-dialog-ok="1">' +
        escapeHtml(options.okLabel || 'Got it') +
        '</button>';
    }

    root.hidden = false;
    document.body.classList.add('vish-dialog-open');
    const focusBtn = actions.querySelector('[data-dialog-ok]');
    if (focusBtn && focusBtn.focus) {
      try {
        focusBtn.focus();
      } catch (e) {}
    }

    return new Promise(function (resolve) {
      resolver = resolve;
    });
  }

  function notice(options) {
    return open(Object.assign({}, options, { mode: 'notice' })).then(function () {
      return true;
    });
  }

  function confirm(options) {
    return open(Object.assign({}, options, { mode: 'confirm' }));
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root && !root.hidden) {
      e.preventDefault();
      finish(false);
    }
  });

  return {
    notice: notice,
    confirm: confirm,
    close: function () {
      finish(false);
    }
  };
})();
