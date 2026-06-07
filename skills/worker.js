const { parentPort } = require('worker_threads');
const vm = require('vm');
const { validateCode } = require('./validator');

let messageIdCounter = 0;
const pendingRequests = new Map();

parentPort.on('message', async (msg) => {
  if (msg.type === 'run') {
    try {
      validateCode(msg.code);

      const mmskills = {
        move: {
          walk: (...args) => callMain('mmskills', ['move', 'walk'], args),
          run: (...args) => callMain('mmskills', ['move', 'run'], args),
          lookat: (...args) => callMain('mmskills', ['move', 'lookat'], args),
          jump: (...args) => callMain('mmskills', ['move', 'jump'], args),
          sneak: (...args) => callMain('mmskills', ['move', 'sneak'], args)
        },
        block: {
          place: (...args) => callMain('mmskills', ['block', 'place'], args),
          break: (...args) => callMain('mmskills', ['block', 'break'], args),
          interact: (...args) => callMain('mmskills', ['block', 'interact'], args)
        },
        inventory: {
          items: (...args) => callMain('mmskills', ['inventory', 'items'], args),
          unequip: (...args) => callMain('mmskills', ['inventory', 'unequip'], args),
          equip: (...args) => callMain('mmskills', ['inventory', 'equip'], args),
          toss: (...args) => callMain('mmskills', ['inventory', 'toss'], args),
          craft: (...args) => callMain('mmskills', ['inventory', 'craft'], args),
          isOpenUI: (...args) => callMain('mmskills', ['inventory', 'isOpenUI'], args)
        },
        window: {
          current: (...args) => callMain('mmskills', ['window', 'current'], args),
          leftClick: (...args) => callMain('mmskills', ['window', 'leftClick'], args),
          rightClick: (...args) => callMain('mmskills', ['window', 'rightClick'], args),
          shiftClick: (...args) => callMain('mmskills', ['window', 'shiftClick'], args)
        },
        entity: {
          interact: (...args) => callMain('mmskills', ['entity', 'interact'], args),
          attack: (...args) => callMain('mmskills', ['entity', 'attack'], args)
        },
        ai: {
          saveExperience: (...args) => callMain('mmskills', ['ai', 'saveExperience'], args),
          saveSpatialMemory: (...args) => callMain('mmskills', ['ai', 'saveSpatialMemory'], args),
          setEmergencyMode: (...args) => callMain('mmskills', ['ai', 'setEmergencyMode'], args)
        },
        vision: {
          takeScreenshot: (...args) => callMain('mmskills', ['vision', 'takeScreenshot'], args)
        }
      };

      const botAPI = {
        chat: (text) => callMain('bot', ['chat'], [text]),
        setControlState: (control, state) => callMain('bot', ['setControlState'], [control, state]),
        clearControlStates: () => callMain('bot', ['clearControlStates'], []),
        getHealth: () => callMain('bot', ['health'], [], true),
        getPosition: () => callMain('bot', ['entity', 'position'], [], true)
      };

      const context = {
        mmskills,
        botAPI,
        console: {
          log: (...args) => callMain('console', ['log'], args),
          error: (...args) => callMain('console', ['error'], args)
        },
        require: require,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        Promise
      };

      vm.createContext(context);
      const script = new vm.Script(`
        (async () => {
          ${msg.code}
        })();
      `);
      const resultPromise = script.runInContext(context);
      if (resultPromise && resultPromise.then) {
        await resultPromise;
      }
      
      parentPort.postMessage({ type: 'done' });
    } catch (err) {
      parentPort.postMessage({ type: 'error', error: err.message });
    }
  } else if (msg.type === 'response') {
    const p = pendingRequests.get(msg.id);
    if (p) {
      pendingRequests.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.data);
    }
  }
});

function callMain(target, path, args, isProperty = false) {
  return new Promise((resolve, reject) => {
    const id = messageIdCounter++;
    pendingRequests.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'call', target, path, args, isProperty, id });
  });
}
