# Steedos Accounts

Fullstack authentication and accounts-management for steedos.

## Connect to mongodb

```bash
export MONGO_URL=mongodb://127.0.0.1/steedos
```

## process.ENV
```bash
export ROOT_URL=http://127.0.0.1:4000/
```

## Start Server at 4000

```bash
yarn
yarn start
```

Server apis runs on https://127.0.0.1:4000/accounts/

## Debug Webapp at 3000

```bash
cd webapp
yarn
yarn start
```

Navigate to https://127.0.0.1:3000/ to view react webapp.

## Build Webapp to 4000

```bash
cd webapp
yarn
yarn build
```

Build webapp to /webapps/build folder, will mount to https://127.0.0.1:4000/accounts/a/

Navigate to https://127.0.0.1:4000/ , will redirect to build webapp at https://127.0.0.1:4000/accounts/a/

## 密码策略
默认密码格式要求为：密码必须包含字符、数字和字母，并至少有一个大写字母，且不能少于8位
可通过steedos-config.ym配置文件进行重写：
```
public:
  accounts:
    password:
      policy:
        reg: ^(?![A-Z]+$)(?![a-z]+$)(?!\d+$)\S{8,}$
        regErrorMessage: 密码必须包含字母和数字，且不能少于8位
```
## 功能说明
- 此包用于提供登录及注册页面的服务端接口