const assert = require('assert');
const { forecast, parseReset } = require('../src/forecast');

const HOUR = 3600 * 1000;
const now = new Date(2026, 10, 6, 20, 0, 0).getTime(); // viernes 6-nov-2026, 20:00 hora local

// ---- parseReset ----
assert.strictEqual(parseReset('Resets in 3 hr 12 min', now), now + 3 * HOUR + 12 * 60000);
assert.strictEqual(parseReset('Se restablece en 1 h 5 min', now), now + HOUR + 5 * 60000);
assert.strictEqual(parseReset('Resets in 45 min', now), now + 45 * 60000);
assert.strictEqual(parseReset('Resets Thu 10:00 AM', now), new Date(2026, 10, 12, 10, 0).getTime());
assert.strictEqual(parseReset('Se restablece el jue 10:00', now), new Date(2026, 10, 12, 10, 0).getTime());
assert.strictEqual(parseReset('Resets Fri 9:00 PM', now), new Date(2026, 10, 6, 21, 0).getTime());   // hoy más tarde
assert.strictEqual(parseReset('Resets Fri 7:00 PM', now), new Date(2026, 10, 13, 19, 0).getTime());  // ya pasó: la semana siguiente
assert.strictEqual(parseReset('Resets Dec 1', now), null);
assert.strictEqual(parseReset(null, now), null);

// ---- forecast ----
function hist(label, startUsed, perHour, minutes) {
  const out = [];
  for (let m = -minutes; m <= 0; m += 5) {
    out.push({ t: now + m * 60000, values: { [label]: startUsed + (perHour * (m + minutes)) / 60 } });
  }
  return out;
}
const L = 'Current session';

// 10 %/h durante la última hora: de 20 % a 30 %
let h = hist(L, 20, 10, 60);
let f = forecast(h, { label: L, kind: 'session', used: 30, reset: 'Resets in 3 hr' }, now);
assert.strictEqual(f.status, 'ok');
assert.ok(Math.abs(f.ratePerHour - 10) < 0.01);
assert.ok(Math.abs(f.hoursToFull - 7) < 0.01);
assert.ok(Math.abs(f.projectedAtReset - 60) < 0.01);
assert.strictEqual(f.willExceed, false);

// 30 %/h: se agota antes del reinicio
h = hist(L, 0, 30, 60);
f = forecast(h, { label: L, kind: 'session', used: 30, reset: 'Resets in 3 hr' }, now);
assert.strictEqual(f.willExceed, true);
assert.strictEqual(f.projectedAtReset, 100);

// Sin hora de reinicio comprensible
f = forecast(hist(L, 20, 10, 60), { label: L, kind: 'session', used: 30, reset: null }, now);
assert.strictEqual(f.projectedAtReset, null);
assert.strictEqual(f.willExceed, null);

// Pocos datos
f = forecast(hist(L, 20, 10, 5), { label: L, kind: 'session', used: 21, reset: null }, now);
assert.strictEqual(f.status, 'collecting');

// Sin consumo
f = forecast(hist(L, 30, 0, 60), { label: L, kind: 'session', used: 30, reset: null }, now);
assert.strictEqual(f.status, 'idle');

// Límite agotado
assert.strictEqual(forecast([], { label: L, kind: 'session', used: 100, reset: null }, now).status, 'full');

// Un reinicio en mitad del histórico: solo cuentan las lecturas posteriores
h = [...hist(L, 70, 10, 120).filter((p) => p.t < now - 60 * 60000), ...hist(L, 2, 6, 60)];
f = forecast(h, { label: L, kind: 'session', used: 8, reset: null }, now);
assert.strictEqual(f.status, 'ok');
assert.ok(Math.abs(f.ratePerHour - 6) < 0.05, `ritmo tras reinicio: ${f.ratePerHour}`);

console.log('✔ forecast: todas las pruebas pasan');
