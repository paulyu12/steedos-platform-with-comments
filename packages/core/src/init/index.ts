// import { Datasources } from './datasources'
import { Core, initCreator, initDesignSystem, initPublic } from './core'
import { Plugins } from './plugins';
import { getSteedosSchema } from '@steedos/objectql';
import * as migrate from '@steedos/migrate';
import { initPublicStaticRouter } from '../routes';
// import { InitI18n } from './i18n';
// import { loadPackages } from './packages';
import { InitTranslations } from './translations';
export { loadClientScripts, loadRouters, removeRouter } from './core'
export { loadPackage } from './packages'
export async function init(settings: any = {}) {
    getSteedosSchema();
    WebAppInternals.setInlineScriptsAllowed(false);
    initPublicStaticRouter();
    initPublic();
    initDesignSystem();
    await Plugins.init(settings);
    // Datasources.loadFiles();
    // await loadPackages();

    // yupeng: 其实是给 Creator 这个对象增加一些自定义属性
    await initCreator();
    // await Datasources.init();
    await migrate.init();
    await InitTranslations();

    // yupeng: 把所有的定义的后端路由加载起来
    Core.run();
}
export * from './translations';
export * from './collection';