import assert from 'node:assert/strict';
import test from 'node:test';
import { html, renderInto } from '../public/js/ui.js';

function fakeElement() {
  return {
    innerHTML: 'sentinel',
  };
}

test('renderInto writes html markup', () => {
  const element = fakeElement();
  renderInto(element, html`<p>${'<unsafe>'}</p>`);
  assert.equal(element.innerHTML, '<p>&lt;unsafe&gt;</p>');
});

test('renderInto writes nothing for empty markup', () => {
  const element = fakeElement();
  renderInto(element, html``);
  assert.equal(element.innerHTML, '');
});

test('renderInto never writes the string undefined', () => {
  const element = fakeElement();
  renderInto(element, undefined);
  assert.equal(element.innerHTML, '');

  renderInto(element, null);
  assert.equal(element.innerHTML, '');

  renderInto(element, '');
  assert.equal(element.innerHTML, '');
});

test('renderInto escapes plain strings instead of treating them as markup', () => {
  const element = fakeElement();
  renderInto(element, '<script>alert(1)</script>');
  assert.equal(element.innerHTML, '&lt;script&gt;alert(1)&lt;/script&gt;');
});
