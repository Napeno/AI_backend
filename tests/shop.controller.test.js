const assert = require('node:assert/strict');
const test = require('node:test');
const { giftCatalog, getGiftById } = require('../src/config/gift-catalog');

test('ships thirteen gifts with server-owned prices and assets', () => {
  assert.equal(giftCatalog.length, 13);
  assert.ok(giftCatalog.every(gift => gift.id && gift.title && gift.description && gift.image && gift.price > 0));
  assert.equal(getGiftById('missing-gift'), undefined);
});
