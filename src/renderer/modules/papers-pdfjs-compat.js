function defineCompatMethod(target, name, implementation) {
  if (!target || typeof target[name] === 'function') {
    return;
  }
  Object.defineProperty(target, name, {
    value: implementation,
    configurable: true,
    writable: true
  });
}

export function installPdfJsCompat(targetGlobal = globalThis) {
  const PromiseCtor = targetGlobal?.Promise;
  const MapCtor = targetGlobal?.Map;
  const SetCtor = targetGlobal?.Set;

  if (PromiseCtor) {
    defineCompatMethod(PromiseCtor, 'withResolvers', function withResolvers() {
      let resolve;
      let reject;
      const promise = new PromiseCtor((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    });
  }

  if (MapCtor?.prototype) {
    defineCompatMethod(MapCtor.prototype, 'getOrInsert', function getOrInsert(key, defaultValue) {
      if (this.has(key)) {
        return this.get(key);
      }
      this.set(key, defaultValue);
      return defaultValue;
    });

    defineCompatMethod(MapCtor.prototype, 'getOrInsertComputed', function getOrInsertComputed(key, factory) {
      if (this.has(key)) {
        return this.get(key);
      }
      const value = typeof factory === 'function' ? factory(key) : factory;
      this.set(key, value);
      return value;
    });
  }

  if (SetCtor?.prototype) {
    defineCompatMethod(SetCtor.prototype, 'intersection', function intersection(other) {
      const result = new SetCtor();
      if (!other || typeof other.has !== 'function') {
        return result;
      }
      for (const value of this) {
        if (other.has(value)) {
          result.add(value);
        }
      }
      return result;
    });
  }

  return targetGlobal;
}
