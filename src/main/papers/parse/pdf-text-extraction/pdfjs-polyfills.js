'use strict';

const { ensureObject } = require('../../../lib/normalize.js');

class PdfTextDomMatrix {
  constructor(init) {
    const values = Array.isArray(init) || ArrayBuffer.isView(init)
      ? Array.from(init)
      : null;
    const source = values || ensureObject(init);
    this.a = numberOrDefault(values ? values[0] : source.a ?? source.m11, 1);
    this.b = numberOrDefault(values ? values[1] : source.b ?? source.m12, 0);
    this.c = numberOrDefault(values ? values[2] : source.c ?? source.m21, 0);
    this.d = numberOrDefault(values ? values[3] : source.d ?? source.m22, 1);
    this.e = numberOrDefault(values ? values[4] : source.e ?? source.m41, 0);
    this.f = numberOrDefault(values ? values[5] : source.f ?? source.m42, 0);
    this.is2D = true;
  }

  get m11() { return this.a; }
  set m11(value) { this.a = Number(value) || 0; }
  get m12() { return this.b; }
  set m12(value) { this.b = Number(value) || 0; }
  get m21() { return this.c; }
  set m21(value) { this.c = Number(value) || 0; }
  get m22() { return this.d; }
  set m22(value) { this.d = Number(value) || 0; }
  get m41() { return this.e; }
  set m41(value) { this.e = Number(value) || 0; }
  get m42() { return this.f; }
  set m42(value) { this.f = Number(value) || 0; }

  multiply(other) {
    return new PdfTextDomMatrix(this).multiplySelf(other);
  }

  multiplySelf(other) {
    const matrix = new PdfTextDomMatrix(other);
    const a = this.a * matrix.a + this.c * matrix.b;
    const b = this.b * matrix.a + this.d * matrix.b;
    const c = this.a * matrix.c + this.c * matrix.d;
    const d = this.b * matrix.c + this.d * matrix.d;
    const e = this.a * matrix.e + this.c * matrix.f + this.e;
    const f = this.b * matrix.e + this.d * matrix.f + this.f;
    return this.#set(a, b, c, d, e, f);
  }

  preMultiplySelf(other) {
    const matrix = new PdfTextDomMatrix(other);
    const a = matrix.a * this.a + matrix.c * this.b;
    const b = matrix.b * this.a + matrix.d * this.b;
    const c = matrix.a * this.c + matrix.c * this.d;
    const d = matrix.b * this.c + matrix.d * this.d;
    const e = matrix.a * this.e + matrix.c * this.f + matrix.e;
    const f = matrix.b * this.e + matrix.d * this.f + matrix.f;
    return this.#set(a, b, c, d, e, f);
  }

  translate(tx = 0, ty = 0) {
    return new PdfTextDomMatrix(this).translateSelf(tx, ty);
  }

  translateSelf(tx = 0, ty = 0) {
    return this.multiplySelf([1, 0, 0, 1, numberOrDefault(tx, 0), numberOrDefault(ty, 0)]);
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new PdfTextDomMatrix(this).scaleSelf(scaleX, scaleY);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.multiplySelf([numberOrDefault(scaleX, 1), 0, 0, numberOrDefault(scaleY, 1), 0, 0]);
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant) {
      return this.#set(NaN, NaN, NaN, NaN, NaN, NaN);
    }
    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;
    return this.#set(a, b, c, d, e, f);
  }

  toFloat32Array() {
    return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  toFloat64Array() {
    return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  #set(a, b, c, d, e, f) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function installPdfJsNodePolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = PdfTextDomMatrix;
  }
  // pdf.js 4+ relies on the TC39 stage-3 `Map.prototype.getOrInsertComputed`,
  // which Node does not yet ship. Without this polyfill `getOperatorList()`
  // (and therefore figure extraction) throws on every call.
  if (typeof Map.prototype.getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value(key, callbackfn) {
        if (this.has(key)) {
          return this.get(key);
        }
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true
    });
  }
}

module.exports = {
  installPdfJsNodePolyfills
};
