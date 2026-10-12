import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const createDOMPurify = require('dompurify');

test('SafeHtml always sanitizes with DOMPurify before dangerouslySetInnerHTML', async () => {
  const src = await readFile(new URL('../src/components/email/SafeHtml.jsx', import.meta.url), 'utf8');
  assert.match(src, /DOMPurify\.sanitize/);
  assert.match(src, /dangerouslySetInnerHTML/);
  assert.match(src, /FORBID_TAGS/);
  assert.ok(src.indexOf('DOMPurify.sanitize') < src.indexOf('dangerouslySetInnerHTML'));
  assert.match(src, /script/);
  assert.match(src, /noopener/);
});

test('DOMPurify strips script and event-handler XSS payloads', () => {
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);

  const PURIFY_CONFIG = {
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
    ALLOW_DATA_ATTR: false,
  };

  const payloads = [
    '<script>alert(1)</script><p>hi</p>',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">click</a>',
    '<svg/onload=alert(1)>',
    '<iframe src="https://evil.com"></iframe>',
  ];

  for (const html of payloads) {
    const clean = DOMPurify.sanitize(html, PURIFY_CONFIG);
    assert.equal(/<script/i.test(clean), false, `script survived: ${clean}`);
    assert.equal(/onerror=/i.test(clean), false, `onerror survived: ${clean}`);
    assert.equal(/javascript:/i.test(clean), false, `javascript: survived: ${clean}`);
    assert.equal(/<iframe/i.test(clean), false, `iframe survived: ${clean}`);
  }
});
