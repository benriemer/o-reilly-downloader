import { api, ApiError } from '../api.js';
import {
  html,
  icon,
  logoMark,
  renderInto,
  setButtonLoading,
  toast,
} from '../ui.js';

export function renderLogin(root, { onSuccess, message = '' } = {}) {
  document.title = 'Sign in · Shelf';
  renderInto(
    root,
    html`
      <div class="login-shell">
        <div class="login-glow login-glow--one"></div>
        <div class="login-glow login-glow--two"></div>
        <section class="login-story" aria-label="About Shelf">
          <div class="login-brand">
            ${logoMark(36)}
            <div>
              <strong>Shelf</strong>
              <span>O'Reilly downloader</span>
            </div>
          </div>
          <div class="login-story__content">
            <p class="eyebrow">Private, local-first</p>
            <h1>Your O'Reilly library,<br />quietly offline.</h1>
            <p class="login-story__lead">
              A focused companion for the CLI you already trust. Queue books and
              courses, watch progress, and keep every file in one place.
            </p>
            <ul class="login-features">
              <li>${icon('book', { size: 17 })}<span>EPUB and PDF downloads</span></li>
              <li>${icon('video', { size: 17 })}<span>Video courses with transcripts</span></li>
              <li>${icon('shield', { size: 17 })}<span>Cookies stay on your server</span></li>
            </ul>
          </div>
          <p class="login-story__foot">
            Unofficial companion for learning.oreilly.com
          </p>
        </section>

        <section class="login-panel">
          <div class="login-card">
            <div class="login-card__mark">${logoMark(42)}</div>
            <p class="eyebrow">Private access</p>
            <h2>Welcome back.</h2>
            <p class="login-card__intro">
              Enter the password configured for this Shelf instance.
            </p>
            ${message
              ? html`<div class="notice notice--warning" role="status">${icon('alert', { size: 17 })}<span>${message}</span></div>`
              : ''}
            <div class="form-alert" data-login-error hidden></div>
            <form class="login-form" data-login-form novalidate>
              <label class="field">
                <span class="field__label">Password</span>
                <span class="password-field">
                  <input
                    class="input"
                    type="password"
                    name="password"
                    autocomplete="current-password"
                    placeholder="Your access password"
                    required
                    autofocus
                  />
                  <button class="password-toggle" type="button" data-password-toggle aria-label="Show password" aria-pressed="false">
                    ${icon('eye', { size: 17 })}
                  </button>
                </span>
              </label>
              <button class="button button--primary button--large button--full" type="submit" data-login-submit>
                ${icon('lock', { size: 16 })}<span>Unlock Shelf</span>
              </button>
            </form>
            <p class="login-card__foot">
              ${icon('shield', { size: 14 })}
              <span>A signed, HTTP-only session protects this browser.</span>
            </p>
          </div>
          <p class="login-legal">
            Use only with content you are authorized to access. O'Reilly terms apply.
          </p>
        </section>
      </div>
    `,
  );

  const form = root.querySelector('[data-login-form]');
  const input = form.querySelector('input[name="password"]');
  const submit = form.querySelector('[data-login-submit]');
  const errorBox = root.querySelector('[data-login-error]');
  const toggle = root.querySelector('[data-password-toggle]');
  let busy = false;

  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(reveal));
    toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    renderInto(toggle, reveal ? icon('eyeOff', { size: 17 }) : icon('eye', { size: 17 }));
    input.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const password = input.value;
    if (!password) {
      errorBox.hidden = false;
      errorBox.textContent = 'Enter your access password.';
      input.focus();
      return;
    }
    busy = true;
    errorBox.hidden = true;
    setButtonLoading(submit, true, 'Unlocking…');
    try {
      const session = await api.login(password);
      toast('Signed in.', 'success');
      onSuccess(session);
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent =
        error instanceof ApiError ? error.message : 'Could not sign in. Try again.';
      input.select();
    } finally {
      busy = false;
      setButtonLoading(submit, false);
    }
  });
}
