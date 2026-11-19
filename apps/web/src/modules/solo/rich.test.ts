import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Rich } from './rich';

const html = (text: string, self?: string) => renderToStaticMarkup(createElement('p', null, createElement(Rich, { text, self })));

test('gains and losses are marked, and the minus sign is a real minus', () => {
  assert.match(html('Take +2 momentum.'), /<mark class="solo-token is-gain">Take \+2 momentum<\/mark>/);
  assert.match(html('You suffer -1 momentum.'), /<mark class="solo-token is-loss">suffer −1 momentum<\/mark>/);
  assert.match(html('suffer -1 supply'), /is-loss">suffer −1 supply/);
  assert.match(html('take +1 health'), /is-gain">take \+1 health/);
});

test('move names link to their move, except the move you are reading', () => {
  assert.match(html('Pay the Price.'), /<a class="solo-move-link" href="#solo-moves-pay-price">Pay the Price<\/a>/);
  assert.match(html('Pay the Price.', 'pay-price'), /<i>Pay the Price<\/i>/);
  assert.match(html('Make the move Face Danger now.'), /href="#solo-moves-face-danger"/);
});

test('the longest move name wins, and plain text stays plain', () => {
  assert.match(html('Face Danger or Secure an Advantage (in a scene)'), /href="#solo-moves-scene-action"/);
  assert.equal(html('Nothing special here.'), '<p>Nothing special here.</p>');
});
