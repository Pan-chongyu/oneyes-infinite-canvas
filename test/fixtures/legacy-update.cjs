const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Unmodified desktop sources from v0.20.207. Keep these frozen: the release
// tests must exercise installed clients, not emulate them with the new parser.
function legacyUpdate(name) {
    const module = { exports: {} };
    const source = readFileSync(join(__dirname, 'updater-v0.20.207', name), 'utf8');
    const legacyRequire = id => id === './update-policy.cjs' ? legacyUpdate('update-policy.cjs') : id.startsWith('./') ? require('../../desktop/' + id.slice(2)) : require(id);
    new Function('require', 'module', 'exports', source)(legacyRequire, module, module.exports);
    return module.exports;
}
module.exports = { legacyUpdate };
