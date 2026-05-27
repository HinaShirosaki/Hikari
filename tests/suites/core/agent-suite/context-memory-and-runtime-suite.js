module.exports = function registerAgentContextMemoryAndRuntimeSuite(context = {}) {
  const registerParts = [
    require('./context-memory-and-runtime-suite/part-01.js'),
    require('./context-memory-and-runtime-suite/part-02.js'),
    require('./context-memory-and-runtime-suite/part-03.js'),
    require('./context-memory-and-runtime-suite/part-04.js'),
    require('./context-memory-and-runtime-suite/part-05.js'),
    require('./context-memory-and-runtime-suite/part-06.js'),
    require('./context-memory-and-runtime-suite/part-07.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
