/* eslint-disable no-continue,no-restricted-syntax */
const { ConcatSource } = require('webpack-sources');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const attrParse = require('./attributesParser');
const { SCRIPT, pluginName } = require('./const');
const MainTemplatePlugin = require('./mainTemplatePlugin');
const babel = require('./babel');

/**
 * 该参数用于指示同步（首屏）js的加载状态。
 * 当首屏的js加载成功时，设置window.__JS_RETRY__[fileName] 为true
 */
const varName = 'window.__JS_RETRY__';

/**
 * @typedef {Object} PluginOptions
 * @property {String} retryPublicPath 重试加载地址，必须以'/'结尾
 * @property {String?} bkFileNames json格式文件名对应文件地址
 * @property {Boolean?} entryOnly default false
 * 以下不直接使用，但在matchObject中生效
 * 
 * @property {String|RegExp|Array?} include 需要重试的文件，若此项不为空则exclude无效，只重试被指定的文件
 * @property {String|RegExp|Array?} exclude 不需要重试的文件
 */

class RetryPlugin {
  constructor(options) {
    if (arguments.length > 1) {
      throw new Error('Retry only takes one argument (pass an options object)');
    }
    if (!options || options.retryPublicPath === undefined) {
      throw new Error('Retry need options.retryPublicPath');
    }

    /** @type {PluginOptions} */
    this.options = Object.assign(
      {
        minimize: false, // 默认不压缩
      },
      options
    );
  }

  /**
   * 插入getRetryUrlCode函数。
   * 仅插入函数定义。
   */
  genGetRetryUrlCode() {
    return `
  function getRetryUrl(src) {
    var retryPublicPath  = '${this.options.retryPublicPath}';
    var publicPath = '${this.publicPath}';
    var bkFileNames = '${this.options.bkFileNames}';

    if (!retryPublicPath || !publicPath || !src.includes(publicPath)) {
      return src;
    }

    var fileName = src.slice(src.lastIndexOf('/') + 1);
    var token = fileName.split('.');
    var fileType = token[token.length - 1];
    var filePrefix = src.replace(publicPath, '').replace(fileName, '');

    if (bkFileNames == 'undefined' || (fileType !== 'js' && fileType !== 'css')) {
      return retryPublicPath + filePrefix + fileName;
    }

    const bkFileNameMap = JSON.parse(bkFileNames);
    const pureName = fileType === 'js' ? token[0] : token[0].split('__')[0];
    const retryFileName = bkFileNameMap[fileType][pureName] || fileName;
    return retryPublicPath + filePrefix + retryFileName;
  }
`;
  }

  /**
   * 重试部分的代码。
   * @param {String} jsComplete 在js处理执行完成后执行的script.
   */
  genRetryCode(jsComplete = '') {
    return `
  var isRetry = this.hasAttribute('retry');
  var isAsync = this.hasAttribute('isAsync')||this.hasAttribute('async');
  var isStyle = this.tagName==='LINK';
  var isError = event.type==='error'||event.type==='timeout';
  var src = this.href||this.src;
  var newSrc = getRetryUrl(src);
  if(isError){ // 失败
    if(isRetry){ 
      // Retry fails
    }else{ // 首次加载失败，插入新标签
      // insert new script or css
      // FIXME delete original one?
      if(isStyle){
        // link style 重新加载
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href= newSrc;
        link.setAttribute('retry','');
        link.setAttribute('onerror',"__retryPlugin.call(this,event)");
        link.setAttribute('onload',"__retryPlugin.call(this,event)");
        this.parentNode.insertBefore(link,this.nextSibling);
      }else if(isAsync){
        // 只有异步的js走这个重试逻辑，同步的都是采用document.write
        // 此处‘异步’包括插入html的带async标签的js文件，以及webpack打包之后动态加载的js bundle
        var head = document.getElementsByTagName('head')[0];
        var script = document.createElement('script');
      
        script.charset = 'utf-8';
        script.timeout = 120;
        script.src = newSrc;
        if (script.src.indexOf(window.location.origin + '/') !== 0) {
          script.crossOrigin = 'anonymous';
        }
        var _timeout_ = setTimeout(function() {
          script.onerror({ type: 'timeout', target: script });
        }, 120000);

        // register retry error event
        script.onerror = function(event){
          script.onerror = script.onload = null;
          clearTimeout(_timeout_);
          ${jsComplete}
          // Js retry fail
        }
        script.onload = function(event){
          script.onerror = script.onload = null;
          clearTimeout(_timeout_);
          ${jsComplete}
          // Js retry success
        }
        head.appendChild(script);
      }  // end of js 重新加载
      // Load fail (not retry)
    }
  }else{ // 成功
    ${varName}=${varName}||{};
    var basename = src.substr(src.lastIndexOf('/')+1);
    ${varName}[basename]=true;
    if(isRetry){
      // Retry success
    }else{
      // Load success 
    }
  }
`;
  }

