const Template = require('webpack/lib/Template');
const { pluginName } = require('./const');

class MainTemplatePlugin {
  constructor(retryPlugin, compilation) {
    this.retryPlugin = retryPlugin;
    this.compilation = compilation;
  }

  jsonpScriptPlugin(mainTemplate, source) {
    return (Template.asString || mainTemplate.asString)([
      source,
      `// ${pluginName} inject retry load js resource`,
      "script.setAttribute('isAsync','')",
      'var retryJS = function(event){',
      Template.indent([
        'clearTimeout(timeout);',
        this.retryPlugin.genRetryCode('onScriptComplete(event);'),
        '}',
      ]),
      'script.onload = function(event){',
      Template.indent([
        'onScriptComplete(event);',
        'retryJS.call(this,event);',
      ]),
      '}',
      'script.onerror = retryJS;',
    ]);
  }

  cssPlugin(mainTemplate, source) {
    return (Template.asString || mainTemplate.asString)([
      source,
      `// ${pluginName} css retry`,
      'var toString = Object.prototype.toString;',
      'var cssChunksPromise=typeof installedCssChunks!=="undefined"&&installedCssChunks[chunkId]',
      "if(toString.call(cssChunksPromise) ==='[object Promise]'&&cssChunks[chunkId]===1 ){",
      Template.indent([
        'cssChunks[chunkId]=2;// 标记已经catch过',
        'var newP = cssChunksPromise.catch(function(err){',
        Template.indent([
          'return new Promise(function(resolve,reject){',
          Template.indent([
            'var src = err.request;',
            'var newSrc = getRetryUrl(src);',
            "var head = document.getElementsByTagName('head')[0];",
            "var link = document.createElement('link');",
            "link.rel = 'stylesheet';",
            'link.href= newSrc;',
            "link.setAttribute('retry','');",
            'link.onerror=function(){',
            Template.indent([
              'link.onerror=link.onload=null',
              '// css retry fail',
              'reject(err);',
            ]),
            '};',
            'link.onload=function(){',
            Template.indent([
              'link.onerror=link.onload=null',
              '// css retry success',
              'resolve();',
            ]),
            '};',
            'head.appendChild(link);',
          ]),
          '})',
        ]),
        '})',
        'promises.splice(promises.indexOf(cssChunksPromise),1,newP);',
      ]),
      '}',
    ]);
  }

  apply(mainTemplate) {
    const jsonpScriptPlugin = this.jsonpScriptPlugin.bind(this, mainTemplate);
    const cssPlugin = this.cssPlugin.bind(this, mainTemplate);
    const { hooks } = mainTemplate;
    if (hooks.jsonpScript && hooks.requireEnsure) {
      hooks.localVars.tap(pluginName, source => {
        return Template.asString([
          source,
          `// ${pluginName} get retry function`,
          this.retryPlugin.genGetRetryUrlCode(),
        ]);
      });
      hooks.jsonpScript.tap(pluginName, jsonpScriptPlugin);
      hooks.requireEnsure.tap(pluginName, cssPlugin);
    } else {
      throw Error(`The ${pluginName} is not useful for non-web targets.`);
    }
  }
}
module.exports = MainTemplatePlugin;
