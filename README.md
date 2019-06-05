# webpack-retry-load-plugin

如果你的站点使用的 CDN，该插件会绑定自动从你配置的其它域名 (例如主域) 重新下载哪些失败的资源。
插件必须配合 html-webpack-plugin 和 mini-css-extract-plugin。

支持同步 JS/CSS 自动重试，也支持异步 JS/CSS 自动重试(通过 webpack import 的 chunk)

并且你可以配置监控，支持上报成功和失败的量。

## Usage

install

```shell
npm i -D @kitten-team/webpack-retry-load-plugin
```

webpack config

```js
const RetryPlugin = require('webpack-retry-load-plugin');
{
  output:{
    publicPath:"//cdn.com/pc/", // cdn地址
  },
  plugins: [
    new RetryPlugin({
      // 重试加载地址，必须以'/'结尾
      retryPublicPath: '//example.com/pc/', 

      // 可选，不通过该插件【同步】处理的文件（依然会被加上onerror标签）
      exclude: 'tingyun-rum',

      // 可选，json格式纯文件名对应备份文件全名, 需将js和css分开
      // 在重试时会查询该字典，将js及css的src由 "[publicPath]a.[hash].js" 替换为 "[retryPublicPath]a.[hash_bk].js"
      // 若不引入hash则可不传
      // 字典中不存在的文件名将被保持原状
      bkFileNames: JSON.stringify({
        js: { 'a': 'a.[hash_bk].js', ... },
        css: { 'b': 'b__[hash_bk].css', ...},
      })
    }),
  ]
}
```