  /**
   * 生成retryPlugin函数。
   * 没有任何立即生效的操作。
   */
  async genInjectCode() {
    let code = `
${varName}=${varName}||{};
function __retryPlugin(event){
try{// 修复部分浏览器this.tagName获取失败的问题
this.onload=this.onerror = null;
${this.genGetRetryUrlCode()}
${this.genRetryCode()}
}catch(e){
console.error(e);
}
}`;
    code = await babel(code, this.options);
    return `<script>${code}</script>`;
  }

  /**
   * 获取替换后的资源地址
   * @param {String} src 原资源地址
   */
  getRetryUrl(src) {
    const { retryPublicPath, bkFileNames } = this.options;
    const { publicPath } = this;

    if (!retryPublicPath || !publicPath || !src.includes(publicPath)) {
      return src;
    }

    const fileName = src.slice(src.lastIndexOf('/') + 1);
    const token = fileName.split('.');
    const fileType = token[token.length - 1];
    const filePrefix = src.replace(publicPath, '').replace(fileName, '');

    if (!bkFileNames || (fileType !== 'js' && fileType !== 'css')) {
      return retryPublicPath + filePrefix + fileName;
    }

    const bkFileNameMap = JSON.parse(bkFileNames);
    const pureName = fileType === 'js' ? token[0] : token[0].split('__')[0];
    const retryFileName = bkFileNameMap[fileType][pureName] || fileName;
    return retryPublicPath + filePrefix + retryFileName;
  }

  /**
   * 注册htmlwebpakplugin钩子
   * 1. 为每个非内联script和css标签注册onerror和onload函数
   * 2. 在index.html文件里插入retryPlugin方法，在head内的最上方
   * @param {*} compilation 
   */
  registerHwpHooks(compilation) {
    // HtmlWebpackPlugin >= 4
    const hooks = HtmlWebpackPlugin.getHooks(compilation);
    hooks.beforeAssetTagGeneration.tapAsync(
      pluginName,
      (pluginArgs, callback) => {
        callback(null, pluginArgs);
      }
    );
    
    // 为每个script和stylesheets注册onerror和onload函数
    hooks.alterAssetTags.tap(pluginName, ({ assetTags }) => {
      const code = '__retryPlugin.call(this,event)';
      const isFromPublicPath = url => url && url.includes(this.publicPath);
      assetTags.styles.forEach(tag => {
        if (!isFromPublicPath(tag.attributes.href)) { return; }
        tag.attributes.onerror = code;
        tag.attributes.onload = code;
      });
      assetTags.scripts
        .forEach(tag => {
          if (!isFromPublicPath(tag.attributes.src)) { return; }
          tag.attributes.onerror = code;
          tag.attributes.onload = code;
        });
    });

    // 在html文件中注入retryPlugin相关代码
    hooks.beforeEmit.tapAsync(pluginName, async (pluginArgs, callback) => {
      let { html } = pluginArgs;
      html = html.replace('<head>', `<head>${await this.genInjectCode()}`);
      const scripts = attrParse(html).filter(tag => tag.name === SCRIPT);

      /**
       * 以下代码为对首屏非内联js（即打包时就插入index.html的js文件）的处理，如kitten.js
       * 对于这些js文件，通过修改代码使其在加载成功后将__JS_RETRY__中的对应chunk值标记为true
       * 并在每个js文件的script标签下面插入一段script，内容为当该js加载不成功时，立即用document.write向文档中写入用于重试的标签
       * 
       * 保证所有同步js按照顺序加载
       */
      scripts.reverse();
      html = [html];
      scripts.forEach(tag => {
        const { attrs } = tag;
        let origin_url = '';
        attrs.forEach(attr => {
          if (attr.name === 'src') {
            origin_url = attr.value;
            attr.value = this.getRetryUrl(attr.value);
          }
        });

        if (!origin_url) {
          throw Error('not url');
        }
        let code = '';

        if (this.matchObject(origin_url)) {
          const filename = path.basename(origin_url);
          const script = `\\x3Cscript type="text/javascript" ${attrs
            .filter(({ name }) => name !== 'crossOrigin')
            .map(i => `${i.name}="${i.value}"`)
            .join(' ')} retry>\\x3C/script>`;
          code = `<script>if(!${varName}["${filename}"]) {document.write('${script}');}</script>`;
        }

        const x = html.pop();
        html.push(x.substr(tag.end));
        html.push(code);
        html.push(x.substr(0, tag.end));
      });
      html.reverse();
      html = html.join('');

      pluginArgs.html = html;
      callback(null, pluginArgs);
    });
  }

