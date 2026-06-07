const acorn = require('acorn');
const walk = require('acorn-walk');

const ALLOWED_REQUIRES = ['vec3'];
const BANNED_GLOBALS = ['process', 'eval', 'Function'];

function validateCode(codeStr) {
  let ast;
  try {
    ast = acorn.parse(codeStr, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch (err) {
    throw new Error(`Syntax Error: ${err.message}`);
  }

  walk.simple(ast, {
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        if (node.arguments.length > 0 && node.arguments[0].type === 'Literal') {
          const moduleName = node.arguments[0].value;
          if (!ALLOWED_REQUIRES.includes(moduleName)) {
            throw new Error(`Security Violation: require('${moduleName}') is not allowed. Only whitelisted modules like vec3 are permitted.`);
          }
        } else {
          throw new Error(`Security Violation: require() must be called with a string literal.`);
        }
      }
    },
    Identifier(node) {
      if (BANNED_GLOBALS.includes(node.name)) {
        throw new Error(`Security Violation: Access to global '${node.name}' is prohibited.`);
      }
    }
  });
}

module.exports = { validateCode };
