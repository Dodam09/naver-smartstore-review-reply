(function () {
  const noise = /Bad (un)?compressed size:/;
  ['error', 'warn'].forEach((method) => {
    const native = console[method].bind(console);
    console[method] = function (...args) {
      const msg = args.map((a) => String(a)).join(' ');
      if (noise.test(msg)) return;
      return native(...args);
    };
  });
})();
