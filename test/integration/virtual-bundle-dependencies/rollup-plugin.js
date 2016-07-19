'use strict';

const VIRTUAL_DEP_IDS = ['\0helper'];

module.exports = {
  name: 'virtual-dep-injector',
  resolveId: (importee, importer) => {
    if (VIRTUAL_DEP_IDS.indexOf(importee) !== -1) return importee;
  },
  load: (id) => {
    if(VIRTUAL_DEP_IDS.indexOf(id) !== -1) return 'export default "hello world";';
  },
  transform: (code, id) => {
    if (VIRTUAL_DEP_IDS.indexOf(id) === -1) {
      let addedImports = '';
      let i = 0;
      for (let id of VIRTUAL_DEP_IDS) {
        addedImports += `import * as dependency${i++} from '${id}';\n`;
      }
      code = addedImports + code;
    }
    return {code, map: null};
  }
};