  registerMTP(compiler, compilation) {
    const plugin = new MainTemplatePlugin(this, compilation);
    if (plugin.apply) {
      plugin.apply(compilation.mainTemplate);
    } else {
      compilation.mainTemplate.apply(plugin);
    }
  }

  // webpack的asRegExp方法会在生成的正则表达式前加^
  // 即只匹配文件名前缀
  // 此处做修改以匹配文件全名
  matchPart (str, test) {
    if (!test) return true;
    const asRegExp = test => {
      if (typeof test === 'string') {
        test = new RegExp(test.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"));
      }
      return test;
    };
    test = asRegExp(test);
    if (Array.isArray(test)) {
      return test.map(asRegExp).some(regExp => regExp.test(str));
    } else {
      return test.test(str);
    }
  };

  matchObject (str) {
    if (this.options.include) {
      if (!this.matchPart(str, this.options.include)) {
        return false;
      }
    }
    if (this.options.exclude) {
      if (this.matchPart(str, this.options.exclude)) {
        return false;
      }
    }
    return true;
  };

  apply(compiler) {
    const { options } = this;
    this.publicPath = compiler.options.output.publicPath;

    // Do nothing when the retry path is useless (the same to the original one)
    if (this.publicPath === options.retryPublicPath) {
      return;
    }

    compiler.hooks.compilation.tap(pluginName, compilation => {
      this.registerHwpHooks(compilation);
      compilation.hooks.optimizeChunkAssets.tap(pluginName, chunks => {
        for (const chunk of chunks) {
          if (options.entryOnly && !chunk.canBeInitial()) {
            continue;
          }
          for (const file of chunk.files) {
            // 根据options筛选出需要处理的文件
            if (!this.matchObject(file)) {
              continue;
            }

            let basename;
            let filename = file;

            const querySplit = filename.indexOf('?');

            if (querySplit >= 0) {
              filename = filename.substr(0, querySplit);
            }

            const lastSlashIndex = filename.lastIndexOf('/');

            if (lastSlashIndex === -1) {
              basename = filename;
            } else {
              basename = filename.substr(lastSlashIndex + 1);
            }

            // 只有js需要标记，css无法执行该方法
            if (!/.js$/.test(filename) || /worker.js$/.test(filename)) {
              continue;
            }
            const code = `${varName}=${varName}||{}; ${varName}["${basename}"]=true;`;

            compilation.assets[file] = new ConcatSource(
              code,
              '\n',
              compilation.assets[file]
            );
          }
        }
      });
    });
    // eslint-disable-next-line
    compiler.hooks.afterPlugins.tap(pluginName, compiler => {
      compiler.hooks.thisCompilation.tap(
        pluginName,
        this.registerMTP.bind(this, compiler)
      );
    });
  }
}

module.exports = RetryPlugin;
