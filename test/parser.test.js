const assert = require('assert');
const { parseUsage, looksLikeLogin } = require('../src/parser');

// Página en inglés (estructura típica de claude.ai/settings/usage)
const en = `Settings
Usage
Plan usage limits
Pro
Current session
Resets in 3 hr 12 min
23% used
Weekly limits
Learn more about usage limits
All models
Resets Thu 10:00 AM
8% used
Last updated: less than a minute ago`;

let items = parseUsage(en);
assert.strictEqual(items.length, 2);
assert.deepStrictEqual(items[0], { label: 'Current session', kind: 'session', used: 23, remaining: 77, reset: 'Resets in 3 hr 12 min' });
assert.strictEqual(items[1].label, 'All models');
assert.strictEqual(items[1].kind, 'weekly');
assert.strictEqual(items[1].remaining, 92);
assert.strictEqual(items[1].reset, 'Resets Thu 10:00 AM');

// Página en español, con el reinicio después del porcentaje
const es = `Límites de uso del plan
Sesión actual
45 % usado
Se restablece en 1 h 5 min
Límites semanales
Todos los modelos
12,5 % usado
Se restablece el jue 10:00`;
items = parseUsage(es);
assert.strictEqual(items.length, 2);
assert.strictEqual(items[0].kind, 'session');
assert.strictEqual(items[0].remaining, 55);
assert.strictEqual(items[0].reset, 'Se restablece en 1 h 5 min');
assert.strictEqual(items[1].used, 12.5);

// Respaldo con barras de progreso
items = parseUsage('nada útil', [{ value: '60', max: '100', context: 'Current session\nResets in 2 hr' }]);
assert.strictEqual(items.length, 1);
assert.strictEqual(items[0].remaining, 40);

// Detección de login
assert.ok(looksLikeLogin('https://claude.ai/login', ''));
assert.ok(looksLikeLogin('https://claude.ai/', 'Welcome\nContinue with Google\nContinue with email'));
assert.ok(!looksLikeLogin('https://claude.ai/settings/usage', en));

console.log('✔ parser: todas las pruebas pasan');
